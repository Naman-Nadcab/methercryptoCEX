/**
 * Stale feed guard. Markets with no trade in STALE_THRESHOLD_SEC become "stale".
 * Used by /health for observability; admin can set per-symbol circuit for halt.
 */

import { db } from '../lib/database.js';

const STALE_THRESHOLD_SEC = 60;

export interface StaleMarketInfo {
  market: string;
  lastTradeAt: string;
  ageSeconds: number;
}

export async function getStaleMarkets(): Promise<StaleMarketInfo[]> {
  const hasMarketCol = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='spot_trades' AND column_name='market') AS exists`
  );
  if (!hasMarketCol.rows[0]?.exists) return [];

  const cutoff = new Date(Date.now() - STALE_THRESHOLD_SEC * 1000);
  const r = await db.query<{ market: string; last_at: string }>(
    `SELECT market, MAX(created_at)::text as last_at
     FROM spot_trades
     GROUP BY market
     HAVING MAX(created_at) < $1`,
    [cutoff]
  );

  const now = Date.now();
  return r.rows.map((row) => {
    const lastAt = new Date(row.last_at).getTime();
    return {
      market: row.market,
      lastTradeAt: row.last_at,
      ageSeconds: Math.round((now - lastAt) / 1000),
    };
  });
}
