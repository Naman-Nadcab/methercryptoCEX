/**
 * Writer colocated public WS fan-out: PID-scaled coalescing (vs oscillating linear lag map),
 * per-symbol timers + activity-aware batching, optional orderbook delta burst merge, adaptive hints.
 */

import { config } from '../config/index.js';
import {
  wireEnvelope,
  nextTradesFeedSeq,
  deliverPublicWireLocal,
  publishSpotBroadcastPayload,
  publishSystemWireToAll,
  getSpotWsBroadcastBacklogBytes,
  getSpotWsNetworkInflationMs,
} from './spot-ws.service.js';
import { getWriterProcessingLagMs, getWriterPendingEstimate } from './spot-orderbook-writer-state.service.js';
import { stepWsAdaptivePid } from './ws-adaptive-pid.service.js';
import {
  spotWsWriterLocalMode,
  spotWsLocalTickerCoalesceFlushTotal,
  spotWsLocalTradesBatchFlushTotal,
  spotWsLocalOrderbookBurstMergedTotal,
  spotWsAdaptiveModeBroadcastTotal,
} from '../lib/prometheus-metrics.js';

type ShedMode = 0 | 1 | 2;

const symbolActivity = new Map<string, number>();

function touchSymbolActivity(sym: string): void {
  const prev = symbolActivity.get(sym) ?? 0;
  symbolActivity.set(sym, prev * 0.97 + 1);
}

function symbolBatchMult(sym: string): number {
  const a = symbolActivity.get(sym) ?? 0;
  return 1 + Math.min(0.85, a / 75);
}

function computeWriterLocalShedMode(): ShedMode {
  if (!config.wsWriterLocal.shedEnabled) return 0;
  const cfg = config.wsForwarderShed;
  const pending = getWriterPendingEstimate();
  const lag = getWriterProcessingLagMs();
  const backlog = getSpotWsBroadcastBacklogBytes();

  let mode: ShedMode = 0;
  const hit2 =
    (cfg.tier2Pending > 0 && pending >= cfg.tier2Pending) ||
    (cfg.tier2LagMs > 0 && lag >= cfg.tier2LagMs) ||
    (cfg.tier2BacklogBytes > 0 && backlog >= cfg.tier2BacklogBytes);
  const hit1 =
    (cfg.tier1Pending > 0 && pending >= cfg.tier1Pending) ||
    (cfg.tier1LagMs > 0 && lag >= cfg.tier1LagMs) ||
    (cfg.tier1BacklogBytes > 0 && backlog >= cfg.tier1BacklogBytes);
  if (hit2) mode = 2;
  else if (hit1) mode = 1;
  return mode;
}

/** Linear lag→factor fallback when PID disabled. */
function linearLagFactor(lag: number): number {
  const t2 = config.wsForwarderShed.tier2LagMs;
  if (t2 <= 0) return 1;
  return Math.min(3, 1 + lag / t2);
}

function effectiveCoalesceMultiplier(lag: number): number {
  const wl = config.wsWriterLocal;
  if (!wl.dynamicCoalesce) return 1;
  if (wl.pidEnabled) {
    return stepWsAdaptivePid(lag, getSpotWsNetworkInflationMs());
  }
  return linearLagFactor(lag);
}

function clampMs(base: number, raw: number, maxMs: number): number {
  if (maxMs <= 0) return Math.max(base, raw);
  return Math.min(maxMs, Math.max(base, Math.floor(raw)));
}

/** Hint line without per-symbol activity (for adaptive_mode JSON only). */
function hintTickerMsGlobal(lag: number): number {
  const wl = config.wsWriterLocal;
  const base = wl.tickerCoalesceMs;
  if (base <= 0) return 0;
  return clampMs(base, base * effectiveCoalesceMultiplier(lag), wl.tickerCoalesceMaxMs || base);
}

function hintTradesBatchMsGlobal(lag: number): number {
  const wl = config.wsWriterLocal;
  const base = wl.tradesBatchMs;
  return clampMs(base, base * effectiveCoalesceMultiplier(lag), wl.tradesBatchMsMax);
}

function effectiveTickerCoalesceMs(lag: number, sym: string): number {
  const wl = config.wsWriterLocal;
  const base = wl.tickerCoalesceMs;
  if (base <= 0) return 0;
  const ms = base * effectiveCoalesceMultiplier(lag) * symbolBatchMult(sym);
  return clampMs(base, ms, wl.tickerCoalesceMaxMs || base);
}

