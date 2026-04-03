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

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function fetchLatestPrices(): Promise<Record<string, number>> {
  try {
    const cached = await redis.get(PRICE_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore */ }

  const prices: Record<string, number> = { USDT: 1, USDC: 1, DAI: 1 };
  try {
    const { rows } = await db.query<{ symbol: string; last_price: string }>(
      `SELECT sm.symbol, COALESCE(tp.last_price, '0') AS last_price
       FROM spot_markets sm
       LEFT JOIN trading_pairs tp ON tp.symbol = sm.symbol
       WHERE sm.quote_currency_id = (SELECT id FROM currencies WHERE symbol = 'USDT' LIMIT 1)
         AND sm.is_active = true`
    );
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

  return prices;
}

async function takeSnapshotsForActiveUsers(): Promise<number> {
  const prices = await fetchLatestPrices();

  const { rows: users } = await db.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM user_balances
     WHERE (CAST(balance AS NUMERIC) > 0 OR CAST(available_balance AS NUMERIC) > 0)
     LIMIT 5000`
  );

  let count = 0;
  for (const { user_id } of users) {
    try {
      const { rows: balances } = await db.query<{ symbol: string; balance: string; account_type: string }>(
        `SELECT c.symbol, ub.balance, ub.account_type
         FROM user_balances ub
         JOIN currencies c ON c.id = ub.currency_id
         WHERE ub.user_id = $1 AND CAST(ub.balance AS NUMERIC) > 0`,
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
