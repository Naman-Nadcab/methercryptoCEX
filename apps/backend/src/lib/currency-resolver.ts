/**
 * Resolve currency_id for user_balances (single source of truth).
 * Used by wallet routes and withdrawal services so balance read/write uses user_balances only.
 */

import { db } from './database.js';

export async function getCurrencyIdBySymbol(symbol: string): Promise<string | null> {
  try {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM($1)) LIMIT 1`,
      [symbol]
    );
    return r.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function getCurrencyIdForToken(tokenId: string): Promise<string | null> {
  try {
    const r = await db.query<{ id: string }>(
      `SELECT c.id FROM tokens t
       JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol))
       WHERE t.id = $1 LIMIT 1`,
      [tokenId]
    );
    return r.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Get token ids for a currency (for cache invalidation). */
export async function getTokenIdsByCurrencyId(currencyId: string): Promise<string[]> {
  try {
    const r = await db.query<{ id: string }>(
      `SELECT t.id FROM tokens t
       JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol))
       WHERE c.id = $1 AND t.is_active = TRUE`,
      [currencyId]
    );
    return r.rows.map((x) => x.id);
  } catch {
    return [];
  }
}
