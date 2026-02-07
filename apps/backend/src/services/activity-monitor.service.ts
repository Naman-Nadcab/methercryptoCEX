/**
 * Activity monitoring: log user and admin actions.
 * Best-effort: never throw; failures are logged and do not block the main flow.
 * Security-sensitive actions should also be written to audit_logs_immutable (see audit-log.service).
 */

import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

export type UserActivityAction =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'password_changed'
  | '2fa_enabled'
  | '2fa_disabled'
  | 'new_device_verified'
  | 'withdrawal_requested'
  | 'session_revoked'
  | 'sessions_revoked_all'
  | 'access_blocked';

export type AdminActivityAction =
  | 'admin_login'
  | 'withdrawal_approved'
  | 'withdrawal_rejected'
  | 'user_lock'
  | 'user_unlock'
  | 'admin_settings_change';

export interface UserActivityParams {
  userId: string;
  action: string;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AdminActivityParams {
  adminId: string;
  action: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

function parseIp(ip: string | undefined | null): string | null {
  if (ip == null || ip === '') return null;
  const t = String(ip).trim();
  return t === '' ? null : t;
}

/**
 * Log a user activity. Best-effort; never throws.
 */
export async function logUserActivity(params: UserActivityParams): Promise<void> {
  const {
    userId,
    action,
    sessionId = null,
    ipAddress = null,
    userAgent = null,
    deviceId = null,
    metadata = null,
  } = params;

  const ip = parseIp(ipAddress);
  const details = metadata != null ? JSON.stringify(metadata) : null;

  try {
    await db.query(
      `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent, device_id, details)
       VALUES ($1, $2, $3, $4::inet, $5, $6, $7::jsonb)`,
      [userId, sessionId, action, ip, userAgent, deviceId, details]
    );
  } catch (err) {
    logger.warn('User activity log failed (best-effort)', {
      userId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Log an admin activity. Best-effort; never throws.
 */
export async function logAdminActivity(params: AdminActivityParams): Promise<void> {
  const {
    adminId,
    action,
    ipAddress = null,
    userAgent = null,
    deviceId = null,
    metadata = null,
  } = params;

  const ip = parseIp(ipAddress);
  const details = metadata != null ? metadata : null;

  try {
    await db.query(
      `INSERT INTO admin_activity_logs (admin_id, action, details, ip_address, user_agent, device_id)
       VALUES ($1, $2, $3::jsonb, $4::inet, $5, $6)`,
      [adminId, action, details ? JSON.stringify(details) : null, ip, userAgent, deviceId]
    );
  } catch (err) {
    logger.warn('Admin activity log failed (best-effort)', {
      adminId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve device id from request (stub: header or fingerprint). Prefer X-Device-Id header.
 */
export function getDeviceIdFromRequest(headers: Record<string, string | undefined>): string | null {
  const id = headers['x-device-id']?.trim();
  if (id && id.length > 0 && id.length <= 255) return id;
  return null;
}
