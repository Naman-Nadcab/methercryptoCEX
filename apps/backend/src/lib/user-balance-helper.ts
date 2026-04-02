/**
 * FREEZE BALANCE FOUNDATION: user_balances is the single source of truth.
 * Ensures a row exists before every balance update so user funds never disappear.
 * Unique key: (user_id, currency_id, chain_id, account_type).
 * Re-exports monetary invariants for use at balance mutation boundaries.
 */

import { Decimal } from './decimal.js';
import { db } from './database.js';
import { logger } from './logger.js';
import type { PoolClient } from 'pg';
import type { QueryResult } from 'pg';

export {
  assertNonNegative,
  assertValidDecimal,
  assertDebitNotExceedLocked,
  assertUnlockNotExceedLocked,
  assertDebitNotExceedAvailable,
} from './monetary-invariants.js';

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
  VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::balance_account_type, 0, 0, 0, 0, NOW())
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
    SELECT gen_random_uuid(), $1::uuid, u.cid, $2, $3::balance_account_type, 0, 0, 0, 0, NOW()
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

/** Row shape from RETURNING * on user_balances (numeric may come as string from pg). */
export interface UserBalanceRowLike {
  available_balance: string | number;
  locked_balance: string | number;
  pending_balance?: string | number | null;
  escrow_balance?: string | number | null;
}

/**
 * Assert invariants after every balance update:
 * - All bucket values must be finite (no NaN, no ±Infinity).
 * - No negative buckets: available >= 0, locked >= 0, pending >= 0, escrow >= 0.
 * Call with the row returned from UPDATE ... RETURNING *.
 * Uses Decimal for comparisons; no float/Number in financial path.
 */
export function assertBalanceInvariant(row: UserBalanceRowLike | null | undefined): void {
  if (row == null) return;
  const av = new Decimal(String(row.available_balance ?? 0));
  const lk = new Decimal(String(row.locked_balance ?? 0));
  const pd = new Decimal(String(row.pending_balance ?? 0));
  const esc = new Decimal(String(row.escrow_balance ?? 0));
  if (!av.isFinite() || !lk.isFinite() || !pd.isFinite() || !esc.isFinite()) {
    logger.error('Balance invariant violated: non-finite value', {
      available_balance: String(row.available_balance ?? 0),
      locked_balance: String(row.locked_balance ?? 0),
      pending_balance: String(row.pending_balance ?? 0),
      escrow_balance: String(row.escrow_balance ?? 0),
    });
    throw new Error(
      `user_balances invariant violated: non-finite bucket value (available=${String(row.available_balance)}, locked=${String(row.locked_balance)}, pending=${String(row.pending_balance)}, escrow=${String(row.escrow_balance)})`
    );
  }
  if (av.lt(0) || lk.lt(0) || pd.lt(0) || esc.lt(0)) {
    logger.error('Balance invariant violated: negative balance', {
      available_balance: av.toString(),
      locked_balance: lk.toString(),
      pending_balance: pd.toString(),
      escrow_balance: esc.toString(),
    });
    throw new Error(
      `user_balances invariant violated: available=${av.toString()}, locked=${lk.toString()}, pending=${pd.toString()}, escrow=${esc.toString()} (all must be >= 0)`
    );
  }
}
