/**
 * Treasury / wallet events → immutable audit chain (no keys, no amounts in clear text beyond ops need).
 */
import { logAudit } from '../audit-log.service.js';

export async function logTreasuryAudit(params: {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details: Record<string, unknown>;
  actorId?: string | null;
}): Promise<void> {
  await logAudit({
    actorType: 'system',
    actorId: params.actorId ?? null,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    newValue: params.details,
    ipAddress: null,
    userAgent: null,
  });
}
