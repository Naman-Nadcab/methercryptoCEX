/**
 * IP rules middleware: whitelist/blacklist and country rules per scope (admin | user).
 * Apply globally; admin routes get stricter treatment (whitelist-if-exists).
 * Logs blocks to user_activity_logs (when user present) and audit_logs_immutable (admin blocks).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PUBLIC_AUTH_ROUTES } from '../lib/public-auth-routes.js';
import { getClientIp, getCountryFromRequest } from '../lib/client-ip.js';
import { matchRules } from '../services/ip-rules.service.js';
import { checkVpnTor } from '../services/vpn-tor.service.js';
import { logUserActivity } from '../services/activity-monitor.service.js';
import { logAudit } from '../services/audit-log.service.js';
import { getAuditContextFromRequest } from '../lib/audit-context.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

export type IpRulesScope = 'admin' | 'user';

declare module 'fastify' {
  interface FastifyRequest {
    clientIp?: string;
    countryCode?: string | null;
    securityFlags?: { isVpnOrTor: boolean };
  }
}

/**
 * Determine scope from URL path: /api/v1/admin -> admin, else user.
 */
export function getScopeFromPath(url: string): IpRulesScope {
  const path = typeof url === 'string' ? url : (url as { path?: string }).path ?? '';
  if (path.includes('/admin') || path.startsWith('/api/v1/admin')) return 'admin';
  return 'user';
}

/**
 * Log block (best-effort). Admin blocks go to audit_logs_immutable; if request has user, also user_activity_logs.
 */
async function logBlock(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  scope: IpRulesScope;
  reason: string;
  clientIp: string;
  app: FastifyInstance;
}): Promise<void> {
  const { request, scope, reason, clientIp, app } = params;
  const req = request as FastifyRequest & { requestId?: string };
  const ctx = getAuditContextFromRequest(request);

  await logAudit({
    requestId: req.requestId ?? null,
    actorType: 'system',
    actorId: null,
    action: scope === 'admin' ? 'admin_access_blocked_ip' : 'user_access_blocked_ip',
    resourceType: 'access',
    resourceId: null,
    newValue: { reason, ip: clientIp, path: request.url },
    ipAddress: clientIp,
    userAgent: (request.headers['user-agent'] as string) ?? null,
  });

  const userId = (request.user as { id?: string } | undefined)?.id;
  if (userId) {
    await logUserActivity({
      userId,
      action: 'access_blocked',
      ipAddress: clientIp,
      userAgent: request.headers['user-agent'],
      metadata: { reason, scope, path: request.url },
    });
  }
}

/**
 * IP rules middleware factory. Registers an onRequest hook that:
 * - Resolves client IP and country
 * - Runs VPN/TOR check (fail-open) and attaches to request
 * - Evaluates IP rules for scope (admin vs user)
 * - Returns 403 with reason code on block and logs
 */
const SKIP_PATHS = new Set([
  '/',
  '/health',
  '/api/v1/admin/auth/login',
  '/api/v1/auth/login/check-passkeys',
  '/api/v1/auth/login/resend-otp',
  '/api/v1/auth/passkey/options',
  '/api/v1/auth/passkey/verify',
  '/api/v1/auth/register/options',
  '/api/v1/auth/register/verify',
]);

export function ipRulesMiddleware(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = (request.url || '').split('?')[0];
    if (PUBLIC_AUTH_ROUTES.has(path)) {
      console.log('[BYPASS]', path);
      return;
    }
    if (SKIP_PATHS.has(path)) return;

    const clientIp = getClientIp(request);
    const countryCode = getCountryFromRequest(request);
    request.clientIp = clientIp;
    request.countryCode = countryCode;

    try {
      const vpnResult = await checkVpnTor(clientIp);
      (request as FastifyRequest & { securityFlags?: { isVpnOrTor: boolean } }).securityFlags = {
        isVpnOrTor: vpnResult.isVpnOrTor,
      };
    } catch (e) {
      logger.warn('VPN/TOR check failed (fail-open)', { clientIp, error: e instanceof Error ? e.message : 'Unknown' });
      (request as FastifyRequest & { securityFlags?: { isVpnOrTor: boolean } }).securityFlags = { isVpnOrTor: false };
    }

    const scope = getScopeFromPath(request.url);
    // In development, skip IP whitelist for admin so local/dev usage works without configuring rules
    if (scope === 'admin' && config.isDevelopment) {
      return;
    }
    const result = await matchRules({ scope, clientIp, countryCode });

    if (!result.allow) {
      await logBlock({
        request,
        reply,
        scope,
        reason: result.reason,
        clientIp,
        app,
      });
      return reply.status(403).send({
        success: false,
        error: {
          code: result.reason,
          message: scope === 'admin'
            ? 'Access denied from this IP or region.'
            : 'Access denied. Your IP or region is not allowed.',
        },
      });
    }
  });
}