function effectiveTradesBatchMs(lag: number, sym: string): number {
  const wl = config.wsWriterLocal;
  const base = wl.tradesBatchMs;
  const ms = base * effectiveCoalesceMultiplier(lag) * symbolBatchMult(sym);
  return clampMs(base, ms, wl.tradesBatchMsMax);
}

function effectiveOrderbookBurstMs(lag: number, sym: string): number {
  const wl = config.wsWriterLocal;
  const base = wl.orderbookBurstMs;
  const ms = base * effectiveCoalesceMultiplier(lag) * symbolBatchMult(sym);
  return clampMs(base, ms, wl.orderbookBurstMsMax);
}

function routePublic(channel: string, wire: string, priority: 'orderbook' | 'ticker' | 'trades'): void {
  if (config.redis.wsPubSubEnabled) {
    publishSpotBroadcastPayload({ channel, wire, priority });
  } else {
    deliverPublicWireLocal(channel, wire, priority);
  }
}

const pendingTickerBySymbol = new Map<string, string>();
const tickerTimersBySymbol = new Map<string, ReturnType<typeof setTimeout>>();

function flushTickerOne(sym: string): void {
  tickerTimersBySymbol.delete(sym);
  const wire = pendingTickerBySymbol.get(sym);
  if (!wire) return;
  pendingTickerBySymbol.delete(sym);
  spotWsLocalTickerCoalesceFlushTotal.inc();
  routePublic(`ticker:${sym}`, wire, 'ticker');
}

function enqueueTicker(sym: string, wire: string, lag: number): void {
  const ms = effectiveTickerCoalesceMs(lag, sym);
  pendingTickerBySymbol.set(sym, wire);
  const old = tickerTimersBySymbol.get(sym);
  if (old) clearTimeout(old);
  if (ms <= 0) {
    spotWsLocalTickerCoalesceFlushTotal.inc();
    routePublic(`ticker:${sym}`, wire, 'ticker');
    pendingTickerBySymbol.delete(sym);
    return;
  }
  tickerTimersBySymbol.set(
    sym,
    setTimeout(() => flushTickerOne(sym), ms),
  );
}

type TradesAcc = { rows: unknown[]; channel: string };
const pendingTradesBySymbol = new Map<string, TradesAcc>();
const tradesTimersBySymbol = new Map<string, ReturnType<typeof setTimeout>>();

function mergeTradesRows(existing: unknown[], incoming: unknown[], cap: number): unknown[] {
  const merged = [...existing, ...incoming];
  if (merged.length <= cap) return merged;
  return merged.slice(merged.length - cap);
}

function flushTradesForSymbol(sym: string): void {
  tradesTimersBySymbol.delete(sym);
  const acc = pendingTradesBySymbol.get(sym);
  if (!acc) return;
  pendingTradesBySymbol.delete(sym);
  const max = config.wsWriterLocal.tradesBatchMax;
  const rows = acc.rows.slice(-max);
  const feedSymbol = acc.channel.startsWith('trades:') ? acc.channel.slice('trades:'.length) : '';
  const w = wireEnvelope('trades', acc.channel, rows, feedSymbol ? { feed_seq: nextTradesFeedSeq(feedSymbol) } : undefined);
  spotWsLocalTradesBatchFlushTotal.inc();
  routePublic(acc.channel, w, 'trades');
}

function scheduleTradesFlushForSymbol(sym: string, lag: number): void {
  const old = tradesTimersBySymbol.get(sym);
  if (old) clearTimeout(old);
  tradesTimersBySymbol.set(
    sym,
    setTimeout(() => flushTradesForSymbol(sym), effectiveTradesBatchMs(lag, sym)),
  );
}

function parseTradesWire(wire: string): { channel: string; rows: unknown[] } | null {
  try {
    const o = JSON.parse(wire) as { channel?: string; data?: unknown };
    const ch = o.channel;
    const data = o.data;
    if (typeof ch !== 'string' || !Array.isArray(data)) return null;
    return { channel: ch, rows: data };
  } catch {
    return null;
  }
}

const pendingOrderbookBurst = new Map<string, string[]>();
const orderbookBurstTimersBySymbol = new Map<string, ReturnType<typeof setTimeout>>();

type DeltaPayload = { symbol: string; seq: number; bids: [string, string][]; asks: [string, string][] };

function parseOrderbookWireType(wire: string): string | null {
  try {
    return (JSON.parse(wire) as { type?: string }).type ?? null;
  } catch {
    return null;
  }
}

