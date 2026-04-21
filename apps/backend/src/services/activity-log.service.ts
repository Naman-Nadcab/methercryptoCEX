/**
 * Defense-in-depth helper for writing to `user_activity_logs`.
 *
 * Enum values for `activity_type` live in PostgreSQL. If application code inserts a
 * value not present in the enum, the INSERT throws AFTER the parent flow has already
 * committed (e.g. signup row, login session). That late failure surfaces as a 500
 * and can leave orphan state. Enum values are kept in sync in `migrate.ts` and
 * `tier1-fixes-2026-04.sql`, but this helper is a belt-and-suspenders wrapper that
 * must NEVER throw. Callers treat activity logging as best-effort.
 */
import type { QueryResult } from 'pg';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

export interface ActivityLogInput {
  userId: string;
  activityType: string;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logUserActivity(input: ActivityLogInput): Promise<void> {
  try {
    const detailsJson = input.details ? JSON.stringify(input.details) : null;
    await db.query(
      `INSERT INTO user_activity_logs
         (user_id, session_id, activity_type, ip_address, user_agent, device_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.userId,
        input.sessionId ?? null,
        input.activityType,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.deviceId ?? null,
        detailsJson,
      ]
    );
  } catch (err) {
    logger.warn('activity log insert failed (swallowed)', {
      userId: input.userId,
      activityType: input.activityType,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

/**
 * Low-level wrapper around the existing INSERT pattern used across the codebase. Use this
 * when you want to keep the exact SQL text but want the query swallowed on failure.
 */
export async function safeActivityLogQuery(
  sql: string,
  params: unknown[]
): Promise<QueryResult | null> {
  try {
    return await db.query(sql, params);
  } catch (err) {
    logger.warn('activity log insert failed (swallowed)', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
    return null;
  }
}
