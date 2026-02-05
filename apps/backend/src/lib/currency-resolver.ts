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
