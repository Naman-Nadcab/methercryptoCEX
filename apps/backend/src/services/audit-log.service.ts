/**
 * Immutable audit log service.
 * Append-only; failures must NOT block the main request (best-effort).
 * Safe to call from anywhere; idempotent-ish (same request_id + action + resource can be logged multiple times).
 */

import type { FastifyRequest } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getAuditContextFromRequest } from '../lib/audit-context.js';

export type AuditActorType = 'user' | 'admin' | 'system';

export interface AuditLogParams {
  requestId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  oldValue?: string | Record<string, unknown> | null;
  newValue?: string | Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function toText(v: string | Record<string, unknown> | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function parseIp(ip: string | undefined | null): string | null {
  if (ip == null || ip === '') return null;
  const trimmed = ip.trim();
  if (trimmed === '') return null;
  return trimmed;
}

/**
 * Append one record to audit_logs_immutable.
 * Best-effort: catches errors and logs them; never throws.
 * Do not pass raw secrets or full PII in old_value/new_value; redact where required.
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  const {
    requestId,
    actorType,
    actorId,
    action,
    resourceType,
    resourceId,
    oldValue,
    newValue,
    ipAddress,
    userAgent,
  } = params;

  const oldValText = toText(oldValue ?? null);
  const newValText = toText(newValue ?? null);
  const ip = parseIp(ipAddress ?? null);

  try {
    await db.query(
      `INSERT INTO audit_logs_immutable (
        request_id, actor_type, actor_id, action,
        resource_type, resource_id, old_value, new_value,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10)`,
      [
        requestId ?? null,
        actorType,
        actorId ?? null,
        action,
        resourceType ?? null,
        resourceId ?? null,
        oldValText,
        newValText,
        ip,
        userAgent ?? null,
      ]
    );
  } catch (err) {
    logger.warn('Audit log insert failed (best-effort)', {
      action,
      resourceType,
      resourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface AuditLogFromRequestOverrides {
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  oldValue?: string | Record<string, unknown> | null;
  newValue?: string | Record<string, unknown> | null;
}

/**
 * Log audit using context from request (requestId, ip, userAgent) and explicit actor + payload.
 * Use this in routes after a sensitive action (e.g. admin withdrawal approve).
 * Best-effort; never throws.
 */
export async function logAuditFromRequest(
  request: FastifyRequest,
  overrides: AuditLogFromRequestOverrides
): Promise<void> {
  const ctx = getAuditContextFromRequest(request);
  await logAudit({
    requestId: ctx.requestId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    actorType: overrides.actorType,
    actorId: overrides.actorId,
    action: overrides.action,
    resourceType: overrides.resourceType,
    resourceId: overrides.resourceId,
    oldValue: overrides.oldValue,
    newValue: overrides.newValue,
  });
}
