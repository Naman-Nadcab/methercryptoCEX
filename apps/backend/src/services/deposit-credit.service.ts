/**
 * PHASE-15: Atomic deposit credit — prevents double-credit under concurrency and retries.
 * Single transaction: transition deposit to completed + set balance_applied_at + credit user_balances.
 * Call from indexer, repair paths, or any flow that credits confirmed deposits.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { ROUND_DOWN, AMOUNT_PRECISION } from '../config/monetary-precision.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { recordAndEvaluateForDeposit } from './aml-transaction-monitor.service.js';
import { logger } from '../lib/logger.js';

Decimal.set({ rounding: Decimal.ROUND_DOWN });

export interface CreditResult {
  credited: boolean;
  reason?: string;
}

/**
 * Credit one deposit by id if it is pending, has enough confirmations, and has not yet been applied.
 * Idempotent: safe to call multiple times; only one caller can win the atomic update.
 */
export async function creditDepositIfConfirmed(depositId: string): Promise<CreditResult> {
  const result = await db.transaction(async (client) => {
    const upd = await client.query<{
      id: string;
      user_id: string;
      currency_id: string;
      amount: string;
    }>(
      `UPDATE deposits
       SET status = 'completed', credited_at = NOW(), balance_applied_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND status = 'pending'
         AND (balance_applied_at IS NULL)
         AND (confirmations >= COALESCE(required_confirmations, 1))
         AND (amount IS NULL OR amount::numeric > 0)
       RETURNING id, user_id, currency_id, amount::text AS amount`,
      [depositId]
    );
    if (upd.rows.length === 0) {
      return { credited: false };
    }
    const row = upd.rows[0]!;
    const amount = new Decimal(row.amount ?? '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    if (amount.lte(0)) {
      return { credited: false };
    }
    const amountStr = amount.toString();
    await ensureUserBalanceRow(row.user_id, row.currency_id, CHAIN_ID_GLOBAL, 'funding', client);
    const sel = await client.query<{ available_balance: string }>(
      `SELECT available_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
      [row.user_id, row.currency_id, CHAIN_ID_GLOBAL]
    );
    if (sel.rows.length === 0) throw new Error('deposit_credit: balance row not found');
    const avBefore = new Decimal(sel.rows[0]!.available_balance);
    const balUpd = await client.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $1::numeric,
           pending_balance = GREATEST(COALESCE(pending_balance, 0) - $1::numeric, 0),
           total_deposited = COALESCE(total_deposited, 0) + $1::numeric,
           updated_at = NOW()
       WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'
       RETURNING *`,
      [amountStr, row.user_id, row.currency_id, CHAIN_ID_GLOBAL]
    );
    assertUserBalanceUpdated('deposit_credit', balUpd, row.user_id, row.currency_id, 'funding', CHAIN_ID_GLOBAL);
    assertBalanceInvariant(balUpd.rows[0]);
    await insertBalanceLedger({
      client,
      userId: row.user_id,
      currencyId: row.currency_id,
      accountType: 'funding',
      debit: '0',
      credit: amountStr,
      balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      balanceAfter: avBefore.plus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      referenceType: 'deposit',
      referenceId: depositId,
      balanceType: 'available',
    });
    return { credited: true };
  });
  if (result.credited) {
    recordAndEvaluateForDeposit(depositId).catch((e) =>
      logger.warn('AML deposit record failed (best-effort)', { depositId, error: e instanceof Error ? e.message : String(e) })
    );
  }
  return result;
}

/**
 * Credit all overdue pending deposits for a user that have enough confirmations and not yet applied.
 * Each deposit is credited atomically (one tx per deposit) to avoid holding locks across many rows.
 */
export async function creditOverdueDepositsForUser(userId: string): Promise<{ credited: number; skipped: number }> {
  const list = await db.query<{ id: string }>(
    `SELECT id FROM deposits
     WHERE user_id = $1 AND status = 'pending'
       AND (confirmations >= COALESCE(required_confirmations, 1))
       AND (balance_applied_at IS NULL)
       AND (amount IS NULL OR amount::numeric > 0)
     ORDER BY created_at ASC`,
    [userId]
  );
  let credited = 0;
  let skipped = 0;
  for (const r of list.rows) {
    const res = await creditDepositIfConfirmed(r.id);
    if (res.credited) credited++;
    else skipped++;
  }
  return { credited, skipped };
}

/**
 * Apply balance for one deposit that is already status='completed' but balance_applied_at IS NULL (legacy/repair).
 * Atomic: only one caller can win the UPDATE ... WHERE balance_applied_at IS NULL; then credit.
 */
export async function applyBalanceForOneCompletedDeposit(depositId: string): Promise<CreditResult> {
  const result = await db.transaction(async (client) => {
    const upd = await client.query<{
      id: string;
      user_id: string;
      currency_id: string;
      amount: string;
    }>(
      `UPDATE deposits SET balance_applied_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'completed' AND credited_at IS NOT NULL AND balance_applied_at IS NULL
         AND (amount IS NULL OR amount::numeric > 0)
       RETURNING id, user_id, currency_id, amount::text AS amount`,
      [depositId]
    );
    if (upd.rows.length === 0) return { credited: false };
    const row = upd.rows[0]!;
    const amount = new Decimal(row.amount ?? '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    if (amount.lte(0)) return { credited: false };
    const amountStr = amount.toString();
    await ensureUserBalanceRow(row.user_id, row.currency_id, CHAIN_ID_GLOBAL, 'funding', client);
    const sel = await client.query<{ available_balance: string }>(
      `SELECT available_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
      [row.user_id, row.currency_id, CHAIN_ID_GLOBAL]
    );
    if (sel.rows.length === 0) throw new Error('deposit_apply_balance: balance row not found');
    const avBefore = new Decimal(sel.rows[0]!.available_balance);
    const balUpd = await client.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $1::numeric, total_deposited = COALESCE(total_deposited, 0) + $1::numeric, updated_at = NOW()
       WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'
       RETURNING *`,
      [amountStr, row.user_id, row.currency_id, CHAIN_ID_GLOBAL]
    );
    assertUserBalanceUpdated('deposit_apply_balance', balUpd, row.user_id, row.currency_id, 'funding', CHAIN_ID_GLOBAL);
    assertBalanceInvariant(balUpd.rows[0]);
    await insertBalanceLedger({
      client,
      userId: row.user_id,
      currencyId: row.currency_id,
      accountType: 'funding',
      debit: '0',
      credit: amountStr,
      balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      balanceAfter: avBefore.plus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      referenceType: 'deposit',
      referenceId: depositId,
      balanceType: 'available',
    });
    return { credited: true };
  });
  if (result.credited) {
    recordAndEvaluateForDeposit(depositId).catch((e) =>
      logger.warn('AML deposit record failed (best-effort)', { depositId, error: e instanceof Error ? e.message : String(e) })
    );
  }
  return result;
}
