/**
 * Spot trading balance operations only. Uses user_balances with account_type = 'trading'.
 * No changes to deposit, withdrawal, or funding logic.
 */

import { db } from '../lib/database.js';
import type { PoolClient } from 'pg';
import {
  ensureUserBalanceRow,
  assertUserBalanceUpdated,
  assertBalanceInvariant,
  CHAIN_ID_GLOBAL,
} from '../lib/user-balance-helper.js';

const ACCOUNT_TYPE = 'trading';

export async function lockTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient
): Promise<boolean> {
  const q = client ?? db;
  await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, client);
  const result = await q.query(
    `UPDATE user_balances
     SET available_balance = available_balance - $4::numeric, locked_balance = locked_balance + $4::numeric, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND available_balance >= $4::numeric
     RETURNING *`,
    [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
  );
  if (result.rowCount === 0) return false;
  assertBalanceInvariant(result.rows[0]);
  return true;
}

export async function unlockTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient
): Promise<void> {
  const q = client ?? db;
  await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, client);
  const result = await q.query(
    `UPDATE user_balances
     SET available_balance = available_balance + $4::numeric, locked_balance = locked_balance - $4::numeric, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND locked_balance >= $4::numeric
     RETURNING *`,
    [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
  );
  assertUserBalanceUpdated('unlockTradingBalance', result, userId, currencyId, ACCOUNT_TYPE, CHAIN_ID_GLOBAL);
  assertBalanceInvariant(result.rows[0]);
}

export async function debitLockedTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient
): Promise<boolean> {
  const q = client ?? db;
  await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, client);
  const result = await q.query(
    `UPDATE user_balances
     SET locked_balance = locked_balance - $4::numeric, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND locked_balance >= $4::numeric
     RETURNING *`,
    [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
  );
  if (result.rowCount === 0) return false;
  assertBalanceInvariant(result.rows[0]);
  return true;
}

export async function creditTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient
): Promise<void> {
  const q = client ?? db;
  await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, client);
  const result = await q.query(
    `UPDATE user_balances
     SET available_balance = available_balance + $4::numeric, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5
     RETURNING *`,
    [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
  );
  assertUserBalanceUpdated('creditTradingBalance', result, userId, currencyId, ACCOUNT_TYPE, CHAIN_ID_GLOBAL);
  assertBalanceInvariant(result.rows[0]);
}
