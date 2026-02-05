/**
 * Structured audit logs for withdrawal lifecycle.
 * Stored in audit_logs table. Never log private keys or secrets.
 */

import { db } from './database.js';

export type WithdrawalAuditEvent =
  | 'withdrawal_created'
  | 'withdrawal_approved'
  | 'withdrawal_rejected'
  | 'withdrawal_signed'
  | 'hot_wallet_sweep'
  | 'deposit_sweep_completed'
  | 'withdrawal_internal_completed';

export interface WithdrawalAuditPayload {
  withdrawal_id: string | null;
  user_id: string | null;
  admin_id: string | null;
  token_id: string | null;
  chain_id: string | null;
  amount: string | null;
  ip?: string | null;
  user_agent?: string | null;
}

/**
 * Insert one withdrawal lifecycle event into audit_logs.
 * All fields are stored as provided; no private keys or secrets must be passed.
 */
export async function logWithdrawalLifecycle(
  event: WithdrawalAuditEvent,
  payload: WithdrawalAuditPayload
): Promise<void> {
  const amountNum = payload.amount != null && payload.amount !== '' ? parseFloat(payload.amount) : null;
  await db.query(
    `INSERT INTO audit_logs (
       action, user_id, withdrawal_id, admin_id, token_id, chain_id, amount,
       ip_address, user_agent, resource_type, resource_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, 'withdrawal', $10)`,
    [
      event,
      payload.user_id ?? null,
      payload.withdrawal_id ?? null,
      payload.admin_id ?? null,
      payload.token_id ?? null,
      payload.chain_id ?? null,
      amountNum,
      payload.ip ?? null,
      payload.user_agent ?? null,
      payload.withdrawal_id ?? null,
    ]
  );
}
