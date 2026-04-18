/**
 * Spot markets cache (Phase 1 hardening).
 *
 * The public GET /spot/markets endpoint composes last price, 24h volume / open / high /
 * low and maker/taker fees for every market. Under load this hit ~14s p95 from remote
 * Postgres. We cache the composed payload at two layers:
 *   1. in-process memo (low TTL, shared across concurrent requests via single-flight)
 *   2. Redis (slightly longer TTL, shared across backend replicas)
 *
 * invalidateMarketsCache() MUST be called from every admin mutation that changes
 * spot_markets (create / pause / resume / fee update / delete) so API clients see the
 * change on the next tick instead of waiting for TTL expiry.
 */
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const MARKETS_LOCAL_TTL_MS = 3_000;
const MARKETS_REDIS_TTL_S = 10;
export const MARKETS_REDIS_KEY = 'spot:markets:v1';

let marketsLocalCache: { expiresAt: number; payload: unknown[] } | null = null;
let marketsInFlight: Promise<unknown[]> | null = null;

async function computeMarkets(): Promise<unknown[]> {
  const result = await db.query(`
    SELECT m.id, m.symbol, m.base_asset, m.quote_asset, m.status, m.min_qty, m.min_notional, m.price_precision, m.qty_precision,
           COALESCE(m.maker_fee, 0.001)::text as maker_fee, COALESCE(m.taker_fee, 0.001)::text as taker_fee,
           COALESCE(mp.price, candle_1m.close_price, candle_1d.close_price)::text as last_price,
           COALESCE(candle_24.volume, '0')::text as volume_24h,
           candle_24.open_price::text as open_24h,
           candle_24.high_price::text as high_24h,
           candle_24.low_price::text as low_24h
    FROM spot_markets m
    LEFT JOIN LATERAL (
      SELECT mp2.price FROM market_prices mp2
      WHERE mp2.base_currency_id = m.base_currency_id AND mp2.quote_currency_id = m.quote_currency_id
      LIMIT 1
    ) mp ON TRUE
    LEFT JOIN LATERAL (
      SELECT oc.close_price FROM ohlcv_candles oc
      JOIN trading_pairs tp2 ON tp2.id = oc.trading_pair_id
      WHERE tp2.symbol = m.symbol AND oc.interval_type = '1m'
      ORDER BY oc.open_time DESC LIMIT 1
    ) candle_1m ON TRUE
    LEFT JOIN LATERAL (
      SELECT oc.close_price FROM ohlcv_candles oc
      JOIN trading_pairs tp2 ON tp2.id = oc.trading_pair_id
      WHERE tp2.symbol = m.symbol AND oc.interval_type = '1d'
      ORDER BY oc.open_time DESC LIMIT 1
    ) candle_1d ON TRUE
    LEFT JOIN LATERAL (
      SELECT oc.open_price, oc.high_price, oc.low_price, oc.volume
      FROM ohlcv_candles oc
      JOIN trading_pairs tp2 ON tp2.id = oc.trading_pair_id
      WHERE tp2.symbol = m.symbol AND oc.interval_type = '1d'
      ORDER BY oc.open_time DESC LIMIT 1
    ) candle_24 ON TRUE
    WHERE m.status IN ('active', 'maintenance')
    ORDER BY m.symbol
  `);
  return result.rows.map((r: Record<string, unknown>) => {
    const open = r.open_24h ? parseFloat(String(r.open_24h)) : NaN;
    const last = r.last_price ? parseFloat(String(r.last_price)) : NaN;
    const changePct =
      Number.isFinite(open) && open > 0 && Number.isFinite(last)
        ? Math.round(((last - open) / open) * 10000) / 100
        : null;
    return { ...r, change_pct: changePct };
  });
}

export async function getMarketsCached(): Promise<unknown[]> {
  const now = Date.now();
  if (marketsLocalCache && marketsLocalCache.expiresAt > now) return marketsLocalCache.payload;
  try {
    const cached = await redis.getJson<unknown[]>(MARKETS_REDIS_KEY);
    if (Array.isArray(cached)) {
      marketsLocalCache = { expiresAt: now + MARKETS_LOCAL_TTL_MS, payload: cached };
      return cached;
    }
  } catch {
    // redis down — fall through to DB
  }
  if (!marketsInFlight) {
    marketsInFlight = (async () => {
      try {
        const fresh = await computeMarkets();
        marketsLocalCache = { expiresAt: Date.now() + MARKETS_LOCAL_TTL_MS, payload: fresh };
        try {
          await redis.setJson(MARKETS_REDIS_KEY, fresh, MARKETS_REDIS_TTL_S);
        } catch {
          // best-effort
        }
        return fresh;
      } finally {
        marketsInFlight = null;
      }
    })();
  }
  return marketsInFlight;
}

/**
 * Clear both the in-process memo and the Redis cache key. Call from admin routes that
 * mutate spot_markets so the next GET /spot/markets recomputes from DB immediately.
 * Safe to call liberally; worst case we take one DB hit on the next request.
 */
export async function invalidateMarketsCache(): Promise<void> {
  marketsLocalCache = null;
  marketsInFlight = null;
  try {
    // Use any because the redis wrapper exposes del under different names across backends.
    const client = redis as unknown as { del?: (k: string) => Promise<unknown> };
    if (typeof client.del === 'function') await client.del(MARKETS_REDIS_KEY);
  } catch (e) {
    logger.warn('invalidateMarketsCache: redis del failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
