/**
 * Withdrawal admin approval layer.
 * Flow: user_request → pending_approval (if threshold/high-risk) → approved → enqueue → signed → broadcast.
 * On reject: mark failed and release locked balance.
 * Monetary amounts: Decimal.js only, no float.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';
import { getCurrencyIdForToken } from '../lib/currency-resolver.js';
import { assertBalanceInvariant } from '../lib/user-balance-helper.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { HotWalletCapCodes } from './hot-wallet.service.js';
import { enqueueWithdrawal } from './withdrawal-signing.service.js';

export interface WithdrawalAuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

export const WithdrawalApprovalErrors = {
  WITHDRAWAL_NOT_FOUND: 'WITHDRAWAL_NOT_FOUND',
  NOT_PENDING_APPROVAL: 'NOT_PENDING_APPROVAL',
  RELEASE_BALANCE_FAILED: 'RELEASE_BALANCE_FAILED',
  HOT_WALLET_CAP_EXCEEDED: 'HOT_WALLET_CAP_EXCEEDED',
} as const;

export class WithdrawalApprovalError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'WithdrawalApprovalError';
  }
}

/** Token row must include is_high_risk (and optionally withdrawal_approval_threshold if added later). */
export interface TokenApprovalInfo {
  is_high_risk?: boolean;
  withdrawal_approval_threshold?: string | null;
}

/**
 * Whether a withdrawal requires admin approval before being enqueued for signing.
 * Required when: amount > threshold OR asset is high-risk.
 * Uses Decimal for comparison; no float.
 */
export function requiresWithdrawalApproval(
  amount: string,
  token: TokenApprovalInfo
): boolean {
  if (token.is_high_risk) return true;
  const thresholdStr =
    token.withdrawal_approval_threshold != null && token.withdrawal_approval_threshold !== ''
      ? String(token.withdrawal_approval_threshold)
      : String(config.withdrawalApprovalThreshold);
  return new Decimal(amount).gt(new Decimal(thresholdStr));
}

/**
 * Approve a withdrawal: set status to 'pending', record approver, then enqueue for signing.
 * Uses SELECT FOR UPDATE to avoid race with concurrent reject.
 */
export async function approveWithdrawal(
  withdrawalId: string,
  adminId: string,
  auditContext?: WithdrawalAuditContext
): Promise<{ ok: true }> {
  const w = await db.transaction(async (client) => {
    const row = await client.query<{
      id: string;
      status: string;
      user_id: string;
      token_id: string;
      chain_id: string;
      amount: string;
    }>(
      `SELECT id, status, user_id, token_id, chain_id, amount FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );
    if (row.rows.length === 0) {
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.WITHDRAWAL_NOT_FOUND,
        'Withdrawal not found'
      );
    }
    const withdrawal = row.rows[0]!;
    if (withdrawal.status !== 'pending_approval') {
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.NOT_PENDING_APPROVAL,
        `Withdrawal is not pending approval (status: ${withdrawal.status})`
      );
    }
    await client.query(
      `UPDATE withdrawals
       SET status = 'pending', approved_by = $1, approved_at = CURRENT_TIMESTAMP,
           rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [adminId, withdrawalId]
    );
    return withdrawal;
  });

  // E2E withdrawal lifecycle: stage 2 — approved (pending_approval → pending)
  logger.info('[E2E_WITHDRAWAL] stage=approved', {
    withdrawal_id: withdrawalId,
    status: 'pending',
    chain_id: w.chain_id,
  });

  await logWithdrawalLifecycle('withdrawal_approved', {
    withdrawal_id: withdrawalId,
    user_id: w.user_id,
    admin_id: adminId,
    token_id: w.token_id,
    chain_id: w.chain_id,
    amount: w.amount,
    ip: auditContext?.ip ?? null,
    user_agent: auditContext?.userAgent ?? null,
  });

  const enqueueResult = await enqueueWithdrawal(withdrawalId);
  if (enqueueResult.enqueued) {
    logger.info('[E2E_WITHDRAWAL] stage=enqueued', {
      withdrawal_id: withdrawalId,
      chain_id: w.chain_id,
    });
  } else if (enqueueResult.reason) {
    if (
      enqueueResult.code === HotWalletCapCodes.SINGLE_TX_CAP_EXCEEDED ||
      enqueueResult.code === HotWalletCapCodes.DAILY_CAP_EXCEEDED
    ) {
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.HOT_WALLET_CAP_EXCEEDED,
        enqueueResult.reason
      );
    }
    logger.warn('Withdrawal approved but enqueue failed', {
      withdrawalId,
      reason: enqueueResult.reason,
    });
  }

  logger.info('Withdrawal approved', { withdrawalId, adminId });
  return { ok: true };
}

