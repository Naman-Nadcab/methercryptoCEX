/**
 * Hot Wallet Audit Logging
 * Every hot wallet action MUST be logged with actor_id, timestamp, action, payload_hash.
 * NO plaintext secrets or private keys in details.
 */

import { db } from './database.js';
import { encryption } from './encryption.js';

export type HotWalletAuditAction =
  | 'hot_wallet_created'
  | 'hot_wallet_replaced'
  | 'hot_wallet_removed'
  | 'hot_wallet_balance_refresh'
  | 'hot_wallet_deactivated'
  | 'hot_wallet_activated'
  | 'hot_wallet_sweep_scheduled'
  | 'hot_wallet_sweep_completed'
  | 'withdrawal_signing_started'
  | 'withdrawal_signing_completed'
  | 'withdrawal_signing_failed'
  | 'withdrawal_signing_recovered_after_broadcast_error'
  | 'hot_wallet_key_decrypted'; // log only that decryption occurred, never key material

export interface HotWalletAuditEntry {
  actorId: string;
  actorType?: 'admin' | 'system';
  action: HotWalletAuditAction;
  resourceType?: string;
  resourceId?: string;
  payloadHash?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

function hashPayload(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return encryption.hash(canonical);
}

export async function logHotWalletAudit(entry: HotWalletAuditEntry): Promise<void> {
  const payloadHash = entry.payloadHash ?? (entry.details ? hashPayload(entry.details) : undefined);
  await db.query(
    `INSERT INTO hot_wallet_audit_log (actor_id, actor_type, action, resource_type, resource_id, payload_hash, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, $9)`,
    [
      entry.actorId,
      entry.actorType ?? 'admin',
      entry.action,
      entry.resourceType ?? null,
      entry.resourceId ?? null,
      payloadHash ?? null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
    ]
  );
}
