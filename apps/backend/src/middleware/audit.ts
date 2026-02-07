/**
 * Audit logging middleware and utilities for immutable audit log.
 *
 * Usage on sensitive routes (withdrawal, KYC, security settings, admin actions):
 * 1. After the sensitive operation succeeds, call:
 *    import { logAuditFromRequest } from '../services/audit-log.service.js';
 *    await logAuditFromRequest(request, {
 *      actorType: 'admin',
 *      actorId: admin.adminId,
 *      action: 'admin_withdrawal_approve',
 *      resourceType: 'withdrawal',
 *      resourceId: withdrawalId,
 *      oldValue: { status: 'pending_approval' },
 *      newValue: { status: 'pending' },
 *    });
 * 2. For user actions, actorType/actorId can be taken from request.user, or pass explicitly.
 * 3. Do not await in a way that blocks the response: logAuditFromRequest is best-effort and never throws.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getAuditContextFromRequest } from '../lib/audit-context.js';

/**
 * Optional preHandler to attach to sensitive routes as a reminder that the route should log to audit_logs_immutable.
 * Does not perform logging itself (old/new values are only known after the handler runs).
 * Use logAuditFromRequest() in the route handler after the operation succeeds.
 */
export async function requireAuditLog(
  _request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  // No-op; document that this route must call logAuditFromRequest in the handler.
}

export { getAuditContextFromRequest };
