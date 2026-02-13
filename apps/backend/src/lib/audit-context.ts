/**
 * Audit context from Fastify request: requestId, IP, userAgent, and optional actor.
 * Used to build payloads for immutable audit log without blocking the request.
 */

import type { FastifyRequest } from 'fastify';
import type { AuditActorType } from '../services/audit-log.service.js';

export interface AuditContext {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  actorType: AuditActorType | null;
  actorId: string | null;
}

/**
 * Get audit context from the current request.
 * actorType/actorId are set only when request.user (user JWT) is present.
 * For admin actions, pass actorType/actorId explicitly when calling logAudit.
 */
export function getAuditContextFromRequest(request: FastifyRequest): AuditContext {
  const req = request as FastifyRequest & { requestId?: string };
  const ip = req.ip ?? request.headers['x-forwarded-for'] ?? request.headers['x-real-ip'];
  const ipStr = typeof ip === 'string' ? ip.split(',')[0]?.trim() ?? null : null;
  return {
    requestId: req.requestId ?? null,
    ipAddress: ipStr ?? null,
    userAgent: (request.headers['user-agent'] as string) ?? null,
    actorType: request.user ? 'user' : null,
    actorId: (request.user as { id?: string } | undefined)?.id ?? null,
  };
}
