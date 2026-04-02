/**
 * Orderbook WS seq, last snapshot for delta, and pre-serialized emit.
 * L2 source: in-memory book (Tier-1); optional DB snapshot for admin/rebuild.
 */

import type { OrderbookSnapshot } from './spot-orderbook-cache.service.js';
import { DEFAULT_L2_DEPTH, snapshotTop } from './spot-in-memory-orderbook.service.js';
import * as spotWs from './spot-ws.service.js';
import { syncTickerBidAskFromBook } from './spot-live-market-state.service.js';

const spotOrderbookWsSeq = new Map<string, number>();
const lastBroadcastOrderbook = new Map<string, OrderbookSnapshot>();

function nextSpotBookSeq(sym: string): number {
  const n = (spotOrderbookWsSeq.get(sym) ?? 0) + 1;
  spotOrderbookWsSeq.set(sym, n);
  return n;
}

function computeOrderbookWsDelta(
  prev: OrderbookSnapshot,
  next: OrderbookSnapshot
): { bids: [string, string][]; asks: [string, string][]; changed: number } {
  const bids: [string, string][] = [];
  const prevB = new Map(prev.bids.map((l) => [l.price, l.quantity]));
  const nextB = new Map(next.bids.map((l) => [l.price, l.quantity]));
  for (const k of new Set([...prevB.keys(), ...nextB.keys()])) {
    const a = prevB.get(k) ?? '0';
    const b = nextB.get(k) ?? '0';
    if (a !== b) bids.push([k, nextB.has(k) ? b : '0']);
  }
  const asks: [string, string][] = [];
  const prevA = new Map(prev.asks.map((l) => [l.price, l.quantity]));
  const nextA = new Map(next.asks.map((l) => [l.price, l.quantity]));
  for (const k of new Set([...prevA.keys(), ...nextA.keys()])) {
    const a = prevA.get(k) ?? '0';
    const b = nextA.get(k) ?? '0';
    if (a !== b) asks.push([k, nextA.has(k) ? b : '0']);
  }
  return { bids, asks, changed: bids.length + asks.length };
}

/** Apply seq + lastBroadcast + ticker sync; return WS wire or null if unchanged vs previous. */
function computeOrderbookWire(symbol: string, snapshot: OrderbookSnapshot): string | null {
  const seq = nextSpotBookSeq(symbol);
  const snap: OrderbookSnapshot = { ...snapshot, symbol, lastUpdateId: seq };
  const prev = lastBroadcastOrderbook.get(symbol);
  lastBroadcastOrderbook.set(symbol, snap);
  const channel = `orderbook:${symbol}`;

  const bestBid = snap.bids[0]?.price ?? null;
  const bestAsk = snap.asks[0]?.price ?? null;
  syncTickerBidAskFromBook(symbol, bestBid, bestAsk);

  if (!prev) {
    return spotWs.wireEnvelope('orderbook_update', channel, snap);
  }
  const { bids, asks, changed } = computeOrderbookWsDelta(prev, snap);
  const denom = Math.max(prev.bids.length + prev.asks.length, snap.bids.length + snap.asks.length, 1);
  if (changed === 0) return null;
  if (changed > 40 || changed / denom > 0.5) {
    return spotWs.wireEnvelope('orderbook_update', channel, snap);
  }
  return spotWs.wireEnvelope('orderbook_delta', channel, { symbol, seq, bids, asks });
}

function ingestSnapshot(symbol: string, snapshot: OrderbookSnapshot): void {
  const channel = `orderbook:${symbol}`;
  const wire = computeOrderbookWire(symbol, snapshot);
  if (wire) spotWs.broadcastSerialized(channel, wire);
}

/** Single-writer / NATS path: same state as ingestOrderbookFromMemory, returns pre-serialized wire. */
export function takeOrderbookWireFromMemory(symbol: string, depth = DEFAULT_L2_DEPTH): string | null {
  const raw = snapshotTop(symbol, depth);
  return computeOrderbookWire(symbol, raw);
}

