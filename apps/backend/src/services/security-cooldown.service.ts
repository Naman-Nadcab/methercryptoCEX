/**
 * Security cooldowns (Step 5D): temporarily block withdrawals after sensitive account changes.
 * Call addCooldown() when: password change (e.g. 48h), 2FA enable/disable (e.g. 24h), new device verification (e.g. 24h).
 * Withdrawal route checks hasActiveCooldown() before allowing withdrawal.
 */

import { db } from '../lib/database.js';

export interface AddCooldownParams {
  userId: string;
  reason: string;
  /** Cooldown duration in hours from now. */
  hours: number;
}

export interface HasActiveCooldownResult {
  active: boolean;
  until?: Date;
  reason?: string;
}

/**
 * Add a cooldown for the user. Withdrawals are blocked until cooldown_until.
 * Call this after: password change (48h), 2FA enable/disable (24h), new device verification (24h).
 */
export async function addCooldown(params: AddCooldownParams): Promise<void> {
  const { userId, reason, hours } = params;
  const cooldownUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO security_cooldowns (user_id, reason, cooldown_until)
     VALUES ($1, $2, $3)`,
    [userId, reason.trim(), cooldownUntil]
  );
}

/**
 * Check if the user has any active cooldown (cooldown_until > NOW()).
 * Returns the latest cooldown_until and reason so withdrawal route can return them in 403.
 */
export async function hasActiveCooldown(params: { userId: string }): Promise<HasActiveCooldownResult> {
  const { userId } = params;
  const result = await db.query<{ cooldown_until: string; reason: string }>(
    `SELECT cooldown_until, reason FROM security_cooldowns
     WHERE user_id = $1 AND cooldown_until > NOW()
     ORDER BY cooldown_until DESC
     LIMIT 1`,
    [userId]
  );
  if (result.rows.length === 0) {
    return { active: false };
  }
  const row = result.rows[0]!;
  return {
    active: true,
    until: new Date(row.cooldown_until),
    reason: row.reason,
  };
}
