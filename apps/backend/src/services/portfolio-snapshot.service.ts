/**
 * Portfolio Snapshot Service
 * Takes periodic snapshots of user portfolio values for historical chart data.
 */
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const LOG_CAT = 'portfolio-snapshot';
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const PRICE_CACHE_KEY = 'portfolio:prices';
const PRICE_CACHE_TTL = 300;
const PRICE_LOCAL_CACHE_TTL_MS = 30_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let priceLocalCache: { expiresAt: number; payload: Record<string, number> } | null = null;
let priceRefreshInFlight: Promise<Record<string, number>> | null = null;

async function queryLatestPricesFast(): Promise<Array<{ symbol: string; last_price: string }>> {
  const result = await db.transaction(async (client) => {
    await client.query(`SET LOCAL statement_timeout = '2200ms'`);
    return client.query<{ symbol: string; last_price: string }>(
      `SELECT sm.symbol,
              COALESCE(mp.price::text, '0') AS last_price
       FROM spot_markets sm
       LEFT JOIN LATERAL (
         SELECT mp2.price FROM market_prices mp2
         WHERE mp2.base_currency_id = sm.base_currency_id AND mp2.quote_currency_id = sm.quote_currency_id
         LIMIT 1
       ) mp ON TRUE
       WHERE sm.status IN ('active', 'maintenance')`
    );
  });
  return result.rows;
}

async function queryLatestPricesFallback(): Promise<Array<{ symbol: string; last_price: string }>> {
  const result = await db.query<{ symbol: string; last_price: string }>(
    `SELECT sm.symbol, COALESCE(mp.price::text, '0') AS last_price
     FROM spot_markets sm
     LEFT JOIN market_prices mp
       ON mp.base_currency_id = sm.base_currency_id
      AND mp.quote_currency_id = sm.quote_currency_id
     WHERE sm.status IN ('active', 'maintenance')`
  );
  return result.rows;
}

async function fetchLatestPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (priceLocalCache && priceLocalCache.expiresAt > now) return priceLocalCache.payload;
  if (priceRefreshInFlight) return priceRefreshInFlight;

  priceRefreshInFlight = (async () => {
  try {
    const cached = await redis.get(PRICE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, number>;
      priceLocalCache = { expiresAt: Date.now() + PRICE_LOCAL_CACHE_TTL_MS, payload: parsed };
      return parsed;
    }
  } catch { /* ignore */ }

  const prices: Record<string, number> = { USDT: 1, USDC: 1, DAI: 1 };
  try {
    const rows = await queryLatestPricesFast().catch(() => queryLatestPricesFallback());
    for (const r of rows) {
      const base = r.symbol.split('_')[0];
      if (base) prices[base] = parseFloat(r.last_price) || 0;
    }
  } catch (e) {
    logger.warn(`[${LOG_CAT}] price fetch failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  try {
    await redis.set(PRICE_CACHE_KEY, JSON.stringify(prices), PRICE_CACHE_TTL);
  } catch { /* ignore */ }

  priceLocalCache = { expiresAt: Date.now() + PRICE_LOCAL_CACHE_TTL_MS, payload: prices };
  return prices;
  })().finally(() => {
    priceRefreshInFlight = null;
  });

  return priceRefreshInFlight;
}

async function takeSnapshotsForActiveUsers(): Promise<number> {
  const prices = await fetchLatestPrices();

  const { rows: users } = await db.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM user_balances
     WHERE (CAST(available_balance AS NUMERIC) > 0 OR CAST(locked_balance AS NUMERIC) > 0)
     LIMIT 5000`
  );

  let count = 0;
  for (const { user_id } of users) {
    try {
      const { rows: balances } = await db.query<{ symbol: string; balance: string; account_type: string }>(
        `SELECT c.symbol, (ub.available_balance + ub.locked_balance)::text AS balance, ub.account_type
         FROM user_balances ub
         JOIN currencies c ON c.id = ub.currency_id
         WHERE ub.user_id = $1 AND (CAST(ub.available_balance AS NUMERIC) > 0 OR CAST(ub.locked_balance AS NUMERIC) > 0)`,
        [user_id]
      );

      let totalUsd = 0;
      const breakdown: Record<string, number> = {};
      for (const b of balances) {
        const amt = parseFloat(b.balance) || 0;
        const price = prices[b.symbol] ?? 0;
        const val = amt * price;
        totalUsd += val;
        breakdown[b.symbol] = (breakdown[b.symbol] ?? 0) + val;
      }

      if (totalUsd > 0) {
        await db.query(
          `INSERT INTO portfolio_snapshots (user_id, total_usd, breakdown)
           VALUES ($1, $2, $3)`,
          [user_id, totalUsd.toFixed(2), JSON.stringify(breakdown)]
        );
        count++;
      }
    } catch (e) {
      logger.debug(`[${LOG_CAT}] snapshot failed for user ${user_id}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return count;
}

export async function getPortfolioHistory(
  userId: string,
  period: '24h' | '7d' | '30d' | '90d' | '1y' = '7d'
): Promise<{ timestamp: string; total_usd: number }[]> {
  const intervalMap: Record<string, string> = {
    '24h': '24 hours',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    '1y': '365 days',
  };
  const interval = intervalMap[period] || '7 days';

  const { rows } = await db.query<{ timestamp: string; total_usd: string }>(
    `SELECT created_at AS timestamp, total_usd
     FROM portfolio_snapshots
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '${interval}'
     ORDER BY created_at ASC
     LIMIT 500`,
    [userId]
  );

  return rows.map((r) => ({
    timestamp: r.timestamp,
    total_usd: parseFloat(r.total_usd) || 0,
  }));
}

export function startPortfolioSnapshotCron(): void {
  if (intervalHandle) return;
  logger.info(`[${LOG_CAT}] starting portfolio snapshot cron (every 1h)`);

  setTimeout(() => {
    takeSnapshotsForActiveUsers()
      .then((n) => logger.info(`[${LOG_CAT}] initial snapshot done, users=${n}`))
      .catch((e) => logger.error(`[${LOG_CAT}] initial snapshot failed: ${e instanceof Error ? e.message : 'unknown'}`));
  }, 30_000);

  intervalHandle = setInterval(() => {
    takeSnapshotsForActiveUsers()
      .then((n) => logger.debug(`[${LOG_CAT}] hourly snapshot done, users=${n}`))
      .catch((e) => logger.error(`[${LOG_CAT}] hourly snapshot failed: ${e instanceof Error ? e.message : 'unknown'}`));
  }, SNAPSHOT_INTERVAL_MS);
}

export function stopPortfolioSnapshotCron(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