function mergeDeltaWiresOnly(wires: string[]): string | null {
  if (wires.length === 0) return null;
  if (wires.length === 1) return wires[0]!;
  const deltas: DeltaPayload[] = [];
  let channel = '';
  for (const w of wires) {
    let o: { type?: string; channel?: string; data?: unknown };
    try {
      o = JSON.parse(w) as { type?: string; channel?: string; data?: unknown };
    } catch {
      return wires[wires.length - 1]!;
    }
    if (typeof o.channel === 'string') channel = o.channel;
    if (o.type !== 'orderbook_delta' || !o.data || typeof o.data !== 'object') return wires[wires.length - 1]!;
    const d = o.data as Partial<DeltaPayload>;
    if (typeof d.seq !== 'number' || typeof d.symbol !== 'string' || !Array.isArray(d.bids) || !Array.isArray(d.asks)) {
      return wires[wires.length - 1]!;
    }
    deltas.push({
      symbol: d.symbol,
      seq: d.seq,
      bids: d.bids as [string, string][],
      asks: d.asks as [string, string][],
    });
  }
  if (deltas.length === 1) return wires[0]!;
  const bidMap = new Map<string, string>();
  const askMap = new Map<string, string>();
  let symbol = deltas[0]!.symbol;
  let seq = 0;
  for (const d of deltas) {
    symbol = d.symbol;
    seq = d.seq;
    for (const [p, q] of d.bids) bidMap.set(p, q);
    for (const [p, q] of d.asks) askMap.set(p, q);
  }
  const bids: [string, string][] = [...bidMap.entries()];
  const asks: [string, string][] = [...askMap.entries()];
  const ch = channel || `orderbook:${symbol}`;
  return wireEnvelope('orderbook_delta', ch, { symbol, seq, bids, asks });
}

function flushOrderbookForSymbol(sym: string): void {
  orderbookBurstTimersBySymbol.delete(sym);
  const wires = pendingOrderbookBurst.get(sym);
  if (!wires?.length) return;
  pendingOrderbookBurst.delete(sym);
  const types = wires.map(parseOrderbookWireType);
  const anyResync = types.some((t) => t === 'orderbook_resync');
  if (anyResync) {
    let lastResync: string | undefined;
    for (const w of wires) {
      if (parseOrderbookWireType(w) === 'orderbook_resync') lastResync = w;
    }
    if (lastResync) {
      if (wires.length > 1) spotWsLocalOrderbookBurstMergedTotal.inc();
      routePublic(`orderbook:${sym}`, lastResync, 'orderbook');
    }
    return;
  }
  const allDelta = types.every((t) => t === 'orderbook_delta');
  if (allDelta && wires.length > 1) {
    const merged = mergeDeltaWiresOnly(wires);
    if (merged) {
      spotWsLocalOrderbookBurstMergedTotal.inc();
      routePublic(`orderbook:${sym}`, merged, 'orderbook');
    }
    return;
  }
  if (allDelta && wires.length === 1) {
    routePublic(`orderbook:${sym}`, wires[0]!, 'orderbook');
    return;
  }
  if (wires.length > 1) spotWsLocalOrderbookBurstMergedTotal.inc();
  for (const w of wires) {
    routePublic(`orderbook:${sym}`, w, 'orderbook');
  }
}

function scheduleOrderbookBurstFlushForSymbol(sym: string, lag: number): void {
  const old = orderbookBurstTimersBySymbol.get(sym);
  if (old) clearTimeout(old);
  orderbookBurstTimersBySymbol.set(
    sym,
    setTimeout(() => flushOrderbookForSymbol(sym), effectiveOrderbookBurstMs(lag, sym)),
  );
}

function isOrderbookResyncWire(wire: string): boolean {
  try {
    const o = JSON.parse(wire) as { type?: string };
    return o.type === 'orderbook_resync';
  } catch {
    return false;
  }
}

function enqueueOrderbookBurst(sym: string, wire: string, lag: number): void {
  let arr = pendingOrderbookBurst.get(sym);
  if (!arr) {
    arr = [];
    pendingOrderbookBurst.set(sym, arr);
  }
  arr.push(wire);
  scheduleOrderbookBurstFlushForSymbol(sym, lag);
}

let lastAdaptiveBroadcastAt = 0;
let lastAdaptiveModeSent: ShedMode | null = null;

