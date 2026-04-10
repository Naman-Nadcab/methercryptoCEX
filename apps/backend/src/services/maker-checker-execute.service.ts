/**
 * Executes fully approved maker-checker requests (withdrawals, manual credits).
 */
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { approveWithdrawal } from './withdrawal-approval.service.js';
import type { ApprovalRequest } from './admin-approval.service.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { applyAdminManualCreditCore } from './admin-manual-credit-apply.service.js';

export async function executeMakerCheckerIfFullyApproved(req: ApprovalRequest): Promise<void> {
  if (req.status !== 'approved' || req.action_executed) return;

  const lastAp =
    Array.isArray(req.approved_by) && req.approved_by.length > 0
      ? req.approved_by[req.approved_by.length - 1]!
      : null;
  if (lastAp && lastAp === req.requested_by) {
    logger.error('maker-checker: execution blocked — approver equals initiator', { requestId: req.id });
    return;
  }

  if (req.action_type === 'withdrawal_approve') {
    const withdrawalId = String((req.action_payload as { withdrawalId?: string }).withdrawalId ?? '').trim();
    if (!withdrawalId) {
      logger.error('maker-checker: missing withdrawalId in payload', { requestId: req.id });
      return;
    }
    const lastApprover =
      Array.isArray(req.approved_by) && req.approved_by.length > 0
        ? req.approved_by[req.approved_by.length - 1]!
        : null;
    if (!lastApprover) {
      logger.error('maker-checker: no approver on approved request', { requestId: req.id });
      return;
    }
    await approveWithdrawal(withdrawalId, lastApprover, {});
    await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, updated_at = NOW() WHERE id = $1`, [
      req.id,
    ]);
    logger.info('maker-checker: withdrawal executed', { requestId: req.id, withdrawalId });
    return;
  }

  if (req.action_type === 'manual_credit') {
    const pl = req.action_payload as Record<string, unknown>;
    const userInput = String(pl.user ?? '').trim();
    const symbol = String(pl.currency ?? '').trim();
    const amountStr = String(pl.amount ?? '').trim();
    const reasonTrimmed = String(pl.reason ?? '').trim();
    const txHashBody = typeof pl.tx_hash === 'string' ? pl.tx_hash.trim() : '';
    if (!userInput || !symbol || !amountStr || reasonTrimmed.length < 8) {
      logger.error('maker-checker: invalid manual_credit payload', { requestId: req.id });
      return;
    }
    let amountDec: DecimalInstance;
    try {
      amountDec = new Decimal(amountStr).toDecimalPlaces(8, 1);
    } catch {
      logger.error('maker-checker: bad amount', { requestId: req.id });
      return;
    }
    if (!amountDec.isFinite() || amountDec.lte(0)) return;

    const userRow = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL
       AND (id::text = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($1))) LIMIT 1`,
      [userInput]
    );
    if (userRow.rows.length === 0) {
      logger.error('maker-checker: user not found for manual credit', { requestId: req.id });
      return;
    }
    const userId = userRow.rows[0]!.id;
    const currencyId = await getCurrencyIdBySymbol(symbol);
    if (!currencyId) {
      logger.error('maker-checker: currency not found', { requestId: req.id });
      return;
    }
    if (txHashBody) {
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM deposits WHERE tx_hash = $1 AND status IN ('completed', 'confirmed') LIMIT 1`,
        [txHashBody]
      );
      if (existing.rows.length > 0) {
        logger.warn('maker-checker: manual credit skipped — tx already credited', { requestId: req.id });
        await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, updated_at = NOW() WHERE id = $1`, [
          req.id,
        ]);
        return;
      }
    }
    const lastApprover =
      Array.isArray(req.approved_by) && req.approved_by.length > 0
        ? req.approved_by[req.approved_by.length - 1]!
        : req.requested_by;
    await applyAdminManualCreditCore({
      userId,
      currencyId,
      symbol,
      amountDec,
      reasonTrimmed,
      executingAdminId: lastApprover,
      requestId: null,
      ipAddress: null,
      userAgent: null,
    });
    await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, updated_at = NOW() WHERE id = $1`, [
      req.id,
    ]);
    logger.info('maker-checker: manual credit executed', { requestId: req.id, userId });
  }
}
