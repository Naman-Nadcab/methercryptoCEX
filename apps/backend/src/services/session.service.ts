/**
 * User session management: create, revoke, list.
 * Integrates with user_sessions table and Redis for JWT validation.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface CreateSessionParams {
  userId: string;
  deviceId?: string | null;
  deviceType?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  ttlSeconds?: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  session_token: string;
  device_type: string;
  device_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Create a new user session. Returns session id and session token.
 * Caller must store session id in JWT and session token in Redis for validation.
 */
export async function createSession(params: CreateSessionParams): Promise<{
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
}> {
  const {
    userId,
    deviceId = null,
    deviceType = 'web',
    ipAddress = null,
    userAgent = null,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  } = params;

  const sessionId = uuidv4();
  const sessionToken = uuidv4();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.query(
    `INSERT INTO user_sessions (id, user_id, session_token, device_type, device_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8)`,
    [
      sessionId,
      userId,
      sessionToken,
      deviceType,
      deviceId,
      ipAddress || null,
      userAgent || null,
      expiresAt,
    ]
  );

  try {
    await redis.setJson(
      `session:${sessionId}`,
      {
        userId,
        isActive: true,
        createdAt: Date.now(),
        expiresAt: expiresAt.getTime(),
      },
      ttlSeconds
    );
  } catch (e) {
    logger.warn('Session Redis set failed; DB session created', {
      sessionId,
      error: e instanceof Error ? e.message : 'Unknown',
    });
  }

  return { sessionId, sessionToken, expiresAt };
}

/**
 * Revoke a single session by id (logout). Best-effort on Redis.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await db.query(
    `UPDATE user_sessions SET is_active = FALSE, revoked_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  try {
    await redis.del(`session:${sessionId}`);
  } catch {
    // best-effort
  }
}

/**
 * Revoke all sessions for the user except the given session id (logout all other devices).
 */
export async function revokeAllExceptCurrent(
  userId: string,
  currentSessionId: string
): Promise<number> {
  const r = await db.query(
    `UPDATE user_sessions SET is_active = FALSE, revoked_at = NOW()
     WHERE user_id = $1 AND id != $2 AND is_active = TRUE
     RETURNING id`,
    [userId, currentSessionId]
  );
  const revoked = r.rows.length;
  for (const row of r.rows as { id: string }[]) {
    try {
      await redis.del(`session:${row.id}`);
    } catch {
      // best-effort
    }
  }
  return revoked;
}

/**
 * List active sessions for a user (for "devices" / "sessions" UI).
 */
export async function listActiveSessions(userId: string): Promise<SessionRow[]> {
  const r = await db.query<SessionRow>(
    `SELECT id, user_id, session_token, device_type, device_id, ip_address, user_agent,
            is_active, created_at, expires_at, revoked_at
     FROM user_sessions
     WHERE user_id = $1 AND is_active = TRUE AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );
  return r.rows.map((row) => ({
    ...row,
    session_token: '[REDACTED]',
  })) as SessionRow[];
}

/**
 * Check if user is locked (locked_until > now). Returns lock expiry or null if not locked.
 */
export async function getAccountLockUntil(userId: string): Promise<Date | null> {
  const r = await db.query<{ locked_until: string | null }>(
    `SELECT locked_until FROM users WHERE id = $1 AND locked_until > NOW()`,
    [userId]
  );
  if (r.rows.length === 0 || !r.rows[0]?.locked_until) return null;
  return new Date(r.rows[0].locked_until);
}

/**
 * Increment failed login attempts and optionally set locked_until. Returns new attempt count.
 */
export async function recordFailedLogin(userId: string): Promise<{
  attempts: number;
  lockedUntil: Date | null;
}> {
  const maxAttempts = (await import('../config/index.js')).config.maxFailedLoginAttempts ?? 5;
  const lockoutMinutes = (await import('../config/index.js')).config.lockoutMinutes ?? 30;

  const r = await db.query<{ failed_login_attempts: number; locked_until: string | null }>(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN (failed_login_attempts + 1) >= $2 THEN NOW() + ($3 || ' minutes')::interval
           ELSE locked_until
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING failed_login_attempts, locked_until`,
    [userId, maxAttempts, lockoutMinutes]
  );
  if (r.rows.length === 0) {
    return { attempts: 0, lockedUntil: null };
  }
  const row = r.rows[0]!;
  return {
    attempts: row.failed_login_attempts,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  };
}

/**
 * Clear failed attempts and lock on successful login (call after login success).
 */
export async function clearFailedLoginAttempts(userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}
