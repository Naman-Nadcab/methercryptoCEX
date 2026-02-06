/**
 * Withdrawal admin approval layer.
 * Flow: user_request → pending_approval (if threshold/high-risk) → approved → enqueue → signed → broadcast.
 * On reject: mark failed and release locked balance.
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';
import { getCurrencyIdForToken } from '../lib/currency-resolver.js';
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
 */
export function requiresWithdrawalApproval(
  amount: number,
  token: TokenApprovalInfo
): boolean {
  if (token.is_high_risk) return true;
  const threshold =
    token.withdrawal_approval_threshold != null
      ? parseFloat(token.withdrawal_approval_threshold)
      : config.withdrawalApprovalThreshold;
  return amount > threshold;
}

/**
 * Approve a withdrawal: set status to 'pending', record approver, then enqueue for signing.
 */
export async function approveWithdrawal(
  withdrawalId: string,
  adminId: string,
  auditContext?: WithdrawalAuditContext
): Promise<{ ok: true }> {
  const row = await db.query<{
    id: string;
    status: string;
    user_id: string;
    token_id: string;
    chain_id: string;
    amount: string;
  }>(
    `SELECT id, status, user_id, token_id, chain_id, amount FROM withdrawals WHERE id = $1`,
    [withdrawalId]
  );
  if (row.rows.length === 0) {
    throw new WithdrawalApprovalError(
      WithdrawalApprovalErrors.WITHDRAWAL_NOT_FOUND,
      'Withdrawal not found'
    );
  }
  const w = row.rows[0]!;
  if (w.status !== 'pending_approval') {
    throw new WithdrawalApprovalError(
      WithdrawalApprovalErrors.NOT_PENDING_APPROVAL,
      `Withdrawal is not pending approval (status: ${w.status})`
    );
  }

  await db.query(
    `UPDATE withdrawals
     SET status = 'pending', approved_by = $1, approved_at = CURRENT_TIMESTAMP,
         rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [adminId, withdrawalId]
  );
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
 */
export async function rejectWithdrawal(
  withdrawalId: string,
  adminId: string,
  reason: string,
  auditContext?: WithdrawalAuditContext
): Promise<{ ok: true }> {
  const row = await db.query<{
    id: string;
    status: string;
    user_id: string;
    token_id: string;
    chain_id: string;
    amount: string;
    fee: string;
    account_type: string;
  }>(
    `SELECT id, status, user_id, token_id, chain_id, amount, fee, account_type FROM withdrawals WHERE id = $1`,
    [withdrawalId]
  );
  if (row.rows.length === 0) {
    throw new WithdrawalApprovalError(
      WithdrawalApprovalErrors.WITHDRAWAL_NOT_FOUND,
      'Withdrawal not found'
    );
  }
  const w = row.rows[0]!;
  if (w.status !== 'pending_approval') {
    throw new WithdrawalApprovalError(
      WithdrawalApprovalErrors.NOT_PENDING_APPROVAL,
      `Withdrawal is not pending approval (status: ${w.status})`
    );
  }

  const totalRefund = (parseFloat(w.amount) + parseFloat(w.fee)).toString();

  await db.query(
    `UPDATE withdrawals
     SET status = 'failed', failed_reason = $1, rejected_by = $2, rejected_at = CURRENT_TIMESTAMP,
         rejection_reason = $1, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [reason || 'Rejected by admin', adminId, withdrawalId]
  );

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

  const currencyId = await getCurrencyIdForToken(w.token_id);
  if (!currencyId) {
    logger.error('No currency_id for token on withdrawal reject', { withdrawalId, tokenId: w.token_id });
    throw new WithdrawalApprovalError(
      WithdrawalApprovalErrors.RELEASE_BALANCE_FAILED,
      'Could not resolve currency for token'
    );
  }
  const rawAccountType = w.account_type || 'funding';
  const accountType = ['funding', 'spot', 'trading'].includes(rawAccountType) ? rawAccountType : 'funding';
  const chainId = w.chain_id ?? CHAIN_ID_GLOBAL;
  await ensureUserBalanceRow(w.user_id, currencyId, chainId, accountType);
  const updateResult = await db.query(
    `UPDATE user_balances
     SET available_balance = available_balance + $1, locked_balance = locked_balance - $1, updated_at = NOW()
     WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5 AND locked_balance >= $1
     RETURNING id`,
    [totalRefund, w.user_id, currencyId, chainId, accountType]
  );
  assertUserBalanceUpdated('withdrawal_reject', updateResult, w.user_id, currencyId, accountType, w.chain_id ?? undefined);

  logger.info('Withdrawal rejected and balance released', {
    withdrawalId,
    adminId,
    reason: reason || 'Rejected by admin',
  });
  return { ok: true };
}
