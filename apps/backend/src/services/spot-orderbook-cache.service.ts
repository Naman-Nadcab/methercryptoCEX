/**
 * Spot orderbook Redis cache. Top N levels cached; periodic rebuild from DB.
 * GET orderbook reads from Redis first (non-blocking for order placement).
 */

import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { withTimeout } from '../lib/async-timeout.js';
import { getSpotOrdersUseMarketSync } from '../lib/spot-schema-cache.js';

const CACHE_PREFIX = 'spot:orderbook:';
const CACHE_TTL_SEC = 10;
const DEFAULT_LEVELS = 50;

export type OrderbookLevel = { price: string; quantity: string };

export interface OrderbookSnapshot {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastUpdateId: number;
  /** Wall-clock ms when this snapshot was produced (cache write or DB rebuild). */
  snapshotAtMs?: number;
}

/** Resolve symbol to trading_pair_id (when market column doesn't exist). Uses read replica when configured. */
async function getTradingPairId(symbol: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `SELECT id FROM trading_pairs WHERE symbol = $1 AND trading_enabled = TRUE LIMIT 1`,
    [symbol]
  );
  return r.rows[0]?.id ?? null;
}

export async function getOrderbookFromDb(symbol: string, limit: number = DEFAULT_LEVELS): Promise<OrderbookSnapshot> {
  const ordersUseMarketColumn = getSpotOrdersUseMarketSync();
  let pairId: string | null = null;
  if (!ordersUseMarketColumn) {
    pairId = await getTradingPairId(symbol);
    if (!pairId) {
      logger.warn('getOrderbookFromDb_no_trading_pair', { symbol });
      const now = Date.now();
      return { symbol, bids: [], asks: [], lastUpdateId: now, snapshotAtMs: now };
    }
  }

  const bidsQuery = ordersUseMarketColumn
    ? db.query<{ price: string; quantity: string }>(`
        SELECT price::text as price, SUM(quantity - COALESCE(filled_quantity,0))::text as quantity
        FROM spot_orders
        WHERE market = $1 AND side = 'buy' AND status IN ('OPEN', 'PARTIALLY_FILLED') AND (quantity - COALESCE(filled_quantity,0)) > 0
        GROUP BY price
        ORDER BY price DESC
        LIMIT $2
      `, [symbol, limit])
    : db.query<{ price: string; quantity: string }>(`
        SELECT o.price::text as price, SUM(COALESCE(o.remaining_quantity, o.quantity - COALESCE(o.filled_quantity,0)))::text as quantity
        FROM spot_orders o
        WHERE o.trading_pair_id = $1 AND o.side = 'buy' AND o.status IN ('new', 'partially_filled')
          AND (COALESCE(o.remaining_quantity, o.quantity - COALESCE(o.filled_quantity,0))) > 0
        GROUP BY o.price
        ORDER BY o.price DESC
        LIMIT $2
      `, [pairId, limit]);

  const asksQuery = ordersUseMarketColumn
    ? db.query<{ price: string; quantity: string }>(`
        SELECT price::text as price, SUM(quantity - COALESCE(filled_quantity,0))::text as quantity
        FROM spot_orders
        WHERE market = $1 AND side = 'sell' AND status IN ('OPEN', 'PARTIALLY_FILLED') AND (quantity - COALESCE(filled_quantity,0)) > 0
        GROUP BY price
        ORDER BY price ASC
        LIMIT $2
      `, [symbol, limit])
    : db.query<{ price: string; quantity: string }>(`
        SELECT o.price::text as price, SUM(COALESCE(o.remaining_quantity, o.quantity - COALESCE(o.filled_quantity,0)))::text as quantity
        FROM spot_orders o
        WHERE o.trading_pair_id = $1 AND o.side = 'sell' AND o.status IN ('new', 'partially_filled')
          AND (COALESCE(o.remaining_quantity, o.quantity - COALESCE(o.filled_quantity,0))) > 0
        GROUP BY o.price
        ORDER BY o.price ASC
        LIMIT $2
      `, [pairId, limit]);

  const [bids, asks] = await Promise.all([bidsQuery, asksQuery]);
  const snapshotAtMs = Date.now();
  const lastUpdateId = snapshotAtMs;
  return {
    symbol,
    bids: bids.rows,
    asks: asks.rows,
    lastUpdateId,
    snapshotAtMs,
  };
}

export async function getCachedOrderbook(symbol: string, limit: number = DEFAULT_LEVELS): Promise<OrderbookSnapshot | null> {
  try {
    const key = `${CACHE_PREFIX}${symbol}`;
    const raw = await withTimeout(redis.get(key), 5_000, `spot:orderbook:cache:get:${symbol}`).catch((err) => {
      logger.warn('Spot orderbook Redis get slow/failed; falling back to DB', {
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (!raw) return null;
    const data = JSON.parse(raw) as OrderbookSnapshot;
    data.bids = (data.bids || []).slice(0, limit);
    data.asks = (data.asks || []).slice(0, limit);
    if (typeof data.snapshotAtMs !== 'number' || !Number.isFinite(data.snapshotAtMs)) {
      data.snapshotAtMs = 0;
    }
    return data;
  } catch {
    return null;
  }
}

export async function setOrderbookCache(snapshot: OrderbookSnapshot): Promise<void> {
  try {
    const key = `${CACHE_PREFIX}${snapshot.symbol}`;
    await redis.set(key, JSON.stringify(snapshot), CACHE_TTL_SEC);
  } catch (e) {
    logger.warn('Spot orderbook cache set failed', { symbol: snapshot.symbol, error: e instanceof Error ? e.message : 'Unknown' });
  }
}

export async function invalidateOrderbookCache(symbol: string): Promise<void> {
  try {
    await redis.del(`${CACHE_PREFIX}${symbol}`);
  } catch {
    // ignore
  }
}

/** Rebuild cache for a symbol from DB. Call periodically or after order/cancel. */
export async function refreshOrderbookCache(symbol: string): Promise<OrderbookSnapshot> {
  const snapshot = await getOrderbookFromDb(symbol, DEFAULT_LEVELS);
  await setOrderbookCache(snapshot);
  return snapshot;
}