export type WriterOrderbookPersisted = {
  seqBySymbol: Record<string, number>;
  lastSnapshots: Record<string, OrderbookSnapshot>;
};

export function exportWriterOrderbookState(): WriterOrderbookPersisted {
  const seqBySymbol: Record<string, number> = {};
  for (const [k, v] of spotOrderbookWsSeq.entries()) seqBySymbol[k] = v;
  const lastSnapshots: Record<string, OrderbookSnapshot> = {};
  for (const [k, v] of lastBroadcastOrderbook.entries()) lastSnapshots[k] = { ...v };
  return { seqBySymbol, lastSnapshots };
}

export function importWriterOrderbookState(state: WriterOrderbookPersisted): void {
  for (const [sym, seq] of Object.entries(state.seqBySymbol)) {
    spotOrderbookWsSeq.set(sym, seq);
  }
  for (const [sym, snap] of Object.entries(state.lastSnapshots)) {
    lastBroadcastOrderbook.set(sym, { ...snap, symbol: sym });
  }
}

/** External snapshot (e.g. DB rebuild). */
export function ingestOrderbookSnapshot(symbol: string, snapshot: OrderbookSnapshot): void {
  ingestSnapshot(symbol, snapshot);
}

/** Hot path: top-of-book from in-memory L2. */
export function ingestOrderbookFromMemory(symbol: string, depth = DEFAULT_L2_DEPTH): void {
  const raw = snapshotTop(symbol, depth);
  ingestSnapshot(symbol, raw);
}

/** Build pre-serialized orderbook_resync wire (updates WS seq + lastBroadcast state). */
export function buildOrderbookResyncWire(symbol: string, depth = DEFAULT_L2_DEPTH): string {
  const sym = symbol.toUpperCase();
  const seq = nextSpotBookSeq(sym);
  const raw = snapshotTop(sym, depth);
  const snap: OrderbookSnapshot = { ...raw, symbol: sym, lastUpdateId: seq };
  lastBroadcastOrderbook.set(sym, snap);
  const channel = `orderbook:${sym}`;
  const bestBid = snap.bids[0]?.price ?? null;
  const bestAsk = snap.asks[0]?.price ?? null;
  syncTickerBidAskFromBook(sym, bestBid, bestAsk);
  return spotWs.wireEnvelope('orderbook_resync', channel, snap);
}

/**
 * Force clients to drop delta state (seq gap / recovery). Full book from memory.
 */
export function broadcastOrderbookResync(symbol: string, depth = DEFAULT_L2_DEPTH): void {
  const sym = symbol.toUpperCase();
  const wire = buildOrderbookResyncWire(sym, depth);
  spotWs.broadcastSerialized(`orderbook:${sym}`, wire);
}

/**
 * Prime L2 state for delta stream when a client subscribes (no broadcast).
 * Reuses last seq if book was already published so multi-subscribe does not create gaps.
 */
export function primeOrderbookStateFromSubscribe(symbol: string, snapshot: OrderbookSnapshot): OrderbookSnapshot {
  const existing = lastBroadcastOrderbook.get(symbol);
  const seq =
    existing?.lastUpdateId != null && existing.lastUpdateId > 0 ? existing.lastUpdateId : nextSpotBookSeq(symbol);
  const snap: OrderbookSnapshot = { ...snapshot, symbol, lastUpdateId: seq };
  lastBroadcastOrderbook.set(symbol, snap);
  const bestBid = snap.bids[0]?.price ?? null;
  const bestAsk = snap.asks[0]?.price ?? null;
  syncTickerBidAskFromBook(symbol, bestBid, bestAsk);
  return snap;
}

export function getLastBroadcastBook(symbol: string): OrderbookSnapshot | undefined {
  return lastBroadcastOrderbook.get(symbol);
}
