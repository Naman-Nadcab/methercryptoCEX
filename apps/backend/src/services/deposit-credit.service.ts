/**
 * PHASE-15: Atomic deposit credit — prevents double-credit under concurrency and retries.
 * Tier-1: Sanctions screening before credit; flagged deposits are never credited.
 * Single transaction: sanctions check → then transition to completed + credit user_balances.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { ROUND_DOWN, AMOUNT_PRECISION } from '../config/monetary-precision.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { recordAndEvaluateForDeposit } from './aml-transaction-monitor.service.js';
import { checkSanctions } from './sanctions-screening.service.js';
import { logger } from '../lib/logger.js';

Decimal.set({ rounding: Decimal.ROUND_DOWN });

export interface CreditResult {
  credited: boolean;
  reason?: string;
}

/**
 * Mark deposit as flagged (sanctions block). Log to aml_transaction_logs and aml_alerts.
 * Call inside the same transaction that will not credit the deposit.
 */
async function markDepositFlagged(
  client: import('pg').PoolClient,
  depositId: string,
  userId: string,
  asset: string,
  amount: string,
  reason: string
): Promise<void> {
  await client.query(
    `UPDATE deposits SET is_flagged = TRUE, flagged_reason = $2, updated_at = NOW() WHERE id = $1`,
    [depositId, reason]
  );
  await client.query(
    `INSERT INTO aml_transaction_logs (user_id, txn_type, asset, amount, created_at)
     VALUES ($1, 'deposit_flagged', $2, $3::numeric, NOW())`,
    [userId, asset ?? 'UNKNOWN', amount]
  );
  try {
    await client.query(
      `INSERT INTO aml_alerts (user_id, alert_type, severity, status, details)
       VALUES ($1, 'sanctions_deposit_blocked', 'high', 'open', $2::jsonb)`,
      [userId, JSON.stringify({ depositId, reason, asset, amount })]
    );
  } catch (e) {
    logger.warn('AML alert insert for deposit_flagged failed (best-effort)', {
      depositId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Credit one deposit by id if it is pending, has enough confirmations, not flagged, and has not yet been applied.
 * Tier-1: Runs sanctions check before crediting; if blocked, marks deposit flagged and does not credit.
 * Idempotent: safe to call multiple times; only one caller can win the atomic update.
 */
export async function creditDepositIfConfirmed(depositId: string): Promise<CreditResult> {
  const result = await db.transaction(async (client) => {
    const sel = await client.query<{
      id: string;
      user_id: string;
      currency_id: string;
      amount: string;
      to_address: string | null;
      symbol: string | null;
    }>(
      `SELECT d.id, d.user_id, d.currency_id, d.amount::text AS amount,
              d.to_address, c.symbol
       FROM deposits d
       LEFT JOIN currencies c ON c.id = d.currency_id
       WHERE d.id = $1
         AND d.status = 'pending'
         AND (d.is_flagged IS NOT TRUE OR d.is_flagged IS NULL)
         AND (d.balance_applied_at IS NULL)
         AND (d.confirmations >= COALESCE(d.required_confirmations, 1))
         AND (d.amount IS NULL OR d.amount::numeric > 0)
       FOR UPDATE`,
      [depositId]
    );
    if (sel.rows.length === 0) {
      return { credited: false };
    }
    const row = sel.rows[0]!;
    const amount = new Decimal(row.amount ?? '0').toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN);
    if (amount.lte(0)) {
      return { credited: false };
    }
    const amountStr = amount.toString();
    const asset = row.symbol ?? 'UNKNOWN';

    const sanctions = await checkSanctions({
      address: row.to_address ?? undefined,
      asset,
      amount: amountStr,
      userId: row.user_id,
    });
    if (!sanctions.allowed) {
      await markDepositFlagged(
        client,
        depositId,
        row.user_id,
        asset,
        amountStr,
        sanctions.reason ?? 'Sanctions check failed'
      );
      return { credited: false, reason: sanctions.reason };
    }

    await client.query(
      `UPDATE deposits
       SET status = 'completed', credited_at = NOW(), balance_applied_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [depositId]
    );
    await ensureUserBalanceRow(row.user_id, row.currency_id, CHAIN_ID_GLOBAL, 'funding', client);
    const balSel = await client.query<{ available_balance: string }>(
      `SELECT available_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
      [row.user_id, row.currency_id, CHAIN_ID_GLOBAL]
    );
    if (balSel.rows.length === 0) throw new Error('deposit_credit: balance row not found');
    const avBefore = new Decimal(balSel.rows[0]!.available_balance);
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
    try {
      const { publishDepositConfirmed } = await import('./admin-ws.service.js');
      const row = await db.query<{ id: string; user_id: string; currency_id: string; amount: string }>(
        `SELECT id, user_id, currency_id, amount::text AS amount FROM deposits WHERE id = $1`,
        [depositId]
      ).then((r) => r.rows[0]);
      if (row) publishDepositConfirmed({ id: row.id, user_id: row.user_id, amount: row.amount, currency_id: row.currency_id });
    } catch { /* best-effort */ }
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
       AND (is_flagged IS NOT TRUE OR is_flagged IS NULL)
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
