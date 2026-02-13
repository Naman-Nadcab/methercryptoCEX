/**
 * Spot trading balance operations only. Uses user_balances with account_type = 'trading'.
 * No changes to deposit, withdrawal, or funding logic.
 */

import crypto from 'node:crypto';
import { db } from '../lib/database.js';
import type { PoolClient } from 'pg';
import {
  ensureUserBalanceRow,
  assertUserBalanceUpdated,
  assertBalanceInvariant,
  CHAIN_ID_GLOBAL,
} from '../lib/user-balance-helper.js';
import { insertBalanceLedger, type LedgerReferenceType } from '../lib/balance-ledger.js';

const ACCOUNT_TYPE = 'trading';

export async function lockTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<boolean> {
  const refType = ledgerRef?.referenceType ?? 'adjustment';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND available_balance >= $5::numeric
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, amount]
    );
    if (lockSel.rows.length === 0) return false;
    const selRow = lockSel.rows[0]!;
    const balanceBeforeAvail = selRow.available_balance ?? '0';
    const balanceBeforeLocked = selRow.locked_balance ?? '0';
    const result = await q.query(
      `UPDATE user_balances
       SET available_balance = available_balance - $4::numeric, locked_balance = locked_balance + $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND available_balance >= $4::numeric
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    if (result.rowCount === 0) return false;
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: amount,
      credit: '0',
      balanceBefore: balanceBeforeAvail,
      balanceAfter: String(row.available_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: '0',
      credit: amount,
      balanceBefore: balanceBeforeLocked,
      balanceAfter: String(row.locked_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'locked',
    });
    return true;
  };
  if (client) return run(client);
  return db.transaction(run);
}

export async function unlockTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<void> {
  const refType = ledgerRef?.referenceType ?? 'adjustment';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND locked_balance >= $5::numeric
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, amount]
    );
    if (lockSel.rows.length === 0) {
      throw new Error('unlockTradingBalance: no rows or insufficient locked');
    }
    const selRow = lockSel.rows[0]!;
    const result = await q.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $4::numeric, locked_balance = locked_balance - $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND locked_balance >= $4::numeric
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    assertUserBalanceUpdated('unlockTradingBalance', result, userId, currencyId, ACCOUNT_TYPE, CHAIN_ID_GLOBAL);
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: '0',
      credit: amount,
      balanceBefore: selRow.available_balance ?? '0',
      balanceAfter: String(row.available_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: amount,
      credit: '0',
      balanceBefore: selRow.locked_balance ?? '0',
      balanceAfter: String(row.locked_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'locked',
    });
  };
  if (client) await run(client);
  else await db.transaction(run);
}

export async function debitLockedTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<boolean> {
  const refType = ledgerRef?.referenceType ?? 'trade_sell';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ locked_balance: string }>(
      `SELECT locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND locked_balance >= $5::numeric
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, amount]
    );
    if (lockSel.rows.length === 0) return false;
    const balanceBefore = lockSel.rows[0]!.locked_balance ?? '0';
    const result = await q.query(
      `UPDATE user_balances
       SET locked_balance = locked_balance - $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND locked_balance >= $4::numeric
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    if (result.rowCount === 0) return false;
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: amount,
      credit: '0',
      balanceBefore,
      balanceAfter: String(row.locked_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'locked',
    });
    return true;
  };
  if (client) return run(client);
  return db.transaction(run);
}

export async function creditTradingBalance(
  userId: string,
  currencyId: string,
  amount: string,
  client?: PoolClient,
  ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
): Promise<void> {
  const refType = ledgerRef?.referenceType ?? 'trade_buy';
  const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
  const run = async (q: PoolClient) => {
    await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE, q);
    const lockSel = await q.query<{ available_balance: string }>(
      `SELECT available_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, ACCOUNT_TYPE]
    );
    if (lockSel.rows.length === 0) {
      throw new Error('creditTradingBalance: no balance row');
    }
    const balanceBefore = lockSel.rows[0]!.available_balance ?? '0';
    const result = await q.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $4::numeric, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5
       RETURNING *`,
      [userId, currencyId, CHAIN_ID_GLOBAL, amount, ACCOUNT_TYPE]
    );
    assertUserBalanceUpdated('creditTradingBalance', result, userId, currencyId, ACCOUNT_TYPE, CHAIN_ID_GLOBAL);
    assertBalanceInvariant(result.rows[0]);
    const row = result.rows[0]!;
    await insertBalanceLedger({
      client: q,
      userId,
      currencyId,
      accountType: ACCOUNT_TYPE,
      debit: '0',
      credit: amount,
      balanceBefore,
      balanceAfter: String(row.available_balance ?? 0),
      referenceType: refType,
      referenceId: refId,
      balanceType: 'available',
    });
  };
  if (client) await run(client);
  else await db.transaction(run);
}
