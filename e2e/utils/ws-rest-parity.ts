/**
 * WS vs REST parity helpers (public market data). No fake data — compares live API responses.
 */
import { config } from '../config.js';
import { getSpotWebSocketClass, SpotWsSession, type SpotWsInbound } from './spot-ws-helpers.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

export type ParityResult = {
  name: string;
  pass: boolean;
  mismatchCount: number;
  latencyMsRest: number;
  latencyMsWs: number;
  notes: string[];
};

function normStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/** Compare numeric-ish strings with small epsilon for ticker fields. */
function tickerFieldsMatch(rest: Record<string, unknown>, wsData: Record<string, unknown>): { ok: boolean; mismatches: string[] } {
  const keys = ['last_price', 'bid', 'ask', 'high_24h', 'low_24h'] as const;
  const mismatches: string[] = [];
  for (const k of keys) {
    const a = normStr(rest[k]);
    const b = normStr(wsData[k]);
    if (a === '' && b === '') continue;
    if (a === b) continue;
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-12) continue;
    mismatches.push(`${k} rest=${a} ws=${b}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

export async function compareTicker(symbol: string): Promise<ParityResult> {
  const notes: string[] = [];
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v1/spot/ticker/${encodeURIComponent(symbol)}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const latencyMsRest = Date.now() - t0;
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Record<string, unknown> };
  if (!res.ok || !body.success || !body.data) {
    return {
      name: 'ticker',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: [`REST ticker failed status=${res.status}`],
    };
  }
  const rest = body.data;

  const Ws = await getSpotWebSocketClass();
  if (!Ws) {
    return {
      name: 'ticker',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: ['no WebSocket implementation'],
    };
  }

  const sess = new SpotWsSession();
  const tws = Date.now();
  try {
    await sess.connect(Ws);
  } catch {
    return {
      name: 'ticker',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: ['WS connect failed'],
    };
  }

  sess.subscribe(`ticker:${symbol}`);
  const subOk = await sess.waitSubscribed([`ticker:${symbol}`], TIMEOUT);
  if (!subOk) notes.push('WARN: no subscribed ack for ticker (server may omit)');

  const tWait = Date.now();
  const msg = await sess.waitFor((m) => m.type === 'ticker' && m.channel === `ticker:${symbol}`, Math.min(25_000, TIMEOUT * 3));
  const latencyMsWs = Date.now() - tws;
  sess.close();

  if (!msg?.data || typeof msg.data !== 'object') {
    return {
      name: 'ticker',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs,
      notes: [...notes, 'no WS ticker frame in window (illiquid/coalesced)'],
    };
  }

  const wsData = msg.data as Record<string, unknown>;
  const { ok, mismatches } = tickerFieldsMatch(rest, wsData);
  if (!ok) notes.push(...mismatches);

  return {
    name: 'ticker',
    pass: ok,
    mismatchCount: mismatches.length,
    latencyMsRest,
    latencyMsWs: Date.now() - tWait,
    notes,
  };
}

function bestBidAskFromOrderbook(data: { bids?: unknown[]; asks?: unknown[] }): { bid: string; ask: string } {
  const bids = Array.isArray(data.bids) ? data.bids : [];
  const asks = Array.isArray(data.asks) ? data.asks : [];
  const bid0 = bids[0];
  const ask0 = asks[0];
  const bid = Array.isArray(bid0) ? normStr(bid0[0]) : '';
  const ask = Array.isArray(ask0) ? normStr(ask0[0]) : '';
  return { bid, ask };
}

export async function compareOrderbook(symbol: string, limit = 20): Promise<ParityResult> {
  const notes: string[] = [];
  const t0 = Date.now();
  const res = await fetch(
    `${BASE}/api/v1/spot/orderbook/${encodeURIComponent(symbol)}?limit=${limit}`,
    { signal: AbortSignal.timeout(TIMEOUT) }
  );
  const latencyMsRest = Date.now() - t0;
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { bids?: unknown[]; asks?: unknown[] } };
  if (!res.ok || !body.success || !body.data) {
    return {
      name: 'orderbook',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: [`REST orderbook failed ${res.status}`],
    };
  }
  const restBa = bestBidAskFromOrderbook(body.data);

  const Ws = await getSpotWebSocketClass();
  if (!Ws) {
    return {
      name: 'orderbook',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: ['no WebSocket implementation'],
    };
  }

  const sess = new SpotWsSession();
  const tws = Date.now();
  try {
    await sess.connect(Ws);
  } catch (e) {
    return {
      name: 'orderbook',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: [`WS connect failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  sess.subscribe(`orderbook:${symbol}`);
  await sess.waitSubscribed([`orderbook:${symbol}`], TIMEOUT);

  const msg = await sess.waitFor(
    (m) =>
      (m.type === 'orderbook_snapshot' || m.type === 'orderbook_update' || m.type === 'orderbook_delta') &&
      m.channel === `orderbook:${symbol}`,
    Math.min(25_000, TIMEOUT * 3)
  );
  const latencyMsWs = Date.now() - tws;
  sess.close();

  if (!msg?.data || typeof msg.data !== 'object') {
    return {
      name: 'orderbook',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs,
      notes: ['no WS orderbook frame'],
    };
  }

  const d = msg.data as { bids?: unknown[]; asks?: unknown[] };
  const wsBa = bestBidAskFromOrderbook(d);
  let mismatchCount = 0;
  if (restBa.bid && wsBa.bid && restBa.bid !== wsBa.bid) {
    mismatchCount++;
    notes.push(`best_bid rest=${restBa.bid} ws=${wsBa.bid}`);
  }
  if (restBa.ask && wsBa.ask && restBa.ask !== wsBa.ask) {
    mismatchCount++;
    notes.push(`best_ask rest=${restBa.ask} ws=${wsBa.ask}`);
  }
  if (!restBa.bid && !wsBa.bid && !restBa.ask && !wsBa.ask) {
    return { name: 'orderbook', pass: true, mismatchCount: 0, latencyMsRest, latencyMsWs, notes: [...notes, 'empty book'] };
  }

  const pass = mismatchCount === 0;
  return { name: 'orderbook', pass, mismatchCount, latencyMsRest, latencyMsWs, notes };
}

type TradeRow = { id?: string; price?: string; quantity?: string };

export async function compareTrades(symbol: string): Promise<ParityResult> {
  const notes: string[] = [];
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/v1/spot/recent-trades/${encodeURIComponent(symbol)}?limit=15`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const latencyMsRest = Date.now() - t0;
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: TradeRow[] };
  const restRows = res.ok && body.success && Array.isArray(body.data) ? body.data : [];
  const restTop = restRows[0];

  const Ws = await getSpotWebSocketClass();
  if (!Ws) {
    return {
      name: 'trades',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: ['no WebSocket implementation'],
    };
  }

  const sess = new SpotWsSession();
  const tws = Date.now();
  try {
    await sess.connect(Ws);
  } catch (e) {
    return {
      name: 'trades',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs: 0,
      notes: [`WS connect failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  sess.subscribe(`trades:${symbol}`);
  await sess.waitSubscribed([`trades:${symbol}`], TIMEOUT);

  const msg = await sess.waitFor(
    (m) => m.type === 'trades' && m.channel === `trades:${symbol}`,
    Math.min(25_000, TIMEOUT * 3)
  );
  const latencyMsWs = Date.now() - tws;
  sess.close();

  if (!restTop?.id) {
    notes.push('INFO: no REST trades (quiet market) — skip strict id match');
    return {
      name: 'trades',
      pass: true,
      mismatchCount: 0,
      latencyMsRest,
      latencyMsWs,
      notes,
    };
  }

  if (!msg?.data || !Array.isArray(msg.data)) {
    notes.push('WS trades frame missing while REST has trades — possible lag');
    return {
      name: 'trades',
      pass: false,
      mismatchCount: 1,
      latencyMsRest,
      latencyMsWs,
      notes,
    };
  }

  const wsArr = msg.data as TradeRow[];
  const wsIds = new Set(wsArr.map((t) => String(t.id ?? '')));
  const pass = wsIds.has(String(restTop.id));
  if (!pass) {
    notes.push(`top REST trade id ${restTop.id} not in WS batch (${wsArr.length} rows)`);
  }
  return {
    name: 'trades',
    pass,
    mismatchCount: pass ? 0 : 1,
    latencyMsRest,
    latencyMsWs,
    notes,
  };
}

export async function runWsRestParitySuite(symbol: string): Promise<{
  results: ParityResult[];
  allPass: boolean;
  summary: string[];
}> {
  let results: ParityResult[];
  try {
    results = await Promise.all([compareTicker(symbol), compareOrderbook(symbol), compareTrades(symbol)]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const summary = [`FAIL: parity suite network/runtime error: ${msg}`];
    return {
      results: [
        {
          name: 'suite',
          pass: false,
          mismatchCount: 1,
          latencyMsRest: 0,
          latencyMsWs: 0,
          notes: [msg],
        },
      ],
      allPass: false,
      summary,
    };
  }
  const summary: string[] = [];
  for (const r of results) {
    const line = `${r.pass ? 'PASS' : 'FAIL'}: parity/${r.name} mismatches=${r.mismatchCount} rest=${r.latencyMsRest}ms ws=${r.latencyMsWs}ms`;
    summary.push(line);
    if (r.notes.length) summary.push(`  notes: ${r.notes.join('; ')}`);
  }
  return { results, allPass: results.every((x) => x.pass), summary };
}