function maybeBroadcastAdaptiveState(
  mode: ShedMode,
  lag: number,
  pending: number,
  pidMult: number,
  netInflationMs: number,
  orderbookBurstActive: boolean
): void {
  const wl = config.wsWriterLocal;
  if (!wl.adaptiveModeEnabled) return;
  const now = Date.now();
  const minIv = wl.adaptiveModeMinIntervalMs;
  if (mode === lastAdaptiveModeSent && now - lastAdaptiveBroadcastAt < minIv) return;
  lastAdaptiveModeSent = mode;
  lastAdaptiveBroadcastAt = now;
  const ui_mode = mode === 0 ? 'normal' : mode === 1 ? 'eco' : 'minimal';
  const m = Math.max(wl.pidCoalesceMinMult, Math.min(wl.pidCoalesceMaxMult, pidMult));
  const render_budget_ob_hz = Math.max(6, Math.round(48 / m));
  const render_budget_ticker_hz = Math.max(4, Math.round(28 / m));
  const render_budget_trades_hz = Math.max(4, Math.round(22 / m));
  const wire = wireEnvelope('adaptive_mode', 'system', {
    ui_mode,
    server_shed_mode: mode,
    lag_ms: lag,
    pending,
    pid_coalesce_mult: Number(m.toFixed(4)),
    network_inflation_ms: Math.round(netInflationMs),
    ticker_coalesce_ms: hintTickerMsGlobal(lag),
    trades_batch_ms: hintTradesBatchMsGlobal(lag),
    orderbook_burst_coalesce: orderbookBurstActive,
    render_budget_ob_hz,
    render_budget_ticker_hz,
    render_budget_trades_hz,
    hint: mode === 2 ? 'orderbook_focus' : mode === 1 ? 'reduce_auxiliary_ui' : 'full_refresh',
  });
  spotWsAdaptiveModeBroadcastTotal.inc();
  publishSystemWireToAll(wire);
}

/**
 * Single call site from orderbook writer local broadcast path.
 */
export function broadcastWriterLocalFanout(
  symbol: string,
  orderbookWire: string,
  tickerWire: string | null,
  tradesWire: string | null
): void {
  const sym = symbol.toUpperCase();
  const wl = config.wsWriterLocal;
  const lag = getWriterProcessingLagMs();
  const netInfl = getSpotWsNetworkInflationMs();
  const pidMult = effectiveCoalesceMultiplier(lag);
  touchSymbolActivity(sym);

  if (!wl.optimizeEnabled) {
    routePublic(`orderbook:${sym}`, orderbookWire, 'orderbook');
    if (tickerWire) routePublic(`ticker:${sym}`, tickerWire, 'ticker');
    if (tradesWire) routePublic(`trades:${sym}`, tradesWire, 'trades');
    return;
  }

  const mode = computeWriterLocalShedMode();
  spotWsWriterLocalMode.labels(config.nodeId).set(mode);

  const burstWanted =
    wl.orderbookBurstCoalesce &&
    !isOrderbookResyncWire(orderbookWire) &&
    (lag >= wl.orderbookBurstMinLagMs || mode >= 1);

  maybeBroadcastAdaptiveState(mode, lag, getWriterPendingEstimate(), pidMult, netInfl, burstWanted);

  if (!burstWanted) {
    routePublic(`orderbook:${sym}`, orderbookWire, 'orderbook');
  } else {
    enqueueOrderbookBurst(sym, orderbookWire, lag);
  }

  if (mode >= 1) {
    pendingTickerBySymbol.delete(sym);
    const tt = tickerTimersBySymbol.get(sym);
    if (tt) clearTimeout(tt);
    tickerTimersBySymbol.delete(sym);
  } else if (tickerWire) {
    enqueueTicker(sym, tickerWire, lag);
  }

  if (mode >= 2 || !tradesWire) {
    if (mode >= 2) {
      pendingTradesBySymbol.delete(sym);
      const tr = tradesTimersBySymbol.get(sym);
      if (tr) clearTimeout(tr);
      tradesTimersBySymbol.delete(sym);
    }
    return;
  }

  const backlog = getSpotWsBroadcastBacklogBytes();
  const t1p = config.wsForwarderShed.tier1Pending;
  const batchByPending =
    t1p > 0 && getWriterPendingEstimate() >= Math.max(500, Math.floor(t1p / 4));
  const batchWanted = backlog >= wl.tradesBatchMinBacklogBytes || batchByPending;

  if (!batchWanted) {
    routePublic(`trades:${sym}`, tradesWire, 'trades');
    return;
  }

  const parsed = parseTradesWire(tradesWire);
  if (!parsed) {
    routePublic(`trades:${sym}`, tradesWire, 'trades');
    return;
  }

  const ch = `trades:${sym}`;
  const cap = wl.tradesBatchMax * 2;
  let acc = pendingTradesBySymbol.get(sym);
  if (!acc) {
    acc = { rows: [], channel: ch };
    pendingTradesBySymbol.set(sym, acc);
  }
  acc.rows = mergeTradesRows(acc.rows, parsed.rows, cap);
  acc.channel = ch;
  scheduleTradesFlushForSymbol(sym, lag);
}
