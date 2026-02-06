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

/** PostgreSQL error code for unique violation. */
const PG_UNIQUE_VIOLATION = '23505';

/** Old DB constraint: (user_id, currency_id) only — INSERT can violate this before migration. */
const OLD_UB_CONSTRAINT = 'user_balances_user_id_currency_id_key';

/**
 * Ensures a row exists in user_balances for (user_id, currency_id, chain_id, account_type).
 * Call BEFORE every UPDATE user_balances. Pass client when inside a transaction.
 * Use CHAIN_ID_GLOBAL ('') when no chain is relevant.
 * If the DB still has the old 2-column unique (user_id, currency_id), duplicate is treated as success.
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
  try {
    if (client) {
      await client.query(sql, params);
    } else {
      await db.query(sql, params);
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const constraint = (err as { constraint?: string })?.constraint;
    if (code === PG_UNIQUE_VIOLATION && constraint === OLD_UB_CONSTRAINT) {
      // Row already exists for (user_id, currency_id); read path can proceed.
      return;
    }
    throw err;
  }
}

/**
 * Ensures balance rows for many currencies in one query (fast path for readUserBalances).
 * Uses unnest; ON CONFLICT DO NOTHING. Catches old 2-col unique and continues.
 */
export async function ensureUserBalanceRowsBulk(
  userId: string,
  currencyIds: string[],
  chainId: string = CHAIN_ID_GLOBAL,
  accountType: string = DEFAULT_ACCOUNT_TYPE,
  client?: PoolClient
): Promise<void> {
  if (currencyIds.length === 0) return;
  const sql = `
    INSERT INTO user_balances (id, user_id, currency_id, chain_id, account_type, available_balance, locked_balance, pending_balance, total_deposited, updated_at)
    SELECT gen_random_uuid(), $1, u.cid, $2, $3::balance_account_type, 0, 0, 0, 0, NOW()
    FROM unnest($4::uuid[]) AS u(cid)
    ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`;
  try {
    if (client) {
      await client.query(sql, [userId, chainId, accountType, currencyIds]);
    } else {
      await db.query(sql, [userId, chainId, accountType, currencyIds]);
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const constraint = (err as { constraint?: string })?.constraint;
    if (code === PG_UNIQUE_VIOLATION && constraint === OLD_UB_CONSTRAINT) {
      return;
    }
    throw err;
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
