/**
 * FREEZE BALANCE FOUNDATION: user_balances is the single source of truth.
 * Ensures a row exists before every balance update so user funds never disappear.
 * Unique key: (user_id, currency_id, chain_id, account_type).
 */

import { db } from './database.js';
import { logger } from './logger.js';
import type { PoolClient } from 'pg';
import type { QueryResult } from 'pg';

/** Canonical account type for main wallet. Use 'spot' for all balance rows. */
export const DEFAULT_ACCOUNT_TYPE = 'spot';

/** Sentinel when no chain is specified (global balance row). */
export const CHAIN_ID_GLOBAL = '';

/**
 * Ensures a row exists in user_balances for (user_id, currency_id, chain_id, account_type).
 * Call BEFORE every UPDATE user_balances. Pass client when inside a transaction.
 * Use CHAIN_ID_GLOBAL ('') when no chain is relevant.
 */
export async function ensureUserBalanceRow(
  userId: string,
  currencyId: string,
  chainId: string = CHAIN_ID_GLOBAL,
  accountType: string = DEFAULT_ACCOUNT_TYPE,
  client?: PoolClient
): Promise<void> {
  const sql = `INSERT INTO user_balances (
    id, user_id, currency_id, chain_id, account_type,
    available_balance, locked_balance, pending_balance, total_deposited, updated_at
  )
  VALUES (gen_random_uuid(), $1, $2, $3, $4::balance_account_type, 0, 0, 0, 0, NOW())
  ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`;
  const params = [userId, currencyId, chainId, accountType];
  if (client) {
    await client.query(sql, params);
  } else {
    await db.query(sql, params);
  }
}

/**
 * Log ERROR when an UPDATE user_balances affected 0 rows. No silent failures.
 */
export function logUserBalanceUpdateZeroRows(
  operation: string,
  userId: string,
  currencyId: string,
  accountType?: string,
  chainId?: string
): void {
  logger.error('UPDATE user_balances affected 0 rows', {
    operation,
    user_id: userId,
    currency_id: currencyId,
    account_type: accountType ?? DEFAULT_ACCOUNT_TYPE,
    chain_id: chainId ?? null,
  });
}

/**
 * Throws if UPDATE user_balances affected 0 rows. Use after every critical balance UPDATE.
 */
export function assertUserBalanceUpdated(
  operation: string,
  updateResult: QueryResult,
  userId: string,
  currencyId: string,
  accountType?: string,
  chainId?: string
): void {
  if (updateResult.rowCount === 0) {
    logUserBalanceUpdateZeroRows(operation, userId, currencyId, accountType, chainId);
    throw new Error(
      `user_balances UPDATE affected 0 rows (operation=${operation}, user_id=${userId}, currency_id=${currencyId}, account_type=${accountType ?? DEFAULT_ACCOUNT_TYPE})`
    );
  }
}
