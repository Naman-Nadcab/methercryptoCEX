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
let marketsLastGoodSnapshot: { generatedAt: number; payload: unknown[] } | null = null;

type MarketComputedRow = {
  id: string;
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status: string;
  min_qty: string;
  min_notional: string;
  price_precision: number;
  qty_precision: number;
  maker_fee: string;
  taker_fee: string;
  last_price: string | null;
  volume_24h: string;
  open_24h: string | null;
  high_24h: string | null;
  low_24h: string | null;
};

function toMarketResponseRows(rows: MarketComputedRow[]): unknown[] {
  return rows.map((r) => {
    const open = r.open_24h ? parseFloat(String(r.open_24h)) : NaN;
    const last = r.last_price ? parseFloat(String(r.last_price)) : NaN;
    const changePct =
      Number.isFinite(open) && open > 0 && Number.isFinite(last)
        ? Math.round(((last - open) / open) * 10000) / 100
        : null;
    return { ...r, change_pct: changePct };
  });
}

async function computeMarketsLightweight(): Promise<unknown[]> {
  const result = await db.queryRead<MarketComputedRow>(`
    SELECT
      m.id::text,
      m.symbol,
      m.base_asset,
      m.quote_asset,
      m.status,
      m.min_qty::text AS min_qty,
      m.min_notional::text AS min_notional,
      m.price_precision,
      m.qty_precision,
      COALESCE(m.maker_fee, 0.001)::text AS maker_fee,
      COALESCE(m.taker_fee, 0.001)::text AS taker_fee,
      mp.price::text AS last_price,
      '0'::text AS volume_24h,
      NULL::text AS open_24h,
      NULL::text AS high_24h,
      NULL::text AS low_24h
    FROM spot_markets m
    LEFT JOIN market_prices mp
      ON mp.base_currency_id = m.base_currency_id
     AND mp.quote_currency_id = m.quote_currency_id
    WHERE m.status IN ('active', 'maintenance')
    ORDER BY m.symbol
  `);
  return toMarketResponseRows(result.rows);
}

async function computeMarkets(): Promise<unknown[]> {
  try {
    const result = await db.transaction(async (client) => {
      // Hard cap rich query latency so API can fallback instead of hanging.
      await client.query(`SET LOCAL statement_timeout = '3500ms'`);
      return client.query<MarketComputedRow>(`
    WITH latest_1m AS (
      SELECT DISTINCT ON (oc.trading_pair_id)
        oc.trading_pair_id,
        oc.close_price
      FROM ohlcv_candles oc
      WHERE oc.interval_type = '1m'
      ORDER BY oc.trading_pair_id, oc.open_time DESC
    ),
    latest_1d AS (
      SELECT DISTINCT ON (oc.trading_pair_id)
        oc.trading_pair_id,
        oc.open_price,
        oc.high_price,
        oc.low_price,
        oc.close_price,
        oc.volume
      FROM ohlcv_candles oc
      WHERE oc.interval_type = '1d'
      ORDER BY oc.trading_pair_id, oc.open_time DESC
    )
    SELECT
      m.id::text,
      m.symbol,
      m.base_asset,
      m.quote_asset,
      m.status,
      m.min_qty::text AS min_qty,
      m.min_notional::text AS min_notional,
      m.price_precision,
      m.qty_precision,
      COALESCE(m.maker_fee, 0.001)::text AS maker_fee,
      COALESCE(m.taker_fee, 0.001)::text AS taker_fee,
      COALESCE(mp.price, c1m.close_price, c1d.close_price)::text AS last_price,
      COALESCE(c1d.volume, '0')::text AS volume_24h,
      c1d.open_price::text AS open_24h,
      c1d.high_price::text AS high_24h,
      c1d.low_price::text AS low_24h
    FROM spot_markets m
    LEFT JOIN trading_pairs tp ON tp.symbol = m.symbol
    LEFT JOIN market_prices mp
      ON mp.base_currency_id = m.base_currency_id
     AND mp.quote_currency_id = m.quote_currency_id
    LEFT JOIN latest_1m c1m ON c1m.trading_pair_id = tp.id
    LEFT JOIN latest_1d c1d ON c1d.trading_pair_id = tp.id
    WHERE m.status IN ('active', 'maintenance')
    ORDER BY m.symbol
  `);
    });
    return toMarketResponseRows(result.rows);
  } catch (e) {
    logger.warn('spot markets rich query failed; using lightweight fallback', {
      error: e instanceof Error ? e.message : String(e),
    });
    return computeMarketsLightweight();
  }
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
        marketsLastGoodSnapshot = { generatedAt: Date.now(), payload: fresh };
        try {
          await redis.setJson(MARKETS_REDIS_KEY, fresh, MARKETS_REDIS_TTL_S);
        } catch {
          // best-effort
        }
        return fresh;
      } catch (e) {
        if (marketsLastGoodSnapshot?.payload?.length) {
          logger.warn('spot markets compute failed; serving stale snapshot', {
            error: e instanceof Error ? e.message : String(e),
            staleAgeMs: Date.now() - marketsLastGoodSnapshot.generatedAt,
          });
          return marketsLastGoodSnapshot.payload;
        }
        throw e;
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
