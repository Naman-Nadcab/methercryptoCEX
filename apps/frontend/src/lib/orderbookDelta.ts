import type { OrderbookSnapshot } from '@/hooks/useSpotWs';

/** WebSocket `orderbook_delta` data shape (symbol + monotonic seq + changed levels). */
export type OrderbookDeltaPayload = {
  symbol: string;
  seq: number;
  bids: [string, string][];
  asks: [string, string][];
};

function isZeroQty(q: string): boolean {
  const n = parseFloat(q);
  return !Number.isFinite(n) || n <= 0;
}

/**
 * Apply L2 delta: tuple [price, size]; size 0 removes level. Bids sort desc, asks asc.
 */
export function applyOrderbookDelta(snapshot: OrderbookSnapshot, delta: OrderbookDeltaPayload): OrderbookSnapshot {
  const bidMap = new Map(snapshot.bids.map((l) => [l.price, l.quantity]));
  for (const [p, q] of delta.bids) {
    if (isZeroQty(q)) bidMap.delete(p);
    else bidMap.set(p, q);
  }
  const askMap = new Map(snapshot.asks.map((l) => [l.price, l.quantity]));
  for (const [p, q] of delta.asks) {
    if (isZeroQty(q)) askMap.delete(p);
    else askMap.set(p, q);
  }
  const bids = Array.from(bidMap.entries())
    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    .map(([price, quantity]) => ({ price, quantity }));
  const asks = Array.from(askMap.entries())
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([price, quantity]) => ({ price, quantity }));
  return {
    symbol: delta.symbol,
    bids,
    asks,
    lastUpdateId: delta.seq,
  };
}
