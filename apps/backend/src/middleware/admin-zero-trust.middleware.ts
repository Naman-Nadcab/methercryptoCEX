/**
 * Global zero-trust for /api/v1/admin/* — rate limit, auth, default-deny RBAC.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { rateLimitByIp } from '../lib/rate-limit-fastify.js';
import { config } from '../config/index.js';
import { getAdminFromRequest } from '../routes/admin.fastify.js';
import { evaluateAdminRouteRbac, isSuperAdminRole } from '../lib/admin-rbac-routes.js';
import { redisBlocksHighRiskActions } from '../services/redis-health.service.js';

function adminPathname(request: FastifyRequest): string {
  const rp = (request as { routerPath?: string }).routerPath;
  if (rp && rp.startsWith('/api/v1/admin')) return rp.split('?')[0] ?? rp;
  return (request.url as string).split('?')[0] ?? '';
}

function adminRelativeUrl(pathname: string): string {
  const u = pathname.replace(/^\/api\/v1\/admin/, '') || '/';
  return u.startsWith('/') ? u : `/${u}`;
}

const UNAUTHENTICATED_PATHS = new Set([
  '/api/v1/admin/auth/login',
  '/api/v1/admin/auth/refresh',
  '/api/v1/admin/break-glass-challenge',
  '/api/v1/admin/break-glass-login',
]);

function adminHighRiskMutationBlockedByRedis(rel: string, method: string): boolean {
  if (!redisBlocksHighRiskActions()) return false;
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (rel === '/deposits/manual-credit' && m === 'POST') return true;
  if (rel.includes('/security/withdrawals/') && (rel.endsWith('/approve') || rel.endsWith('/reject'))) return true;
  if (rel.includes('/withdrawals/') && (rel.endsWith('/approve') || rel.endsWith('/reject')) && m === 'POST') return true;
  if (/\/approval-requests\/[^/]+\/(approve|reject)$/.test(rel)) return true;
  if (rel.startsWith('/settings/')) return true;
  if (rel.startsWith('/admins') && m !== 'GET') return true;
  if (rel.startsWith('/control/')) return true;
  if (/\/users\/[^/]+\/balance-adjust$/.test(rel) && m === 'POST') return true;
  return false;
}

export function registerAdminZeroTrustHooks(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const pathname = adminPathname(request);
    if (!pathname.startsWith('/api/v1/admin')) return;

    if (UNAUTHENTICATED_PATHS.has(pathname)) return;

    if (pathname.startsWith('/api/v1/admin/ws/')) return;

    const rl = rateLimitByIp('admin-api', 600, 60, { failClosed: config.isProduction });
    await rl(request, reply);
    if (reply.sent) return;

    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin || reply.sent) return;

    const rel = adminRelativeUrl(pathname);

    if (
      rel.startsWith('/auth/') &&
      (rel === '/auth/me' || rel === '/auth/logout' || rel === '/auth/ws-ticket')
    ) {
      return;
    }

    if (adminHighRiskMutationBlockedByRedis(rel, request.method)) {
      reply.status(503).send({
        success: false,
        error: {
          code: 'REDIS_UNAVAILABLE',
          message: 'High-risk admin actions are disabled while Redis is unhealthy.',
        },
      });
      return;
    }

    const role = admin.role || '';
    if (isSuperAdminRole(role)) return;

    const decision = evaluateAdminRouteRbac(role, request.method, rel);
    if (!decision.mapped) {
      reply.status(403).send({
        success: false,
        error: {
          code: 'ADMIN_ROUTE_NOT_MAPPED',
          message: 'This admin route is not authorized by RBAC policy (default deny).',
        },
      });
      return;
    }
    if (!decision.allowed) {
      reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Permission '${decision.required ?? 'unknown'}' required for this action.`,
        },
      });
      return;
    }
  });
}
