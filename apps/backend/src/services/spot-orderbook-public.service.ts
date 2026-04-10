/**
 * Single public L2 path for REST + legacy WS: Redis cache → DB rebuild, align seq with Tier-1 WS writer state.
 */
import {
  getCachedOrderbook,
  getOrderbookFromDb,
  setOrderbookCache,
  type OrderbookSnapshot,
} from './spot-orderbook-cache.service.js';
import { getLastBroadcastBook } from './spot-orderbook-ws-engine.service.js';
import { config } from '../config/index.js';
import { orderbookStaleResponsesTotal } from '../lib/prometheus-metrics.js';

export type PublicOrderbookPayload = OrderbookSnapshot & {
  stale: boolean;
  orderbookAgeMs: number;
};

export async function resolvePublicOrderbookSnapshot(symbol: string, limit: number): Promise<PublicOrderbookPayload> {
  const sym = symbol.toUpperCase().replace(/-/g, '_');
  let snapshot = await getCachedOrderbook(sym, limit);
  if (!snapshot) {
    snapshot = await getOrderbookFromDb(sym, limit);
    void setOrderbookCache(snapshot);
  }
  const ob: OrderbookSnapshot = {
    ...snapshot,
    symbol: sym,
    bids: snapshot.bids.slice(0, limit),
    asks: snapshot.asks.slice(0, limit),
    snapshotAtMs: snapshot.snapshotAtMs || 0,
  };
  const wsAligned = getLastBroadcastBook(sym);
  if (wsAligned?.lastUpdateId != null && wsAligned.lastUpdateId > 0) {
    ob.lastUpdateId = wsAligned.lastUpdateId;
  }
  const now = Date.now();
  const maxAge = config.orderbook.maxAgeMs;
  const snapAt = ob.snapshotAtMs ?? 0;
  const snapMs = snapAt > 0 ? snapAt : now;
  const orderbookAgeMs = Math.max(0, now - snapMs);
  const stale = maxAge > 0 && orderbookAgeMs > maxAge;
  if (stale) {
    orderbookStaleResponsesTotal.inc({ symbol: sym });
  }
  return { ...ob, stale, orderbookAgeMs };
}

export function isOrderbookStaleForSymbol(symbol: string): boolean {
  const sym = symbol.toUpperCase().replace(/-/g, '_');
  const maxAge = config.orderbook.maxAgeMs;
  if (maxAge <= 0 || !config.orderbook.pauseTradingOnStale) return false;
  const ws = getLastBroadcastBook(sym);
  const t = ws?.snapshotAtMs ?? 0;
  if (t <= 0) return false;
  return Date.now() - t > maxAge;
}
