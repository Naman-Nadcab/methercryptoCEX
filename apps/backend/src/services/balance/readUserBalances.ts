/**
 * Canonical balance read: ONE place for all user balance reads.
 * - Ensures a row exists for every active currency before reading.
 * - Reads ONLY from user_balances. Never filters by value. Always returns numeric strings ('0', not null).
 * - Zero rows after ensure = CRITICAL error.
 * @see docs/BALANCE_AND_DEPOSIT_RULES.md – do not add alternate balance read paths; use this so balance always shows.
 */

import { db } from '../../lib/database.js';
import { ensureUserBalanceRowsBulk, CHAIN_ID_GLOBAL } from '../../lib/user-balance-helper.js';
import { logger } from '../../lib/logger.js';
import { getActiveCurrencyIds } from '../../lib/active-currencies-cache.js';

export interface BalanceRow {
  currency_id: string;
  symbol: string;
  account_type: string;
  available_balance: string;
  locked_balance: string;
  /** PHASE-11: P2P escrow (non-withdrawable, non-tradable). */
  escrow_balance?: string;
}

const BALANCE_READ_SQL = `
  SELECT
    ub.currency_id,
    COALESCE(c.symbol, '') AS symbol,
    ub.account_type::text AS account_type,
    COALESCE(ub.available_balance, 0)::text AS available_balance,
    COALESCE(ub.locked_balance, 0)::text AS locked_balance,
    COALESCE(ub.escrow_balance, 0)::text AS escrow_balance
  FROM user_balances ub
  LEFT JOIN currencies c ON c.id = ub.currency_id
  WHERE
    ub.user_id = $1
    AND LOWER(TRIM(COALESCE(ub.account_type::text, ''))) = LOWER(TRIM($2))
  ORDER BY COALESCE(c.symbol, ub.currency_id::text) ASC
`;

/**
 * Load balance rows from user_balances (single source of truth).
 * Ensures a row exists for every active currency so the list is complete; then reads all rows for (user, accountType).
 * Never filters by balance value. Returns numeric strings only ('0', not null).
 * @param currencyIds Optional pre-fetched IDs (e.g. from getActiveCurrencyIds) to avoid redundant queries in batch calls.
 */
export async function readUserBalances(userId: string, accountType: string, currencyIds?: string[]): Promise<BalanceRow[]> {
  const ids = currencyIds ?? (await getActiveCurrencyIds());

  if (ids.length > 0) {
    await ensureUserBalanceRowsBulk(userId, ids, CHAIN_ID_GLOBAL, accountType);
  }

  const result = await db.query<BalanceRow & { escrow_balance?: string }>(BALANCE_READ_SQL, [userId, accountType]);
  const rows = result.rows.map((r) => ({
    currency_id: r.currency_id,
    symbol: r.symbol,
    account_type: r.account_type,
    available_balance: r.available_balance ?? '0',
    locked_balance: r.locked_balance ?? '0',
    escrow_balance: (r as { escrow_balance?: string }).escrow_balance ?? '0',
  }));

  if (rows.length === 0) {
    logger.debug('Balance read returned zero rows', { userId, accountType, activeCurrencyCount: ids.length });
  }

  return rows;
}
