/**
 * Immutable audit log with hash chain (prev_hash → entry_hash).
 * Append-only; failures must NOT block the main request (best-effort).
 */

import { createHash } from 'node:crypto';
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

export function expectedAuditEntryHashFromImmutableRow(row: {
  prev_hash: string | null;
  request_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  user_agent: string | null;
}): string {
  const prev = row.prev_hash ?? 'genesis';
  const canon = canonicalPayload({
    requestId: row.request_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    oldValText: row.old_value,
    newValText: row.new_value,
    ip: parseIp(row.ip_address),
    userAgent: row.user_agent,
  });
  return createHash('sha256').update(`${prev}|${canon}`, 'utf8').digest('hex');
}

export function auditImmutableEntryHashMatches(row: {
  entry_hash: string | null;
  prev_hash: string | null;
  request_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  old_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  user_agent: string | null;
}): boolean {
  if (!row.entry_hash) return false;
  return row.entry_hash === expectedAuditEntryHashFromImmutableRow(row);
}

function canonicalPayload(params: {
  requestId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  oldValText: string | null;
  newValText: string | null;
  ip: string | null;
  userAgent: string | null;
}): string {
  return JSON.stringify({
    request_id: params.requestId,
    actor_type: params.actorType,
    actor_id: params.actorId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    old_value: params.oldValText,
    new_value: params.newValText,
    ip_address: params.ip,
    user_agent: params.userAgent,
  });
}

/**
 * Append one record to audit_logs_immutable with SHA-256 chain.
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
    await db.transaction(async (client) => {
      const head = await client.query<{ last_entry_hash: string }>(
        'SELECT last_entry_hash FROM audit_chain_state WHERE id = 1 FOR UPDATE'
      );
      const prevHash = head.rows[0]?.last_entry_hash ?? 'genesis';
      const canon = canonicalPayload({
        requestId: requestId ?? null,
        actorType,
        actorId: actorId ?? null,
        action,
        resourceType: resourceType ?? null,
        resourceId: resourceId ?? null,
        oldValText,
        newValText,
        ip,
        userAgent: userAgent ?? null,
      });
      const entryHash = createHash('sha256').update(`${prevHash}|${canon}`, 'utf8').digest('hex');

      await client.query(
        `INSERT INTO audit_logs_immutable (
          request_id, actor_type, actor_id, action,
          resource_type, resource_id, old_value, new_value,
          ip_address, user_agent, prev_hash, entry_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11, $12)`,
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
          prevHash,
          entryHash,
        ]
      );

      await client.query(`UPDATE audit_chain_state SET last_entry_hash = $1 WHERE id = 1`, [entryHash]);
    });
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
