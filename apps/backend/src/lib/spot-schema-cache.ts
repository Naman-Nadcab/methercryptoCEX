/**
 * Caches whether spot_trades uses 'market' or 'trading_pair_id' column.
 * Checked once at server startup to avoid per-request information_schema queries.
 */

import { db } from './database.js';

let cachedUseMarket: boolean | null = null;

/**
 * Returns true if spot_trades has 'market' column; false if it uses trading_pair_id.
 * Call once at startup; result is cached for process lifetime.
 */
export async function getSpotTradesUseMarket(): Promise<boolean> {
  if (cachedUseMarket !== null) return cachedUseMarket;
  try {
    const r = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'market'
      ) as exists`
    );
    cachedUseMarket = r.rows[0]?.exists ?? false;
  } catch {
    cachedUseMarket = false;
  }
  return cachedUseMarket;
}

/**
 * Synchronous getter after init. Returns cached value or false if not yet initialized.
 */
export function getSpotTradesUseMarketSync(): boolean {
  return cachedUseMarket ?? false;
}

export function setSpotTradesUseMarket(value: boolean): void {
  cachedUseMarket = value;
}