/**
 * Reject a withdrawal: set status to 'failed', record rejector and reason, release locked balance.
 * Uses SELECT FOR UPDATE inside transaction to avoid race with concurrent approve.
 */
export async function rejectWithdrawal(
  withdrawalId: string,
  adminId: string,
  reason: string,
  auditContext?: WithdrawalAuditContext
): Promise<{ ok: true }> {
  const w = await db.transaction(async (client) => {
    const row = await client.query<{
      id: string;
      status: string;
      user_id: string;
      token_id: string;
      chain_id: string;
      amount: string;
      fee: string;
      account_type: string;
    }>(
      `SELECT id, status, user_id, token_id, chain_id, amount, fee, account_type FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );
    if (row.rows.length === 0) {
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.WITHDRAWAL_NOT_FOUND,
        'Withdrawal not found'
      );
    }
    const withdrawal = row.rows[0]!;
    if (withdrawal.status !== 'pending_approval') {
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.NOT_PENDING_APPROVAL,
        `Withdrawal is not pending approval (status: ${withdrawal.status})`
      );
    }

    const totalRefund = new Decimal(withdrawal.amount).plus(withdrawal.fee).toString();
    const rawAccountType = withdrawal.account_type || 'funding';
    const accountType = ['funding', 'spot', 'trading'].includes(rawAccountType) ? rawAccountType : 'funding';
    const chainId = withdrawal.chain_id ?? CHAIN_ID_GLOBAL;

    const currencyId = await getCurrencyIdForToken(withdrawal.token_id);
    if (!currencyId) {
      logger.error('No currency_id for token on withdrawal reject', { withdrawalId, tokenId: withdrawal.token_id });
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.RELEASE_BALANCE_FAILED,
        'Could not resolve currency for token'
      );
    }

    await client.query(
      `UPDATE withdrawals
       SET status = 'failed', failed_reason = $1, rejected_by = $2, rejected_at = CURRENT_TIMESTAMP,
           rejection_reason = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reason || 'Rejected by admin', adminId, withdrawalId]
    );
    await ensureUserBalanceRow(withdrawal.user_id, currencyId, chainId, accountType, client);
    const lockSel = await client.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
         AND locked_balance >= $5::numeric
       FOR UPDATE`,
      [withdrawal.user_id, currencyId, chainId, accountType, totalRefund]
    );
    if (lockSel.rows.length === 0) {
      throw new WithdrawalApprovalError(
        WithdrawalApprovalErrors.RELEASE_BALANCE_FAILED,
        'Balance row not found or insufficient locked for refund'
      );
    }
    const avBefore = lockSel.rows[0]!.available_balance ?? '0';
    const lockBefore = lockSel.rows[0]!.locked_balance ?? '0';

    const updateResult = await client.query(
      `UPDATE user_balances
       SET available_balance = available_balance + $1::numeric, locked_balance = locked_balance - $1::numeric, updated_at = NOW()
       WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5 AND locked_balance >= $1::numeric
       RETURNING *`,
      [totalRefund, withdrawal.user_id, currencyId, chainId, accountType]
    );
    assertUserBalanceUpdated('withdrawal_reject', updateResult, withdrawal.user_id, currencyId, accountType, withdrawal.chain_id ?? undefined);
    assertBalanceInvariant(updateResult.rows[0]);
    const ubRow = updateResult.rows[0] as { available_balance?: string; locked_balance?: string } | undefined;

    await insertBalanceLedger({
      client,
      userId: withdrawal.user_id,
      currencyId,
      accountType,
      debit: '0',
      credit: totalRefund,
      balanceBefore: avBefore,
      balanceAfter: String(ubRow?.available_balance ?? 0),
      referenceType: 'withdrawal',
      referenceId: withdrawalId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client,
      userId: withdrawal.user_id,
      currencyId,
      accountType,
      debit: totalRefund,
      credit: '0',
      balanceBefore: lockBefore,
      balanceAfter: String(ubRow?.locked_balance ?? 0),
      referenceType: 'withdrawal',
      referenceId: withdrawalId,
      balanceType: 'locked',
    });
    return withdrawal;
  });

  await logWithdrawalLifecycle('withdrawal_rejected', {
    withdrawal_id: withdrawalId,
    user_id: w.user_id,
    admin_id: adminId,
    token_id: w.token_id,
    chain_id: w.chain_id,
    amount: w.amount,
    ip: auditContext?.ip ?? null,
    user_agent: auditContext?.userAgent ?? null,
  });

  logger.info('Withdrawal rejected and balance released', {
    withdrawalId,
    adminId,
    reason: reason || 'Rejected by admin',
  });
  return { ok: true };
}
