/**
 * KYC enforcement service (Step 6B). India-focused rules for actions that require
 * or are limited by KYC status. Uses kyc_applications; blocks are logged to aml_alerts.
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types & error classes
// ---------------------------------------------------------------------------

export type KycAction =
  | 'withdrawal'
  | 'p2p_sell'
  | 'p2p_buy'
  | 'spot_trade'
  | 'fiat_deposit'
  | 'fiat_withdrawal';

export type KycStatusValue = 'not_started' | 'pending' | 'approved' | 'rejected';

export interface KycStatusResult {
  status: KycStatusValue | string;
  approvedAt?: Date | null;
}

export interface AssertKycAllowedParams {
  userId: string;
  action: KycAction;
}

/** Thrown when the action requires approved KYC but user is only pending or not verified. */
export class KycRequiredError extends Error {
  code = 'KYC_REQUIRED' as const;
  constructor(message: string = 'KYC verification is required for this action.') {
    super(message);
    this.name = 'KycRequiredError';
  }
}

/** Thrown when the action requires approved KYC and user has pending KYC (so they must wait for approval). */
export class KycPendingError extends Error {
  code = 'KYC_PENDING' as const;
  constructor(message: string = 'Your KYC is under review. Please wait for approval.') {
    super(message);
    this.name = 'KycPendingError';
  }
}

// ---------------------------------------------------------------------------
// Rules: which actions require approved vs allow pending (India-focused)
// ---------------------------------------------------------------------------

const REQUIRE_APPROVED_ACTIONS: KycAction[] = ['withdrawal', 'p2p_sell', 'fiat_withdrawal'];
const ALLOW_PENDING_ACTIONS: KycAction[] = ['p2p_buy', 'spot_trade', 'fiat_deposit'];

// ---------------------------------------------------------------------------
// getKycStatus
// ---------------------------------------------------------------------------

/**
 * Returns the current KYC status for the user from kyc_applications (latest row).
 * approvedAt is set when status is 'approved' (uses reviewed_at or created_at).
 */
export async function getKycStatus(userId: string): Promise<KycStatusResult> {
  const result = await db.query<{ status: string; created_at: string }>(
    `SELECT status, created_at
     FROM kyc_applications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { status: 'not_started' };
  }

  const row = result.rows[0]!;
  const status = row.status as KycStatusValue | string;
  const approvedAt = status === 'approved' && row.created_at ? new Date(row.created_at) : null;

  return { status, approvedAt };
}

// ---------------------------------------------------------------------------
// Log KYC block to aml_alerts (best-effort)
// ---------------------------------------------------------------------------

async function logKycViolationAlert(userId: string, action: KycAction): Promise<void> {
  try {
    await db.query(
      `INSERT INTO aml_alerts (user_id, alert_type, severity, status, details)
       VALUES ($1, 'kyc_violation', 'medium', 'open', $2::jsonb)`,
      [userId, JSON.stringify({ action })]
    );
  } catch (e) {
    logger.warn('KYC violation AML alert insert failed (best-effort)', {
      userId,
      action,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }
}

// ---------------------------------------------------------------------------
// assertKycAllowed
// Throws KycRequiredError or KycPendingError when the action is not allowed.
// ---------------------------------------------------------------------------

export async function assertKycAllowed(params: AssertKycAllowedParams): Promise<void> {
  const { userId, action } = params;
  const { status } = await getKycStatus(userId);

  const normalizedStatus = (status ?? 'not_started') as KycStatusValue;

  if (normalizedStatus === 'approved') {
    return;
  }

  const requiresApproved = REQUIRE_APPROVED_ACTIONS.includes(action);
  const allowPending = ALLOW_PENDING_ACTIONS.includes(action);

  if (requiresApproved) {
    await logKycViolationAlert(userId, action);
    if (normalizedStatus === 'pending') {
      throw new KycPendingError('KYC approval is required for this action. Your application is under review.');
    }
    throw new KycRequiredError('KYC verification is required for this action. Please complete identity verification.');
  }

  if (allowPending) {
    if (normalizedStatus === 'pending') {
      return;
    }
    if (normalizedStatus === 'not_started' || normalizedStatus === 'rejected') {
      await logKycViolationAlert(userId, action);
      throw new KycRequiredError('KYC verification is required for this action. Please complete identity verification.');
    }
  }

  // Unknown status or action: treat as not allowed
  await logKycViolationAlert(userId, action);
  throw new KycRequiredError('KYC verification is required for this action.');
}

/*
  Integration examples (call assertKycAllowed before the action):

  --- 1) Withdrawal route (before whitelist / cooldown): ---

  import { assertKycAllowed, KycRequiredError, KycPendingError } from '../services/kyc-enforcement.service.js';

  // Inside POST /withdrawals handler, after risk engine and cooldown, before whitelist:
  try {
    await assertKycAllowed({ userId, action: 'withdrawal' });
  } catch (err) {
    if (err instanceof KycPendingError) {
      return reply.status(403).send({
        success: false,
        error: { code: 'KYC_PENDING', message: err.message },
      });
    }
    if (err instanceof KycRequiredError) {
      return reply.status(403).send({
        success: false,
        error: { code: 'KYC_REQUIRED', message: err.message },
      });
    }
    throw err;
  }

  --- 2) P2P sell order create: ---

  try {
    await assertKycAllowed({ userId: request.user!.id, action: 'p2p_sell' });
  } catch (err) {
    if (err instanceof KycPendingError) {
      return reply.status(403).send({
        success: false,
        error: { code: 'KYC_PENDING', message: err.message },
      });
    }
    if (err instanceof KycRequiredError) {
      return reply.status(403).send({
        success: false,
        error: { code: 'KYC_REQUIRED', message: err.message },
      });
    }
    throw err;
  }
  // ... proceed to create P2P sell order
*/
