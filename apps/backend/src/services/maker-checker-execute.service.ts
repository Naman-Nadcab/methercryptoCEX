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
import { setTradingHalt } from '../lib/trading-halt.js';
import { setMmCircuitState } from './mm-circuit-breaker.service.js';

type GlobalControlAction =
  | 'halt_trading'
  | 'resume_trading'
  | 'cancel_all_orders'
  | 'disable_withdrawals'
  | 'enable_withdrawals'
  | 'disable_deposits'
  | 'enable_deposits'
  | 'pause_p2p'
  | 'resume_p2p'
  | 'pause_market_making'
  | 'resume_market_making';

async function executeGlobalControlAction(action: GlobalControlAction, payload: Record<string, unknown>, adminId: string): Promise<void> {
  if (action === 'halt_trading') {
    await setTradingHalt(true);
    return;
  }
  if (action === 'resume_trading') {
    await setTradingHalt(false);
    return;
  }
  if (action === 'cancel_all_orders') {
    const market = String(payload.market ?? '').trim().toUpperCase().replace(/-/g, '_');
    let conditions = "status IN ('new', 'partially_filled')";
    const params: string[] = [];
    if (market) {
      conditions += ' AND market = $1';
      params.push(market);
    }
    await db.query(`UPDATE spot_orders SET status = 'cancelled', updated_at = NOW() WHERE ${conditions}`, params.length ? params : undefined);
    return;
  }
  if (action === 'disable_withdrawals' || action === 'enable_withdrawals') {
    const value = action === 'disable_withdrawals' ? '1' : '0';
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_withdrawals', $1, NOW(), $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
      [value, adminId]
    );
    return;
  }
  if (action === 'disable_deposits' || action === 'enable_deposits') {
    const value = action === 'disable_deposits' ? '1' : '0';
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_deposits', $1, NOW(), $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
      [value, adminId]
    );
    return;
  }
  if (action === 'pause_p2p' || action === 'resume_p2p') {
    const value = action === 'pause_p2p' ? '1' : '0';
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('admin_p2p_orders_paused', $1, NOW(), $2)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
      [value, adminId]
    );
    return;
  }
  if (action === 'pause_market_making') {
    await setMmCircuitState({ tradingPaused: true, orderPlacementBlocked: true }, { source: 'admin' });
    return;
  }
  if (action === 'resume_market_making') {
    await setMmCircuitState({ tradingPaused: false, orderPlacementBlocked: false }, { source: 'admin' });
  }
}

export async function executeMakerCheckerIfFullyApproved(req: ApprovalRequest): Promise<void> {
  if (req.status !== 'approved' || req.action_executed) return;

  const lastAp =
    Array.isArray(req.approved_by) && req.approved_by.length > 0
      ? req.approved_by[req.approved_by.length - 1]!
      : null;
  if (lastAp && lastAp === req.requested_by) {
    throw new Error('maker-checker blocked: approver equals initiator');
  }

  if (req.action_type === 'withdrawal_approve') {
    const withdrawalId = String((req.action_payload as { withdrawalId?: string }).withdrawalId ?? '').trim();
    if (!withdrawalId) {
      throw new Error('maker-checker: missing withdrawalId in payload');
    }
    const lastApprover =
      Array.isArray(req.approved_by) && req.approved_by.length > 0
        ? req.approved_by[req.approved_by.length - 1]!
        : null;
    if (!lastApprover) {
      throw new Error('maker-checker: no approver on approved request');
    }
    await approveWithdrawal(withdrawalId, lastApprover, {});
    await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, execution_error = NULL, updated_at = NOW() WHERE id = $1`, [
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
      throw new Error('maker-checker: invalid manual_credit payload');
    }
    let amountDec: DecimalInstance;
    try {
      amountDec = new Decimal(amountStr).toDecimalPlaces(8, 1);
    } catch {
      throw new Error('maker-checker: bad amount');
    }
    if (!amountDec.isFinite() || amountDec.lte(0)) {
      throw new Error('maker-checker: amount must be positive');
    }

    const userRow = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL
       AND (id::text = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($1))) LIMIT 1`,
      [userInput]
    );
    if (userRow.rows.length === 0) {
      throw new Error('maker-checker: user not found for manual credit');
    }
    const userId = userRow.rows[0]!.id;
    const currencyId = await getCurrencyIdBySymbol(symbol);
    if (!currencyId) {
      throw new Error('maker-checker: currency not found');
    }
    if (txHashBody) {
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM deposits WHERE tx_hash = $1 AND status IN ('completed', 'confirmed') LIMIT 1`,
        [txHashBody]
      );
      if (existing.rows.length > 0) {
        logger.warn('maker-checker: manual credit skipped — tx already credited', { requestId: req.id });
        await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, execution_error = NULL, updated_at = NOW() WHERE id = $1`, [
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
    await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, execution_error = NULL, updated_at = NOW() WHERE id = $1`, [
      req.id,
    ]);
    logger.info('maker-checker: manual credit executed', { requestId: req.id, userId });
  }

  if (req.action_type === 'global_control_action') {
    const payload = req.action_payload as Record<string, unknown>;
    const action = String(payload.action ?? '').trim() as GlobalControlAction;
    const validActions: GlobalControlAction[] = [
      'halt_trading',
      'resume_trading',
      'cancel_all_orders',
      'disable_withdrawals',
      'enable_withdrawals',
      'disable_deposits',
      'enable_deposits',
      'pause_p2p',
      'resume_p2p',
      'pause_market_making',
      'resume_market_making',
    ];
    if (!validActions.includes(action)) {
      throw new Error(`maker-checker: unsupported global_control_action '${action}'`);
    }
    const lastApprover =
      Array.isArray(req.approved_by) && req.approved_by.length > 0
        ? req.approved_by[req.approved_by.length - 1]!
        : req.requested_by;
    await executeGlobalControlAction(action, payload, lastApprover);
    await db.query(`UPDATE admin_approval_requests SET action_executed = TRUE, execution_error = NULL, updated_at = NOW() WHERE id = $1`, [req.id]);
    logger.info('maker-checker: global control action executed', { requestId: req.id, action });
  }
}
