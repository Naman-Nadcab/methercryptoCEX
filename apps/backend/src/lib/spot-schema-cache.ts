/**
 * Caches whether spot_trades uses 'market' or 'trading_pair_id' column.
 * Checked once at server startup to avoid per-request information_schema queries.
 */

import { db } from './database.js';

let cachedUseMarket: boolean | null = null;
let cachedOrdersUseMarket: boolean | null = null;

/**
 * Returns true if spot_trades has 'market' column; false if it uses trading_pair_id.
 * Call once at startup; result is cached for process lifetime.
 */
export async function getSpotTradesUseMarket(): Promise<boolean> {
  if (cachedUseMarket !== null) return cachedUseMarket;
  try {
    const r = await db.query<{ has_market: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'spot_trades' AND column_name = 'market'
      ) AS has_market`
    );
    if (r.rows[0]?.has_market === true) {
      cachedUseMarket = true;
      return true;
    }
  } catch {
    /* fall through to probe */
  }
  try {
    await db.query(`SELECT market FROM spot_trades WHERE 1=0`);
    cachedUseMarket = true;
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

/** True if spot_orders has a `market` column; false if only trading_pair_id (+ join to trading_pairs). */
export async function getSpotOrdersUseMarket(): Promise<boolean> {
  if (cachedOrdersUseMarket !== null) return cachedOrdersUseMarket;
  try {
    const r = await db.query<{ has_market: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'spot_orders' AND column_name = 'market'
      ) AS has_market`
    );
    if (r.rows[0]?.has_market === true) {
      cachedOrdersUseMarket = true;
      return true;
    }
  } catch {
    /* fall through to probe */
  }
  try {
    await db.query(`SELECT market FROM spot_orders WHERE 1=0`);
    cachedOrdersUseMarket = true;
  } catch {
    cachedOrdersUseMarket = false;
  }
  return cachedOrdersUseMarket;
}

export function getSpotOrdersUseMarketSync(): boolean {
  return cachedOrdersUseMarket ?? false;
}

export function setSpotOrdersUseMarket(value: boolean): void {
  cachedOrdersUseMarket = value;
}
