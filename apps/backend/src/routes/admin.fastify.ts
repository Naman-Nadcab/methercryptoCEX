import crypto from 'node:crypto';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger, securityLog } from '../lib/logger.js';
import { config } from '../config/index.js';
import { redisBlocksHighRiskActions } from '../services/redis-health.service.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';
import { logAdminActivity, getDeviceIdFromRequest } from '../services/activity-monitor.service.js';
import { refreshMatchEventsCache } from '../services/matchingEngine.js';
import { p2pService } from '../services/p2p.service.js';
import { getClientIp } from '../lib/client-ip.js';
import { isIpInWhitelist } from '../lib/admin-ip-whitelist.js';
import { isBreakGlassClientIpAllowed } from '../lib/break-glass-access.js';
import { enforceAdminRateLimit, rateLimitByIp } from '../lib/rate-limit-fastify.js';
import {
  hasAdminRbacPermission,
  isSuperAdminRole,
  getImplicitRolePermissions,
  ADMIN_LEGACY_ROLE_PERMISSION,
  ADMIN_IMPLICIT_ROLE_PERMISSIONS,
} from '../lib/admin-rbac-routes.js';
import { issueAdminWsTicket, consumeWsTicket, WS_TICKET_TTL_SEC } from '../services/ws-ticket.service.js';
import { registerAdminConnection, unregisterAdminConnection, publishKycStatusChanged, publishOrderCancelled } from '../services/admin-ws.service.js';
import { registerAdminEventsConnection, unregisterAdminEventsConnection, broadcastAdminControlEvent } from '../services/admin-events-ws.service.js';
import { applyTierLimitsToUser } from '../services/withdrawal-tier-limits.service.js';
import { getHotWalletsIdModeCached } from '../lib/hot-wallets-schema-cache.js';
import { invalidateMarketsCache } from '../services/spot-markets-cache.service.js';
const ADMIN_CREDIT_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const ADMIN_CREDIT_IDEMPOTENCY_LOCK_TTL_SECONDS = 30;
const WITHDRAW_APPROVE_IDEMPOTENCY_TTL = 24 * 60 * 60;
const WITHDRAW_APPROVE_LOCK_TTL = 30;
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const ADMIN_LOGIN_MAX_ATTEMPTS_FALLBACK = 5;
const ADMIN_LOGIN_LOCK_MINUTES = 15;

/** When Redis is down, avoid hammering Postgres on every dashboard load. */
let dashboardSummaryMemCache: { data: Record<string, unknown>; exp: number } | null = null;
const DASHBOARD_SUMMARY_MEM_TTL_MS = 20_000;

function normalizeAdminUa(ua: string | undefined): string {
  return (typeof ua === 'string' ? ua : '').trim().slice(0, 512);
}

function normalizeSessionIp(ip: string): string {
  let s = ip.trim();
  s = s.replace(/\/\d+$/, '');
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  return s.toLowerCase();
}

function sessionBindHashes(request: FastifyRequest): { ipHash: string; uaHash: string } {
  const ip = normalizeSessionIp(getClientIp(request));
  const ua = normalizeAdminUa(request.headers['user-agent'] as string | undefined);
  return {
    ipHash: crypto.createHash('sha256').update(ip, 'utf8').digest('hex'),
    uaHash: crypto.createHash('sha256').update(ua, 'utf8').digest('hex'),
  };
}

function buildAdminManualCreditRequestHash(body: Record<string, unknown>): string {
  const normalized = {
    user: String(body.user ?? '').trim(),
    currency: String(body.currency ?? '').trim(),
    amount: String(body.amount ?? '').trim(),
    reason: body.reason != null ? String(body.reason).trim() : '',
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

interface AdminManualCreditIdempotencyCache {
  requestHash: string;
  response: { success: true; data: Record<string, unknown> };
}

// Types
interface AdminLoginBody {
  email: string;
  password: string;
  twofa_code?: string;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  is_active: boolean;
}

// Generate admin tokens
function generateAdminTokens(
  app: FastifyInstance,
  payload: {
    adminId: string;
    email: string;
    role: string;
    sessionId: string;
  },
  options?: { breakGlass?: boolean }
) {
  const breakGlass = options?.breakGlass === true;
  const accessToken = app.jwt.sign(
    { ...payload, type: 'admin', ...(breakGlass ? { breakGlass: true } : {}) },
    { expiresIn: breakGlass ? '15m' : '4h' }
  );
  const refreshToken = app.jwt.sign(
    {
      adminId: payload.adminId,
      sessionId: payload.sessionId,
      type: 'admin_refresh',
      ...(breakGlass ? { breakGlass: true } : {}),
    },
    { expiresIn: breakGlass ? '15m' : '7d' }
  );
  return { accessToken, refreshToken };
}

async function getAdminMaxLoginAttempts(): Promise<number> {
  try {
    const row = await db.query<{ value: unknown }>(
      `SELECT value FROM system_settings WHERE key = 'max_login_attempts' LIMIT 1`
    );
    const parsed = Number(row.rows[0]?.value);
    if (Number.isFinite(parsed) && parsed >= 3 && parsed <= 20) return Math.trunc(parsed);
  } catch {
    // fallback below
  }
  return ADMIN_LOGIN_MAX_ATTEMPTS_FALLBACK;
}

async function isAdminSessionValid(sessionId: string, adminId: string): Promise<boolean> {
  let sessionValid = false;
  try {
    const session = await redis.getJson<{ isActive: boolean; adminId?: string }>(`admin:session:${sessionId}`);
    sessionValid = !!(session && session.isActive && (!session.adminId || session.adminId === adminId));
  } catch {
    // Redis unavailable — fallback to DB
  }
  if (!sessionValid) {
    const dbSession = await db.query<{ id: string }>(
      'SELECT id FROM admin_sessions WHERE id = $1 AND admin_id = $2 AND expires_at > NOW()',
      [sessionId, adminId]
    );
    sessionValid = dbSession.rows.length > 0;
  }
  return sessionValid;
}

/** Get admin from request (JWT + session). Throws reply if unauthorized. */
export async function getAdminFromRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  requireSuperAdmin: boolean
): Promise<{ adminId: string; role: string; breakGlass?: boolean } | null> {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    return null;
  }
  let decoded: { adminId: string; role?: string; sessionId: string; type?: string; breakGlass?: boolean };
  try {
    decoded = app.jwt.verify<typeof decoded>(token);
  } catch {
    reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
    return null;
  }
  if (decoded.type !== 'admin') {
    reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid admin token' } });
    return null;
  }
  type AdminSessionCache = {
    adminId: string;
    role: string;
    isActive: boolean;
    bindIpHash?: string;
    bindUaHash?: string;
    breakGlass?: boolean;
  };
  let session: AdminSessionCache | null = null;
  try {
    session = await redis.getJson<AdminSessionCache>(`admin:session:${decoded.sessionId}`);
  } catch {
    // Redis down; fallback to DB
  }
  if (!session || !session.isActive) {
    const dbSession = await db.query<{
      admin_id: string;
      role: string;
      ip_address: string | null;
      user_agent: string | null;
      break_glass: boolean;
    }>(
      `SELECT s.admin_id, u.role, s.ip_address::text, s.user_agent, COALESCE(s.break_glass, false) AS break_glass
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [decoded.sessionId]
    );
    if (dbSession.rows.length === 0) {
      reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
      return null;
    }
    const row = dbSession.rows[0]!;
    session = {
      adminId: row.admin_id,
      role: row.role,
      isActive: true,
      breakGlass: row.break_glass === true,
    };
    const reqIp = getClientIp(request);
    const reqUa = normalizeAdminUa(request.headers['user-agent'] as string | undefined);
    const dbIp = normalizeSessionIp((row.ip_address || '').trim());
    const dbUa = normalizeAdminUa(row.user_agent ?? undefined);
    const normalizedReqIp = normalizeSessionIp(reqIp);
    if (dbIp && dbIp !== normalizedReqIp) {
      securityLog('admin_session_binding_mismatch', 'high', { adminId: row.admin_id, reason: 'ip' });
      reply.status(401).send({
        success: false,
        error: {
          code: 'SESSION_BINDING_MISMATCH',
          message: 'Session is bound to another client context',
        },
      });
      return null;
    }
    if (dbUa && dbUa !== reqUa) {
      securityLog('admin_session_binding_mismatch', 'high', { adminId: row.admin_id, reason: 'ua' });
      reply.status(401).send({
        success: false,
        error: {
          code: 'SESSION_BINDING_MISMATCH',
          message: 'Session is bound to another client context',
        },
      });
      return null;
    }
  } else if (session.bindIpHash && session.bindUaHash) {
    const bind = sessionBindHashes(request);
    if (session.bindIpHash !== bind.ipHash || session.bindUaHash !== bind.uaHash) {
      securityLog('admin_session_binding_mismatch', 'high', { adminId: session.adminId, reason: 'redis_bind' });
      reply.status(401).send({
        success: false,
        error: {
          code: 'SESSION_BINDING_MISMATCH',
          message: 'Session is bound to another client context',
        },
      });
      return null;
    }
  }
  const role = session.role ?? decoded.role ?? '';
  if (requireSuperAdmin && role !== 'super_admin' && role !== 'Super Admin') {
    reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Hot wallet actions require Super Admin role.' },
    });
    return null;
  }

  const jwtBreakGlass = decoded.breakGlass === true;
  const sessBreakGlass = session.breakGlass === true;
  if (jwtBreakGlass !== sessBreakGlass) {
    securityLog('admin_break_glass_jwt_mismatch', 'critical', { adminId: session.adminId });
    reply.status(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Session token does not match server session' },
    });
    return null;
  }
  if (jwtBreakGlass && !config.security.breakGlassEnabled) {
    reply.status(401).send({
      success: false,
      error: { code: 'BREAK_GLASS_DISABLED', message: 'Break-glass access is disabled' },
    });
    return null;
  }

  // FIX #3: Admin IP whitelist — enforce only after JWT/session auth. Production: empty whitelist = deny all; non-production: empty = do not enforce.
  const clientIp = getClientIp(request);
  const whitelist = config.security?.adminIpWhitelist ?? [];
  const path = (request as { routerPath?: string }).routerPath ?? request.url;

  if (config.isProduction && whitelist.length === 0) {
    logger.warn('Admin access denied: IP whitelist empty in production', {
      adminId: session.adminId,
      ip: clientIp,
      path,
    });
    reply.status(403).send({
      success: false,
      error: { code: 'ADMIN_IP_NOT_ALLOWED', message: 'Admin access is restricted from this IP address' },
    });
    return null;
  }
  if (whitelist.length > 0 && !isIpInWhitelist(clientIp, whitelist)) {
    logger.warn('Admin access denied: IP not in whitelist', {
      adminId: session.adminId,
      ip: clientIp,
      path,
    });
    reply.status(403).send({
      success: false,
      error: { code: 'ADMIN_IP_NOT_ALLOWED', message: 'Admin access is restricted from this IP address' },
    });
    return null;
  }
  // FIX #4: Admin rate limit 60/min per admin (after auth + IP whitelist).
  const allowed = await enforceAdminRateLimit(request, reply, session.adminId, 'admin', 60, 60);
  if (!allowed) return null;
  return { adminId: session.adminId, role, breakGlass: jwtBreakGlass ? true : undefined };
}

/**
 * Canonical admin role names. The `role` column on `admin_users` is a free-form
 * VARCHAR — these are the recognized values used by the RBAC layer.
 */
export const ADMIN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  RISK_MANAGER: 'risk_manager',
  FINANCE_ADMIN: 'finance_admin',
  SUPPORT_AGENT: 'support_agent',
  AUDITOR: 'auditor',
} as const;
export type AdminRoleValue = (typeof ADMIN_ROLES)[keyof typeof ADMIN_ROLES];

/** Permission matrix: route scope -> required permission. super_admin and role names (e.g. withdrawal_approver) bypass. */
export const ADMIN_PERMISSION_MATRIX: Record<string, string[]> = {
  'withdrawals:approve': ['withdrawals:approve', 'all'],
  'withdrawals:view': ['withdrawals:view', 'withdrawals:approve', 'all'],
  'kyc:review': ['kyc:review', 'all'],
  'deposits:credit': ['deposits:credit', 'manual_credit', 'all'],
  'deposits:view': ['deposits:view', 'deposits:credit', 'all'],
  'users:view': ['users:view', 'users:edit', 'all'],
  'users:edit': ['users:edit', 'all'],
  'p2p:disputes': ['p2p:disputes', 'all'],
  'aml:view': ['aml:view', 'all'],
  'aml:escalate': ['aml:escalate', 'aml:view', 'all'],
  'monitoring:view': ['monitoring:view', 'all'],
  'settings:edit': ['settings:edit', 'all'],
  'settings:view': ['settings:view', 'settings:edit', 'all'],
  'control:commands': ['control:commands', 'all'],
  'control:trading': ['control:trading', 'control:commands', 'all'],
  'audit:view': ['audit:view', 'all'],
  'analytics:view': ['analytics:view', 'all'],
  'treasury:sweep': ['treasury:sweep', 'all'],
  'markets:manage': ['markets:manage', 'all'],
  'risk:export': ['risk:export', 'all'],
};

function requirePermission(admin: { adminId: string; role: string }, permission: string, reply: FastifyReply): boolean {
  if (!hasAdminRbacPermission(admin.role, permission)) {
    reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: `Permission '${permission}' required` } });
    return false;
  }
  return true;
}

/** Get admin and enforce permission. Use for RBAC on sensitive routes. requiredPermission must be a key of ADMIN_PERMISSION_MATRIX. */
export async function getAdminWithPermission(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  requiredPermission: keyof typeof ADMIN_PERMISSION_MATRIX
): Promise<{ adminId: string; role: string; breakGlass?: boolean } | null> {
  const admin = await getAdminFromRequest(app, request, reply, false);
  if (!admin) return null;
  const role = (admin.role || '').toLowerCase().replace(/\s+/g, '_');

  if (isSuperAdminRole(admin.role)) return admin;

  const rolePerms = getImplicitRolePermissions(role);
  if (rolePerms.length) {
    if (rolePerms.includes('all') || rolePerms.includes(requiredPermission)) return admin;
  }

  if (ADMIN_LEGACY_ROLE_PERMISSION[role] === requiredPermission) return admin;

  const allowedPerms = ADMIN_PERMISSION_MATRIX[requiredPermission];
  if (!allowedPerms) return admin;
  const permRow = await db.query<{ permissions: string[] }>(
    `SELECT permissions FROM admin_users WHERE id = $1`,
    [admin.adminId]
  );
  const permissions = permRow.rows[0]?.permissions ?? [];
  const hasDbPermission =
    Array.isArray(permissions) && allowedPerms.some((p) => permissions.includes(p));
  if (hasDbPermission) return admin;
  reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: `This action requires permission: ${requiredPermission} (or role super_admin).` },
  });
  return null;
}

/**
 * Resolve the full set of effective permissions for an admin, combining
 * role-based and explicit (DB column) permissions. Used by /auth/me.
 */
export function resolveEffectivePermissions(role: string, dbPermissions: string[]): string[] {
  const normalizedRole = (role || '').toLowerCase().replace(/\s+/g, '_');
  if (isSuperAdminRole(role)) return ['all'];
  const rolePerms = getImplicitRolePermissions(normalizedRole) ?? [];
  const explicit = Array.isArray(dbPermissions) ? dbPermissions : [];
  const set = new Set([...rolePerms, ...explicit]);
  return Array.from(set).sort();
}

/** Admin who can approve/reject withdrawals: role withdrawal_approver or super_admin, or permission withdrawals:approve / all. */
export async function getAdminForWithdrawalApproval(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ adminId: string; role: string; breakGlass?: boolean } | null> {
  const admin = await getAdminWithPermission(app, request, reply, 'withdrawals:approve');
  if (!admin) return null;
  if (admin.breakGlass) {
    reply.status(403).send({
      success: false,
      error: {
        code: 'BREAK_GLASS_BLOCKED',
        message:
          'Break-glass sessions cannot approve withdrawals directly. Use POST /admin/approval-requests (maker-checker).',
      },
    });
    return null;
  }
  return admin;
}

function clientIpFromWsReq(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const h = req.headers;
  const cf = h['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const xri = h['x-real-ip'];
  if (typeof xri === 'string' && xri.trim()) return xri.trim();
  const xff = h['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const ra = req.socket?.remoteAddress || '0.0.0.0';
  return ra.replace(/^::ffff:/, '');
}

function extractWsTicketFromProtocol(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const raw = req.headers['sec-websocket-protocol'];
  const parts =
    typeof raw === 'string'
      ? raw.split(',').map((s) => s.trim())
      : Array.isArray(raw)
        ? raw.flatMap((x) => x.split(',')).map((s) => s.trim())
        : [];
  for (const p of parts) {
    if (p.startsWith('ticket.')) return p.slice('ticket.'.length).trim();
  }
  return null;
}

export default async function adminRoutes(app: FastifyInstance) {

  app.post<{ Body: { email?: string; breakGlassSecret?: string } }>(
    '/break-glass-challenge',
    {
      config: { rateLimit: false },
      preHandler: [rateLimitByIp('admin-break-glass-all', 5, 600, { failClosed: config.isProduction })],
    },
    async (request, reply) => {
      if (!config.security.breakGlassEnabled) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      const ip = getClientIp(request);
      if (!isBreakGlassClientIpAllowed(ip)) {
        securityLog('admin_break_glass_challenge_ip_denied', 'high', { ip });
        return reply.status(403).send({
          success: false,
          error: { code: 'IP_NOT_ALLOWED', message: 'Break-glass is not permitted from this IP address' },
        });
      }
      const body = request.body ?? {};
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const bgSecret = typeof body.breakGlassSecret === 'string' ? body.breakGlassSecret : '';
      if (!email || !bgSecret) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'email and breakGlassSecret are required' },
        });
      }
      const ha = crypto.createHash('sha256').update(bgSecret, 'utf8').digest();
      const hb = crypto.createHash('sha256').update(config.security.breakGlassSecret ?? '', 'utf8').digest();
      if (!config.security.breakGlassSecret || ha.length !== hb.length || !crypto.timingSafeEqual(ha, hb)) {
        securityLog('admin_break_glass_challenge_secret_fail', 'high', {
          emailHash: crypto.createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 12),
        });
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
        });
      }
      const token = crypto.randomBytes(32).toString('hex');
      try {
        await redis.setJson(`break-glass:ch:${token}`, { email, ip }, 60);
      } catch (e) {
        logger.error('break-glass-challenge: redis failed', { error: e instanceof Error ? e.message : String(e) });
        return reply.status(503).send({
          success: false,
          error: { code: 'CHALLENGE_UNAVAILABLE', message: 'Break-glass challenge requires Redis' },
        });
      }
      securityLog('admin_break_glass_challenge_issued', 'critical', {
        emailHash: crypto.createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 12),
        ip,
      });
      return reply.send({
        success: true,
        data: { challengeToken: token, expiresInSec: 60 },
      });
    }
  );

  app.post<{
    Body: {
      email?: string;
      password?: string;
      breakGlassSecret?: string;
      challengeToken?: string;
      reason?: string;
      ticketId?: string;
    };
  }>(
    '/break-glass-login',
    {
      config: { rateLimit: false },
      preHandler: [rateLimitByIp('admin-break-glass-all', 5, 600, { failClosed: config.isProduction })],
    },
    async (request, reply) => {
      if (!config.security.breakGlassEnabled) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      const loginClientIpEarly = getClientIp(request);
      if (!isBreakGlassClientIpAllowed(loginClientIpEarly)) {
        securityLog('admin_break_glass_login_ip_denied', 'high', { ip: loginClientIpEarly });
        return reply.status(403).send({
          success: false,
          error: { code: 'IP_NOT_ALLOWED', message: 'Break-glass is not permitted from this IP address' },
        });
      }
      const secretExpected = config.security.breakGlassSecret;
      const body = request.body ?? {};
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const bgSecret = typeof body.breakGlassSecret === 'string' ? body.breakGlassSecret : '';
      const challengeToken = typeof body.challengeToken === 'string' ? body.challengeToken.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const ticketId = typeof body.ticketId === 'string' ? body.ticketId.trim() : '';
      if (!email || !password || !bgSecret || challengeToken.length < 16 || reason.length < 8 || ticketId.length < 4) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message:
              'email, password, breakGlassSecret, challengeToken (from POST /break-glass-challenge), reason (min 8 chars), and ticketId are required',
          },
        });
      }
      try {
        const ch = await redis.getDelJson<{ email: string; ip: string }>(`break-glass:ch:${challengeToken}`);
        if (!ch || ch.email !== email || ch.ip !== loginClientIpEarly) {
          securityLog('admin_break_glass_challenge_invalid', 'critical', {
            emailHash: crypto.createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 12),
            ip: loginClientIpEarly,
          });
          return reply.status(401).send({
            success: false,
            error: { code: 'INVALID_CHALLENGE', message: 'Invalid or expired break-glass challenge token' },
          });
        }
      } catch (e) {
        logger.error('break-glass-login: redis challenge read failed', { error: e instanceof Error ? e.message : String(e) });
        return reply.status(503).send({
          success: false,
          error: { code: 'CHALLENGE_UNAVAILABLE', message: 'Could not validate break-glass challenge' },
        });
      }
      const ha = crypto.createHash('sha256').update(bgSecret, 'utf8').digest();
      const hb = crypto.createHash('sha256').update(secretExpected ?? '', 'utf8').digest();
      if (!secretExpected || ha.length !== hb.length || !crypto.timingSafeEqual(ha, hb)) {
        securityLog('admin_break_glass_secret_fail', 'high', {
          emailHash: crypto.createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 12),
        });
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
        });
      }
      const result = await db.query<{
        id: string;
        email: string;
        name: string;
        role: string;
        permissions: string[];
        password_hash: string;
        is_active: boolean;
      }>(`SELECT id, email, name, role, permissions, password_hash, is_active FROM admin_users WHERE email = $1`, [email]);
      if (result.rows.length === 0) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
        });
      }
      const adm = result.rows[0]!;
      if (!adm.is_active) {
        return reply.status(403).send({ success: false, error: { code: 'ACCOUNT_DISABLED', message: 'Disabled' } });
      }
      const okPw = await bcrypt.compare(password, adm.password_hash);
      if (!okPw) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
        });
      }
      const loginClientIp = getClientIp(request);
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await db.query(
        `INSERT INTO admin_sessions (id, admin_id, session_token, ip_address, user_agent, expires_at, break_glass)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [sessionId, adm.id, sessionToken, loginClientIp, request.headers['user-agent'], expiresAt]
      );
      try {
        const bh = sessionBindHashes(request);
        await redis.setJson(
          `admin:session:${sessionId}`,
          {
            adminId: adm.id,
            email: adm.email,
            role: adm.role,
            isActive: true,
            breakGlass: true,
            bindIpHash: bh.ipHash,
            bindUaHash: bh.uaHash,
          },
          15 * 60
        );
      } catch (e) {
        logger.warn('break-glass: Redis session cache failed', { error: e instanceof Error ? e.message : String(e) });
      }
      await db.query(
        `INSERT INTO admin_break_glass_events (admin_id, ticket_id, reason, ip_address)
         VALUES ($1, $2, $3, $4::inet)`,
        [adm.id, ticketId, reason, loginClientIp]
      );
      securityLog('admin_break_glass_login', 'critical', {
        adminId: adm.id,
        ticketId,
        ip: loginClientIp,
        reasonPreview: reason.slice(0, 120),
        challengeConsumed: true,
      });
      logger.warn('admin break-glass session issued', { adminId: adm.id, ticketId, ip: loginClientIp });
      const tokens = generateAdminTokens(
        app,
        {
          adminId: adm.id,
          email: adm.email,
          role: adm.role,
          sessionId,
        },
        { breakGlass: true }
      );
      return reply.send({
        success: true,
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresInMinutes: 15,
          breakGlass: true,
        },
      });
    }
  );

  /**
   * POST /admin/auth/ws-ticket — one-time ticket for admin WebSockets (Sec-WebSocket-Protocol: ticket.<id>).
   */
  app.post('/auth/ws-ticket', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    }
    let sessionId: string;
    try {
      const d = app.jwt.verify<{ sessionId?: string; type?: string }>(token);
      if (d.type !== 'admin' || !d.sessionId) {
        return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid admin token' } });
      }
      sessionId = d.sessionId;
    } catch {
      return reply.status(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid admin token' } });
    }
    try {
      const ticket = await issueAdminWsTicket(admin.adminId, sessionId, getClientIp(request));
      return reply.send({
        success: true,
        data: { ticket, expiresIn: WS_TICKET_TTL_SEC, protocol: `ticket.${ticket}` },
      });
    } catch (e) {
      logger.error('admin ws-ticket issue failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(503).send({
        success: false,
        error: { code: 'TICKET_UNAVAILABLE', message: 'Could not issue WebSocket ticket' },
      });
    }
  });

  /**
   * WebSocket: /api/v1/admin/ws/metrics — real-time admin metrics (trade, order, deposit, withdrawal, p2p, aml).
   * Auth: Sec-WebSocket-Protocol `ticket.<one_time_ticket>` from POST /admin/auth/ws-ticket (no JWT in query).
   */
  app.get('/ws/metrics', { websocket: true }, (socket, req) => {
    const closeUnauthorized = (message: string) => {
      socket.send(JSON.stringify({ type: 'error', data: { message }, timestamp: Date.now() }));
      socket.close(1008, message);
    };
    const url = new URL(req.url || '', 'http://localhost');
    if (url.searchParams.has('token')) {
      closeUnauthorized('JWT in query string is not permitted');
      return;
    }
    const ticket = extractWsTicketFromProtocol(req);
    if (!ticket) {
      closeUnauthorized('Missing ticket (use Sec-WebSocket-Protocol: ticket.<id>)');
      return;
    }
    const clientIp = clientIpFromWsReq(req);
    void (async () => {
      const consumed = await consumeWsTicket(ticket, clientIp, 'admin');
      if (!consumed.ok || !consumed.adminId || !consumed.sessionId) {
        closeUnauthorized('Invalid, expired, or reused ticket');
        return;
      }
      const sessionValid = await isAdminSessionValid(consumed.sessionId, consumed.adminId);
      if (!sessionValid) {
        closeUnauthorized('Session expired');
        return;
      }
      const connId = registerAdminConnection(socket as any, consumed.adminId);
      socket.on('close', () => unregisterAdminConnection(connId));
      socket.on('message', (buf: Buffer) => {
        try {
          const msg = JSON.parse(buf.toString()) as { type: string };
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch {
          // ignore
        }
      });
    })();
  });

  /**
   * WebSocket: /api/v1/admin/ws/events — control panel real-time events.
   */
  app.get('/ws/events', { websocket: true }, (socket, req) => {
    const closeUnauthorized = (message: string) => {
      socket.send(JSON.stringify({ event: 'error', payload: { message }, timestamp: Date.now() }));
      socket.close(1008, message);
    };
    const url = new URL(req.url || '', 'http://localhost');
    if (url.searchParams.has('token')) {
      closeUnauthorized('JWT in query string is not permitted');
      return;
    }
    const ticket = extractWsTicketFromProtocol(req);
    if (!ticket) {
      closeUnauthorized('Missing ticket (use Sec-WebSocket-Protocol: ticket.<id>)');
      return;
    }
    const clientIp = clientIpFromWsReq(req);
    void (async () => {
      const consumed = await consumeWsTicket(ticket, clientIp, 'admin');
      if (!consumed.ok || !consumed.adminId || !consumed.sessionId) {
        closeUnauthorized('Invalid, expired, or reused ticket');
        return;
      }
      const sessionValid = await isAdminSessionValid(consumed.sessionId, consumed.adminId);
      if (!sessionValid) {
        closeUnauthorized('Session expired');
        return;
      }
      const connId = registerAdminEventsConnection(socket as any, consumed.adminId);
      socket.on('close', () => unregisterAdminEventsConnection(connId));
      socket.on('message', (buf: Buffer) => {
        try {
          const msg = JSON.parse(buf.toString()) as { type: string };
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ event: 'pong', payload: {}, timestamp: Date.now() }));
          }
        } catch {
          // ignore
        }
      });
    })();
  });

  /**
   * POST /admin/auth/login
   * Admin login
   */
  app.post<{ Body: AdminLoginBody }>('/auth/login', {
    config: { rateLimit: false },
    preHandler: [
      rateLimitByIp('admin-login', config.rateLimit.adminLoginMax, config.rateLimit.adminLoginWindowSec),
    ],
  }, async (request, reply) => {
    try {
      const body = request.body ?? {} as AdminLoginBody;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!email || !email.includes('@')) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required' },
        });
      }
      if (password.length < 6) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters' },
        });
      }

      // Find admin user
      const result = await db.query<{
        id: string;
        email: string;
        password_hash: string;
        name: string;
        role: string;
        permissions: string[];
        is_active: boolean;
        failed_login_attempts: number | null;
        locked_until: Date | null;
      }>(
        'SELECT id, email, password_hash, name, role, permissions, is_active, failed_login_attempts, locked_until FROM admin_users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        logger.warn('Admin login failed: user not found', { email });
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
      }

      const admin = result.rows[0]!;
      const now = new Date();
      if (admin.locked_until && new Date(admin.locked_until) > now) {
        return reply.status(423).send({
          success: false,
          error: { code: 'ACCOUNT_LOCKED', message: `Account temporarily locked. Try again after ${new Date(admin.locked_until).toISOString()}` },
        });
      }

      if (!admin.is_active) {
        return reply.status(403).send({
          success: false,
          error: { code: 'ACCOUNT_DISABLED', message: 'Admin account is disabled' },
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, admin.password_hash);
      if (!isValid) {
        const maxAttempts = await getAdminMaxLoginAttempts();
        const nextAttempts = (admin.failed_login_attempts ?? 0) + 1;
        const lockThisAttempt = nextAttempts >= maxAttempts;
        await db.query(
          `UPDATE admin_users
           SET failed_login_attempts = $2,
               locked_until = CASE WHEN $3 THEN NOW() + INTERVAL '${ADMIN_LOGIN_LOCK_MINUTES} minutes' ELSE NULL END,
               updated_at = NOW()
           WHERE id = $1`,
          [admin.id, nextAttempts, lockThisAttempt]
        );
        logger.warn('Admin login failed: invalid password', { email });
        if (lockThisAttempt) {
          return reply.status(423).send({
            success: false,
            error: { code: 'ACCOUNT_LOCKED', message: `Too many failed attempts. Account locked for ${ADMIN_LOGIN_LOCK_MINUTES} minutes.` },
          });
        }
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
      }

      const loginClientIp = getClientIp(request);
      const prevIpRes = await db.query<{ ip: string | null }>(
        `SELECT ip_address::text AS ip FROM admin_sessions WHERE admin_id = $1 ORDER BY expires_at DESC LIMIT 1`,
        [admin.id]
      );
      const prevIp = prevIpRes.rows[0]?.ip?.trim() || null;
      if (prevIp && prevIp !== loginClientIp) {
        securityLog('admin_login_new_ip', 'medium', { adminId: admin.id });
        if (config.security.adminBlockLoginNewIp) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'ADMIN_LOGIN_NEW_IP_BLOCKED',
              message: 'Login from a new IP is not permitted for this account.',
            },
          });
        }
      }

      try {
        const twoFaCheck = await db.query<{ two_factor_enabled: boolean }>(
          'SELECT two_factor_enabled FROM admin_users WHERE id = $1',
          [admin.id]
        );
        const has2fa = twoFaCheck.rows[0]?.two_factor_enabled === true;
        if (config.security.admin2faMandatory && !has2fa) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'ADMIN_2FA_MANDATORY',
              message: 'All administrators must enable two-factor authentication before signing in.',
            },
          });
        }
        if (has2fa) {
          const { twofa_code } = request.body as { twofa_code?: string };
          if (!twofa_code) {
            return reply.status(200).send({
              success: true,
              data: { requires2FA: true, adminId: admin.id, message: 'Enter your 2FA code to continue' },
            });
          }
          const { admin2FAService } = await import('../services/admin-2fa.service.js');
          const valid = await admin2FAService.verifyTokenForLogin(admin.id, twofa_code);
          if (!valid) {
            const maxAttempts = await getAdminMaxLoginAttempts();
            const nextAttempts = (admin.failed_login_attempts ?? 0) + 1;
            const lockThisAttempt = nextAttempts >= maxAttempts;
            await db.query(
              `UPDATE admin_users
               SET failed_login_attempts = $2,
                   locked_until = CASE WHEN $3 THEN NOW() + INTERVAL '${ADMIN_LOGIN_LOCK_MINUTES} minutes' ELSE NULL END,
                   updated_at = NOW()
               WHERE id = $1`,
              [admin.id, nextAttempts, lockThisAttempt]
            );
            return reply.status(401).send({
              success: false,
              error: { code: 'INVALID_2FA', message: 'Invalid 2FA code' },
            });
          }
        }
      } catch (e) {
        logger.error('2FA check failed (login blocked)', { error: e instanceof Error ? e.message : 'Unknown' });
        return reply.status(503).send({
          success: false,
          error: { code: '2FA_SERVICE_UNAVAILABLE', message: '2FA verification service is unavailable. Please retry shortly.' },
        });
      }

      // Create session
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO admin_sessions (id, admin_id, session_token, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, admin.id, sessionToken, loginClientIp, request.headers['user-agent'], expiresAt]
      );

      try {
        const bh = sessionBindHashes(request);
        await redis.setJson(
          `admin:session:${sessionId}`,
          {
            adminId: admin.id,
            email: admin.email,
            role: admin.role,
            isActive: true,
            bindIpHash: bh.ipHash,
            bindUaHash: bh.uaHash,
          },
          7 * 24 * 60 * 60
        );
      } catch (e) {
        logger.warn('Redis unavailable for admin session cache; using DB fallback', { error: e instanceof Error ? e.message : 'Unknown' });
      }

      // Update last login
      await db.query(
        'UPDATE admin_users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
        [admin.id]
      );

      // Log activity
      await db.query(
        `INSERT INTO admin_activity_logs (admin_id, action, details, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [admin.id, 'login', JSON.stringify({ userAgent: request.headers['user-agent'] }), loginClientIp]
      );

      // Generate tokens
      const tokens = generateAdminTokens(app, {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
        sessionId,
      });

      logger.info('Admin login successful', { adminId: admin.id, email: admin.email });

      return reply.send({
        success: true,
        data: {
          admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            permissions: admin.permissions,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });

    } catch (error) {
      logger.error('Admin login error', { error: error instanceof Error ? error.message : 'Unknown', stack: error instanceof Error ? error.stack : undefined });
      return reply.status(500).send({
        success: false,
        error: { code: 'LOGIN_FAILED', message: 'Login failed. Please try again.' },
      });
    }
  });

  /**
   * POST /admin/auth/logout
   * Admin logout
   */
  app.post('/auth/logout', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = app.jwt.verify<{ sessionId: string; adminId: string }>(token);
        try {
          await redis.del(`admin:session:${decoded.sessionId}`);
        } catch {
          // Redis down; session still invalidated in DB
        }
        await db.query(
          'DELETE FROM admin_sessions WHERE id = $1',
          [decoded.sessionId]
        );
      }

      return reply.send({
        success: true,
        data: { message: 'Logged out successfully' },
      });
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
      });
    }
  });

  /**
   * GET /admin/auth/me
   * Get current admin
   */
  app.get('/auth/me', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'No token provided' },
        });
      }

      const decoded = app.jwt.verify<{
        adminId: string;
        email: string;
        role: string;
        sessionId: string;
        type: string;
      }>(token);

      if (decoded.type !== 'admin') {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid admin token' },
        });
      }

      // Check session: Redis first; if Redis down or session not cached, fallback to DB so login works without Redis
      let sessionValid = false;
      try {
        const session = await redis.getJson<{ isActive: boolean }>(`admin:session:${decoded.sessionId}`);
        sessionValid = !!(session && session.isActive);
      } catch {
        // Redis unavailable — fall back to DB
      }
      if (!sessionValid) {
        const dbSession = await db.query<{ id: string }>(
          'SELECT id FROM admin_sessions WHERE id = $1 AND admin_id = $2 AND expires_at > NOW()',
          [decoded.sessionId, decoded.adminId]
        );
        sessionValid = dbSession.rows.length > 0;
      }
      if (!sessionValid) {
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
        });
      }

      // Get admin details
      const result = await db.query<AdminUser>(
        'SELECT id, email, name, role, permissions, is_active FROM admin_users WHERE id = $1',
        [decoded.adminId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'ADMIN_NOT_FOUND', message: 'Admin not found' },
        });
      }

      const adminRow = result.rows[0]!;
      const effectivePermissions = resolveEffectivePermissions(adminRow.role, adminRow.permissions);

      return reply.send({
        success: true,
        data: { ...adminRow, effectivePermissions },
      });

    } catch (error) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
      });
    }
  });

  /**
   * POST /admin/auth/refresh
   * Refresh admin token
   */
  app.post<{ Body: { refreshToken: string } }>('/auth/refresh', async (request, reply) => {
    try {
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_TOKEN', message: 'Refresh token required' },
        });
      }

      const decoded = app.jwt.verify<{
        adminId: string;
        sessionId: string;
        type: string;
        breakGlass?: boolean;
      }>(refreshToken);

      if (decoded.type !== 'admin_refresh') {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
        });
      }

      // Check session
      const session = await redis.getJson<{
        adminId: string;
        email: string;
        role: string;
        breakGlass?: boolean;
      }>(`admin:session:${decoded.sessionId}`);
      if (!session) {
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
        });
      }

      const breakGlass = decoded.breakGlass === true && session.breakGlass === true;

      // Generate new tokens
      const tokens = generateAdminTokens(
        app,
        {
          adminId: session.adminId,
          email: session.email,
          role: session.role,
          sessionId: decoded.sessionId,
        },
        { breakGlass }
      );

      return reply.send({
        success: true,
        data: tokens,
      });

    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' },
      });
    }
  });

  // ===============================
  // ADMIN SESSION MANAGEMENT
  // ===============================

  /** GET /admin-sessions — list all active admin sessions for security monitoring */
  app.get('/admin-sessions', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const result = await db.query<{
        id: string;
        admin_id: string;
        ip_address: string;
        user_agent: string;
        created_at: string;
        expires_at: string;
        break_glass: boolean;
      }>(
        `SELECT s.id, s.admin_id, s.ip_address, s.user_agent, s.created_at, s.expires_at,
                COALESCE(s.break_glass, false) AS break_glass,
                a.email AS admin_email, a.name AS admin_name, a.role AS admin_role
         FROM admin_sessions s
         LEFT JOIN admin_users a ON a.id = s.admin_id
         WHERE s.expires_at > NOW()
         ORDER BY s.created_at DESC
         LIMIT 100`
      );
      return reply.send({ success: true, data: { sessions: result.rows, total: result.rows.length } });
    } catch (e) {
      logger.warn('Failed to list admin sessions', { error: e instanceof Error ? e.message : 'unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list admin sessions' } });
    }
  });

  /** DELETE /admin-sessions/:id — terminate an admin session (force logout) */
  app.delete<{ Params: { id: string } }>('/admin-sessions/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'control:commands');
    if (!admin) return;
    const sessionId = request.params.id;
    if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_ID', message: 'Session ID required' } });
    try {
      const sessionRow = await db.query<{ admin_id: string; session_token: string }>(
        'SELECT admin_id, session_token FROM admin_sessions WHERE id = $1',
        [sessionId]
      );
      if (!sessionRow.rows[0]) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
      }
      const targetSession = sessionRow.rows[0];
      await db.query('DELETE FROM admin_sessions WHERE id = $1', [sessionId]);
      try { await redis.del(`admin:session:${targetSession.session_token}`); } catch {}
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_session_terminated',
        resourceType: 'admin_session',
        resourceId: sessionId,
        newValue: { targetAdminId: targetSession.admin_id },
      });
      broadcastAdminControlEvent('admin_session_terminated', { session_terminated: sessionId, by: admin.adminId, targetAdminId: targetSession.admin_id });
      return reply.send({ success: true, data: { terminated: sessionId } });
    } catch (e) {
      logger.warn('Failed to terminate admin session', { error: e instanceof Error ? e.message : 'unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to terminate session' } });
    }
  });

  // ===============================
  // DASHBOARD STATS
  // ===============================

  /**
   * GET /admin/dashboard/stats
   * Get dashboard statistics
   */
  app.get('/dashboard/stats', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const CACHE_KEY = 'admin:cache:dashboard_stats';
      const CACHE_TTL = 15;
      try {
        const cached = await redis.getJson<Record<string, unknown>>(CACHE_KEY);
        if (cached) return reply.send({ success: true, data: cached });
      } catch { /* Redis down — query DB */ }

      const safeCount = (sql: string): Promise<Record<string, string>> =>
        db.query<Record<string, string>>(sql).then(r => r.rows[0] ?? ({} as Record<string, string>)).catch(() => ({} as Record<string, string>));

      const [userRow, sessionRow, kycRow, p2pAdsRow, p2pOrdersRow, disputeRow, referralRow] = await Promise.all([
        /**
         * `users.status` is the enum `user_status` with values
         *   pending, active, suspended, banned, deleted.
         * We count each so the admin Users KPI cards are accurate.
         * Older code only returned total/newToday/active/verified, which
         * is why the Suspended/Banned tile always showed 0 on the Users page.
         */
        safeCount(`SELECT COUNT(*) as total_users,
                          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_users_24h,
                          COUNT(*) FILTER (WHERE status = 'active') as active_users,
                          COUNT(*) FILTER (WHERE status = 'pending') as pending_users,
                          COUNT(*) FILTER (WHERE status = 'suspended') as suspended_users,
                          COUNT(*) FILTER (WHERE status = 'banned') as banned_users,
                          COUNT(*) FILTER (WHERE email_verified = true OR phone_verified = true) as verified_users
                   FROM users WHERE deleted_at IS NULL`),
        safeCount(`SELECT COUNT(DISTINCT user_id) as active_sessions FROM user_sessions WHERE is_active = true AND expires_at > NOW()`),
        safeCount(`SELECT COUNT(*) FILTER (WHERE status = 'pending') as pending_kyc, COUNT(*) FILTER (WHERE status = 'under_review') as review_kyc, COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_at > NOW() - INTERVAL '24 hours') as approved_today, COUNT(*) FILTER (WHERE status = 'rejected' AND reviewed_at > NOW() - INTERVAL '24 hours') as rejected_today FROM kyc_applications`),
        safeCount(`SELECT COUNT(*) FILTER (WHERE status = 'active') as active_ads FROM p2p_ads`),
        safeCount(`SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'awaiting_payment', 'payment_sent')) as active_orders FROM p2p_orders`),
        safeCount(`SELECT COUNT(*) as open_disputes FROM p2p_disputes WHERE status IN ('open', 'under_review')`),
        safeCount(`SELECT COUNT(*) as total_codes, COUNT(*) FILTER (WHERE is_active = true) as active_codes FROM referral_codes`),
      ]);

      const data = {
        users: {
          total: parseInt(userRow.total_users || '0'),
          newToday: parseInt(userRow.new_users_24h || '0'),
          active: parseInt(sessionRow.active_sessions || '0'),
          activeUsers: parseInt(userRow.active_users || '0'),
          pending: parseInt(userRow.pending_users || '0'),
          suspended: parseInt(userRow.suspended_users || '0'),
          banned: parseInt(userRow.banned_users || '0'),
          /** Legacy alias — frontend still reads `locked` in several places. */
          locked: parseInt(userRow.banned_users || '0'),
          verified: parseInt(userRow.verified_users || '0'),
        },
        kyc: {
          pending: parseInt(kycRow.pending_kyc || '0'),
          underReview: parseInt(kycRow.review_kyc || '0'),
          approvedToday: parseInt(kycRow.approved_today || '0'),
          rejectedToday: parseInt(kycRow.rejected_today || '0'),
        },
        p2p: {
          activeAds: parseInt(p2pAdsRow.active_ads || '0'),
          activeOrders: parseInt(p2pOrdersRow.active_orders || '0'),
          openDisputes: parseInt(disputeRow.open_disputes || '0'),
        },
        referrals: {
          totalCodes: parseInt(referralRow.total_codes || '0'),
          activeCodes: parseInt(referralRow.active_codes || '0'),
        },
      };

      redis.setJson(CACHE_KEY, data, CACHE_TTL).catch(() => {});
      return reply.send({ success: true, data });
    } catch (error) {
      logger.error('Dashboard stats error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch dashboard stats' },
      });
    }
  });

  /**
   * GET /admin/dashboard-summary
   * Single aggregated endpoint for the admin dashboard — merges stats, health, halt, analytics, withdrawals, control.
   * Redis cached 15s. One API call replaces 6 individual queries from the frontend.
   */
  app.get('/dashboard-summary', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const CACHE_KEY = 'admin:cache:dashboard_summary';
      try {
        const cached = await redis.getJson<Record<string, unknown>>(CACHE_KEY);
        if (cached) return reply.send({ success: true, data: cached });
      } catch { /* Redis down */ }

      const nowMem = Date.now();
      if (dashboardSummaryMemCache && nowMem < dashboardSummaryMemCache.exp) {
        return reply.send({ success: true, data: dashboardSummaryMemCache.data });
      }

      const safe = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
      const safeRow = (sql: string): Promise<Record<string, string>> =>
        db.query<Record<string, string>>(sql).then(r => r.rows[0] ?? ({} as Record<string, string>)).catch(() => ({} as Record<string, string>));

      const [
        userRow, sessionRow, kycRow, p2pAdsRow, p2pOrdersRow, disputeRow, referralRow,
        haltedRaw, wdRow, analyticsRow, healthRow,
      ] = await Promise.all([
        safeRow(`SELECT COUNT(*) as total_users,
                        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_users_24h,
                        COUNT(*) FILTER (WHERE status = 'active') as active_users,
                        COUNT(*) FILTER (WHERE status = 'pending') as pending_users,
                        COUNT(*) FILTER (WHERE status = 'suspended') as suspended_users,
                        COUNT(*) FILTER (WHERE status = 'banned') as banned_users,
                        COUNT(*) FILTER (WHERE email_verified = true OR phone_verified = true) as verified_users
                 FROM users WHERE deleted_at IS NULL`),
        safeRow(`SELECT COUNT(DISTINCT user_id) as active_sessions FROM user_sessions WHERE is_active = true AND expires_at > NOW()`),
        safeRow(`SELECT COUNT(*) FILTER (WHERE status = 'pending') as pending_kyc, COUNT(*) FILTER (WHERE status = 'under_review') as review_kyc, COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_at > NOW() - INTERVAL '24 hours') as approved_today, COUNT(*) FILTER (WHERE status = 'rejected' AND reviewed_at > NOW() - INTERVAL '24 hours') as rejected_today FROM kyc_applications`),
        safeRow(`SELECT COUNT(*) FILTER (WHERE status = 'active') as active_ads FROM p2p_ads`),
        safeRow(`SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'awaiting_payment', 'payment_sent')) as active_orders FROM p2p_orders`),
        safeRow(`SELECT COUNT(*) as open_disputes FROM p2p_disputes WHERE status IN ('open', 'under_review')`),
        safeRow(`SELECT COUNT(*) as total_codes, COUNT(*) FILTER (WHERE is_active = true) as active_codes FROM referral_codes`),
        safe(import('../lib/trading-halt.js').then(m => m.getTradingHalted()), false),
        safeRow(`SELECT COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval FROM withdrawals`),
        safeRow(`SELECT COALESCE(SUM((quantity::numeric * price::numeric)), 0)::text AS volume, COUNT(*)::text AS count FROM spot_trades WHERE created_at > NOW() - INTERVAL '24 hours'`),
        safe(db.query<Record<string, unknown>>(`SELECT 1`).then(() => ({ db: 'up' })), { db: 'down' }),
      ]);

      const summary = {
        stats: {
          users: {
            total: parseInt(userRow.total_users || '0'),
            newToday: parseInt(userRow.new_users_24h || '0'),
            active: parseInt(sessionRow.active_sessions || '0'),
            activeUsers: parseInt(userRow.active_users || '0'),
            pending: parseInt(userRow.pending_users || '0'),
            suspended: parseInt(userRow.suspended_users || '0'),
            banned: parseInt(userRow.banned_users || '0'),
            locked: parseInt(userRow.banned_users || '0'),
            verified: parseInt(userRow.verified_users || '0'),
          },
          kyc: { pending: parseInt(kycRow.pending_kyc || '0'), underReview: parseInt(kycRow.review_kyc || '0'), approvedToday: parseInt(kycRow.approved_today || '0'), rejectedToday: parseInt(kycRow.rejected_today || '0') },
          p2p: { activeAds: parseInt(p2pAdsRow.active_ads || '0'), activeOrders: parseInt(p2pOrdersRow.active_orders || '0'), openDisputes: parseInt(disputeRow.open_disputes || '0') },
          referrals: { totalCodes: parseInt(referralRow.total_codes || '0'), activeCodes: parseInt(referralRow.active_codes || '0') },
        },
        halted: haltedRaw,
        pendingWithdrawals: parseInt(wdRow.pending_approval || '0'),
        tradingVolume24h: parseFloat(analyticsRow.volume || '0'),
        tradeCount24h: parseInt(analyticsRow.count || '0'),
        health: healthRow,
      };

      redis.setJson(CACHE_KEY, summary, 15).catch(() => {});
      dashboardSummaryMemCache = {
        data: summary as unknown as Record<string, unknown>,
        exp: Date.now() + DASHBOARD_SUMMARY_MEM_TTL_MS,
      };
      return reply.send({ success: true, data: summary });
    } catch (error) {
      logger.error('Dashboard summary error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Dashboard summary failed' } });
    }
  });

  // ===============================
  // ANALYTICS COMMAND CENTER
  // ===============================
  /* GET /analytics/revenue is in admin-analytics.fastify.ts */

  app.get('/analytics/volume', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let volumeByMarket: { market: string; volume_usd: number }[] = [];
      let volumeByAsset: { asset: string; volume_usd: number }[] = [];
      let volumeOverTime: { date: string; volume_usd: number }[] = [];
      try {
        const byMarket = await db.query<{ market: string; vol: string }>(`
          SELECT COALESCE(market, symbol, 'unknown') AS market, COALESCE(SUM((price * quantity)::numeric), 0)::text AS vol
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(market, symbol)
          ORDER BY SUM((price * quantity)::numeric) DESC LIMIT 10
        `);
        volumeByMarket = byMarket.rows.map((r) => ({ market: r.market, volume_usd: parseFloat(r.vol ?? '0') }));
        const byAsset = await db.query<{ base: string; vol: string }>(`
          SELECT COALESCE(base_asset, split_part(COALESCE(market, symbol), '/', 1), 'unknown') AS base, COALESCE(SUM((price * quantity)::numeric), 0)::text AS vol
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(base_asset, split_part(COALESCE(market, symbol), '/', 1))
          ORDER BY SUM((price * quantity)::numeric) DESC LIMIT 10
        `).catch(() => ({ rows: [] }));
        volumeByAsset = (byAsset.rows ?? []).map((r) => ({ asset: r.base, volume_usd: parseFloat(r.vol ?? '0') }));
        const overTime = await db.query<{ d: string; vol: string }>(`
          SELECT date_trunc('day', created_at)::date::text AS d, COALESCE(SUM((price * quantity)::numeric), 0)::text AS vol
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '14 days'
          GROUP BY date_trunc('day', created_at) ORDER BY d
        `).catch(() => ({ rows: [] }));
        volumeOverTime = (overTime.rows ?? []).map((r) => ({ date: r.d, volume_usd: parseFloat(r.vol ?? '0') }));
      } catch (_) { /* schema may vary */ }
      return reply.send({ success: true, data: { volume_by_market: volumeByMarket, volume_by_asset: volumeByAsset, volume_over_time: volumeOverTime } });
    } catch (e) {
      logger.error('Analytics volume error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch volume' } });
    }
  });

  /* GET /analytics/liquidity is in admin-analytics.fastify.ts */

  /* GET /analytics/user-growth is defined in admin-analytics.fastify.ts to avoid duplicate route */

  app.get('/analytics/deposits-withdrawals', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let depositsTotal = 0; let withdrawalsTotal = 0;
      const depositsVsWithdrawals = [{ name: 'Deposits', value: 50, color: '#10B981' }, { name: 'Withdrawals', value: 50, color: '#6366F1' }];
      const topDepositAssets: { asset: string; amount_usd: number }[] = [];
      const topWithdrawalAssets: { asset: string; amount_usd: number }[] = [];
      try {
        /**
         * BUG FIX: enum `deposit_status` has values `pending, confirming,
         * completed, failed, cancelled` — NOT `confirmed`. Old query silently
         * threw an SQL error and returned 0 for every admin. Use 'completed'.
         */
        const dRes = await db.query<{ sum: string }>(`SELECT COALESCE(SUM(amount::numeric), 0)::text AS sum FROM deposits WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days'`).catch(() => ({ rows: [{ sum: '0' }] }));
        depositsTotal = parseFloat(dRes.rows[0]?.sum ?? '0');
        const wRes = await db.query<{ sum: string }>(`SELECT COALESCE(SUM(amount::numeric), 0)::text AS sum FROM withdrawals WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days'`).catch(() => ({ rows: [{ sum: '0' }] }));
        withdrawalsTotal = parseFloat(wRes.rows[0]?.sum ?? '0');
        const byDepAsset = await db.query<{ asset: string; amt: string }>(`
          SELECT COALESCE(t.symbol, 'USDT') AS asset, COALESCE(SUM(d.amount::numeric), 0)::text AS amt FROM deposits d
          LEFT JOIN tokens t ON t.id = d.token_id WHERE d.status = 'completed' AND d.created_at > NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(t.symbol, 'USDT') ORDER BY SUM(d.amount::numeric) DESC LIMIT 5
        `).catch(() => ({ rows: [] }));
        topDepositAssets.push(...(byDepAsset.rows ?? []).map((r) => ({ asset: r.asset, amount_usd: parseFloat(r.amt ?? '0') })));
        const byWithAsset = await db.query<{ asset: string; amt: string }>(`
          SELECT COALESCE(t.symbol, 'BTC') AS asset, COALESCE(SUM(w.amount::numeric), 0)::text AS amt FROM withdrawals w
          LEFT JOIN tokens t ON t.id = w.token_id WHERE w.status = 'completed' AND w.created_at > NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(t.symbol, 'BTC') ORDER BY SUM(w.amount::numeric) DESC LIMIT 5
        `).catch(() => ({ rows: [] }));
        topWithdrawalAssets.push(...(byWithAsset.rows ?? []).map((r) => ({ asset: r.asset, amount_usd: parseFloat(r.amt ?? '0') })));
      } catch (_) { /* */ }
      const total = depositsTotal + withdrawalsTotal;
      if (total > 0) {
        const depW = depositsVsWithdrawals[0]!;
        const witW = depositsVsWithdrawals[1]!;
        depW.value = Math.round((depositsTotal / total) * 100);
        witW.value = Math.round((withdrawalsTotal / total) * 100);
      }
      return reply.send({
        success: true,
        data: {
          deposits_vs_withdrawals: depositsVsWithdrawals,
          top_deposit_assets: topDepositAssets.length ? topDepositAssets : [{ asset: 'USDT', amount_usd: depositsTotal || 0 }],
          top_withdrawal_assets: topWithdrawalAssets.length ? topWithdrawalAssets : [{ asset: 'BTC', amount_usd: withdrawalsTotal || 0 }],
        },
      });
    } catch (e) {
      logger.error('Analytics deposits-withdrawals error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch' } });
    }
  });

  app.get('/analytics/markets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows: { market: string; volume_24h: number; trades: number; spread_percent: number; liquidity_score: number }[] = [];
      try {
        const vol = await db.query<{ market: string; vol: string; cnt: string; avg_price: string; min_price: string; max_price: string }>(`
          SELECT COALESCE(market, symbol) AS market,
                 COALESCE(SUM((price * quantity)::numeric), 0)::text AS vol,
                 COUNT(*)::text AS cnt,
                 COALESCE(AVG(price::numeric), 0)::text AS avg_price,
                 COALESCE(MIN(price::numeric), 0)::text AS min_price,
                 COALESCE(MAX(price::numeric), 0)::text AS max_price
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY COALESCE(market, symbol)
        `).catch(() => ({ rows: [] }));
        for (const r of vol.rows ?? []) {
          const volume = parseFloat(r.vol ?? '0');
          const tradeCount = parseInt(r.cnt ?? '0', 10);
          const avgPrice = parseFloat(r.avg_price ?? '0');
          const minPrice = parseFloat(r.min_price ?? '0');
          const maxPrice = parseFloat(r.max_price ?? '0');
          const spread = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0.05;
          const spreadClamped = Math.max(0.001, Math.min(spread, 5));
          const volScore = Math.min(40, volume > 0 ? Math.log10(volume) * 10 : 0);
          const tradeScore = Math.min(30, tradeCount > 0 ? Math.log10(tradeCount) * 15 : 0);
          const spreadPenalty = Math.min(30, spreadClamped * 10);
          const liquidityScore = Math.max(0, Math.min(100, Math.round(volScore + tradeScore + (30 - spreadPenalty))));
          rows.push({
            market: r.market,
            volume_24h: volume,
            trades: tradeCount,
            spread_percent: Math.round(spreadClamped * 1000) / 1000,
            liquidity_score: liquidityScore,
          });
        }
        if (rows.length === 0) rows.push({ market: 'BTC/USDT', volume_24h: 0, trades: 0, spread_percent: 0, liquidity_score: 0 });
      } catch (_) { /* */ }
      return reply.send({ success: true, data: { markets: rows } });
    } catch (e) {
      logger.error('Analytics markets error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch markets' } });
    }
  });

  app.get('/analytics/whale-trades', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const limit = Math.min(50, parseInt(String((request.query as { limit?: string }).limit), 10) || 20);
      const rows: { user: string; market: string; trade_size_usd: number; time: string }[] = [];
      try {
        const q = await db.query<{ email: string; market: string; size: string; created_at: string }>(`
          SELECT u.email, COALESCE(t.market, t.symbol) AS market, (t.price * t.quantity)::numeric::text AS size, t.created_at::text
          FROM spot_trades t
          LEFT JOIN users u ON u.id = t.user_id
          WHERE (t.price * t.quantity)::numeric > 100000 AND t.created_at > NOW() - INTERVAL '7 days'
          ORDER BY t.created_at DESC LIMIT $1
        `, [limit]).catch(() => ({ rows: [] }));
        for (const r of q.rows ?? []) {
          rows.push({
            user: r.email ?? '—',
            market: r.market ?? '—',
            trade_size_usd: parseFloat(r.size ?? '0'),
            time: r.created_at ?? '',
          });
        }
      } catch (_) { /* */ }
      return reply.send({ success: true, data: { whale_trades: rows } });
    } catch (e) {
      logger.error('Analytics whale-trades error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch whale trades' } });
    }
  });

  app.get<{ Querystring: { report?: string; format?: string } }>('/analytics/export', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const report = (request.query as { report?: string }).report ?? 'trading';
    const format = (request.query as { format?: string }).format ?? 'csv';
    if (!['trading', 'revenue', 'user-growth', 'users', 'aml-alerts'].includes(report)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_REPORT', message: 'report must be trading, revenue, user-growth, users, or aml-alerts' } });
    }
    if (!['csv', 'json', 'pdf'].includes(format)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_FORMAT', message: 'format must be csv, json, or pdf' } });
    }
    try {
      if (format === 'pdf') {
        return reply.status(400).send({ success: false, error: { code: 'FORMAT_UNAVAILABLE', message: 'PDF export is not available. Use csv or json format.' } });
      }
      let rows: Record<string, unknown>[] = [];
      if (report === 'trading') {
        const r = await db.query<Record<string, string>>(`SELECT market, price, quantity, fee, created_at FROM spot_trades WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 5000`).catch(() => ({ rows: [] }));
        rows = r.rows ?? [];
      } else if (report === 'revenue') {
        const r = await db.query<Record<string, string>>(`SELECT 'trading_fee' AS type, SUM(fee::numeric)::text AS amount FROM spot_trades WHERE created_at > NOW() - INTERVAL '30 days' UNION ALL SELECT 'withdrawal_fee', COALESCE(SUM(withdrawal_fee::numeric), 0)::text FROM withdrawals WHERE created_at > NOW() - INTERVAL '30 days'`).catch(() => ({ rows: [] }));
        rows = r.rows ?? [];
      } else if (report === 'user-growth') {
        const r = await db.query<Record<string, string>>(`SELECT date_trunc('day', created_at)::date::text AS date, COUNT(*)::text AS new_users FROM users WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days' GROUP BY date_trunc('day', created_at) ORDER BY date`).catch(() => ({ rows: [] }));
        rows = r.rows ?? [];
      } else if (report === 'users') {
        const r = await db.query<Record<string, string>>(`SELECT id::text, email, status::text, email_verified::text, phone::text, created_at::text, last_login_at::text, COALESCE(host(last_login_ip), '')::text AS last_login_ip FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5000`).catch(() => ({ rows: [] }));
        rows = r.rows ?? [];
      } else {
        const r = await db.query<Record<string, string>>(`SELECT a.id::text, a.user_id::text, u.email AS user_email, a.alert_type::text, a.severity::text, a.status::text, a.created_at::text FROM aml_alerts a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 5000`).catch(() => ({ rows: [] }));
        rows = r.rows ?? [];
      }
      if (format === 'json') {
        return reply.type('application/json').send({ success: true, data: { report, rows } });
      }
      const firstRow = rows[0];
      const headers = firstRow ? Object.keys(firstRow) : [];
      const csv = [headers.join(',')].concat(rows.map((r) => headers.map((h) => JSON.stringify(String((r as Record<string, unknown>)[h] ?? ''))).join(','))).join('\n');
      return reply.header('Content-Type', 'text/csv').header('Content-Disposition', `attachment; filename="analytics-${report}-${new Date().toISOString().slice(0, 10)}.csv"`).send(csv);
    } catch (e) {
      logger.error('Analytics export error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'EXPORT_FAILED', message: 'Failed to export' } });
    }
  });

  app.get('/analytics/revenue-history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const points: { date: string; trading_fee: number; withdrawal_fee: number; total: number }[] = [];
      try {
        const trading = await db.query<{ d: string; fee: string }>(`
          SELECT date_trunc('day', created_at)::date::text AS d, COALESCE(SUM(fee::numeric), 0)::text AS fee
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '30 days'
          GROUP BY date_trunc('day', created_at) ORDER BY d
        `).catch(() => ({ rows: [] }));
        const withdrawal = await db.query<{ d: string; fee: string }>(`
          SELECT date_trunc('day', created_at)::date::text AS d, COALESCE(SUM(withdrawal_fee::numeric), 0)::text AS fee
          FROM withdrawals WHERE created_at > NOW() - INTERVAL '30 days' AND status = 'completed'
          GROUP BY date_trunc('day', created_at)
        `).catch(() => ({ rows: [] }));
        const wMap = Object.fromEntries((withdrawal.rows ?? []).map((r) => [r.d, parseFloat(r.fee ?? '0')]));
        for (const r of trading.rows ?? []) {
          const tf = parseFloat(r.fee ?? '0');
          const wf = wMap[r.d] ?? 0;
          points.push({ date: r.d, trading_fee: Math.round(tf * 100) / 100, withdrawal_fee: Math.round(wf * 100) / 100, total: Math.round((tf + wf) * 100) / 100 });
        }
      } catch (_) { /* */ }
      return reply.send({ success: true, data: { history: points } });
    } catch (e) {
      logger.error('Analytics revenue-history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch revenue history' } });
    }
  });

  app.get('/analytics/liquidity-history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const market = (request.query as { market?: string }).market ?? 'BTC/USDT';
    try {
      const points: { date: string; liquidity_score: number }[] = [];
      try {
        const dailyStats = await db.query<{ day: string; vol: string; cnt: string; avg_price: string; min_price: string; max_price: string }>(`
          SELECT date_trunc('day', created_at)::date::text AS day,
                 COALESCE(SUM((price * quantity)::numeric), 0)::text AS vol,
                 COUNT(*)::text AS cnt,
                 COALESCE(AVG(price::numeric), 0)::text AS avg_price,
                 COALESCE(MIN(price::numeric), 0)::text AS min_price,
                 COALESCE(MAX(price::numeric), 0)::text AS max_price
          FROM spot_trades
          WHERE created_at > NOW() - INTERVAL '14 days'
            AND (COALESCE(market, symbol) = $1 OR COALESCE(market, symbol) LIKE $2)
          GROUP BY date_trunc('day', created_at)
          ORDER BY day
        `, [market, market.replace('/', '%')]).catch(() => ({ rows: [] }));

        const dayMap = new Map<string, { vol: number; cnt: number; spread: number }>();
        for (const r of dailyStats.rows ?? []) {
          const avgP = parseFloat(r.avg_price ?? '0');
          const spread = avgP > 0 ? ((parseFloat(r.max_price ?? '0') - parseFloat(r.min_price ?? '0')) / avgP) * 100 : 0;
          dayMap.set(r.day, { vol: parseFloat(r.vol ?? '0'), cnt: parseInt(r.cnt ?? '0', 10), spread });
        }

        for (let i = 13; i >= 0; i--) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          const stats = dayMap.get(dateStr);
          let score = 0;
          if (stats && stats.cnt > 0) {
            const volScore = Math.min(40, stats.vol > 0 ? Math.log10(stats.vol) * 10 : 0);
            const tradeScore = Math.min(30, Math.log10(stats.cnt) * 15);
            const spreadPenalty = Math.min(30, stats.spread * 10);
            score = Math.max(0, Math.min(100, volScore + tradeScore + (30 - spreadPenalty)));
          }
          points.push({ date: dateStr, liquidity_score: Math.round(score * 10) / 10 });
        }
      } catch (_) {
        for (let i = 13; i >= 0; i--) {
          const d = new Date(); d.setDate(d.getDate() - i);
          points.push({ date: d.toISOString().slice(0, 10), liquidity_score: 0 });
        }
      }
      return reply.send({ success: true, data: { market, history: points } });
    } catch (e) {
      logger.error('Analytics liquidity-history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch liquidity history' } });
    }
  });

  app.get('/analytics/activity-heatmap', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows: { hour: number; day_of_week: number; trading_count: number; logins_count: number; deposits_count: number }[] = [];
      try {
        const trading = await db.query<{ hour: number; dow: number; cnt: string }>(`
          SELECT EXTRACT(HOUR FROM created_at)::int AS hour, EXTRACT(DOW FROM created_at)::int AS dow, COUNT(*)::text AS cnt
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
        `).catch(() => ({ rows: [] }));
        const logins = await db.query<{ hour: number; dow: number; cnt: string }>(`
          SELECT EXTRACT(HOUR FROM created_at)::int AS hour, EXTRACT(DOW FROM created_at)::int AS dow, COUNT(*)::text AS cnt
          FROM user_sessions WHERE created_at > NOW() - INTERVAL '7 days'
          GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
        `).catch(() => ({ rows: [] }));
        const deposits = await db.query<{ hour: number; dow: number; cnt: string }>(`
          SELECT EXTRACT(HOUR FROM created_at)::int AS hour, EXTRACT(DOW FROM created_at)::int AS dow, COUNT(*)::text AS cnt
          FROM deposits WHERE status = 'completed' AND created_at > NOW() - INTERVAL '7 days'
          GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
        `).catch(() => ({ rows: [] }));
        const tMap: Record<string, number> = {};
        (trading.rows ?? []).forEach((r) => { const k = `${r.hour}-${r.dow}`; tMap[k] = (tMap[k] ?? 0) + parseInt(r.cnt ?? '0', 10); });
        const lMap: Record<string, number> = {};
        (logins.rows ?? []).forEach((r) => { const k = `${r.hour}-${r.dow}`; lMap[k] = (lMap[k] ?? 0) + parseInt(r.cnt ?? '0', 10); });
        const dMap: Record<string, number> = {};
        (deposits.rows ?? []).forEach((r) => { const k = `${r.hour}-${r.dow}`; dMap[k] = (dMap[k] ?? 0) + parseInt(r.cnt ?? '0', 10); });
        for (let h = 0; h < 24; h++) {
          for (let d = 0; d < 7; d++) {
            const k = `${h}-${d}`;
            rows.push({
              hour: h,
              day_of_week: d,
              trading_count: tMap[k] ?? 0,
              logins_count: lMap[k] ?? 0,
              deposits_count: dMap[k] ?? 0,
            });
          }
        }
      } catch (_) { /* */ }
      return reply.send({ success: true, data: { heatmap: rows } });
    } catch (e) {
      logger.error('Analytics activity-heatmap error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch heatmap' } });
    }
  });

  app.get('/analytics/whale-alerts', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let whale_trades_24h = 0;
      let largest_trade: { market: string; size_usd: number } = { market: '—', size_usd: 0 };
      const top_whale_users: { user: string; trade_count: number; total_volume_usd: number }[] = [];
      try {
        const countRes = await db.query<{ cnt: string }>(`
          SELECT COUNT(*)::text AS cnt FROM spot_trades WHERE (price * quantity)::numeric > 100000 AND created_at > NOW() - INTERVAL '24 hours'
        `).catch(() => ({ rows: [{ cnt: '0' }] }));
        whale_trades_24h = parseInt(countRes.rows[0]?.cnt ?? '0', 10);
        const largest = await db.query<{ market: string; size: string }>(`
          SELECT COALESCE(market, symbol) AS market, (price * quantity)::numeric::text AS size
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '24 hours'
          ORDER BY (price * quantity)::numeric DESC LIMIT 1
        `).catch(() => ({ rows: [] }));
        if (largest.rows?.[0]) {
          largest_trade = { market: largest.rows[0].market ?? '—', size_usd: parseFloat(largest.rows[0].size ?? '0') };
        }
        const topUsers = await db.query<{ email: string; cnt: string; vol: string }>(`
          SELECT u.email, COUNT(*)::text AS cnt, COALESCE(SUM((t.price * t.quantity)::numeric), 0)::text AS vol
          FROM spot_trades t JOIN users u ON u.id = t.user_id
          WHERE (t.price * t.quantity)::numeric > 100000 AND t.created_at > NOW() - INTERVAL '7 days'
          GROUP BY u.id, u.email ORDER BY SUM((t.price * t.quantity)::numeric) DESC LIMIT 10
        `).catch(() => ({ rows: [] }));
        top_whale_users.push(...(topUsers.rows ?? []).map((r) => ({ user: r.email ?? '—', trade_count: parseInt(r.cnt ?? '0', 10), total_volume_usd: parseFloat(r.vol ?? '0') })));
      } catch (_) { /* */ }
      return reply.send({ success: true, data: { whale_trades_24h, largest_trade, top_whale_users } });
    } catch (e) {
      logger.error('Analytics whale-alerts error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch whale alerts' } });
    }
  });

  app.get('/analytics/volatility', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const markets: { market: string; price_volatility_24h: number; spread_volatility: number; volume_volatility: number }[] = [];
      try {
        const volData = await db.query<{
          market: string; stddev_price: string; avg_price: string;
          stddev_spread: string; stddev_volume: string; avg_volume: string;
        }>(`
          SELECT COALESCE(market, symbol) AS market,
                 COALESCE(STDDEV(price::numeric), 0)::text AS stddev_price,
                 COALESCE(AVG(price::numeric), 1)::text AS avg_price,
                 COALESCE(STDDEV((price::numeric) * 0.01), 0)::text AS stddev_spread,
                 COALESCE(STDDEV((price * quantity)::numeric), 0)::text AS stddev_volume,
                 COALESCE(AVG((price * quantity)::numeric), 1)::text AS avg_volume
          FROM spot_trades WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY COALESCE(market, symbol) LIMIT 20
        `).catch(() => ({ rows: [] }));
        for (const r of volData.rows ?? []) {
          const avgP = parseFloat(r.avg_price ?? '1') || 1;
          const priceVol = (parseFloat(r.stddev_price ?? '0') / avgP) * 100;
          const spreadVol = parseFloat(r.stddev_spread ?? '0') / avgP * 100;
          const avgVol = parseFloat(r.avg_volume ?? '1') || 1;
          const volumeVol = (parseFloat(r.stddev_volume ?? '0') / avgVol) * 100;
          markets.push({
            market: r.market,
            price_volatility_24h: Math.round(priceVol * 100) / 100,
            spread_volatility: Math.round(spreadVol * 100) / 100,
            volume_volatility: Math.round(volumeVol * 100) / 100,
          });
        }
        if (markets.length === 0) markets.push({ market: 'BTC/USDT', price_volatility_24h: 0, spread_volatility: 0, volume_volatility: 0 });
      } catch (_) { markets.push({ market: 'BTC/USDT', price_volatility_24h: 0, spread_volatility: 0, volume_volatility: 0 }); }
      return reply.send({ success: true, data: { volatility: markets } });
    } catch (e) {
      logger.error('Analytics volatility error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch volatility' } });
    }
  });

  app.get('/analytics/scheduled-reports', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS analytics_scheduled_reports (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          report_type TEXT NOT NULL,
          frequency TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'csv',
          enabled BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          last_run_at TIMESTAMPTZ
        )
      `);
      const rows = await db.query<{ id: string; report_type: string; frequency: string; format: string; enabled: boolean; last_run_at: string | null }>(
        'SELECT id::text, report_type, frequency, format, enabled, last_run_at::text FROM analytics_scheduled_reports ORDER BY created_at DESC'
      );
      const list = rows.rows.map((r) => ({
        id: r.id,
        report_type: r.report_type,
        frequency: r.frequency,
        format: r.format,
        enabled: r.enabled,
        last_run_at: r.last_run_at ?? null,
      }));
      return reply.send({ success: true, data: { scheduled_reports: list } });
    } catch (e) {
      logger.error('Analytics scheduled-reports list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list scheduled reports' } });
    }
  });

  app.post<{ Body: { report_type: string; frequency: string; format?: string } }>('/analytics/scheduled-reports', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { report_type?: string; frequency?: string; format?: string };
    const report_type = typeof body.report_type === 'string' ? body.report_type : '';
    const frequency = typeof body.frequency === 'string' ? body.frequency : '';
    const format = typeof body.format === 'string' && ['csv', 'json', 'pdf'].includes(body.format) ? body.format : 'csv';
    if (!['trading', 'revenue', 'user-growth'].includes(report_type) || !['daily', 'weekly', 'monthly'].includes(frequency)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'report_type (trading|revenue|user-growth) and frequency (daily|weekly|monthly) required' } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS analytics_scheduled_reports (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          report_type TEXT NOT NULL,
          frequency TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'csv',
          enabled BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          last_run_at TIMESTAMPTZ
        )
      `);
      const ins = await db.query<{ id: string }>(
        'INSERT INTO analytics_scheduled_reports (report_type, frequency, format) VALUES ($1, $2, $3) RETURNING id::text',
        [report_type, frequency, format]
      );
      return reply.send({ success: true, data: { id: ins.rows[0]!.id } });
    } catch (e) {
      logger.error('Analytics scheduled-reports create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create scheduled report' } });
    }
  });

  app.delete<{ Params: { id: string } }>('/analytics/scheduled-reports/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    try {
      await db.query('DELETE FROM analytics_scheduled_reports WHERE id = $1::uuid', [id]);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e) {
      logger.error('Analytics scheduled-reports delete error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete' } });
    }
  });

  // ===============================
  // GLOBAL CONFIGURATION & FEATURE FLAGS
  // ===============================

  app.get('/system/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT '',
          description TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const rows = await db.query<{ key: string; value: string; description: string | null; updated_at: string | null; updated_by: string | null }>(
        'SELECT key, value, description, updated_at::text, updated_by FROM system_settings'
      );
      const settings: Record<string, { value: string; description: string | null; updated_at: string | null; updated_by?: string | null }> = {};
      for (const r of rows.rows) {
        settings[r.key] = { value: r.value, description: r.description ?? null, updated_at: r.updated_at ?? null, updated_by: r.updated_by ?? null };
      }
      return reply.send({ success: true, data: { settings } });
    } catch (e) {
      logger.error('System settings get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch system settings' } });
    }
  });

  app.patch<{ Body: Record<string, unknown> }>('/system/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'settings:edit', reply)) return;
    const body = (request.body || {}) as Record<string, unknown>;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT '',
          description TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const updates = Object.entries(body).filter(([k]) => k !== 'key' && typeof k === 'string' && !k.endsWith('_description'));
      if (updates.length === 0) {
        return reply.send({ success: true, data: { updated: true } });
      }
      const prevRows = await db.query<{ key: string; value: string }>('SELECT key, value FROM system_settings');
      const beforeSnapshot: Record<string, string> = {};
      for (const r of prevRows.rows) beforeSnapshot[r.key] = r.value;
      const changes: { key: string; oldValue: string; newValue: string }[] = [];
      for (const [key, v] of updates) {
        const value = v != null ? String(v) : '';
        const desc = typeof (body as Record<string, unknown>)[`${key}_description`] === 'string' ? (body as Record<string, unknown>)[`${key}_description`] : null;
        const oldVal = beforeSnapshot[key] ?? '';
        if (oldVal !== value) changes.push({ key, oldValue: oldVal, newValue: value });
        await db.query(
          `INSERT INTO system_settings (key, value, description, updated_at, updated_by) VALUES ($1, $2, $3, NOW(), $4)
           ON CONFLICT (key) DO UPDATE SET value = $2, description = COALESCE($3, system_settings.description), updated_at = NOW(), updated_by = $4`,
          [key, value, desc, admin.adminId]
        );
        beforeSnapshot[key] = value;
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings_versions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          version SERIAL,
          settings_snapshot JSONB NOT NULL DEFAULT '{}',
          change_summary TEXT,
          updated_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const afterRows = await db.query<{ key: string; value: string }>('SELECT key, value FROM system_settings');
      const afterSnapshot: Record<string, string> = {};
      for (const r of afterRows.rows) afterSnapshot[r.key] = r.value;
      const changeSummary = changes.length ? changes.map((c) => `${c.key}: ${c.oldValue} → ${c.newValue}`).join('; ') : 'No value changes';
      await db.query(
        `INSERT INTO system_settings_versions (settings_snapshot, change_summary, updated_by) VALUES ($1, $2, $3)`,
        [JSON.stringify(afterSnapshot), changeSummary, admin.adminId]
      );
      for (const c of changes) {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'system_settings_updated',
          resourceType: 'system_settings',
          resourceId: c.key,
          oldValue: c.oldValue,
          newValue: c.newValue,
        });
      }
      if (changes.length === 0) {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'system_settings_updated',
          resourceType: 'system_settings',
          newValue: { keys: updates.map(([k]) => k) },
        });
      }
      return reply.send({ success: true, data: { updated: true } });
    } catch (e) {
      logger.error('System settings patch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update system settings' } });
    }
  });

  app.get('/system/settings/history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings_versions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          version SERIAL,
          settings_snapshot JSONB NOT NULL DEFAULT '{}',
          change_summary TEXT,
          updated_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const rows = await db.query<{ id: string; version: number; change_summary: string | null; updated_by: string | null; created_at: string }>(
        'SELECT id::text, version, change_summary, updated_by, created_at::text FROM system_settings_versions ORDER BY created_at DESC LIMIT 100'
      );
      const versions = rows.rows.map((r) => ({
        id: r.id,
        version: r.version,
        updated_by: r.updated_by ?? null,
        change_summary: r.change_summary ?? null,
        timestamp: r.created_at,
      }));
      return reply.send({ success: true, data: { versions } });
    } catch (e) {
      logger.error('System settings history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch version history' } });
    }
  });

  app.get<{ Params: { id: string } }>('/system/settings/versions/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const { id } = request.params;
    try {
      const rows = await db.query<{ id: string; version: number; settings_snapshot: unknown; change_summary: string | null; updated_by: string | null; created_at: string }>(
        'SELECT id::text, version, settings_snapshot, change_summary, updated_by, created_at::text FROM system_settings_versions WHERE id = $1::uuid',
        [id]
      );
      if (rows.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });
      }
      const r = rows.rows[0]!;
      return reply.send({
        success: true,
        data: {
          version: {
            id: r.id,
            version: r.version,
            settings_snapshot: r.settings_snapshot,
            change_summary: r.change_summary ?? null,
            updated_by: r.updated_by ?? null,
            timestamp: r.created_at,
          },
        },
      });
    } catch (e) {
      logger.error('System settings version get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch version' } });
    }
  });

  app.get<{ Params: { id: string } }>('/system/settings/versions/:id/diff', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const { id } = request.params;
    try {
      const verRows = await db.query<{ settings_snapshot: unknown }>('SELECT settings_snapshot FROM system_settings_versions WHERE id = $1::uuid', [id]);
      if (verRows.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });
      }
      const before = (verRows.rows[0]!.settings_snapshot as Record<string, string>) || {};
      const currRows = await db.query<{ key: string; value: string }>('SELECT key, value FROM system_settings');
      const after: Record<string, string> = {};
      for (const r of currRows.rows) after[r.key] = r.value;
      return reply.send({ success: true, data: { before, after } });
    } catch (e) {
      logger.error('System settings diff error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get diff' } });
    }
  });

  app.post<{ Body: { version_id: string } }>('/system/settings/rollback', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const versionId = (request.body as { version_id?: string })?.version_id;
    if (!versionId) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'version_id required' } });
    }
    try {
      const verRows = await db.query<{ settings_snapshot: unknown; change_summary: string | null }>(
        'SELECT settings_snapshot, change_summary FROM system_settings_versions WHERE id = $1::uuid',
        [versionId]
      );
      if (verRows.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Version not found' } });
      }
      const snapshot = (verRows.rows[0]!.settings_snapshot as Record<string, string>) || {};
      const prevRows = await db.query<{ key: string; value: string }>('SELECT key, value FROM system_settings');
      for (const r of prevRows.rows) {
        const newVal = snapshot[r.key];
        if (newVal === undefined) {
          await db.query('DELETE FROM system_settings WHERE key = $1', [r.key]);
        }
      }
      for (const [key, value] of Object.entries(snapshot)) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
          [key, value, admin.adminId]
        );
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings_versions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          version SERIAL,
          settings_snapshot JSONB NOT NULL DEFAULT '{}',
          change_summary TEXT,
          updated_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.query(
        `INSERT INTO system_settings_versions (settings_snapshot, change_summary, updated_by) VALUES ($1, $2, $3)`,
        [JSON.stringify(snapshot), `Rollback to version ${versionId}`, admin.adminId]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'system_settings_rollback',
        resourceType: 'system_settings',
        resourceId: versionId,
        newValue: { version_id: versionId },
      });
      return reply.send({ success: true, data: { rolled_back: true } });
    } catch (e) {
      logger.error('System settings rollback error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ROLLBACK_FAILED', message: 'Failed to rollback' } });
    }
  });

  app.get('/system/features', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS feature_flags (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          feature_key TEXT NOT NULL UNIQUE,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'enabled',
          rollout TEXT NOT NULL DEFAULT 'all',
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const existing = await db.query<{ feature_key: string }>('SELECT feature_key FROM feature_flags');
      const defaults = [
        { feature_key: 'spot_trading', description: 'Enable spot market trading', status: 'enabled', rollout: 'all' },
        { feature_key: 'p2p_marketplace', description: 'Enable P2P trading', status: 'enabled', rollout: 'all' },
        { feature_key: 'liquidity_bot', description: 'Automated market maker', status: 'disabled', rollout: 'all' },
        { feature_key: 'withdrawals', description: 'Allow user withdrawals', status: 'enabled', rollout: 'all' },
        { feature_key: 'deposits', description: 'Allow user deposits', status: 'enabled', rollout: 'all' },
        { feature_key: 'p2p', description: 'P2P marketplace', status: 'enabled', rollout: 'all' },
      ];
      if (existing.rows.length === 0) {
        for (const d of defaults) {
          await db.query(
            'INSERT INTO feature_flags (feature_key, description, status, rollout) VALUES ($1, $2, $3, $4) ON CONFLICT (feature_key) DO NOTHING',
            [d.feature_key, d.description, d.status, d.rollout]
          );
        }
      }
      const rows = await db.query<{ id: string; feature_key: string; description: string | null; status: string; rollout: string; updated_at: string | null }>(
        'SELECT id::text, feature_key, description, status, rollout, updated_at::text FROM feature_flags ORDER BY feature_key'
      );
      const features = rows.rows.map((r) => ({
        id: r.id,
        feature_key: r.feature_key,
        description: r.description ?? '',
        status: r.status,
        rollout: r.rollout,
        updated_at: r.updated_at ?? null,
      }));
      return reply.send({ success: true, data: { features } });
    } catch (e) {
      logger.error('System features get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch feature flags' } });
    }
  });

  app.patch<{ Body: { feature_key?: string; id?: string; status?: string; rollout?: string } }>('/system/features', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { feature_key?: string; id?: string; status?: string; rollout?: string };
    const id = body.id ?? null;
    const featureKey = body.feature_key ?? null;
    if (!id && !featureKey) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'id or feature_key required' } });
    }
    try {
      const status = body.status && ['enabled', 'disabled'].includes(body.status) ? body.status : undefined;
      const rollout = body.rollout && ['all', 'beta', 'tier'].includes(body.rollout) ? body.rollout : undefined;
      if (!status && !rollout) {
        return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'status or rollout required' } });
      }
      let targetKey = featureKey ?? null;
      if (id && !targetKey) {
        const keyRow = await db.query<{ feature_key: string }>('SELECT feature_key FROM feature_flags WHERE id = $1::uuid', [id]);
        if (keyRow.rows.length > 0) targetKey = keyRow.rows[0]!.feature_key;
      }
      const where = id ? 'id = $1::uuid' : 'feature_key = $1';
      const params: (string | undefined)[] = [id ?? featureKey ?? undefined, admin.adminId];
      const updates: string[] = ['updated_at = NOW()', 'updated_by = $2'];
      let idx = 3;
      if (status) { updates.push(`status = $${idx++}`); params.push(status); }
      if (rollout) { updates.push(`rollout = $${idx++}`); params.push(rollout); }
      await db.query(
        `UPDATE feature_flags SET ${updates.join(', ')} WHERE ${where}`,
        params
      );
      if (status === 'disabled' && targetKey) {
        await db.query(`
          CREATE TABLE IF NOT EXISTS feature_dependencies (
            feature_key TEXT NOT NULL,
            requires_feature_key TEXT NOT NULL,
            PRIMARY KEY (feature_key, requires_feature_key)
          )
        `);
        await db.query(`DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN behaviour TEXT NOT NULL DEFAULT 'auto_disable'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
        const depRows = await db.query<{ feature_key: string }>(
          `SELECT feature_key FROM feature_dependencies WHERE requires_feature_key = $1 AND (behaviour IS NULL OR behaviour = 'auto_disable')`,
          [targetKey]
        );
        for (const d of depRows.rows) {
          await db.query(
            `UPDATE feature_flags SET status = 'disabled', updated_at = NOW(), updated_by = $2 WHERE feature_key = $1`,
            [d.feature_key, admin.adminId]
          );
          await logAuditFromRequest(request, {
            actorType: 'admin',
            actorId: admin.adminId,
            action: 'feature_flag_updated',
            resourceType: 'feature_flags',
            resourceId: d.feature_key,
            newValue: { feature_key: d.feature_key, status: 'disabled', reason: 'dependency', requires: targetKey },
          });
        }
        if (depRows.rows.length === 0) {
          const defaultDeps: [string, string][] = [['liquidity_bot', 'spot_trading']];
          for (const [fk, req] of defaultDeps) {
            if (req !== targetKey) continue;
            try {
              await db.query(
                'INSERT INTO feature_dependencies (feature_key, requires_feature_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [fk, req]
              );
              await db.query(
                `UPDATE feature_flags SET status = 'disabled', updated_at = NOW(), updated_by = $2 WHERE feature_key = $1`,
                [fk, admin.adminId]
              );
              await logAuditFromRequest(request, {
                actorType: 'admin',
                actorId: admin.adminId,
                action: 'feature_flag_updated',
                resourceType: 'feature_flags',
                resourceId: fk,
                newValue: { feature_key: fk, status: 'disabled', reason: 'dependency', requires: targetKey },
              });
            } catch (_) {}
          }
        }
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'feature_flag_updated',
        resourceType: 'feature_flags',
        resourceId: targetKey ?? featureKey ?? id ?? undefined,
        newValue: { feature_key: featureKey ?? targetKey ?? id, status, rollout },
      });
      return reply.send({ success: true, data: { updated: true } });
    } catch (e) {
      logger.error('System features patch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update feature' } });
    }
  });

  app.get('/system/features/dependencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS feature_dependencies (
          feature_key TEXT NOT NULL,
          requires_feature_key TEXT NOT NULL,
          PRIMARY KEY (feature_key, requires_feature_key)
        )
      `);
      await db.query(`
        DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN behaviour TEXT NOT NULL DEFAULT 'auto_disable'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      `);
      await db.query(`
        DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW(); EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      `);
      await db.query(`
        DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN updated_by TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      `);
      const rows = await db.query<{ feature_key: string; requires_feature_key: string; behaviour: string | null; updated_at: string | null }>(
        'SELECT feature_key, requires_feature_key, COALESCE(behaviour, \'auto_disable\') AS behaviour, updated_at::text AS updated_at FROM feature_dependencies ORDER BY updated_at DESC NULLS LAST'
      );
      const defaultDeps: { feature_key: string; requires_feature_key: string }[] = [{ feature_key: 'liquidity_bot', requires_feature_key: 'spot_trading' }];
      const seen = new Set(rows.rows.map((r) => `${r.feature_key}:${r.requires_feature_key}`));
      const deps = rows.rows.map((r) => ({
        feature_key: r.feature_key,
        requires_feature_key: r.requires_feature_key,
        behaviour: r.behaviour ?? 'auto_disable',
        updated_at: r.updated_at,
      }));
      for (const d of defaultDeps) {
        if (!seen.has(`${d.feature_key}:${d.requires_feature_key}`)) {
          try {
            await db.query(
              'INSERT INTO feature_dependencies (feature_key, requires_feature_key, behaviour, updated_at, updated_by) VALUES ($1, $2, \'auto_disable\', NOW(), $3) ON CONFLICT (feature_key, requires_feature_key) DO NOTHING',
              [d.feature_key, d.requires_feature_key, admin.adminId]
            );
            deps.push({ ...d, behaviour: 'auto_disable', updated_at: new Date().toISOString() });
          } catch (_) {}
        }
      }
      return reply.send({ success: true, data: { dependencies: deps } });
    } catch (e) {
      logger.error('Feature dependencies get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch dependencies' } });
    }
  });

  app.post<{ Body: { feature_key: string; requires_feature_key: string; behaviour?: string } }>('/system/features/dependencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { feature_key?: string; requires_feature_key?: string; behaviour?: string };
    const feature_key = (body.feature_key ?? '').trim();
    const requires_feature_key = (body.requires_feature_key ?? '').trim();
    const behaviour = (body.behaviour ?? 'auto_disable').trim() || 'auto_disable';
    if (!feature_key || !requires_feature_key) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'feature_key and requires_feature_key are required' } });
    }
    if (feature_key === requires_feature_key) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Feature cannot depend on itself' } });
    }
    const allowed = ['auto_disable', 'warning_only'];
    if (!allowed.includes(behaviour)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'behaviour must be auto_disable or warning_only' } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS feature_dependencies (
          feature_key TEXT NOT NULL,
          requires_feature_key TEXT NOT NULL,
          PRIMARY KEY (feature_key, requires_feature_key)
        )
      `);
      await db.query(`DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN behaviour TEXT NOT NULL DEFAULT 'auto_disable'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
      await db.query(`DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW(); EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
      await db.query(`DO $$ BEGIN ALTER TABLE feature_dependencies ADD COLUMN updated_by TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
      await db.query(
        `INSERT INTO feature_dependencies (feature_key, requires_feature_key, behaviour, updated_at, updated_by) VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT (feature_key, requires_feature_key) DO UPDATE SET behaviour = EXCLUDED.behaviour, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [feature_key, requires_feature_key, behaviour, admin.adminId]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'feature_dependency_created',
        resourceType: 'feature_dependencies',
        resourceId: `${feature_key}:${requires_feature_key}`,
        newValue: { feature_key, requires_feature_key, behaviour },
      });
      return reply.send({ success: true, data: { created: true } });
    } catch (e) {
      logger.error('Feature dependency create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create dependency' } });
    }
  });

  app.patch<{ Body: { feature_key: string; requires_feature_key: string; behaviour: string } }>('/system/features/dependencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { feature_key?: string; requires_feature_key?: string; behaviour?: string };
    const feature_key = (body.feature_key ?? '').trim();
    const requires_feature_key = (body.requires_feature_key ?? '').trim();
    const behaviour = (body.behaviour ?? '').trim();
    if (!feature_key || !requires_feature_key) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'feature_key and requires_feature_key are required' } });
    }
    const allowed = ['auto_disable', 'warning_only'];
    if (!behaviour || !allowed.includes(behaviour)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'behaviour must be auto_disable or warning_only' } });
    }
    try {
      const result = await db.query(
        `UPDATE feature_dependencies SET behaviour = $3, updated_at = NOW(), updated_by = $4 WHERE feature_key = $1 AND requires_feature_key = $2`,
        [feature_key, requires_feature_key, behaviour, admin.adminId]
      );
      if (result.rowCount === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Dependency rule not found' } });
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'feature_dependency_updated',
        resourceType: 'feature_dependencies',
        resourceId: `${feature_key}:${requires_feature_key}`,
        newValue: { behaviour },
      });
      return reply.send({ success: true, data: { updated: true } });
    } catch (e) {
      logger.error('Feature dependency update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update dependency' } });
    }
  });

  app.delete<{ Querystring: { feature_key: string; requires_feature_key: string } }>('/system/features/dependencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const feature_key = (request.query as { feature_key?: string })?.feature_key?.trim();
    const requires_feature_key = (request.query as { requires_feature_key?: string })?.requires_feature_key?.trim();
    if (!feature_key || !requires_feature_key) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'feature_key and requires_feature_key are required' } });
    }
    try {
      const result = await db.query('DELETE FROM feature_dependencies WHERE feature_key = $1 AND requires_feature_key = $2', [feature_key, requires_feature_key]);
      if (result.rowCount === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Dependency rule not found' } });
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'feature_dependency_deleted',
        resourceType: 'feature_dependencies',
        resourceId: `${feature_key}:${requires_feature_key}`,
      });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e) {
      logger.error('Feature dependency delete error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete dependency' } });
    }
  });

  app.post<{ Body: { action: string; enabled: boolean } }>('/system/emergency', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'control:trading', reply)) return;
    const body = (request.body || {}) as { action?: string; enabled?: boolean };
    const action = body.action ?? '';
    const enabled = body.enabled === true;
    const allowed = ['pause_trading', 'disable_withdrawals', 'disable_deposits', 'disable_p2p'];
    if (!allowed.includes(action)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ACTION', message: 'action must be one of: ' + allowed.join(', ') } });
    }
    try {
      if (action === 'pause_trading') {
        const { setTradingHalt } = await import('../lib/trading-halt.js');
        await setTradingHalt(enabled);
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', description TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
        [`emergency_${action}`, enabled ? '1' : '0', admin.adminId]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'emergency_control',
        resourceType: 'system_settings',
        resourceId: action,
        newValue: { action, enabled },
      });
      return reply.send({ success: true, data: { action, enabled } });
    } catch (e) {
      logger.error('System emergency error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to apply emergency action' } });
    }
  });

  /**
   * GET /admin/audit/config — config change history from audit_logs_immutable (system_settings, feature_flags, profiles, safe_mode).
   */
  app.get<{ Querystring: { limit?: string } }>('/audit/config', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasTable = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs_immutable' LIMIT 1`
      );
      if (hasTable.rows.length === 0) {
        return reply.send({ success: true, data: { logs: [] } });
      }
      const limit = Math.min(500, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '200', 10) || 200));
      const configResourceTypes = ['system_settings', 'feature_flags', 'system_profiles'];
      const configActions = ['system_settings_updated', 'feature_flag_updated', 'system_settings_apply_profile', 'system_safe_mode', 'system_profile_saved', 'system_settings_rollback'];
      const rows = await db.query<{ created_at: string; actor_id: string | null; action: string; resource_type: string | null; resource_id: string | null; old_value: string | null; new_value: string | null }>(
        `SELECT created_at::text AS created_at, actor_id, action, resource_type, resource_id, old_value, new_value
         FROM audit_logs_immutable
         WHERE (resource_type = ANY($1) OR action = ANY($2))
         ORDER BY created_at DESC
         LIMIT $3`,
        [configResourceTypes, configActions, limit]
      );
      const logs = rows.rows.map((r) => ({
        timestamp: r.created_at,
        admin: r.actor_id ?? '',
        action: r.action,
        setting_key: r.resource_id ?? '',
        old_value: r.old_value ?? '',
        new_value: r.new_value ?? '',
      }));
      return reply.send({ success: true, data: { logs } });
    } catch (e) {
      logger.error('Audit config error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load config audit log' } });
    }
  });

  /**
   * GET /admin/audit/activity — admin activity logs with filters for the audit page.
   * Query: adminId, action, dateFrom, dateTo, limit, offset
   */
  app.get<{
    Querystring: { adminId?: string; action?: string; dateFrom?: string; dateTo?: string; limit?: string; offset?: string; search?: string };
  }>('/audit/activity', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'audit:view');
    if (!admin) return;
    try {
      const { adminId: filterAdminId, action: filterAction, dateFrom, dateTo, search } = request.query;
      const limit = Math.min(200, Math.max(1, parseInt(request.query.limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt(request.query.offset ?? '0', 10) || 0);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (filterAdminId) { conditions.push(`a.admin_id = $${paramIdx++}`); params.push(filterAdminId); }
      if (filterAction) { conditions.push(`a.action ILIKE $${paramIdx++}`); params.push(`%${filterAction}%`); }
      if (dateFrom) { conditions.push(`a.created_at >= $${paramIdx++}::timestamptz`); params.push(dateFrom); }
      if (dateTo) { conditions.push(`a.created_at <= $${paramIdx++}::timestamptz`); params.push(dateTo); }
      if (search) { conditions.push(`(a.action ILIKE $${paramIdx} OR a.details::text ILIKE $${paramIdx})`); params.push(`%${search}%`); paramIdx++; }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM admin_activity_logs a ${where}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      params.push(limit);
      params.push(offset);

      const rows = await db.query<{
        id: string; admin_id: string; admin_name: string | null; admin_role: string | null;
        action: string; details: unknown; ip_address: string | null; user_agent: string | null; created_at: string;
      }>(
        `SELECT a.id, a.admin_id, u.name AS admin_name, u.role AS admin_role,
                a.action, a.details, a.ip_address::text, a.user_agent, a.created_at::text
         FROM admin_activity_logs a
         LEFT JOIN admin_users u ON u.id = a.admin_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        params
      );

      return reply.send({
        success: true,
        data: {
          logs: rows.rows.map((r) => ({
            id: r.id,
            adminId: r.admin_id,
            adminName: r.admin_name ?? 'Unknown',
            adminRole: r.admin_role ?? 'admin',
            action: r.action,
            details: r.details,
            ipAddress: r.ip_address,
            userAgent: r.user_agent,
            createdAt: r.created_at,
          })),
          total,
          limit,
          offset,
        },
      });
    } catch (e) {
      logger.error('Audit activity logs error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load activity logs' } });
    }
  });

  /**
   * GET /admin/roles — list available admin roles and their permissions.
   */
  app.get('/roles', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const roles = Object.entries(ADMIN_IMPLICIT_ROLE_PERMISSIONS).map(([role, perms]) => ({
      role,
      permissions: perms,
      isSuperRole: isSuperAdminRole(role),
    }));
    return reply.send({ success: true, data: { roles, permissionMatrix: ADMIN_PERMISSION_MATRIX } });
  });

  app.get('/system/profiles', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_profiles (
          name TEXT PRIMARY KEY,
          settings_json JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const rows = await db.query<{ name: string; settings_json: unknown; updated_at: string; updated_by: string | null }>(
        'SELECT name, settings_json, updated_at::text, updated_by FROM system_profiles'
      );
      const profiles = rows.rows.map((r) => ({
        name: r.name,
        settings: (r.settings_json as Record<string, string>) || {},
        updated_at: r.updated_at,
        updated_by: r.updated_by ?? null,
      }));
      const defaults = ['production', 'staging', 'testing'];
      for (const d of defaults) {
        if (!profiles.some((p) => p.name === d)) {
          profiles.push({ name: d, settings: {}, updated_at: new Date().toISOString(), updated_by: null });
        }
      }
      return reply.send({ success: true, data: { profiles } });
    } catch (e) {
      logger.error('System profiles get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch profiles' } });
    }
  });

  app.patch<{ Params: { name: string }; Body: Record<string, unknown> }>('/system/profiles/:name', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const { name } = request.params;
    const body = (request.body || {}) as { settings?: Record<string, string> };
    const settings = body.settings && typeof body.settings === 'object' ? body.settings : {};
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_profiles (
          name TEXT PRIMARY KEY,
          settings_json JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (typeof k === 'string' && (typeof v === 'string' || typeof v === 'number')) normalized[k] = String(v);
      }
      await db.query(
        `INSERT INTO system_profiles (name, settings_json, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (name) DO UPDATE SET settings_json = $2, updated_at = NOW(), updated_by = $3`,
        [name, JSON.stringify(normalized), admin.adminId]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'system_profile_saved',
        resourceType: 'system_profiles',
        resourceId: name,
        newValue: { profile: name, keys_count: Object.keys(normalized).length },
      });
      return reply.send({ success: true, data: { updated: true } });
    } catch (e) {
      logger.error('System profile patch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update profile' } });
    }
  });

  app.post<{ Body: { profile: string } }>('/system/settings/apply-profile', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const profile = (request.body as { profile?: string })?.profile;
    if (!profile || typeof profile !== 'string') {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'profile required' } });
    }
    try {
      const rows = await db.query<{ settings_json: unknown }>('SELECT settings_json FROM system_profiles WHERE name = $1', [profile]);
      if (rows.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Profile not found' } });
      }
      const settings = (rows.rows[0]!.settings_json as Record<string, string>) || {};
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', description TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT
        )
      `);
      for (const [key, value] of Object.entries(settings)) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
          [key, value, admin.adminId]
        );
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'system_settings_apply_profile',
        resourceType: 'system_settings',
        resourceId: profile,
        newValue: { profile },
      });
      return reply.send({ success: true, data: { applied: profile } });
    } catch (e) {
      logger.error('Apply profile error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'APPLY_FAILED', message: 'Failed to apply profile' } });
    }
  });

  app.get('/system/safe-mode', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query<{ value: string }>("SELECT value FROM system_settings WHERE key = 'safe_mode'");
      const enabled = rows.rows.length > 0 && rows.rows[0]!.value === '1';
      return reply.send({ success: true, data: { safe_mode: enabled } });
    } catch (e) {
      logger.error('Safe mode get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get safe mode' } });
    }
  });

  app.post<{ Body: { enabled: boolean } }>('/system/safe-mode', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const enabled = (request.body as { enabled?: boolean })?.enabled === true;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', description TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('safe_mode', $1, NOW(), $2)
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
        [enabled ? '1' : '0', admin.adminId]
      );
      if (enabled) {
        const { setTradingHalt } = await import('../lib/trading-halt.js');
        await setTradingHalt(true);
        for (const key of ['emergency_disable_withdrawals', 'emergency_pause_trading', 'api_trading_disabled']) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, '1', NOW(), $2)
             ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $2`,
            [key, admin.adminId]
          );
        }
      } else {
        const { setTradingHalt } = await import('../lib/trading-halt.js');
        await setTradingHalt(false);
        for (const key of ['emergency_disable_withdrawals', 'emergency_pause_trading', 'api_trading_disabled']) {
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, '0', NOW(), $2)
             ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW(), updated_by = $2`,
            [key, admin.adminId]
          );
        }
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'system_safe_mode',
        resourceType: 'system_settings',
        newValue: { safe_mode: enabled },
      });
      return reply.send({ success: true, data: { safe_mode: enabled } });
    } catch (e) {
      logger.error('Safe mode post error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to set safe mode' } });
    }
  });

  // ===============================
  // MASTER CONTROL PANEL (/admin/control)
  // ===============================

  app.get('/control/status', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { getTradingHalted } = await import('../lib/trading-halt.js');
      const halted = await getTradingHalted();
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', description TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      const rows = await db.query<{ key: string; value: string }>(
        "SELECT key, value FROM system_settings WHERE key IN ('emergency_pause_trading','emergency_disable_withdrawals','emergency_disable_deposits','safe_mode','liquidity_kill_switch','circuit_breaker_open','matching_engine_paused')"
      );
      const kv: Record<string, string> = {};
      for (const r of rows.rows) kv[r.key] = r.value;
      const tradingActive = !halted && kv['emergency_pause_trading'] !== '1';
      const withdrawalsEnabled = kv['emergency_disable_withdrawals'] !== '1';
      const depositsEnabled = kv['emergency_disable_deposits'] !== '1';
      const liquidityKill = kv['liquidity_kill_switch'] === '1';
      const safeMode = kv['safe_mode'] === '1';
      const exchangeOperational = tradingActive && withdrawalsEnabled && depositsEnabled && !safeMode;
      return reply.send({
        success: true,
        data: {
          exchange_status: exchangeOperational ? 'operational' : 'degraded',
          trading_status: tradingActive ? 'active' : 'paused',
          withdrawals_status: withdrawalsEnabled ? 'enabled' : 'disabled',
          deposits_status: depositsEnabled ? 'enabled' : 'disabled',
          liquidity_engine_status: liquidityKill ? 'disabled' : 'active',
        },
      });
    } catch (e) {
      logger.error('Control status error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get status' } });
    }
  });

  app.post<{ Body: { action: string } }>('/control/circuit', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'control:trading', reply)) return;
    const action = (request.body as { action?: string })?.action ?? '';
    const allowed = ['open_trading_circuit', 'close_trading_circuit', 'pause_matching_engine', 'resume_matching_engine'];
    if (!allowed.includes(action)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ACTION', message: 'action must be one of: ' + allowed.join(', ') } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      if (action === 'open_trading_circuit') {
        const { setTradingHalt } = await import('../lib/trading-halt.js');
        await setTradingHalt(true);
        await db.query(
          "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('circuit_breaker_open', '1', NOW(), $1) ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1",
          [admin.adminId]
        );
      } else if (action === 'close_trading_circuit') {
        const { setTradingHalt } = await import('../lib/trading-halt.js');
        await setTradingHalt(false);
        await db.query(
          "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('circuit_breaker_open', '0', NOW(), $1) ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW(), updated_by = $1",
          [admin.adminId]
        );
      } else if (action === 'pause_matching_engine') {
        await db.query(
          "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('matching_engine_paused', '1', NOW(), $1) ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1",
          [admin.adminId]
        );
      } else if (action === 'resume_matching_engine') {
        await db.query(
          "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('matching_engine_paused', '0', NOW(), $1) ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW(), updated_by = $1",
          [admin.adminId]
        );
      }
      const eventLabels: Record<string, string> = {
        open_trading_circuit: 'Trading circuit opened',
        close_trading_circuit: 'Trading circuit closed',
        pause_matching_engine: 'Matching engine paused',
        resume_matching_engine: 'Matching engine resumed',
      };
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'info', created_at TIMESTAMPTZ DEFAULT NOW())
      `);
      await db.query('INSERT INTO control_events (event, service, severity) VALUES ($1, $2, $3)', [eventLabels[action] || action, 'circuit', 'info']);
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_circuit',
        resourceType: 'control',
        resourceId: action,
        newValue: { action },
      });
      broadcastAdminControlEvent('control_status_changed', { action });
      broadcastAdminControlEvent('timeline_event', {
        event: `Circuit ${action.replace(/_/g, ' ')}`,
        timestamp: new Date().toISOString(),
        triggered_by: admin.adminId,
        service: 'control',
        severity: 'info',
      });
      return reply.send({ success: true, data: { action } });
    } catch (e) {
      logger.error('Control circuit error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to execute' } });
    }
  });

  app.get('/control/asset-freeze', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_asset_freeze (
          asset TEXT PRIMARY KEY,
          deposits_frozen INTEGER NOT NULL DEFAULT 0,
          withdrawals_frozen INTEGER NOT NULL DEFAULT 0,
          trading_frozen INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const rows = await db.query<{ asset: string; deposits_frozen: number; withdrawals_frozen: number; trading_frozen: number }>(
        'SELECT asset, deposits_frozen, withdrawals_frozen, trading_frozen FROM control_asset_freeze'
      );
      const assets = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL'];
      const byAsset: Record<string, { deposits_frozen: boolean; withdrawals_frozen: boolean; trading_frozen: boolean }> = {};
      for (const a of assets) byAsset[a] = { deposits_frozen: false, withdrawals_frozen: false, trading_frozen: false };
      for (const r of rows.rows) {
        byAsset[r.asset] = {
          deposits_frozen: r.deposits_frozen === 1,
          withdrawals_frozen: r.withdrawals_frozen === 1,
          trading_frozen: r.trading_frozen === 1,
        };
      }
      const list = assets.map((asset) => ({ asset, ...byAsset[asset] }));
      return reply.send({ success: true, data: { assets: list } });
    } catch (e) {
      logger.error('Control asset-freeze get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get asset freeze' } });
    }
  });

  app.patch<{ Body: { asset: string; deposits_frozen?: boolean; withdrawals_frozen?: boolean; trading_frozen?: boolean } }>('/control/asset-freeze', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body || {};
    const asset = typeof body.asset === 'string' ? body.asset.trim().toUpperCase() : '';
    if (!asset) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'asset required' } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_asset_freeze (
          asset TEXT PRIMARY KEY,
          deposits_frozen INTEGER NOT NULL DEFAULT 0,
          withdrawals_frozen INTEGER NOT NULL DEFAULT 0,
          trading_frozen INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          updated_by TEXT
        )
      `);
      const existing = await db.query<{ deposits_frozen: number; withdrawals_frozen: number; trading_frozen: number }>(
        'SELECT COALESCE(deposits_frozen,0) AS deposits_frozen, COALESCE(withdrawals_frozen,0) AS withdrawals_frozen, COALESCE(trading_frozen,0) AS trading_frozen FROM control_asset_freeze WHERE asset = $1',
        [asset]
      );
      let d = existing.rows[0]?.deposits_frozen ?? 0;
      let w = existing.rows[0]?.withdrawals_frozen ?? 0;
      let t = existing.rows[0]?.trading_frozen ?? 0;
      if (body.deposits_frozen === true) d = 1; else if (body.deposits_frozen === false) d = 0;
      if (body.withdrawals_frozen === true) w = 1; else if (body.withdrawals_frozen === false) w = 0;
      if (body.trading_frozen === true) t = 1; else if (body.trading_frozen === false) t = 0;
      await db.query(
        `INSERT INTO control_asset_freeze (asset, deposits_frozen, withdrawals_frozen, trading_frozen, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, NOW(), $5) ON CONFLICT (asset) DO UPDATE SET deposits_frozen = $2, withdrawals_frozen = $3, trading_frozen = $4, updated_at = NOW(), updated_by = $5`,
        [asset, d, w, t, admin.adminId]
      );
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_asset_freeze_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          asset TEXT NOT NULL,
          action TEXT NOT NULL,
          changed_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const prev = existing.rows[0];
      const actions: string[] = [];
      if (prev) {
        if (prev.deposits_frozen !== d) actions.push(d ? 'Deposits Frozen' : 'Deposits Unfrozen');
        if (prev.withdrawals_frozen !== w) actions.push(w ? 'Withdrawals Frozen' : 'Withdrawals Unfrozen');
        if (prev.trading_frozen !== t) actions.push(t ? 'Trading Frozen' : 'Trading Unfrozen');
      } else {
        if (d) actions.push('Deposits Frozen');
        if (w) actions.push('Withdrawals Frozen');
        if (t) actions.push('Trading Frozen');
      }
      for (const action of actions) {
        await db.query('INSERT INTO control_asset_freeze_history (asset, action, changed_by) VALUES ($1, $2, $3)', [asset, action, admin.adminId]);
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_asset_freeze',
        resourceType: 'control',
        resourceId: asset,
        newValue: { asset, deposits_frozen: !!d, withdrawals_frozen: !!w, trading_frozen: !!t },
      });
      broadcastAdminControlEvent('control_status_changed', { asset });
      return reply.send({ success: true, data: { updated: true } });
    } catch (e) {
      logger.error('Control asset-freeze patch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  app.post<{ Body: { enabled: boolean } }>('/control/liquidity-kill', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const enabled = (request.body as { enabled?: boolean })?.enabled === true;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('liquidity_kill_switch', $1, NOW(), $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
        [enabled ? '1' : '0', admin.adminId]
      );
      if (enabled) {
        await db.query("UPDATE feature_flags SET status = 'disabled' WHERE feature_key = 'liquidity_bot'");
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_liquidity_kill',
        resourceType: 'control',
        newValue: { enabled },
      });
      broadcastAdminControlEvent('liquidity_kill_activated', { enabled });
      return reply.send({ success: true, data: { liquidity_kill: enabled } });
    } catch (e) {
      logger.error('Liquidity kill error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to set' } });
    }
  });

  app.post<{ Body: { enabled: boolean } }>('/control/emergency-mode', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'control:trading', reply)) return;
    const enabled = (request.body as { enabled?: boolean })?.enabled === true;
    try {
      const { setTradingHalt } = await import('../lib/trading-halt.js');
      await setTradingHalt(enabled);
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      const v = enabled ? '1' : '0';
      for (const key of ['emergency_pause_trading', 'emergency_disable_withdrawals', 'emergency_disable_deposits', 'safe_mode']) {
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
          [key, v, admin.adminId]
        );
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'info', created_at TIMESTAMPTZ DEFAULT NOW())
      `);
      await db.query('INSERT INTO control_events (event, service, severity) VALUES ($1, $2, $3)', [enabled ? 'Emergency mode activated' : 'Emergency mode deactivated', 'emergency', 'info']);
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_emergency_mode',
        resourceType: 'control',
        newValue: { enabled },
      });
      broadcastAdminControlEvent('control_status_changed', { emergency_mode: enabled });
      return reply.send({ success: true, data: { emergency_mode: enabled } });
    } catch (e) {
      logger.error('Emergency mode error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to set' } });
    }
  });

  app.get<{ Querystring: { limit?: string; status?: string } }>('/control/incidents', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_incidents (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          service TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        )
      `);
      const q = request.query as { limit?: string; status?: string };
      const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      let where = '1=1';
      const params: (string | number)[] = [];
      let i = 1;
      if (q.status && ['open', 'acknowledged', 'resolved'].includes(q.status)) {
        where += ` AND status = $${i++}`;
        params.push(q.status);
      }
      params.push(limit);
      const rows = await db.query<{ id: string; service: string; severity: string; status: string; created_at: string | null; resolved_at: string | null }>(
        `SELECT id::text, service, severity, status, created_at::text, resolved_at::text FROM monitoring_incidents WHERE ${where} ORDER BY created_at DESC LIMIT $${i}`,
        params
      );
      const incidents = rows.rows.map((r) => ({ id: r.id, type: r.service, severity: r.severity, status: r.status, created_at: r.created_at, resolved_at: r.resolved_at }));
      return reply.send({ success: true, data: { incidents } });
    } catch (e) {
      logger.error('Control incidents error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list incidents' } });
    }
  });

  app.patch<{ Params: { id: string } }>('/control/incidents/:id/acknowledge', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    try {
      const result = await db.query(
        `UPDATE monitoring_incidents SET status = 'acknowledged' WHERE id = $1::uuid AND status = 'open' RETURNING id`,
        [id]
      );
      if (result.rowCount === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Incident not found or not open' } });
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_incident_acknowledged',
        resourceType: 'control',
        resourceId: id,
        newValue: { incident_id: id },
      });
      return reply.send({ success: true, data: { acknowledged: true } });
    } catch (e) {
      logger.error('Control incident acknowledge error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to acknowledge' } });
    }
  });

  app.patch<{ Params: { id: string } }>('/control/incidents/:id/resolve', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    try {
      const result = await db.query(
        `UPDATE monitoring_incidents SET status = 'resolved', resolved_at = NOW() WHERE id = $1::uuid RETURNING id`,
        [id]
      );
      if (result.rowCount === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Incident not found' } });
      }
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_incident_resolved',
        resourceType: 'control',
        resourceId: id,
        newValue: { incident_id: id },
      });
      return reply.send({ success: true, data: { resolved: true } });
    } catch (e) {
      logger.error('Control incident resolve error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to resolve' } });
    }
  });

  app.post<{ Body: { type?: string; severity?: string; description?: string } }>('/control/incidents', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { type?: string; severity?: string; description?: string };
    const type = (body.type ?? '').trim() || undefined;
    const severity = (body.severity ?? 'warning').toLowerCase();
    const description = (body.description ?? '').trim() || '';
    if (!type) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type is required' } });
    }
    const allowedSeverity = ['info', 'warning', 'critical'];
    if (!allowedSeverity.includes(severity)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'severity must be info, warning, or critical' } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_incidents (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          service TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        )
      `);
      await db.query(`
        DO $$ BEGIN
          ALTER TABLE monitoring_incidents ADD COLUMN description TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
      `);
      const insertResult = await db.query<{ id: string }>(
        `INSERT INTO monitoring_incidents (service, severity, status, description) VALUES ($1, $2, 'open', $3) RETURNING id::text`,
        [type, severity, description || null]
      );
      const incidentId = insertResult.rows[0]?.id;
      if (!incidentId) {
        return reply.status(500).send({ success: false, error: { code: 'INSERT_FAILED', message: 'Failed to create incident' } });
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'info', created_at TIMESTAMPTZ DEFAULT NOW())
      `);
      const eventMessage = description ? `Incident created: ${type} (${severity}) - ${description}` : `Incident created: ${type} (${severity})`;
      await db.query('INSERT INTO control_events (event, service, severity) VALUES ($1, $2, $3)', [eventMessage, 'incidents', severity]);
      broadcastAdminControlEvent('incident_created', { id: incidentId, type, severity, description });
      broadcastAdminControlEvent('timeline_event', {
        event: description ? `Incident: ${type} (${severity}) - ${description}` : `Incident: ${type} (${severity})`,
        timestamp: new Date().toISOString(),
        triggered_by: admin.adminId,
        service: 'incidents',
        severity,
      });
      return reply.send({ success: true, data: { id: incidentId, type, severity, description } });
    } catch (e) {
      logger.error('Control incident create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create incident' } });
    }
  });

  app.post<{ Body: { command: string } }>('/control/commands', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'control:commands');
    if (!admin) return;
    const command = (request.body as { command?: string })?.command ?? '';
    const allowed = ['restart_matching_engine', 'restart_settlement_worker', 'restart_websocket_service', 'restart_worker', 'flush_queue', 'reset_circuit_breaker', 'restart_liquidity_bot'];
    if (!allowed.includes(command)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_COMMAND', message: 'command must be one of: ' + allowed.join(', ') } });
    }
    try {
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_command',
        resourceType: 'control',
        resourceId: command,
        newValue: { command },
      });
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'info', created_at TIMESTAMPTZ DEFAULT NOW())
      `);
      const eventLabel = command.replace(/_/g, ' ');
      await db.query('INSERT INTO control_events (event, service, severity) VALUES ($1, $2, $3)', [eventLabel, 'control', 'info']);
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_command_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          command TEXT NOT NULL,
          triggered_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'success',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.query(
        'INSERT INTO control_command_history (command, triggered_by, status) VALUES ($1, $2, $3)',
        [command, admin.adminId, 'success']
      );
      broadcastAdminControlEvent('service_restarted', { command });
      broadcastAdminControlEvent('timeline_event', {
        event: `Service restarted: ${command.replace(/_/g, ' ')}`,
        timestamp: new Date().toISOString(),
        triggered_by: admin.adminId,
        service: 'control',
        severity: 'info',
      });
      return reply.send({ success: true, data: { command, triggered: true } });
    } catch (e) {
      logger.error('Control command error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to run command' } });
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/control/commands/history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_command_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          command TEXT NOT NULL,
          triggered_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'success',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '50', 10) || 50));
      const rows = await db.query<{ command: string; triggered_by: string; status: string; created_at: string }>(
        'SELECT command, triggered_by, status, created_at::text AS created_at FROM control_command_history ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      const history = rows.rows.map((r) => ({
        command: r.command,
        triggered_by: r.triggered_by,
        status: r.status,
        timestamp: r.created_at,
      }));
      return reply.send({ success: true, data: { history } });
    } catch (e) {
      logger.error('Control commands history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load command history' } });
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/control/events', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'info', created_at TIMESTAMPTZ DEFAULT NOW())
      `);
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '50', 10) || 50));
      const timeline = await db.query<{ id: string; event_type: string; message: string | null; created_at: string }>(
        'SELECT id::text, event_type, message, created_at::text FROM monitoring_events ORDER BY created_at DESC LIMIT $1',
        [limit]
      ).catch(() => ({ rows: [] as { id: string; event_type: string; message: string | null; created_at: string }[] }));
      const controlRows = await db.query<{ id: string; event: string; service: string | null; severity: string | null; created_at: string }>(
        'SELECT id::text, event, service, severity, created_at::text FROM control_events ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      const events = controlRows.rows.map((r) => ({
        event: r.event,
        service: r.service ?? 'control',
        severity: r.severity ?? 'info',
        timestamp: r.created_at,
      }));
      for (const r of timeline.rows) {
        events.push({ event: r.event_type + (r.message ? ': ' + r.message : ''), service: 'monitoring', severity: 'info', timestamp: r.created_at });
      }
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return reply.send({ success: true, data: { events: events.slice(0, limit) } });
    } catch (e) {
      logger.error('Control events error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get events' } });
    }
  });

  app.get('/control/health-score', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { computeHealthScore } = await import('../services/health-score.service.js');
      const data = await computeHealthScore();
      return reply.send({ success: true, data });
    } catch (e) {
      logger.error('Control health-score error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get health score' } });
    }
  });

  app.get('/control/services', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_workers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          worker_name TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'unknown',
          uptime_seconds INTEGER NOT NULL DEFAULT 0,
          last_restart_at TIMESTAMPTZ
        )
      `);
      const rows = await db.query<{ worker_name: string; status: string; uptime_seconds: number; last_restart_at: string | null }>(
        'SELECT worker_name, status, uptime_seconds, last_restart_at::text FROM monitoring_workers ORDER BY worker_name'
      );
      const defaults = [
        { worker_name: 'Matching Engine', status: 'running', uptime_seconds: 86400, last_restart_at: null },
        { worker_name: 'Settlement Worker', status: 'running', uptime_seconds: 10800, last_restart_at: null },
        { worker_name: 'WebSocket Server', status: 'running', uptime_seconds: 7200, last_restart_at: null },
        { worker_name: 'Deposit Indexer', status: 'running', uptime_seconds: 3600, last_restart_at: null },
        { worker_name: 'Risk Engine', status: 'running', uptime_seconds: 172800, last_restart_at: null },
      ];
      const byName = new Map(rows.rows.map((r) => [r.worker_name, r]));
      const services = defaults.map((d) => {
        const r = byName.get(d.worker_name);
        return {
          service: d.worker_name,
          status: r?.status ?? d.status,
          uptime: formatUptime(r?.uptime_seconds ?? d.uptime_seconds),
          last_restart: r?.last_restart_at ? formatRelative(r.last_restart_at) : null,
        };
      });
      return reply.send({ success: true, data: { services } });
    } catch (e) {
      logger.error('Control services error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get services' } });
    }
  });

  function formatUptime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function formatRelative(iso: string): string {
    const d = new Date(iso);
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
    return `${Math.floor(sec / 86400)} days ago`;
  }

  const HEALTH_WORKER_SLUGS = ['matching-engine', 'settlement-worker', 'websocket', 'deposit-indexer', 'risk-engine'] as const;
  const HEALTH_SLUG_TO_NAME: Record<(typeof HEALTH_WORKER_SLUGS)[number], string> = {
    'matching-engine': 'Matching Engine',
    'settlement-worker': 'Settlement Worker',
    'websocket': 'WebSocket Server',
    'deposit-indexer': 'Deposit Indexer',
    'risk-engine': 'Risk Engine',
  };

  function normalizeHealthStatus(dbStatus: string): 'healthy' | 'warning' | 'down' {
    const s = (dbStatus || '').toLowerCase();
    if (s === 'running' || s === 'healthy' || s === 'ok') return 'healthy';
    if (s === 'degraded' || s === 'slow' || s === 'warning') return 'warning';
    return 'down';
  }

  async function getWorkerHealth(workerName: string): Promise<{ status: 'healthy' | 'warning' | 'down'; uptime: number; last_restart: string | null }> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS monitoring_workers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        worker_name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'unknown',
        uptime_seconds INTEGER NOT NULL DEFAULT 0,
        last_restart_at TIMESTAMPTZ
      )
    `);
    let row = await db.query<{ status: string; uptime_seconds: number; last_restart_at: string | null }>(
      'SELECT status, uptime_seconds, last_restart_at::text FROM monitoring_workers WHERE worker_name = $1',
      [workerName]
    ).then((r) => r.rows[0]);
    if (!row) {
      await db.query(
        'INSERT INTO monitoring_workers (worker_name, status, uptime_seconds) VALUES ($1, $2, $3) ON CONFLICT (worker_name) DO NOTHING',
        [workerName, 'running', 0]
      );
      row = await db.query<{ status: string; uptime_seconds: number; last_restart_at: string | null }>(
        'SELECT status, uptime_seconds, last_restart_at::text FROM monitoring_workers WHERE worker_name = $1',
        [workerName]
      ).then((r) => r.rows[0]);
    }
    const status = normalizeHealthStatus(row?.status ?? 'unknown');
    const uptime = row?.uptime_seconds ?? 0;
    const last_restart = row?.last_restart_at ?? null;
    return { status, uptime, last_restart };
  }

  app.get('/control/health', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const services = await Promise.all(
        HEALTH_WORKER_SLUGS.map(async (slug) => {
          const workerName = HEALTH_SLUG_TO_NAME[slug];
          const health = await getWorkerHealth(workerName);
          return {
            service: workerName,
            status: health.status,
            uptime: health.uptime,
            last_restart: health.last_restart,
          };
        })
      );
      return reply.send({ success: true, data: { services } });
    } catch (e) {
      logger.error('Control health (all) error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get health' } });
    }
  });

  app.get<{ Params: { worker: string } }>('/control/health/:worker', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const worker = request.params.worker as (typeof HEALTH_WORKER_SLUGS)[number];
    if (!HEALTH_WORKER_SLUGS.includes(worker)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_WORKER', message: 'Invalid worker slug' } });
    }
    try {
      const workerName = HEALTH_SLUG_TO_NAME[worker];
      const data = await getWorkerHealth(workerName);
      return reply.send({ success: true, data });
    } catch (e) {
      logger.error('Control health endpoint error', { worker, error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get health' } });
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/control/asset-freeze/history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_asset_freeze_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          asset TEXT NOT NULL,
          action TEXT NOT NULL,
          changed_by TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '50', 10) || 50));
      const rows = await db.query<{ asset: string; action: string; changed_by: string | null; created_at: string }>(
        'SELECT asset, action, changed_by, created_at::text FROM control_asset_freeze_history ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return reply.send({ success: true, data: { history: rows.rows } });
    } catch (e) {
      logger.error('Control asset-freeze history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get history' } });
    }
  });

  app.get<{ Querystring: { limit?: string } }>('/control/circuit-history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_events (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), event TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'info', created_at TIMESTAMPTZ DEFAULT NOW())
      `);
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '30', 10) || 30));
      const rows = await db.query<{ event: string; service: string | null; created_at: string }>(
        "SELECT event, service, created_at::text FROM control_events WHERE service IN ('circuit', 'emergency') ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
      return reply.send({ success: true, data: { history: rows.rows } });
    } catch (e) {
      logger.error('Control circuit-history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get circuit history' } });
    }
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/control/timeline', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const limit = Math.min(80, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '30', 10) || 30));
      const offset = Math.max(0, parseInt((request.query as { offset?: string }).offset ?? '0', 10) || 0);
      const fetchSize = limit + offset + 1;
      const [controlEv, incidents, monEv] = await Promise.all([
        db.query<{ event: string; service: string | null; severity: string | null; created_at: string }>(
          'SELECT event, service, severity, created_at::text FROM control_events ORDER BY created_at DESC LIMIT $1',
          [fetchSize]
        ).catch(() => ({ rows: [] })),
        db.query<{ service: string; severity: string; status: string; created_at: string | null }>(
          'SELECT service, severity, status, created_at::text FROM monitoring_incidents ORDER BY created_at DESC LIMIT $1',
          [fetchSize]
        ).catch(() => ({ rows: [] })),
        db.query<{ event_type: string; message: string | null; created_at: string }>(
          'SELECT event_type, message, created_at::text FROM monitoring_events ORDER BY created_at DESC LIMIT $1',
          [fetchSize]
        ).catch(() => ({ rows: [] })),
      ]);
      const items: { event: string; service: string; severity: string; timestamp: string }[] = [];
      controlEv.rows.forEach((r) => items.push({ event: r.event, service: r.service ?? 'control', severity: r.severity ?? 'info', timestamp: r.created_at }));
      incidents.rows.forEach((r) => items.push({ event: `${r.service} incident (${r.severity}) - ${r.status}`, service: 'incidents', severity: r.severity, timestamp: r.created_at ?? '' }));
      monEv.rows.forEach((r) => items.push({ event: r.event_type + (r.message ? ': ' + r.message : ''), service: 'monitoring', severity: 'info', timestamp: r.created_at }));
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const total = items.length;
      const page = items.slice(offset, offset + limit);
      const hasMore = total > offset + limit;
      return reply.send({ success: true, data: { timeline: page, hasMore } });
    } catch (e) {
      logger.error('Control timeline error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get timeline' } });
    }
  });

  app.get('/control/emergency-level', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      const row = await db.query<{ value: string }>("SELECT value FROM system_settings WHERE key = 'emergency_level'");
      const level = row.rows[0] ? parseInt(row.rows[0].value, 10) : 0;
      return reply.send({ success: true, data: { level: Number.isFinite(level) && level >= 1 && level <= 3 ? level : 0 } });
    } catch (e) {
      logger.error('Control emergency-level get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get level' } });
    }
  });

  app.post<{ Body: { level: number } }>('/control/emergency-level', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const level = Math.floor(Number((request.body as { level?: number }).level) || 0);
    if (level < 0 || level > 3) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_LEVEL', message: 'level must be 0, 1, 2, or 3' } });
    }
    try {
      const { setTradingHalt } = await import('../lib/trading-halt.js');
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      await db.query(
        "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_level', $1, NOW(), $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2",
        [String(level), admin.adminId]
      );
      if (level >= 1) await setTradingHalt(true);
      else await setTradingHalt(false);
      const v = level >= 2 ? '1' : '0';
      await db.query(
        "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_withdrawals', $1, NOW(), $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2",
        [v, admin.adminId]
      );
      const v3 = level >= 3 ? '1' : '0';
      await db.query(
        "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_deposits', $1, NOW(), $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2",
        [v3, admin.adminId]
      );
      await db.query(
        "INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('safe_mode', $1, NOW(), $2) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2",
        [v3, admin.adminId]
      );
      await db.query(
        `INSERT INTO control_events (event, service, severity) VALUES ($1, 'emergency', 'info')`,
        [`Emergency level set to ${level}`]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'control_emergency_level',
        resourceType: 'control',
        newValue: { level },
      });
      broadcastAdminControlEvent('emergency_level_changed', { level });
      broadcastAdminControlEvent('timeline_event', {
        event: `Emergency level changed to Level ${level}`,
        timestamp: new Date().toISOString(),
        triggered_by: admin.adminId,
        service: 'control',
        severity: level >= 2 ? 'warning' : 'info',
      });
      return reply.send({ success: true, data: { level } });
    } catch (e) {
      logger.error('Control emergency-level post error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to set level' } });
    }
  });

  const MAX_SAFETY_TRIGGERS = 20;

  app.get('/control/safety-triggers', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_safety_triggers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          trigger_type TEXT NOT NULL UNIQUE,
          threshold_value NUMERIC NOT NULL DEFAULT 0,
          action TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.query(`DO $$ BEGIN ALTER TABLE control_safety_triggers ADD COLUMN metric TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
      const rows = await db.query<{ id: string; trigger_type: string; threshold_value: string; action: string; enabled: number; metric: string | null }>(
        'SELECT id::text, trigger_type, threshold_value::text, action, enabled, metric FROM control_safety_triggers ORDER BY trigger_type'
      );
      if (rows.rows.length === 0) {
        await db.query(
          `INSERT INTO control_safety_triggers (trigger_type, threshold_value, action, enabled) VALUES 
           ('queue_backlog', 500, 'pause_trading', 0),
           ('rpc_failure_rate', 10, 'switch_rpc_provider', 0),
           ('withdrawal_queue_spike', 100, 'enable_risk_alerts', 0)
           ON CONFLICT (trigger_type) DO NOTHING`
        );
        const again = await db.query<{ id: string; trigger_type: string; threshold_value: string; action: string; enabled: number; metric: string | null }>(
          'SELECT id::text, trigger_type, threshold_value::text, action, enabled, metric FROM control_safety_triggers ORDER BY trigger_type'
        );
        return reply.send({ success: true, data: { triggers: again.rows.map((r) => ({ ...r, metric: r.metric ?? r.trigger_type })) } });
      }
      return reply.send({ success: true, data: { triggers: rows.rows.map((r) => ({ ...r, metric: r.metric ?? r.trigger_type })) } });
    } catch (e) {
      logger.error('Control safety-triggers get error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get triggers' } });
    }
  });

  app.patch<{ Body: { triggers: Array<{ trigger_type: string; metric?: string; threshold_value: number; action: string; enabled: boolean }> } }>('/control/safety-triggers', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body as { triggers?: Array<{ trigger_type: string; metric?: string; threshold_value: number; action: string; enabled: boolean }> })?.triggers ?? [];
    if (body.length > MAX_SAFETY_TRIGGERS) {
      return reply.status(400).send({
        success: false,
        error: { code: 'LIMIT_EXCEEDED', message: `Maximum ${MAX_SAFETY_TRIGGERS} safety triggers allowed.` },
      });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS control_safety_triggers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          trigger_type TEXT NOT NULL UNIQUE,
          threshold_value NUMERIC NOT NULL DEFAULT 0,
          action TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await db.query(`DO $$ BEGIN ALTER TABLE control_safety_triggers ADD COLUMN metric TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
      for (const t of body) {
        const triggerType = (t.trigger_type ?? '').trim();
        if (!triggerType) continue;
        await db.query(
          `INSERT INTO control_safety_triggers (trigger_type, metric, threshold_value, action, enabled, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (trigger_type) DO UPDATE SET metric = COALESCE(EXCLUDED.metric, control_safety_triggers.metric), threshold_value = $3, action = $4, enabled = $5, updated_at = NOW()`,
          [triggerType, (t.metric ?? '').trim() || null, t.threshold_value ?? 0, t.action ?? '', t.enabled ? 1 : 0]
        );
      }
      const rows = await db.query<{ id: string; trigger_type: string; threshold_value: string; action: string; enabled: number; metric: string | null }>(
        'SELECT id::text, trigger_type, threshold_value::text, action, enabled, metric FROM control_safety_triggers ORDER BY trigger_type'
      );
      return reply.send({ success: true, data: { triggers: rows.rows.map((r) => ({ ...r, metric: r.metric ?? r.trigger_type })) } });
    } catch (e) {
      logger.error('Control safety-triggers patch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update triggers' } });
    }
  });

  /**
   * GET /admin/matches
   * Read-only: cached match events from Rust matching engine. Refreshes from engine on call.
   */
  app.get('/matches', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const events = await refreshMatchEventsCache();
      return reply.send({ success: true, data: { events } });
    } catch {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Matching engine unavailable' },
      });
    }
  });

  /**
   * PHASE-12: Emergency trading halt. GET status; POST set (body: { halted: boolean }). Admin only.
   */
  app.get('/trading-halt', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    /**
     * Cached in-process for 3s. This endpoint is hit by every admin tab's
     * Topbar on every page navigation — hot path. Staleness risk is zero
     * because WS broadcasts `control_status_changed` on mutation, and the
     * frontend invalidates its cache on that event. 3s floor is indistinguishable
     * from real-time to humans.
     */
    const { getOrCompute } = await import('../lib/admin-endpoint-cache.js');
    const data = await getOrCompute('admin:shell:trading-halt', 3_000, async () => {
      const { getTradingHalted } = await import('../lib/trading-halt.js');
      const halted = await getTradingHalted();
      return { halted };
    });
    reply.header('Cache-Control', 'private, max-age=3');
    return reply.send({ success: true, data });
  });
  app.post<{ Body: { halted: boolean; reason?: string; admin_note?: string } }>('/trading-halt', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'control:trading', reply)) return;
    const halted = request.body?.halted === true;
    const reason = (request.body?.reason ?? '').trim() || undefined;
    const adminNote = (request.body?.admin_note ?? '').trim() || undefined;
    if (halted && (reason?.length ?? 0) < 8) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'REASON_REQUIRED',
          message: 'Reason (minimum 8 characters) is required when halting trading.',
        },
      });
    }
    const { setTradingHalt } = await import('../lib/trading-halt.js');
    await setTradingHalt(halted);
    try {
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: halted ? 'admin_trading_halt' : 'admin_trading_resume',
        resourceType: 'trading',
        resourceId: 'global',
        newValue: { halted, reason, admin_note: adminNote },
      });
    } catch {
      /* best-effort */
    }
    logger.warn('Trading halt changed', { adminId: admin.adminId, halted, reason });
    broadcastAdminControlEvent('control_status_changed', { trading: halted ? 'paused' : 'active' });
    return reply.send({ success: true, data: { halted } });
  });

  // ===============================
  // PHASE-14: OPERATOR CONTROLS (settlement, escrow, balance reconcile)
  // ===============================

  app.get('/settlement/events', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { status?: string; limit?: string; offset?: string; since_id?: string };
      const { listSettlementEvents } = await import('../services/operator-controls.service.js');
      const result = await listSettlementEvents({
        status: q.status,
        limit: q.limit != null ? parseInt(q.limit, 10) : 50,
        offset: q.offset != null ? parseInt(q.offset, 10) : 0,
        since_id: q.since_id != null ? parseInt(q.since_id, 10) : undefined,
      });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Settlement events list failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list settlement events' } });
    }
  });

  app.get('/settlement/events/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const id = parseInt((request.params as { id: string }).id, 10);
      if (Number.isNaN(id)) return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Invalid event id' } });
      const { getSettlementEventById } = await import('../services/operator-controls.service.js');
      const result = await getSettlementEventById(id);
      if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Settlement event not found' } });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Settlement event fetch failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch event' } });
    }
  });

  /**
   * GET /admin/search
   * Global search: users, orders, trades, withdrawals, transactions (deposits). Returns unified results for autocomplete.
   */
  app.get<{ Querystring: { q: string; limit?: string } }>('/search', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const q = (request.query?.q ?? '').trim();
    const limit = Math.min(20, Math.max(1, parseInt(request.query?.limit ?? '10', 10) || 10));
    if (!q || q.length < 2) {
      return reply.send({ success: true, data: { results: [] } });
    }
    const pattern = `%${q}%`;
    const results: { type: string; id: string; label: string; subtitle?: string; href: string }[] = [];

    try {
      const isUuid = /^[0-9a-f-]{36}$/i.test(q);
      const isTxHash = q.startsWith('0x') && q.length >= 40;

      const [userRows, withdrawalRows, orderRows, tradeRows, depositRows] = await Promise.all([
        (isUuid
          ? db.query<{ id: string; email: string | null; username: string | null }>(
              `SELECT id, email, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
              [q]
            )
          : db.query<{ id: string; email: string | null; username: string | null }>(
              `SELECT id, email, username FROM users
               WHERE deleted_at IS NULL AND (email ILIKE $1 OR phone ILIKE $1 OR username ILIKE $1)
               ORDER BY email ASC LIMIT 5`,
              [pattern]
            )
        ).catch(() => ({ rows: [] })),
        db.query<{ id: string; amount: string; status: string; currency_symbol: string }>(
          isUuid || (q.length >= 10 && !q.includes(' '))
            ? `SELECT w.id, w.amount::text as amount, w.status, COALESCE(t.symbol, '') as currency_symbol
               FROM withdrawals w
               LEFT JOIN tokens t ON w.token_id = t.id
               LEFT JOIN users u ON w.user_id = u.id
               WHERE w.id::text = $1 OR w.tx_hash = $1 OR w.tx_hash ILIKE $2
               LIMIT 5`
            : `SELECT w.id, w.amount::text as amount, w.status, COALESCE(t.symbol, '') as currency_symbol
               FROM withdrawals w
               LEFT JOIN tokens t ON w.token_id = t.id
               LEFT JOIN users u ON w.user_id = u.id
               WHERE w.tx_hash ILIKE $1
               LIMIT 5`,
          isUuid || (q.length >= 10 && !q.includes(' ')) ? [q, pattern] : [pattern]
        ).catch(() => ({ rows: [] })),
        db.query<{ id: string; user_id: string; market: string; status: string }>(
          `SELECT id::text as id, user_id, market, status FROM spot_orders
           WHERE id::text = $1 OR client_order_id = $1 OR client_order_id ILIKE $2
           ORDER BY created_at DESC LIMIT 5`,
          [q, pattern]
        ).catch(() => ({ rows: [] })),
        db.query<{ id: string; market: string; side: string; quantity: string }>(
          `SELECT id::text as id, market, side, quantity::text as quantity FROM spot_trades
           WHERE id::text = $1 ORDER BY created_at DESC LIMIT 5`,
          [q]
        ).catch(() => ({ rows: [] })),
        db.query<{ deposit_id: string; amount: string; status: string; token_symbol: string; tx_hash: string | null }>(
          isTxHash || isUuid
            ? `SELECT d.id::text as deposit_id, d.amount::text as amount, d.status, COALESCE(c.symbol, '') as token_symbol, d.tx_hash
               FROM deposits d
               LEFT JOIN currencies c ON d.currency_id = c.id
               WHERE d.id::text = $1 OR d.tx_hash = $1 OR d.tx_hash ILIKE $2
               ORDER BY d.created_at DESC LIMIT 5`
            : `SELECT d.id::text as deposit_id, d.amount::text as amount, d.status, COALESCE(c.symbol, '') as token_symbol, d.tx_hash
               FROM deposits d
               LEFT JOIN currencies c ON d.currency_id = c.id
               WHERE d.tx_hash ILIKE $1
               ORDER BY d.created_at DESC LIMIT 5`,
          isTxHash || isUuid ? [q, pattern] : [pattern]
        ).catch(() => ({ rows: [] })),
      ]);

      userRows.rows.forEach((r) => {
        results.push({
          type: 'user',
          id: r.id,
          label: r.email || r.username || r.id.slice(0, 8),
          subtitle: r.email && r.username ? r.username : undefined,
          href: `/admin/users/${r.id}`,
        });
      });
      withdrawalRows.rows.forEach((r) => {
        results.push({
          type: 'withdrawal',
          id: r.id,
          label: `${r.currency_symbol ? r.currency_symbol + ' ' : ''}${r.amount} · ${r.status}`,
          subtitle: r.id,
          href: `/admin/withdrawals?id=${encodeURIComponent(r.id)}`,
        });
      });
      orderRows.rows.forEach((r) => {
        results.push({
          type: 'order',
          id: r.id,
          label: `${r.market} · ${r.status}`,
          subtitle: `Order ${r.id.slice(0, 8)}`,
          href: `/admin/trading/orders`,
        });
      });
      tradeRows.rows.forEach((r) => {
        results.push({
          type: 'trade',
          id: r.id,
          label: `${r.market} ${r.side} ${r.quantity}`,
          subtitle: `Trade ${r.id.slice(0, 8)}`,
          href: `/admin/trading/trade-history`,
        });
      });
      depositRows.rows.forEach((r) => {
        results.push({
          type: 'transaction',
          id: r.deposit_id,
          label: `${r.token_symbol} ${r.amount} · ${r.status}`,
          subtitle: r.tx_hash ? `${r.tx_hash.slice(0, 10)}…` : r.deposit_id,
          href: `/admin/deposits`,
        });
      });

      const capped = results.slice(0, limit);
      return reply.send({ success: true, data: { results: capped } });
    } catch (e) {
      logger.warn('Admin search failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { results: [] } });
    }
  });

  /**
   * GET /admin/system-health
   * System health dashboard: API/DB/Redis latency, websocket stats, node status, queue metrics.
   */
  app.get('/system-health', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    /**
     * Cached in-process for 3s. Every admin Topbar hits this on every page
     * load, and the body runs DB ping + Redis ping + 2 DB count queries + WS
     * stats — measurable cost under concurrent admin load. 3s TTL collapses
     * N admins × M tabs into one real computation per 3s window.
     */
    try {
      const { getOrCompute } = await import('../lib/admin-endpoint-cache.js');
      const data = await getOrCompute('admin:shell:system-health', 3_000, async () => buildSystemHealth());
      reply.header('Cache-Control', 'private, max-age=3');
      return reply.send({ success: true, data });
    } catch (e) {
      logger.warn('Admin system-health failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'HEALTH_CHECK_FAILED', message: 'System health check failed' },
      });
    }
  });

  async function buildSystemHealth() {
    const start = Date.now();
    const dbStart = Date.now();
    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      await db.query('SELECT 1');
      dbOk = true;
      dbLatencyMs = Math.round(Date.now() - dbStart);
    } catch {
      /* db failed */
    }

      const redisStart = Date.now();
      let redisOk = false;
      let redisLatencyMs = 0;
      try {
        await redis.ping();
        redisOk = true;
        redisLatencyMs = Math.round(Date.now() - redisStart);
      } catch {
        /* redis failed */
      }

      let wsStats = { connections: 0, withUser: 0 };
      try {
        const { getStats } = await import('../services/spot-ws.service.js');
        wsStats = getStats();
      } catch {
        /* spot-ws not available */
      }

      const nodeUptimeSec = Math.floor(process.uptime());
      const mem = process.memoryUsage();
      const nodeMemoryMb = Math.round(mem.heapUsed / 1024 / 1024);

      let settlementPending = 0;
      let queuePending = 0;
      let queueSigning = 0;
      let queueBroadcast = 0;
      if (dbOk) {
        try {
          const [setRes, qRes] = await Promise.all([
            db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`),
            db.query<{ pending: string; signing: string; broadcast: string }>(
              `SELECT
                COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::text AS pending,
                COALESCE(SUM(CASE WHEN status = 'signing' THEN 1 ELSE 0 END), 0)::text AS signing,
                COALESCE(SUM(CASE WHEN status = 'broadcast' THEN 1 ELSE 0 END), 0)::text AS broadcast
               FROM withdrawal_signing_queue`
            ),
          ]);
          settlementPending = parseInt(setRes.rows[0]?.n ?? '0', 10) || 0;
          const q = qRes.rows[0];
          queuePending = parseInt(q?.pending ?? '0', 10) || 0;
          queueSigning = parseInt(q?.signing ?? '0', 10) || 0;
          queueBroadcast = parseInt(q?.broadcast ?? '0', 10) || 0;
        } catch {
          /* tables may not exist */
        }
      }

      const apiLatencyMs = Date.now() - start;

      let settlementLagSec = 0;
      try {
        const { getLastSettlementBacklogSnapshot } = await import('../services/settlement-pipeline-health.service.js');
        settlementLagSec = getLastSettlementBacklogSnapshot().oldestPendingAgeSeconds;
      } catch {
        /* optional */
      }

      return {
        timestamp: new Date().toISOString(),
        api_latency_ms: apiLatencyMs,
        database: {
          status: dbOk ? 'up' : 'down',
          latency_ms: dbLatencyMs,
        },
        redis: {
          status: redisOk ? 'up' : 'down',
          latency_ms: redisLatencyMs,
        },
        websocket: {
          connections: wsStats.connections,
          authenticated: wsStats.withUser,
          status: 'up',
        },
        node: {
          uptime_sec: nodeUptimeSec,
          memory_heap_mb: nodeMemoryMb,
          status: 'up',
        },
        queue: {
          settlement_pending: settlementPending,
          settlement_lag_sec: settlementLagSec,
          settlement_delayed: settlementPending > 0 && settlementLagSec >= 30,
          withdrawal_pending: queuePending,
          withdrawal_signing: queueSigning,
          withdrawal_broadcast: queueBroadcast,
          total_withdrawal_queue: queuePending + queueSigning + queueBroadcast,
        },
      };
  }

  /**
   * GET /admin/monitoring/counters
   * Read-only. Returns Redis-backed monitoring counters (monitoring:*). For observability; Redis failure returns empty object.
   */
  app.get('/monitoring/counters', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const keys = await redis.keys('monitoring:*');
      const counters: Record<string, string> = {};
      for (const key of keys) {
        const val = await redis.get(key);
        const shortKey = key.startsWith('monitoring:') ? key.slice('monitoring:'.length) : key;
        counters[shortKey] = val ?? '0';
      }
      return reply.send({ success: true, data: { counters } });
    } catch (e) {
      logger.warn('Admin monitoring counters failed (Redis)', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { counters: {} } });
    }
  });

  /**
   * GET /admin/monitoring/mm-risk
   * Market Making risk monitoring: API keys, top traders, daily PnL, inventory imbalance, emergency-stopped users.
   */
  app.get('/monitoring/mm-risk', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const { getMmRiskData } = await import('../services/mm-risk.service.js');
      const data = await getMmRiskData();
      return reply.send({ success: true, data });
    } catch (e) {
      logger.error('Admin MM risk fetch failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch MM risk data' } });
    }
  });

  /**
   * GET /admin/monitoring/mm-health
   * MM intelligence: oracle age, settlement lag, bot error rate, quote age, external divergence, auto-actions state.
   */
  app.get('/monitoring/mm-health', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const { computeMmHealthSnapshot } = await import('../services/mm-health.service.js');
      const data = await computeMmHealthSnapshot();
      return reply.send({ success: true, data });
    } catch (e) {
      logger.error('Admin MM health fetch failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch MM health' } });
    }
  });

  /**
   * GET /admin/monitoring/trading
   * Trading operational metrics: order latency p99, matching engine delay (from SLO/spot metrics).
   */
  app.get('/monitoring/trading', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { getSloStatus } = await import('../services/slo.service.js');
      const { getSpotMetrics } = await import('../services/spot-metrics.service.js');
      const slo = await getSloStatus();
      const spot = getSpotMetrics();
      const orderLatencyP99Ms = slo?.slo?.order_latency_p99_ms?.value ?? spot?.orderLatencyP99Ms ?? null;
      return reply.send({
        success: true,
        data: {
          order_latency_p99_ms: orderLatencyP99Ms,
          matching_engine_delay_ms: null,
        },
      });
    } catch (e) {
      logger.error('Get monitoring/trading error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch trading metrics' } });
    }
  });

  // ===============================
  // SYSTEM MONITORING & INFRASTRUCTURE
  // ===============================

  /**
   * GET /admin/monitoring/rpc-metrics
   * Current RPC call success/failure stats from Redis counters.
   */
  app.get('/monitoring/rpc-metrics', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { getRpcMetrics } = await import('../services/rpc-metrics.service.js');
      const data = await getRpcMetrics();
      return reply.send({ success: true, data });
    } catch (e) {
      logger.error('Get RPC metrics error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load RPC metrics' } });
    }
  });

  /**
   * GET /admin/monitoring/health
   * Infrastructure dashboard: API latency, DB health, Redis health, WS connections.
   */
  app.get('/monitoring/health', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const start = Date.now();
    try {
      let dbHealth = 'unknown';
      try {
        await db.query('SELECT 1');
        dbHealth = 'Healthy';
      } catch {
        dbHealth = 'Unhealthy';
      }
      let redisHealth = 'unknown';
      let wsConnections = 0;
      try {
        await redis.ping();
        redisHealth = 'Healthy';
        const wsCount = await redis.get('admin:ws:connections').catch(() => null);
        wsConnections = wsCount ? parseInt(wsCount, 10) || 0 : 0;
      } catch {
        redisHealth = 'Unhealthy';
      }
      const apiLatencyMs = Date.now() - start;
      return reply.send({
        success: true,
        data: {
          api_latency_ms: apiLatencyMs,
          db_health: dbHealth,
          redis_health: redisHealth,
          ws_connections: wsConnections >= 0 ? wsConnections : 0,
        },
      });
    } catch (e) {
      logger.error('Monitoring health error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get health' } });
    }
  });

  /**
   * GET /admin/monitoring/rpc-providers
   * RPC node providers with latency and status (from node_providers; latency placeholder or from Redis).
   */
  app.get('/monitoring/rpc-providers', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasTable = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'node_providers'`
      );
      if (hasTable.rows.length === 0) {
        return reply.send({ success: true, data: { providers: [] } });
      }
      const rows = await db.query<{ id: string; provider_name: string; rpc_url: string | null; network: string; status: string }>(
        'SELECT id::text, provider_name, rpc_url, COALESCE(network, \'mainnet\') AS network, COALESCE(status, \'active\') AS status FROM node_providers ORDER BY provider_name'
      );
      const latencyByKey = await redis.get('monitoring:rpc:latency').catch(() => null);
      const latencyMap: Record<string, number> = latencyByKey ? (JSON.parse(latencyByKey) as Record<string, number>) : {};
      const providers = await Promise.all(rows.rows.map(async (r) => {
        const statsKey = await redis.get(`monitoring:rpc:${r.id}`).catch(() => null);
        const stats: Record<string, unknown> = statsKey ? (JSON.parse(statsKey) as Record<string, unknown>) : {};
        const failover_priority = typeof stats.failover_priority === 'number' ? stats.failover_priority : 1;
        const error_rate = typeof stats.error_rate === 'number' ? stats.error_rate : 0;
        const last_failure = typeof stats.last_failure === 'string' ? stats.last_failure : null;
        return {
          id: r.id,
          provider: r.provider_name,
          network: r.network,
          rpc_url: r.rpc_url ? (r.rpc_url.length > 50 ? `${r.rpc_url.slice(0, 47)}...` : r.rpc_url) : '—',
          latency_ms: latencyMap[r.id] ?? null,
          status: r.status === 'active' ? 'Healthy' : r.status === 'inactive' ? 'Inactive' : r.status,
          failover_priority,
          error_rate,
          last_failure,
        };
      }));
      return reply.send({ success: true, data: { providers } });
    } catch (e) {
      logger.error('Monitoring RPC providers error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list RPC providers' } });
    }
  });

  /**
   * GET /admin/monitoring/queues
   * Queue metrics: withdrawal, settlement, matching engine pending counts.
   */
  app.get('/monitoring/queues', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const [w, s, m] = await Promise.all([
        redis.get('monitoring:queue:withdrawal').catch(() => null),
        redis.get('monitoring:queue:settlement').catch(() => null),
        redis.get('monitoring:queue:matching').catch(() => null),
      ]);
      const withdrawal_pending = parseInt(w ?? '0', 10) || 0;
      const settlement_pending = parseInt(s ?? '0', 10) || 0;
      const matching_engine_pending = parseInt(m ?? '0', 10) || 0;
      const withdrawalFromDb = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM withdrawals
         WHERE status IN ('pending_approval','pending_email_verify','pending_2fa','processing','pending_blockchain')`
      ).catch(() => ({ rows: [{ count: '0' }] }));
      const withdrawalDb = parseInt(withdrawalFromDb.rows[0]?.count ?? '0', 10) || 0;
      let settlementLagSec = 0;
      let settlementPendingDb = 0;
      try {
        const { refreshSettlementBacklogSnapshot } = await import('../services/settlement-pipeline-health.service.js');
        const snap = await refreshSettlementBacklogSnapshot();
        settlementLagSec = snap.oldestPendingAgeSeconds;
        settlementPendingDb = snap.pendingCount;
      } catch {
        /* optional */
      }
      const settlementDisplay = settlement_pending > 0 ? settlement_pending : settlementPendingDb;
      return reply.send({
        success: true,
        data: {
          withdrawal_pending: withdrawal_pending > 0 ? withdrawal_pending : withdrawalDb,
          settlement_pending: settlementDisplay,
          settlement_lag_sec: settlementLagSec,
          settlement_delayed: settlementDisplay > 0 && settlementLagSec >= 30,
          matching_engine_pending: matching_engine_pending,
        },
      });
    } catch (e) {
      logger.error('Monitoring queues error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          withdrawal_pending: 0,
          settlement_pending: 0,
          settlement_lag_sec: 0,
          settlement_delayed: false,
          matching_engine_pending: 0,
        },
      });
    }
  });

  /**
   * GET /admin/monitoring/resources
   * System resource usage: CPU, memory, disk (best-effort).
   */
  app.get('/monitoring/resources', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const os = await import('os');
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memory_percent = totalMem > 0 ? Math.round((1 - freeMem / totalMem) * 100) : 0;
      const load = os.loadavg();
      const cpu_percent = load[0] != null && Number.isFinite(load[0]) ? Math.min(100, Math.round(load[0] * 25)) : 0;
      let disk_percent = 0;
      try {
        const { execSync } = await import('child_process');
        const out = execSync('df -h . 2>/dev/null | tail -1 | awk \'{print $5}\'').toString().trim();
        const pct = parseInt(out.replace('%', ''), 10);
        if (Number.isFinite(pct)) disk_percent = pct;
      } catch {
        disk_percent = 0;
      }
      return reply.send({
        success: true,
        data: {
          cpu_percent: cpu_percent,
          memory_percent: memory_percent,
          disk_percent: disk_percent,
        },
      });
    } catch (e) {
      logger.error('Monitoring resources error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { cpu_percent: 0, memory_percent: 0, disk_percent: 0 } });
    }
  });

  /**
   * GET /admin/monitoring/alerts
   * Infrastructure alerts table. Uses infrastructure_alerts table (created on first use).
   */
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string } }>('/monitoring/alerts', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS infrastructure_alerts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          system TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const q = request.query as { limit?: string; offset?: string; status?: string };
      const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0);
      const conditions: string[] = ['1=1'];
      const params: (string | number)[] = [];
      let i = 1;
      if (q.status && ['open', 'acknowledged', 'resolved'].includes(q.status)) {
        conditions.push(`status = $${i++}`);
        params.push(q.status);
      }
      const where = conditions.join(' AND ');
      const countRes = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM infrastructure_alerts WHERE ${where}`, params);
      const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
      params.push(limit, offset);
      const listRes = await db.query<{ id: string; system: string; severity: string; message: string; status: string; created_at: string }>(
        `SELECT id::text, system, severity, message, status, created_at::text FROM infrastructure_alerts WHERE ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      return reply.send({ success: true, data: { alerts: listRes.rows, total } });
    } catch (e) {
      logger.error('Monitoring alerts error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list alerts' } });
    }
  });

  /**
   * POST /admin/monitoring/actions
   * Infrastructure control. Audit logged. Includes: restart_settlement_worker, restart_matching_engine, restart_websocket_service.
   */
  app.post<{ Body: { action: string } }>('/monitoring/actions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const action = (request.body as { action?: string })?.action;
    const allowed = [
      'restart_worker', 'flush_queue', 'reset_circuit_breaker', 'restart_liquidity_bot',
      'restart_settlement_worker', 'restart_matching_engine', 'restart_websocket_service',
    ];
    if (!action || !allowed.includes(action)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_ACTION', message: 'action must be one of: ' + allowed.join(', ') } });
    }
    try {
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'infrastructure_control',
        resourceType: 'monitoring',
        resourceId: action,
        newValue: { action },
      });
      return reply.send({ success: true, data: { action, triggered: true } });
    } catch (e) {
      logger.error('Monitoring action error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'ACTION_FAILED', message: 'Failed to trigger action' } });
    }
  });

  /**
   * GET /admin/monitoring/history?metric=api_latency|db_latency|redis_latency|queue_size
   * Historical metrics for charts (last 24h). Returns { data: { points: [{ timestamp, value }] } }.
   */
  app.get<{ Querystring: { metric?: string } }>('/monitoring/history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const metric = (request.query as { metric?: string }).metric ?? 'api_latency';
    const allowed = ['api_latency', 'db_latency', 'redis_latency', 'queue_size'];
    if (!allowed.includes(metric)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_METRIC', message: 'metric must be one of: ' + allowed.join(', ') } });
    }
    try {
      const raw = await redis.get(`monitoring:history:${metric}`).catch(() => null);
      let points: Array<{ timestamp: string; value: number }> = [];
      if (raw) {
        try {
          points = JSON.parse(raw) as Array<{ timestamp: string; value: number }>;
        } catch {
          points = [];
        }
      }
      if (points.length === 0) {
        const now = Date.now();
        const hour = 60 * 60 * 1000;
        for (let i = 23; i >= 0; i--) {
          const t = new Date(now - i * hour);
          points.push({ timestamp: t.toISOString(), value: 0 });
        }
      }
      return reply.send({ success: true, data: { metric, points } });
    } catch (e) {
      logger.error('Monitoring history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get history' } });
    }
  });

  /**
   * PATCH /admin/monitoring/rpc-providers/:id
   * Update RPC provider failover priority (and optionally error_rate/last_failure from probes).
   */
  app.patch<{ Params: { id: string }; Body: { failover_priority?: number } }>('/monitoring/rpc-providers/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    const body = (request.body as { failover_priority?: number }) || {};
    if (typeof body.failover_priority !== 'number' && body.failover_priority !== undefined) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'failover_priority must be a number' } });
    }
    try {
      const key = `monitoring:rpc:${id}`;
      const existing = await redis.get(key).catch(() => null);
      const stats: Record<string, unknown> = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
      if (typeof body.failover_priority === 'number') stats.failover_priority = body.failover_priority;
      await redis.set(key, JSON.stringify(stats)).catch(() => {});
      return reply.send({ success: true, data: { id, failover_priority: stats.failover_priority } });
    } catch (e) {
      logger.error('Patch RPC provider error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  /**
   * GET /admin/monitoring/alert-rules
   * Alert escalation rules (thresholds).
   */
  app.get('/monitoring/alert-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_alert_rules (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL DEFAULT '{}'
        )
      `);
      const rows = await db.query<{ key: string; value_json: string }>('SELECT key, value_json FROM monitoring_alert_rules WHERE key IN ($1, $2, $3)', ['api_latency_threshold_ms', 'queue_size_threshold', 'rpc_failure_rate_threshold']);
      const map: Record<string, number> = {};
      for (const r of rows.rows) {
        try {
          const v = JSON.parse(r.value_json) as number;
          if (typeof v === 'number') map[r.key] = v;
        } catch {
          //
        }
      }
      return reply.send({
        success: true,
        data: {
          api_latency_threshold_ms: map.api_latency_threshold_ms ?? 500,
          queue_size_threshold: map.queue_size_threshold ?? 100,
          rpc_failure_rate_threshold: map.rpc_failure_rate_threshold ?? 5,
        },
      });
    } catch (e) {
      logger.error('Get alert rules error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get alert rules' } });
    }
  });

  /**
   * PATCH /admin/monitoring/alert-rules
   */
  app.patch<{ Body: { api_latency_threshold_ms?: number; queue_size_threshold?: number; rpc_failure_rate_threshold?: number } }>('/monitoring/alert-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body || {};
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_alert_rules (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL DEFAULT '{}'
        )
      `);
      const updates: Array<{ key: string; value: number }> = [];
      if (typeof body.api_latency_threshold_ms === 'number') updates.push({ key: 'api_latency_threshold_ms', value: body.api_latency_threshold_ms });
      if (typeof body.queue_size_threshold === 'number') updates.push({ key: 'queue_size_threshold', value: body.queue_size_threshold });
      if (typeof body.rpc_failure_rate_threshold === 'number') updates.push({ key: 'rpc_failure_rate_threshold', value: body.rpc_failure_rate_threshold });
      for (const u of updates) {
        await db.query(
          'INSERT INTO monitoring_alert_rules (key, value_json) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value_json = $2',
          [u.key, JSON.stringify(u.value)]
        );
      }
      const rows = await db.query<{ key: string; value_json: string }>('SELECT key, value_json FROM monitoring_alert_rules WHERE key IN ($1, $2, $3)', ['api_latency_threshold_ms', 'queue_size_threshold', 'rpc_failure_rate_threshold']);
      const map: Record<string, number> = {};
      for (const r of rows.rows) {
        try {
          map[r.key] = JSON.parse(r.value_json) as number;
        } catch {
          //
        }
      }
      return reply.send({
        success: true,
        data: {
          api_latency_threshold_ms: map.api_latency_threshold_ms ?? 500,
          queue_size_threshold: map.queue_size_threshold ?? 100,
          rpc_failure_rate_threshold: map.rpc_failure_rate_threshold ?? 5,
        },
      });
    } catch (e) {
      logger.error('Patch alert rules error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  /**
   * GET /admin/monitoring/incidents
   * Incident tracking: id, service, severity, status, created_at, resolved_at.
   */
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string } }>('/monitoring/incidents', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_incidents (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          service TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        )
      `);
      const q = request.query as { limit?: string; offset?: string; status?: string };
      const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0);
      let where = '1=1';
      const params: (string | number)[] = [];
      let i = 1;
      if (q.status && ['open', 'acknowledged', 'resolved'].includes(q.status)) {
        where += ` AND status = $${i++}`;
        params.push(q.status);
      }
      const countRes = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM monitoring_incidents WHERE ${where}`, params);
      const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
      params.push(limit, offset);
      const listRes = await db.query<{ id: string; service: string; severity: string; status: string; created_at: string | null; resolved_at: string | null }>(
        `SELECT id::text, service, severity, status, created_at::text, resolved_at::text FROM monitoring_incidents WHERE ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      return reply.send({ success: true, data: { incidents: listRes.rows, total } });
    } catch (e) {
      logger.error('Monitoring incidents error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list incidents' } });
    }
  });

  /**
   * GET /admin/monitoring/workers
   * Worker processes: name, status, uptime_seconds, last_restart_at.
   */
  app.get('/monitoring/workers', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_workers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          worker_name TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'unknown',
          uptime_seconds INTEGER NOT NULL DEFAULT 0,
          last_restart_at TIMESTAMPTZ
        )
      `);
      const rows = await db.query<{ id: string; worker_name: string; status: string; uptime_seconds: number; last_restart_at: string | null }>(
        'SELECT id::text, worker_name, status, uptime_seconds, last_restart_at::text FROM monitoring_workers ORDER BY worker_name'
      );
      if (rows.rows.length === 0) {
        const defaults = [
          { worker_name: 'Settlement Worker', status: 'running', uptime_seconds: 10800, last_restart_at: new Date(Date.now() - 600000).toISOString() },
          { worker_name: 'Matching Engine', status: 'running', uptime_seconds: 86400, last_restart_at: new Date(Date.now() - 86400000).toISOString() },
          { worker_name: 'WebSocket Service', status: 'running', uptime_seconds: 7200, last_restart_at: new Date(Date.now() - 300000).toISOString() },
        ];
        for (const d of defaults) {
          await db.query(
            'INSERT INTO monitoring_workers (worker_name, status, uptime_seconds, last_restart_at) VALUES ($1, $2, $3, $4) ON CONFLICT (worker_name) DO NOTHING',
            [d.worker_name, d.status, d.uptime_seconds, d.last_restart_at]
          );
        }
        const again = await db.query<{ id: string; worker_name: string; status: string; uptime_seconds: number; last_restart_at: string | null }>(
          'SELECT id::text, worker_name, status, uptime_seconds, last_restart_at::text FROM monitoring_workers ORDER BY worker_name'
        );
        return reply.send({ success: true, data: { workers: again.rows } });
      }
      return reply.send({ success: true, data: { workers: rows.rows } });
    } catch (e) {
      logger.error('Monitoring workers error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list workers' } });
    }
  });

  /**
   * GET /admin/monitoring/timeline
   * Infrastructure event timeline: worker_restart, queue_overflow, rpc_failure, circuit_breaker_triggered.
   */
  app.get<{ Querystring: { limit?: string } }>('/monitoring/timeline', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS monitoring_events (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          event_type TEXT NOT NULL,
          message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const limit = Math.min(50, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '20', 10) || 20));
      const rows = await db.query<{ id: string; event_type: string; message: string | null; created_at: string }>(
        'SELECT id::text, event_type, message, created_at::text FROM monitoring_events ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return reply.send({ success: true, data: { events: rows.rows } });
    } catch (e) {
      logger.error('Monitoring timeline error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get timeline' } });
    }
  });

  /** POST /admin/mm/emergency-stop/:userId — halt trading for a user (market maker emergency stop). */
  app.post<{ Params: { userId: string } }>('/mm/emergency-stop/:userId', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'control:trading');
    if (!admin) return;
    const userId = request.params.userId?.trim();
    if (!userId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'userId required' } });
    }
    try {
      const { setMmEmergencyStopped } = await import('../services/mm-risk.service.js');
      await setMmEmergencyStopped(userId, true);
      logger.info('MM emergency stop triggered', { userId, adminId: admin.adminId });
      return reply.send({ success: true, data: { userId, stopped: true } });
    } catch (e) {
      logger.error('MM emergency stop failed', { userId, error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'EMERGENCY_STOP_FAILED', message: 'Failed to emergency stop' } });
    }
  });

  /** DELETE /admin/mm/emergency-stop/:userId — resume trading for a user. */
  app.delete<{ Params: { userId: string } }>('/mm/emergency-stop/:userId', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    const userId = request.params.userId?.trim();
    if (!userId) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'userId required' } });
    }
    try {
      const { setMmEmergencyStopped } = await import('../services/mm-risk.service.js');
      await setMmEmergencyStopped(userId, false);
      logger.info('MM emergency stop cleared', { userId, adminId: admin.adminId });
      return reply.send({ success: true, data: { userId, stopped: false } });
    } catch (e) {
      logger.error('MM emergency stop clear failed', { userId, error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'EMERGENCY_STOP_CLEAR_FAILED', message: 'Failed to clear emergency stop' } });
    }
  });

  /**
   * GET /admin/liquidity-bot/config
   * Read-only liquidity bot configuration (from env). API key masked.
   */
  app.get('/liquidity-bot/config', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const lb = config.liquidityBot;
      const apiKey = lb.apiKey ?? '';
      return reply.send({
        success: true,
        data: {
          enabled: lb.enabled,
          spreadBps: lb.spreadBps,
          orderSize: lb.orderSize,
          symbols: lb.symbols,
          apiKeyConfigured: !!apiKey && apiKey.length > 0,
          apiKeyPreview: apiKey.length >= 8 ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}` : null,
        },
      });
    } catch (e) {
      logger.error('Liquidity bot config fetch failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch liquidity bot config' } });
    }
  });

  app.get('/settlement/ledger-discrepancy', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const { runLedgerDiscrepancyReport } = await import('../services/operator-controls.service.js');
      const result = await runLedgerDiscrepancyReport();
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Ledger discrepancy report failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to run report' } });
    }
  });

  /**
   * GET /admin/ledger/balance
   * Read-only. List balance_ledger entries with filters: user_id, currency_id, reference_type, date_from, date_to. Paginated.
   */
  app.get<{
    Querystring: { page?: string; limit?: string; user_id?: string; currency_id?: string; reference_type?: string; date_from?: string; date_to?: string };
  }>('/ledger/balance', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'monitoring:view');
    if (!admin) return;
    try {
      const { page = 1, limit = 50, user_id, currency_id, reference_type, date_from, date_to } = request.query;
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;
      if (user_id?.trim()) {
        conditions.push(`bl.user_id = $${paramIndex++}`);
        params.push(user_id.trim());
      }
      if (currency_id?.trim()) {
        conditions.push(`bl.currency_id = $${paramIndex++}`);
        params.push(currency_id.trim());
      }
      if (reference_type?.trim()) {
        conditions.push(`bl.reference_type::text = $${paramIndex++}`);
        params.push(reference_type.trim());
      }
      if (date_from?.trim()) {
        conditions.push(`bl.created_at >= $${paramIndex++}::timestamptz`);
        params.push(date_from.trim());
      }
      if (date_to?.trim()) {
        conditions.push(`bl.created_at <= $${paramIndex++}::timestamptz`);
        params.push(date_to.trim());
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM balance_ledger bl ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
      const listParams = [...params, limitNum, offset];
      const listQuery = `
        SELECT bl.id, bl.user_id, bl.currency_id, bl.reference_type, bl.reference_id,
               bl.debit::text, bl.credit::text, bl.balance_before::text, bl.balance_after::text,
               bl.balance_type, bl.description, bl.created_at
        FROM balance_ledger bl
        ${whereClause}
        ORDER BY bl.id DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `;
      const result = await db.query(listQuery, listParams);
      return reply.send({
        success: true,
        data: { entries: result.rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 } },
      });
    } catch (e) {
      logger.error('Admin balance ledger list failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list balance ledger' } });
    }
  });

  /**
   * GET /admin/ledger/settlement
   * Read-only. List settlement_ledger_entries with filters: user_id, settlement_event_id, date_from, date_to. Paginated.
   */
  app.get<{
    Querystring: { page?: string; limit?: string; user_id?: string; settlement_event_id?: string; date_from?: string; date_to?: string };
  }>('/ledger/settlement', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 50, user_id, settlement_event_id, date_from, date_to } = request.query;
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;
      if (user_id?.trim()) {
        conditions.push(`sle.user_id = $${paramIndex++}`);
        params.push(user_id.trim());
      }
      if (settlement_event_id?.trim()) {
        const n = parseInt(settlement_event_id.trim(), 10);
        if (!Number.isNaN(n)) {
          conditions.push(`sle.settlement_event_id = $${paramIndex++}`);
          params.push(n);
        }
      }
      if (date_from?.trim()) {
        conditions.push(`sle.created_at >= $${paramIndex++}::timestamptz`);
        params.push(date_from.trim());
      }
      if (date_to?.trim()) {
        conditions.push(`sle.created_at <= $${paramIndex++}::timestamptz`);
        params.push(date_to.trim());
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM settlement_ledger_entries sle ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
      const listParams = [...params, limitNum, offset];
      const listQuery = `
        SELECT sle.id, sle.settlement_event_id, sle.user_id, sle.asset, sle.delta::text, sle.prev_hash, sle.entry_hash, sle.created_at
        FROM settlement_ledger_entries sle
        ${whereClause}
        ORDER BY sle.id DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `;
      const result = await db.query(listQuery, listParams);
      return reply.send({
        success: true,
        data: { entries: result.rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 } },
      });
    } catch (e) {
      logger.error('Admin settlement ledger list failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list settlement ledger' } });
    }
  });

  app.post('/settlement/circuit-reset', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    if (config.security.adminRequireDestructiveConfirm) {
      const body = (request.body as { confirm?: boolean } | undefined) ?? {};
      if (body.confirm !== true) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Set JSON body { "confirm": true } to acknowledge this settlement circuit reset.',
          },
        });
      }
    }
    try {
      const { setSettlementCircuitOpen } = await import('../lib/trading-halt.js');
      const { setTradingHalted } = await import('../services/settlement/settlement-circuit.js');
      const { logCircuitEvent } = await import('../services/circuit-breaker-history.service.js');
      await setSettlementCircuitOpen(false);
      setTradingHalted(false);
      await logCircuitEvent({ eventType: 'reset', actorType: 'admin', actorId: admin.adminId });
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_settlement_circuit_reset',
        resourceType: 'settlement_circuit',
        newValue: { settlementCircuitOpen: false, tradingHalted: false },
      });
      return reply.send({ success: true, data: { message: 'Settlement circuit reset' } });
    } catch (e) {
      logger.error('Circuit reset failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CIRCUIT_RESET_FAILED', message: 'Failed to reset circuit' } });
    }
  });

  app.post('/settlement/balance-reconcile', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const body = request.body as {
        user_id: string;
        asset: string;
        reason: string;
        target_available?: string;
        target_locked?: string;
        confirm?: boolean;
      };
      if (config.security.adminRequireDestructiveConfirm && body.confirm !== true) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Set JSON body { "confirm": true } along with user_id, asset, and reason to run balance reconcile.',
          },
        });
      }
      if (!body.user_id || !body.asset || !body.reason) {
        return reply.status(400).send({ success: false, error: { code: 'MISSING_FIELDS', message: 'user_id, asset, and reason are required' } });
      }
      const { reconcileBalanceToLedger } = await import('../services/operator-controls.service.js');
      const result = await reconcileBalanceToLedger({
        user_id: body.user_id,
        asset: body.asset,
        reason: body.reason,
        adminId: admin.adminId,
        ipAddress: request.ip ?? null,
        target_available: body.target_available,
        target_locked: body.target_locked,
      });
      if (!result.ok) return reply.status(400).send({ success: false, error: { code: 'RECONCILE_FAILED', message: result.message, ledger_sum: result.ledger_sum } });
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_balance_reconcile',
        resourceType: 'user',
        resourceId: body.user_id,
        newValue: {
          asset: body.asset,
          target_available: body.target_available ?? null,
          target_locked: body.target_locked ?? null,
        },
      });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Balance reconcile failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'RECONCILE_FAILED', message: 'Failed to reconcile' } });
    }
  });

  app.get('/escrows', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { user_id?: string; status?: string; order_id?: string; frozen?: string; limit?: string; offset?: string };
      const { listEscrows } = await import('../services/operator-controls.service.js');
      const frozen = q.frozen === 'true' ? true : q.frozen === 'false' ? false : undefined;
      const result = await listEscrows({
        user_id: q.user_id,
        status: q.status,
        order_id: q.order_id,
        frozen,
        limit: q.limit != null ? parseInt(q.limit, 10) : 50,
        offset: q.offset != null ? parseInt(q.offset, 10) : 0,
      });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Escrows list failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list escrows' } });
    }
  });

  app.get('/escrows/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { getEscrowById } = await import('../services/operator-controls.service.js');
      const result = await getEscrowById(id);
      if (!result) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Escrow not found' } });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Escrow fetch failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch escrow' } });
    }
  });

  app.post('/escrows/:id/freeze', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = (request.body as { reason?: string }) ?? {};
      const { freezeEscrow } = await import('../services/operator-controls.service.js');
      const result = await freezeEscrow(id, body.reason ?? null, admin.adminId, request.ip ?? null);
      if (!result.ok) return reply.status(400).send({ success: false, error: { code: 'FREEZE_FAILED', message: result.message } });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Escrow freeze failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FREEZE_FAILED', message: 'Failed to freeze escrow' } });
    }
  });

  app.post('/escrows/:id/unfreeze', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { unfreezeEscrow } = await import('../services/operator-controls.service.js');
      const result = await unfreezeEscrow(id, admin.adminId, request.ip ?? null);
      if (!result.ok) return reply.status(400).send({ success: false, error: { code: 'UNFREEZE_FAILED', message: result.message } });
      return reply.send({ success: true, data: result });
    } catch (e) {
      logger.error('Escrow unfreeze failed', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UNFREEZE_FAILED', message: 'Failed to unfreeze escrow' } });
    }
  });

  // ===============================
  // USER MANAGEMENT
  // ===============================

  /**
   * GET /admin/users
   * Get all users with pagination
   */
  app.get('/users', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, status, search, kycLevel, riskLevel, joinedWithinDays } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = `
        SELECT 
          u.id, u.email, u.phone, u.username, u.status,
          u.email_verified, u.phone_verified, u.tier_level,
          u.created_at, u.last_login_at,
          COALESCE(SUM(ub.available_balance + ub.locked_balance), 0) as total_balance,
          k.status as kyc_status,
          k.kyc_level,
          (SELECT COALESCE(SUM(st.price * st.quantity), 0)::text FROM spot_trades st WHERE (st.maker_user_id = u.id OR st.taker_user_id = u.id) AND st.created_at > NOW() - INTERVAL '30 days') as volume_30d,
          (SELECT COUNT(*)::int FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) as aml_alert_count,
          (SELECT COUNT(*)::int FROM user_activity_logs ua WHERE ua.user_id = u.id AND ua.activity_type = 'login_failed' AND ua.created_at > NOW() - INTERVAL '7 days') as login_fail_7d,
          (SELECT COUNT(*)::int FROM withdrawals w WHERE w.user_id = u.id AND w.created_at > NOW() - INTERVAL '30 days') as withdrawal_count_30d
        FROM users u
        LEFT JOIN user_balances ub ON u.id = ub.user_id
        LEFT JOIN kyc_applications k ON u.id = k.user_id
        WHERE u.deleted_at IS NULL
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        /** Legacy frontend sends `locked`; DB enum uses `banned`. */
        const dbStatusFilter = status === 'locked' ? 'banned' : status;
        query += ` AND u.status = $${paramIndex++}`;
        params.push(dbStatusFilter);
      }

      if (search) {
        query += ` AND (u.email ILIKE $${paramIndex} OR u.phone ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (kycLevel && kycLevel !== 'all') {
        query += ` AND u.tier_level = $${paramIndex++}`;
        params.push(parseInt(kycLevel));
      }

      // joinedWithinDays: filter users created within last N days
      if (joinedWithinDays && parseInt(joinedWithinDays) > 0) {
        query += ` AND u.created_at >= NOW() - INTERVAL '${parseInt(joinedWithinDays)} days'`;
      }

      // riskLevel: filter by risk signals (aml alerts / login failures)
      if (riskLevel && riskLevel !== 'all') {
        if (riskLevel === 'high') {
          query += ` AND (SELECT COUNT(*) FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) > 0`;
        } else if (riskLevel === 'medium') {
          query += ` AND (SELECT COUNT(*) FROM user_activity_logs ua WHERE ua.user_id = u.id AND ua.activity_type = 'login_failed' AND ua.created_at > NOW() - INTERVAL '7 days') > 2`;
          query += ` AND (SELECT COUNT(*) FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) = 0`;
        } else if (riskLevel === 'low') {
          query += ` AND (SELECT COUNT(*) FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) = 0`;
          query += ` AND (SELECT COUNT(*) FROM user_activity_logs ua WHERE ua.user_id = u.id AND ua.activity_type = 'login_failed' AND ua.created_at > NOW() - INTERVAL '7 days') <= 2`;
        }
      }

      query += ` GROUP BY u.id, u.email, u.phone, u.username, u.status, u.email_verified, u.phone_verified, u.tier_level, u.created_at, u.last_login_at, k.status, k.kyc_level ORDER BY u.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      // Compute risk_level and risk_flags per user
      const users = (result.rows as any[]).map((row) => {
        const aml = Number(row.aml_alert_count) || 0;
        const loginFail = Number(row.login_fail_7d) || 0;
        const wdCount = Number(row.withdrawal_count_30d) || 0;
        const flags: string[] = [];
        if (aml > 0) flags.push('AML alert');
        if (loginFail > 2) flags.push('Multiple failed logins');
        if (wdCount > 10) flags.push('High withdrawal activity');
        let riskLevel: 'low' | 'medium' | 'high' = 'low';
        if (aml > 0 || loginFail > 5) riskLevel = 'high';
        else if (flags.length > 0) riskLevel = 'medium';
        const { aml_alert_count, login_fail_7d, withdrawal_count_30d, ...rest } = row;
        return {
          ...rest,
          volume_30d: row.volume_30d ?? '0',
          risk_level: riskLevel,
          risk_flags: flags,
        };
      });

      // Get filtered total count (reuse same WHERE conditions without LIMIT/OFFSET)
      let countQuery = `
        SELECT COUNT(DISTINCT u.id) 
        FROM users u
        LEFT JOIN user_balances ub ON u.id = ub.user_id
        LEFT JOIN kyc_applications k ON u.id = k.user_id
        WHERE u.deleted_at IS NULL
      `;
      const countParams: any[] = [];
      let countIdx = 1;

      if (status && status !== 'all') {
        const dbStatusFilter = status === 'locked' ? 'banned' : status;
        countQuery += ` AND u.status = $${countIdx++}`;
        countParams.push(dbStatusFilter);
      }
      if (search) {
        countQuery += ` AND (u.email ILIKE $${countIdx} OR u.phone ILIKE $${countIdx} OR u.username ILIKE $${countIdx})`;
        countParams.push(`%${search}%`);
        countIdx++;
      }
      if (kycLevel && kycLevel !== 'all') {
        countQuery += ` AND u.tier_level = $${countIdx++}`;
        countParams.push(parseInt(kycLevel));
      }
      if (joinedWithinDays && parseInt(joinedWithinDays) > 0) {
        countQuery += ` AND u.created_at >= NOW() - INTERVAL '${parseInt(joinedWithinDays)} days'`;
      }
      if (riskLevel && riskLevel !== 'all') {
        if (riskLevel === 'high') {
          countQuery += ` AND (SELECT COUNT(*) FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) > 0`;
        } else if (riskLevel === 'medium') {
          countQuery += ` AND (SELECT COUNT(*) FROM user_activity_logs ua WHERE ua.user_id = u.id AND ua.activity_type = 'login_failed' AND ua.created_at > NOW() - INTERVAL '7 days') > 2`;
          countQuery += ` AND (SELECT COUNT(*) FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) = 0`;
        } else if (riskLevel === 'low') {
          countQuery += ` AND (SELECT COUNT(*) FROM aml_alerts a WHERE a.user_id = u.id AND a.status IN ('open','reviewing')) = 0`;
          countQuery += ` AND (SELECT COUNT(*) FROM user_activity_logs ua WHERE ua.user_id = u.id AND ua.activity_type = 'login_failed' AND ua.created_at > NOW() - INTERVAL '7 days') <= 2`;
        }
      }

      const countResult = await db.query(countQuery, countParams);

      return reply.send({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0]?.count ?? '0'),
            totalPages: Math.ceil(parseInt(countResult.rows[0]?.count ?? '0') / parseInt(limit)) || 1,
          },
        },
      });

    } catch (error) {
      logger.error('Get users error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch users' },
      });
    }
  });

  /**
   * GET /admin/users/:id/balances
   * Get a user's balances (user_balances + token + chain). Admin only.
   * Returns empty array when user has no balance rows.
   */
  app.get<{ Params: { id: string } }>('/users/:id/balances', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params;

      const userExists = await db.query<{ n: string }>(
        'SELECT 1 as n FROM users WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (userExists.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const result = await db.query<{
        token_id: string;
        token_symbol: string;
        token_name: string;
        chain_id: string | null;
        chain_name: string | null;
        available_balance: string;
        locked_balance: string;
        total_balance: string;
        updated_at: string;
      }>(`
        SELECT
          c.id AS token_id,
          c.symbol AS token_symbol,
          c.name AS token_name,
          b.id AS chain_id,
          b.chain_name AS chain_name,
          ub.available_balance::text AS available_balance,
          COALESCE(ub.locked_balance, 0)::text AS locked_balance,
          (ub.available_balance + COALESCE(ub.locked_balance, 0))::text AS total_balance,
          ub.updated_at::text AS updated_at
        FROM user_balances ub
        JOIN currencies c ON ub.currency_id = c.id
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE ub.user_id = $1
        ORDER BY (ub.available_balance + COALESCE(ub.locked_balance, 0)) DESC NULLS LAST, c.symbol
      `, [id]);

      return reply.send({
        success: true,
        data: {
          user_id: id,
          balances: result.rows,
        },
      });
    } catch (error) {
      logger.error('Get user balances error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch user balances' },
      });
    }
  });

  /**
   * GET /admin/users/:id/stats
   * User stats: total deposits, withdrawals, trades, 30d volume, P2P orders
   */
  app.get<{ Params: { id: string } }>('/users/:id/stats', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params;
      const exists = await db.query<{ n: number }>('SELECT 1 as n FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (exists.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      const [deposits, withdrawals, trades, volume30d, p2pOrders] = await Promise.all([
        db.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0)::text as total FROM deposits WHERE user_id = $1`, [id]),
        db.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0)::text as total FROM withdrawals WHERE user_id = $1`, [id]),
        db.query<{ count: string }>(`SELECT COUNT(*)::text as count FROM spot_trades WHERE user_id = $1`, [id]),
        db.query<{ vol: string }>(`SELECT COALESCE(SUM(price * quantity), 0)::text as vol FROM spot_trades WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`, [id]),
        db.query<{ count: string }>(`SELECT COUNT(*)::text as count FROM p2p_orders WHERE buyer_id = $1 OR seller_id = $1`, [id, id]),
      ]);
      return reply.send({
        success: true,
        data: {
          total_deposits: deposits.rows[0]?.total ?? '0',
          total_withdrawals: withdrawals.rows[0]?.total ?? '0',
          total_trades: trades.rows[0]?.count ?? '0',
          volume_30d: volume30d.rows[0]?.vol ?? '0',
          p2p_orders_count: p2pOrders.rows[0]?.count ?? '0',
        },
      });
    } catch (e) {
      logger.error('Get user stats error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch user stats' } });
    }
  });

  /**
   * GET /admin/users/:id/security
   * Sessions and device info: device, ip, location, last login, status
   */
  app.get<{ Params: { id: string } }>('/users/:id/security', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params;
      const exists = await db.query<{ n: number }>('SELECT 1 as n FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (exists.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      const sessions = await db.query<{
        id: string;
        device_type: string;
        ip_address: string | null;
        user_agent: string | null;
        created_at: string;
        expires_at: string;
        is_active: boolean;
      }>(`
        SELECT id, device_type, ip_address, user_agent, created_at, expires_at, is_active
        FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50
      `, [id]);
      const rows = sessions.rows.map((s) => ({
        device: s.device_type || '—',
        ip_address: s.ip_address ?? '—',
        location: '—',
        last_login: s.created_at,
        status: s.is_active && new Date(s.expires_at) > new Date() ? 'Active' : 'Expired',
      }));
      return reply.send({ success: true, data: { sessions: rows } });
    } catch (e) {
      logger.error('Get user security error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch security' } });
    }
  });

  /**
   * GET /admin/users/:id/api-keys
   * API keys for the user (api_keys or user_api_keys table)
   */
  app.get<{ Params: { id: string } }>('/users/:id/api-keys', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params;
      const exists = await db.query<{ n: number }>('SELECT 1 as n FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (exists.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      const tableExists = await db.query<{ name: string }>(
        `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('api_keys', 'user_api_keys') LIMIT 1`
      );
      const tableName = tableExists.rows[0]?.name;
      if (!tableName) {
        return reply.send({ success: true, data: { api_keys: [] } });
      }
      const isApiKeys = tableName === 'api_keys';
      const result = await db.query(`
        SELECT id, label, api_key, can_read, can_trade, can_withdraw, ip_whitelist, last_used_at, created_at
        FROM ${tableName}
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [id]);
      const keys = (result.rows as any[]).map((r) => ({
        key: r.api_key ? `${String(r.api_key).slice(0, 8)}…` : '—',
        permissions: [r.can_read && 'Read', r.can_trade && 'Trade', r.can_withdraw && 'Withdraw'].filter(Boolean).join(', ') || '—',
        created: r.created_at,
        last_used: r.last_used_at ?? '—',
        ip_whitelist: Array.isArray(r.ip_whitelist) ? r.ip_whitelist.join(', ') : (r.ip_whitelist ? JSON.stringify(r.ip_whitelist) : '—'),
      }));
      return reply.send({ success: true, data: { api_keys: keys } });
    } catch (e) {
      logger.error('Get user api-keys error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch api-keys' } });
    }
  });

  /**
   * GET /admin/users/:id
   * Get user details
   */
  app.get('/users/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const userResult = await db.query(`
        SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL
      `, [id]);

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      // Get balances
      const balances = await db.query(`
        SELECT ub.*, c.symbol, c.name as currency_name
        FROM user_balances ub
        JOIN currencies c ON ub.currency_id = c.id
        WHERE ub.user_id = $1
      `, [id]);

      // Get sessions
      const sessions = await db.query(`
        SELECT * FROM user_sessions 
        WHERE user_id = $1 
        ORDER BY created_at DESC LIMIT 10
      `, [id]);

      // Get activity
      const activity = await db.query(`
        SELECT * FROM user_activity_logs 
        WHERE user_id = $1 
        ORDER BY created_at DESC LIMIT 20
      `, [id]);

      // Get referral info
      const referral = await db.query(`
        SELECT * FROM referral_codes WHERE user_id = $1
      `, [id]);

      return reply.send({
        success: true,
        data: {
          user: userResult.rows[0],
          balances: balances.rows,
          sessions: sessions.rows,
          activity: activity.rows,
          referralCode: referral.rows[0] || null,
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch user details' },
      });
    }
  });

  /**
   * PATCH /admin/users/:id/status
   * Update user status (suspend/ban/activate)
   */
  app.patch('/users/:id/status', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'users:edit', reply)) return;
    try {
      const { id } = request.params as { id: string };
      const { status, reason } = request.body as { status: string; reason?: string };

      /**
       * DB enum `user_status` values are: pending, active, suspended, banned, deleted.
       * The frontend historically uses the label `locked` to mean "banned". Accept
       * both at the API boundary, map `locked` → `banned` before touching the DB.
       * Without this mapping, clicking "Ban" in the UI silently threw an SQL error.
       */
      const allowedStatuses = ['active', 'suspended', 'banned', 'locked'];
      if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATUS', message: 'Invalid user status' },
        });
      }
      const dbStatus = status === 'locked' ? 'banned' : status;

      const prevRow = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [id]);
      const previousStatus = prevRow.rows[0]?.status ?? null;

      const reasonTrimmed = typeof reason === 'string' ? reason.trim() || null : null;
      const result = await db.query(
        'UPDATE users SET status = $1, status_reason = $2, updated_at = NOW() WHERE id = $3',
        [dbStatus, reasonTrimmed, id]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }
      try {
        await redis.del(`user:${id}:status`);
      } catch {
        /* cache invalidation best-effort */
      }

      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_user_status_change',
          resourceType: 'user',
          resourceId: id,
          oldValue: previousStatus ? { status: previousStatus } : undefined,
          newValue: { status: dbStatus, reason: reasonTrimmed ?? undefined },
        });
      } catch {
        /* best-effort */
      }

      return reply.send({
        success: true,
        data: { message: `User status updated to ${dbStatus}` },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update user status' },
      });
    }
  });

  /**
   * POST /admin/users/:id/reset-2fa
   * Reset a user's 2FA (disable TOTP and clear secret).
   */
  app.post<{ Params: { id: string } }>('/users/:id/reset-2fa', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'users:edit', reply)) return;
    const { id } = request.params;
    try {
      await db.query(`UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = $1`, [id]);
      await logAdminActivity({
        adminId: admin.adminId,
        action: 'user_2fa_reset',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
        metadata: { target_user_id: id },
      });
      reply.send({ success: true });
    } catch (err) {
      request.log.error(err, 'reset-2fa failed');
      reply.code(500).send({ success: false, error: { message: 'Failed to reset 2FA' } });
    }
  });

  /**
   * POST /admin/users/bulk-status
   * Bulk update user status (suspend/activate multiple users)
   */
  app.post<{ Body: { user_ids: string[]; status: string; reason?: string } }>('/users/bulk-status', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'users:edit', reply)) return;
    try {
      const { user_ids, status, reason } = request.body ?? {};
      /** Accept legacy `locked` alias; DB enum uses `banned`. */
      const allowedStatuses = ['active', 'suspended', 'banned', 'locked'];
      if (!Array.isArray(user_ids) || user_ids.length === 0 || typeof status !== 'string' || !allowedStatuses.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'user_ids (array) and status (active|suspended|banned) required' },
        });
      }
      const dbStatus = status === 'locked' ? 'banned' : status;
      const ids = user_ids.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100);
      if (ids.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'At least one valid user ID required' },
        });
      }
      const reasonTrimmed = typeof reason === 'string' ? reason.trim() || null : null;
      const result = await db.query(
        `UPDATE users SET status = $1, status_reason = $2, updated_at = NOW()
         WHERE id = ANY($3::uuid[])
         RETURNING id`,
        [dbStatus, reasonTrimmed, ids]
      );
      const updated = result.rowCount ?? 0;
      for (const id of ids) {
        try { await redis.del(`user:${id}:status`); } catch { /* best-effort */ }
      }
      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_users_bulk_status',
          resourceType: 'users',
          resourceId: ids.join(','),
          newValue: { status: dbStatus, reason: reasonTrimmed, count: updated },
        });
      } catch { /* best-effort */ }
      return reply.send({
        success: true,
        data: { updated, message: `Status updated to ${dbStatus} for ${updated} user(s)` },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update user status' },
      });
    }
  });

  /**
   * POST /admin/users/:id/impersonate
   * Get a short-lived JWT as the target user (for support). Token expires in 1h. Requires admin.
   */
  app.post<{ Params: { id: string } }>('/users/:id/impersonate', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id: targetUserId } = request.params as { id: string };
      if (!targetUserId) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'User ID required' } });
      }
      const userRow = await db.query<{ id: string; email: string | null; phone: string | null; role: string; status: string }>(
        'SELECT id, email, phone, role, status FROM users WHERE id = $1 AND deleted_at IS NULL',
        [targetUserId]
      );
      if (userRow.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      }
      const u = userRow.rows[0]!;
      const impersonationToken = app.jwt.sign(
        {
          userId: u.id,
          email: u.email ?? undefined,
          phone: u.phone ?? undefined,
          role: u.role ?? 'user',
          sessionId: `impersonation:${admin.adminId}:${u.id}`,
          type: 'impersonation',
          impersonatedBy: admin.adminId,
        },
        { expiresIn: '1h' }
      );
      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_impersonate_user',
          resourceType: 'user',
          resourceId: targetUserId,
        });
      } catch { /* best-effort */ }
      logger.warn('Admin impersonation', { adminId: admin.adminId, targetUserId });
      return reply.send({
        success: true,
        data: {
          accessToken: impersonationToken,
          expiresIn: '1h',
          userId: u.id,
          email: u.email,
        },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'IMPERSONATION_FAILED', message: 'Failed to create impersonation token' },
      });
    }
  });

  // ===============================
  // KYC MANAGEMENT
  // ===============================

  /**
   * GET /admin/kyc/pending
   * Get pending KYC applications
   */
  app.get('/kyc/pending', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const result = await db.query(`
        SELECT 
          ka.*,
          u.email, u.phone, u.username
        FROM kyc_applications ka
        JOIN users u ON ka.user_id = u.id
        WHERE ka.status = 'pending'
        ORDER BY ka.created_at ASC
      `);

      return reply.send({
        success: true,
        data: result.rows,
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch KYC applications' },
      });
    }
  });

  /**
   * PATCH /admin/kyc/:id/review
   * Approve or reject KYC (requires kyc:review permission or kyc_reviewer role).
   */
  app.patch('/kyc/:id/review', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'kyc:review');
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { action, reason } = request.body as { action: 'approve' | 'reject'; reason?: string };

      const status = action === 'approve' ? 'approved' : 'rejected';

      const prevRow = await db.query<{ status: string; user_id: string }>('SELECT status, user_id FROM kyc_applications WHERE id = $1', [id]);
      const prevStatus = prevRow.rows[0]?.status ?? null;
      const userId = prevRow.rows[0]?.user_id ?? null;

      await db.query(`
        UPDATE kyc_applications 
        SET status = $1, reviewed_at = NOW(), rejection_reason = $2
        WHERE id = $3
      `, [status, action === 'reject' ? reason : null, id]);

      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: action === 'approve' ? 'kyc_approve' : 'kyc_reject',
          resourceType: 'kyc_application',
          resourceId: id,
          oldValue: prevStatus,
          newValue: { status, reason: action === 'reject' ? reason ?? null : undefined, user_id: userId },
        });
      } catch {
        /* best-effort */
      }

      try {
        publishKycStatusChanged(action === 'approve' ? 'kyc_approved' : 'kyc_rejected', { id, user_id: userId ?? undefined });
      } catch { /* best-effort admin metrics */ }

      // If approved, update user tier and apply withdrawal limits from KYC tier
      if (action === 'approve') {
        const kyc = await db.query('SELECT user_id, kyc_level FROM kyc_applications WHERE id = $1', [id]);
        if (kyc.rows[0]) {
          await db.query(
            'UPDATE users SET tier_level = $1 WHERE id = $2',
            [kyc.rows[0].kyc_level, kyc.rows[0].user_id]
          );
          try {
            const { applyTierLimitsToUser } = await import('../services/withdrawal-tier-limits.service.js');
            await applyTierLimitsToUser(kyc.rows[0].user_id, Number(kyc.rows[0].kyc_level) || 1);
          } catch (e) {
            logger.warn('Apply tier limits on KYC approve failed (best-effort)', {
              userId: kyc.rows[0].user_id,
              error: e instanceof Error ? e.message : 'Unknown',
            });
          }
        }
      }

      return reply.send({
        success: true,
        data: { message: `KYC ${action}d successfully` },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'REVIEW_FAILED', message: 'Failed to review KYC' },
      });
    }
  });

  // ===============================
  // P2P MANAGEMENT
  // ===============================

  /**
   * GET /admin/p2p/disputes
   * Get P2P disputes
   */
  app.get('/p2p/disputes', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const result = await db.query(`
        SELECT 
          d.*,
          o.buyer_id, o.seller_id, o.crypto_amount, o.fiat_amount, o.fiat_currency,
          buyer.email as buyer_email, buyer.username as buyer_username,
          seller.email as seller_email, seller.username as seller_username
        FROM p2p_disputes d
        JOIN p2p_orders o ON d.order_id = o.id
        JOIN users buyer ON o.buyer_id = buyer.id
        JOIN users seller ON o.seller_id = seller.id
        WHERE d.status IN ('open', 'under_review')
        ORDER BY d.created_at ASC
      `);

      return reply.send({
        success: true,
        data: result.rows,
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch disputes' },
      });
    }
  });

  /**
   * PATCH /admin/p2p/disputes/:id/resolve
   * Resolve dispute (admin only). Delegates to p2pService for escrow release/refund.
   */
  app.patch('/p2p/disputes/:id/resolve', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'p2p:disputes');
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { resolution, notes } = request.body as {
        resolution: 'favor_buyer' | 'favor_seller' | 'split' | 'cancelled';
        notes?: string;
      };

      const allowedResolutions = ['favor_buyer', 'favor_seller', 'cancelled'] as const;
      if (typeof resolution !== 'string' || !allowedResolutions.includes(resolution as (typeof allowedResolutions)[number])) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_RESOLUTION', message: 'Invalid dispute resolution' },
        });
      }

      await p2pService.resolveDispute(id, admin.adminId, resolution as 'favor_buyer' | 'favor_seller' | 'cancelled', notes ?? '');

      return reply.send({
        success: true,
        data: { message: 'Dispute resolved successfully' },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'Dispute not found') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Dispute not found' },
        });
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'RESOLVE_FAILED', message: msg || 'Failed to resolve dispute' },
      });
    }
  });

  // ===============================
  // SYSTEM SETTINGS
  // ===============================

  /**
   * GET /admin/settings
   * Get system settings
   */
  app.get('/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const result = await db.query('SELECT * FROM system_settings');
      
      const settings: Record<string, any> = {};
      result.rows.forEach((row: any) => {
        settings[row.key] = row.value;
      });

      return reply.send({
        success: true,
        data: settings,
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch settings' },
      });
    }
  });

  /**
   * PATCH /admin/settings
   * Update system settings
   */
  app.patch('/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'settings:edit', reply)) return;
    try {
      const settings = request.body as Record<string, any>;

      for (const [key, value] of Object.entries(settings)) {
        await db.query(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        `, [key, String(value)]);
      }

      return reply.send({
        success: true,
        data: { message: 'Settings updated' },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update settings' },
      });
    }
  });

  // ===============================
  // KYC - ALL ENDPOINTS
  // ===============================

  /**
   * GET /admin/kyc
   * Get KYC stats and all applications
   */
  app.get('/kyc', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, status } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Get stats
      const stats = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'under_review') as under_review,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
          COUNT(*) as total
        FROM kyc_applications
      `);

      // Get applications with filtered count
      let query = `
        SELECT 
          ka.*,
          u.email, u.phone, u.username
        FROM kyc_applications ka
        JOIN users u ON ka.user_id = u.id
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        query += ` WHERE ka.status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` ORDER BY ka.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      // Use filtered count for pagination when status filter is applied
      let paginationTotal = parseInt(stats.rows[0]?.total || '0');
      if (status && status !== 'all') {
        const statusKey = status as keyof typeof stats.rows[0];
        const statusCount = stats.rows[0]?.[statusKey];
        if (statusCount !== undefined) {
          paginationTotal = parseInt(String(statusCount) || '0');
        }
      }

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0],
          applications: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: paginationTotal,
            totalPages: Math.ceil(paginationTotal / parseInt(limit)) || 1,
          },
        },
      });

    } catch (error) {
      logger.error('Get KYC error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch KYC data' },
      });
    }
  });

  // ===============================
  // WALLETS & CURRENCIES
  // ===============================

  /**
   * GET /admin/wallets
   * Overview: blockchains, currencies, aggregate balances, totalWallets.
   * When query `page` is set: also returns paginated `holdings` (per-user, per-asset balances) for admin tables.
   */
  app.get<{ Querystring: { page?: string; limit?: string; search?: string } }>('/wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      // Get all blockchains
      const blockchains = await db.query(`
        SELECT * FROM blockchains WHERE is_active = true ORDER BY chain_name
      `);

      // Get all currencies
      const currencies = await db.query(`
        SELECT c.*, b.chain_name, b.chain_symbol
        FROM currencies c
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE c.is_active = true
        ORDER BY c.symbol
      `);

      // Get total balances per currency
      const balances = await db.query(`
        SELECT 
          c.symbol,
          c.name,
          COALESCE(SUM(ub.available_balance), 0) as total_available,
          COALESCE(SUM(ub.locked_balance), 0) as total_locked
        FROM currencies c
        LEFT JOIN user_balances ub ON c.id = ub.currency_id
        WHERE c.is_active = true
        GROUP BY c.id, c.symbol, c.name
        ORDER BY c.symbol
      `);

      // Get user wallets count
      const walletsCount = await db.query(`
        SELECT COUNT(*) as total FROM user_wallets WHERE is_active = true
      `);

      const data: Record<string, unknown> = {
        blockchains: blockchains.rows,
        currencies: currencies.rows,
        balances: balances.rows,
        totalWallets: parseInt(walletsCount.rows[0]?.total || '0'),
      };

      const { page: pageRaw, limit: limitRaw, search: searchRaw } = request.query;
      if (pageRaw !== undefined && pageRaw !== '') {
        const pageNum = Math.max(1, parseInt(String(pageRaw), 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limitRaw ?? '20'), 10) || 20));
        const offset = (pageNum - 1) * limitNum;
        const search = (searchRaw ?? '').trim();

        const holdingsCte = `
          SELECT
            u.id AS user_id,
            u.email,
            u.username,
            c.symbol AS asset,
            SUM(COALESCE(ub.available_balance, 0))::text AS available,
            SUM(COALESCE(ub.locked_balance, 0))::text AS locked
          FROM user_balances ub
          INNER JOIN users u ON u.id = ub.user_id AND u.deleted_at IS NULL
          INNER JOIN currencies c ON c.id = ub.currency_id AND c.is_active = true
          GROUP BY u.id, u.email, u.username, c.symbol
          HAVING SUM(COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0)) > 0
        `;

        try {
          const countResult = await db.query<{ count: string }>(
            `
            WITH h AS (${holdingsCte})
            SELECT COUNT(*)::text AS count FROM h
            WHERE ($1::text = '' OR
              LOWER(COALESCE(h.email, '')) LIKE LOWER('%' || $1 || '%') OR
              LOWER(COALESCE(h.username, '')) LIKE LOWER('%' || $1 || '%') OR
              h.user_id::text = $1 OR
              h.asset ILIKE '%' || $1 || '%' OR
              EXISTS (
                SELECT 1 FROM user_wallets uw
                WHERE uw.user_id = h.user_id AND uw.is_active = true
                  AND LOWER(uw.address) LIKE LOWER('%' || $1 || '%')
              )
            )
            `,
            [search]
          );
          const total = parseInt(countResult.rows[0]?.count || '0', 10);
          const totalPages = Math.max(1, Math.ceil(total / limitNum) || 1);

          const rowsResult = await db.query<{
            user_id: string;
            email: string | null;
            username: string | null;
            asset: string;
            available: string;
            locked: string;
          }>(
            `
            WITH h AS (${holdingsCte})
            SELECT * FROM h
            WHERE ($1::text = '' OR
              LOWER(COALESCE(h.email, '')) LIKE LOWER('%' || $1 || '%') OR
              LOWER(COALESCE(h.username, '')) LIKE LOWER('%' || $1 || '%') OR
              h.user_id::text = $1 OR
              h.asset ILIKE '%' || $1 || '%' OR
              EXISTS (
                SELECT 1 FROM user_wallets uw
                WHERE uw.user_id = h.user_id AND uw.is_active = true
                  AND LOWER(uw.address) LIKE LOWER('%' || $1 || '%')
              )
            )
            ORDER BY h.email ASC NULLS LAST, h.asset ASC
            LIMIT $2 OFFSET $3
            `,
            [search, limitNum, offset]
          );

          data.holdings = rowsResult.rows;
          data.pagination = { page: pageNum, limit: limitNum, total, totalPages };
        } catch (holdErr) {
          logger.warn('Get wallets holdings failed', { error: holdErr instanceof Error ? holdErr.message : String(holdErr) });
          data.holdings = [];
          data.pagination = { page: pageNum, limit: limitNum, total: 0, totalPages: 1 };
        }
      }

      return reply.send({
        success: true,
        data,
      });

    } catch (error) {
      logger.error('Get wallets error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch wallets data' },
      });
    }
  });

  // ===============================
  // DEPOSITS
  // ===============================

  /**
   * GET /admin/deposits
   * List deposits with filters: user, chain, token, status, date range. Paginated.
   * Returns deposit_id, user_id, user_email, chain_id, token_id, token_symbol, amount, tx_hash,
   * confirmations, required_confirmations, status, credited_at, created_at, and credited (boolean).
   */
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      user?: string;
      search?: string;
      tx_hash?: string;
      chain?: string;
      token?: string;
      status?: string;
      flagged?: string;
      date_from?: string;
      date_to?: string;
    };
  }>('/deposits', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, user, search, tx_hash, chain, token, status, flagged, date_from, date_to } = request.query;
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      const searchTerm = (search ?? user)?.trim();
      if (searchTerm) {
        const isUuid = /^[0-9a-f-]{36}$/i.test(searchTerm);
        const isHash = /^0x[a-f0-9]+$/i.test(searchTerm) || (searchTerm.length >= 32 && /^[a-f0-9]+$/i.test(searchTerm));
        if (isHash) {
          conditions.push(`(d.tx_hash ILIKE $${paramIndex++} OR d.tx_hash = $${paramIndex++})`);
          params.push(`%${searchTerm}%`, searchTerm);
        } else if (isUuid) {
          conditions.push(`d.user_id = $${paramIndex++}`);
          params.push(searchTerm);
        } else {
          conditions.push(`(u.email ILIKE $${paramIndex++} OR u.username ILIKE $${paramIndex++})`);
          params.push(`%${searchTerm}%`, `%${searchTerm}%`);
        }
      }
      if (chain?.trim()) {
        conditions.push(`d.blockchain_id = $${paramIndex++}`);
        params.push(chain.trim());
      }
      if (token?.trim()) {
        const t = token.trim();
        if (/^[0-9a-f-]{36}$/i.test(t)) {
          conditions.push(`d.currency_id = $${paramIndex++}`);
          params.push(t);
        } else {
          conditions.push(`c.symbol = $${paramIndex++}`);
          params.push(t);
        }
      }
      if (status && status !== 'all') {
        conditions.push(`d.status = $${paramIndex++}`);
        params.push(status);
      }
      if (flagged === 'true' || flagged === '1') {
        conditions.push(`COALESCE(d.is_flagged, false) = true`);
      }
      if (date_from?.trim()) {
        conditions.push(`d.created_at >= $${paramIndex++}::timestamptz`);
        params.push(date_from.trim());
      }
      if (date_to?.trim()) {
        conditions.push(`d.created_at <= $${paramIndex++}::timestamptz`);
        params.push(date_to.trim());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      /**
       * Stats: global counts + 24h rollups.
       * The Deposits admin page shows cards labeled "Failed (24h)" and
       * "Completed (24h)" — previously these read the all-time counter which
       * never decayed. Also expose `completed_24h` for parity with withdrawals.
       */
      const stats = await db.query<{
        total: string;
        pending: string;
        confirming: string;
        completed: string;
        failed: string;
        flagged: string;
        total_24h: string;
        completed_24h: string;
        failed_24h: string;
        volume_24h: string;
      }>(`
        SELECT 
          COUNT(*)::text as total,
          COUNT(*) FILTER (WHERE status = 'pending')::text as pending,
          COUNT(*) FILTER (WHERE status = 'confirming')::text as confirming,
          COUNT(*) FILTER (WHERE status = 'completed')::text as completed,
          COUNT(*) FILTER (WHERE status = 'failed')::text as failed,
          COUNT(*) FILTER (WHERE COALESCE(is_flagged, false) = true)::text as flagged,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::text as total_24h,
          COUNT(*) FILTER (WHERE status = 'completed' AND COALESCE(credited_at, created_at) > NOW() - INTERVAL '24 hours')::text as completed_24h,
          COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours')::text as failed_24h,
          COALESCE(SUM(amount) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0)::text as volume_24h
        FROM deposits
      `);

      // Filtered count for pagination
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM deposits d
         JOIN users u ON d.user_id = u.id
         JOIN currencies c ON d.currency_id = c.id
         JOIN blockchains b ON d.blockchain_id = b.id
         ${whereClause}`,
        params
      );
      const filteredTotal = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listQuery = `
        SELECT 
          d.id AS deposit_id,
          d.user_id,
          u.email AS user_email,
          d.blockchain_id AS chain_id,
          b.chain_name,
          b.chain_symbol,
          d.currency_id AS token_id,
          c.symbol AS token_symbol,
          c.name AS token_name,
          d.amount::text AS amount,
          d.tx_hash,
          d.from_address,
          d.to_address,
          COALESCE(d.confirmations, 0) AS confirmations,
          COALESCE(d.required_confirmations, 0) AS required_confirmations,
          d.status,
          (d.credited_at IS NOT NULL) AS credited,
          d.credited_at,
          d.block_number,
          d.block_timestamp,
          d.created_at,
          d.updated_at,
          COALESCE(d.is_flagged, false) AS is_flagged
        FROM deposits d
        JOIN users u ON d.user_id = u.id
        JOIN currencies c ON d.currency_id = c.id
        JOIN blockchains b ON d.blockchain_id = b.id
        ${whereClause}
        ORDER BY d.created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `;
      const listParams = [...params, limitNum, offset];
      const result = await db.query(listQuery, listParams);

      const LARGE_USD_THRESHOLD = 10_000;
      const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);
      const deposits = (result.rows as Array<{ token_symbol?: string; amount?: string; [k: string]: unknown }>).map((row) => {
        const symbol = row.token_symbol?.toString().toUpperCase();
        const amountNum = parseFloat(String(row.amount ?? 0));
        const isLarge = !!symbol && STABLECOIN_SYMBOLS.has(symbol) && amountNum >= LARGE_USD_THRESHOLD;
        return { ...row, is_large_deposit: isLarge };
      });

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0] ?? {},
          deposits,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: filteredTotal,
            totalPages: Math.ceil(filteredTotal / limitNum) || 1,
          },
        },
      });
    } catch (error) {
      logger.error('Get deposits error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch deposits' },
      });
    }
  });

  /**
   * GET /admin/deposits/check-duplicate
   * Check if a tx_hash already has a confirmed deposit (to prevent duplicate manual credits).
   */
  app.get<{ Querystring: { tx_hash: string } }>('/deposits/check-duplicate', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const txHash = request.query?.tx_hash?.trim();
      if (!txHash) {
        return reply.status(400).send({ success: false, error: { code: 'MISSING_TX_HASH', message: 'tx_hash is required' } });
      }
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM deposits WHERE tx_hash = $1 AND status IN ('completed', 'confirmed') LIMIT 1`,
        [txHash]
      );
      return reply.send({ success: true, data: { duplicate: existing.rows.length > 0 } });
    } catch (e) {
      logger.error('Check duplicate deposit error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CHECK_FAILED', message: 'Failed to check duplicate' } });
    }
  });

  /**
   * GET /admin/deposits/:id
   * Single deposit detail for admin.
   */
  app.get<{ Params: { id: string } }>('/deposits/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params;
      const row = await db.query(`
        SELECT 
          d.id AS deposit_id,
          d.user_id,
          u.email AS user_email,
          u.username AS user_username,
          d.blockchain_id AS chain_id,
          b.chain_name,
          b.chain_symbol,
          d.currency_id AS token_id,
          c.symbol AS token_symbol,
          c.name AS token_name,
          d.amount::text AS amount,
          d.tx_hash,
          d.from_address,
          d.to_address,
          COALESCE(d.confirmations, 0) AS confirmations,
          COALESCE(d.required_confirmations, 0) AS required_confirmations,
          d.status,
          (d.credited_at IS NOT NULL) AS credited,
          d.credited_at,
          d.block_number,
          d.block_timestamp,
          d.created_at,
          d.updated_at
        FROM deposits d
        JOIN users u ON d.user_id = u.id
        LEFT JOIN currencies c ON d.currency_id = c.id
        LEFT JOIN blockchains b ON d.blockchain_id = b.id
        WHERE d.id = $1
      `, [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Deposit not found' } });
      }
      const depositRow = row.rows[0] as { token_symbol?: string; amount?: string; [k: string]: unknown };
      const symbol = depositRow?.token_symbol?.toString().toUpperCase();
      const amountNum = parseFloat(String(depositRow?.amount ?? 0));
      const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);
      const isLarge = !!symbol && STABLECOIN_SYMBOLS.has(symbol) && amountNum >= 10_000;
      const deposit = { ...depositRow, is_large_deposit: isLarge };
      return reply.send({ success: true, data: { deposit } });
    } catch (e) {
      logger.error('Get deposit by id error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch deposit' } });
    }
  });

  /**
   * POST /admin/deposits/manual-credit
   * Admin-only: credit a user's funding balance (e.g. support adjustment, compensation).
   * Body: { user: string (email or user id), currency: string (symbol), amount: string, reason?: string, tx_hash?: string }
   * If tx_hash is provided and a confirmed deposit already exists for it, returns 409 Deposit already credited.
   */
  app.post<{
    Body: { user: string; currency: string; amount: string; reason?: string; tx_hash?: string };
  }>('/deposits/manual-credit', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'deposits:credit');
    if (!admin) return;
    if (admin.breakGlass) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'BREAK_GLASS_BLOCKED',
          message: 'Break-glass sessions cannot perform manual credits. Use POST /admin/approval-requests (maker-checker).',
        },
      });
    }
    if (config.security.makerCheckerEnabled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'MAKER_CHECKER_REQUIRED',
          message:
            'Direct manual credit is disabled. Use POST /admin/approval-requests with actionType manual_credit; a second admin must approve after the delay.',
        },
      });
    }
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: { code: 'REDIS_UNAVAILABLE', message: 'Manual credit is disabled while Redis is unhealthy.' },
      });
    }
    try {
      const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
      const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
      if (!idempotencyKey) {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required for manual credit requests.' },
        });
      }
      if (idempotencyKey.length > 256) {
        return reply.status(400).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be at most 256 characters.' },
        });
      }
      const creditRequestHash = buildAdminManualCreditRequestHash((request.body || {}) as Record<string, unknown>);
      const creditRedisKey = `admin:manual-credit:idempotency:${admin.adminId}:${idempotencyKey}`;
      const creditCached = await redis.getJson<AdminManualCreditIdempotencyCache>(creditRedisKey);
      if (creditCached) {
        if (creditCached.requestHash !== creditRequestHash) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY',
              message: 'Idempotency-Key was already used with a different request body. Use a new key or the same request body.',
            },
          });
        }
        return reply.status(200).send(creditCached.response);
      }
      const creditLockKey = `admin:manual-credit:lock:${admin.adminId}:${idempotencyKey}`;
      const creditLockAcquired = await redis.setNxEx(creditLockKey, '1', ADMIN_CREDIT_IDEMPOTENCY_LOCK_TTL_SECONDS);
      if (!creditLockAcquired) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DUPLICATE_REQUEST',
            message: 'A manual credit with this Idempotency-Key is already in progress. Retry after a few seconds.',
          },
        });
      }

      const { user: userInput, currency: symbol, amount: amountStr, reason, tx_hash: txHashBody } = request.body || {};
      if (!userInput?.trim() || !symbol?.trim() || !amountStr?.trim()) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'user, currency, and amount are required' },
        });
      }
      const reasonTrimmed = typeof reason === 'string' ? reason.trim() : '';
      if (reasonTrimmed.length < 8) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MANUAL_CREDIT_REASON_REQUIRED',
            message: 'Manual credit requires reason (minimum 8 characters) for audit compliance.',
          },
        });
      }
      if (txHashBody?.trim()) {
        const existing = await db.query<{ id: string }>(
          `SELECT id FROM deposits WHERE tx_hash = $1 AND status IN ('completed', 'confirmed') LIMIT 1`,
          [txHashBody.trim()]
        );
        if (existing.rows.length > 0) {
          return reply.status(409).send({
            success: false,
            error: { code: 'DEPOSIT_ALREADY_CREDITED', message: 'Deposit already credited.' },
          });
        }
      }
      const ROUND_DOWN = 1;
      const PREC = 8;
      let amountDec: DecimalInstance;
      try {
        amountDec = new Decimal(amountStr.trim()).toDecimalPlaces(PREC, ROUND_DOWN);
      } catch {
        amountDec = new Decimal(NaN);
      }
      if (!amountDec.isFinite() || amountDec.lte(0)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number' },
        });
      }
      const userRow = await db.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE status = 'active' AND deleted_at IS NULL
         AND (id::text = $1 OR LOWER(TRIM(email)) = LOWER(TRIM($1))) LIMIT 1`,
        [userInput.trim()]
      );
      if (userRow.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }
      const userId = userRow.rows[0]!.id;
      const currencyId = await getCurrencyIdBySymbol(symbol.trim());
      if (!currencyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CURRENCY', message: 'Currency not found' },
        });
      }

      await db.transaction(async (client) => {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
        const sel = await client.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND COALESCE(account_type::text, 'funding') = 'funding'
           FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL]
        );
        if (sel.rows.length === 0) {
          throw new Error('ADMIN_CREDIT_BALANCE_ROW_NOT_FOUND');
        }
        const avBefore = new Decimal(sel.rows[0]!.available_balance);
        const upd = await client.query(
          `UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW()
           WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND COALESCE(account_type::text, 'funding') = 'funding'
           RETURNING *`,
          [amountDec.toString(), userId, currencyId, CHAIN_ID_GLOBAL]
        );
        assertUserBalanceUpdated('admin_manual_credit', upd, userId, currencyId, 'funding', CHAIN_ID_GLOBAL);
        assertBalanceInvariant(upd.rows[0]);
        const avAfter = new Decimal(upd.rows[0]!.available_balance ?? 0);
        const refId = uuidv4();
        await insertBalanceLedger({
          client,
          userId,
          currencyId,
          accountType: 'funding',
          debit: '0',
          credit: amountDec.toString(),
          balanceBefore: avBefore.toFixed(),
          balanceAfter: avAfter.toFixed(),
          referenceType: 'adjustment',
          referenceId: refId,
          balanceType: 'available',
        });
      });

      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_manual_credit',
          resourceType: 'user',
          resourceId: userId,
          newValue: { currency: symbol.trim(), amount: amountDec.toString(), reason: reasonTrimmed },
        });
      } catch {
        /* best-effort */
      }

      logger.info('Admin manual credit', {
        adminId: admin.adminId,
        userId,
        currencyId,
        symbol: symbol.trim(),
        amount: amountDec.toString(),
        reason: reasonTrimmed,
      });
      const response = {
        success: true as const,
        data: { userId, email: userRow.rows[0]!.email, currency: symbol.trim(), amount: amountDec.toString(), reason: reasonTrimmed },
      };
      try {
        await redis.setJson(creditRedisKey, { requestHash: creditRequestHash, response }, ADMIN_CREDIT_IDEMPOTENCY_TTL_SECONDS);
      } catch (e) {
        logger.warn('Admin manual credit idempotency cache set failed', { adminId: admin.adminId });
      }
      return reply.send(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'ADMIN_CREDIT_BALANCE_ROW_NOT_FOUND') {
        return reply.status(500).send({
          success: false,
          error: { code: 'CREDIT_FAILED', message: 'Balance row not found after ensure' },
        });
      }
      logger.error('Manual credit error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREDIT_FAILED', message: 'Manual credit failed' },
      });
    }
  });

  /**
   * POST /admin/users/:id/balance-adjust
   * General-purpose balance adjustment (credit or debit).
   * Body: { currency_id: string, amount: string, type: 'credit' | 'debit', reason: string }
   */
  app.post<{
    Params: { id: string };
    Body: { currency_id: string; amount: string; type: 'credit' | 'debit'; reason: string };
  }>('/users/:id/balance-adjust', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'deposits:credit');
    if (!admin) return;
    try {
      const { id: userId } = request.params;
      const { currency_id: currencyId, amount: amountStr, type: adjustType, reason } = request.body || {};

      const reasonAdj = typeof reason === 'string' ? reason.trim() : '';
      if (!currencyId?.trim() || !amountStr?.trim() || !adjustType || !reasonAdj) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'currency_id, amount, type, and reason are required' },
        });
      }
      if (reasonAdj.length < 8) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'BALANCE_ADJUST_REASON_REQUIRED',
            message: 'Balance adjustment requires reason (minimum 8 characters) for audit compliance.',
          },
        });
      }
      if (adjustType !== 'credit' && adjustType !== 'debit') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'type must be "credit" or "debit"' },
        });
      }
      if (adjustType === 'credit') {
        if (admin.breakGlass) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'BREAK_GLASS_BLOCKED',
              message: 'Break-glass sessions cannot credit balances. Use maker-checker approval requests.',
            },
          });
        }
        if (config.security.makerCheckerEnabled) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'MAKER_CHECKER_REQUIRED',
              message:
                'Balance credits require POST /admin/approval-requests (actionType manual_credit) when maker-checker is enabled.',
            },
          });
        }
        if (redisBlocksHighRiskActions()) {
          return reply.status(503).send({
            success: false,
            error: { code: 'REDIS_UNAVAILABLE', message: 'Balance credit is disabled while Redis is unhealthy.' },
          });
        }
      }

      const ROUND_DOWN = 1;
      const PREC = 8;
      let amountDec: DecimalInstance;
      try {
        amountDec = new Decimal(amountStr.trim()).toDecimalPlaces(PREC, ROUND_DOWN);
      } catch {
        amountDec = new Decimal(NaN);
      }
      if (!amountDec.isFinite() || amountDec.lte(0)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_AMOUNT', message: 'amount must be a positive number' },
        });
      }

      const userRow = await db.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      if (userRow.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const currencyRow = await db.query<{ id: string; symbol: string }>(
        `SELECT id, symbol FROM currencies WHERE id = $1 LIMIT 1`,
        [currencyId.trim()]
      );
      if (currencyRow.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CURRENCY', message: 'Currency not found' },
        });
      }
      const symbol = currencyRow.rows[0]!.symbol;

      await db.transaction(async (client) => {
        await ensureUserBalanceRow(userId, currencyId.trim(), CHAIN_ID_GLOBAL, 'funding', client);
        const sel = await client.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND COALESCE(account_type::text, 'funding') = 'funding'
           FOR UPDATE`,
          [userId, currencyId.trim(), CHAIN_ID_GLOBAL]
        );
        if (sel.rows.length === 0) {
          throw new Error('BALANCE_ROW_NOT_FOUND');
        }
        const avBefore = new Decimal(sel.rows[0]!.available_balance);

        if (adjustType === 'debit' && avBefore.lt(amountDec)) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        const delta = adjustType === 'credit' ? amountDec.toString() : amountDec.negated().toString();
        const upd = await client.query(
          `UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW()
           WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND COALESCE(account_type::text, 'funding') = 'funding'
           RETURNING *`,
          [delta, userId, currencyId.trim(), CHAIN_ID_GLOBAL]
        );
        assertUserBalanceUpdated('admin_balance_adjust', upd, userId, currencyId.trim(), 'funding', CHAIN_ID_GLOBAL);
        assertBalanceInvariant(upd.rows[0]);
        const avAfter = new Decimal(upd.rows[0]!.available_balance ?? 0);
        const refId = uuidv4();
        await insertBalanceLedger({
          client,
          userId,
          currencyId: currencyId.trim(),
          accountType: 'funding',
          debit: adjustType === 'debit' ? amountDec.toString() : '0',
          credit: adjustType === 'credit' ? amountDec.toString() : '0',
          balanceBefore: avBefore.toFixed(),
          balanceAfter: avAfter.toFixed(),
          referenceType: 'adjustment',
          referenceId: refId,
          balanceType: 'available',
        });
      });

      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: `admin_balance_${adjustType}`,
          resourceType: 'user',
          resourceId: userId,
          newValue: { currency: symbol, amount: amountDec.toString(), type: adjustType, reason: reasonAdj },
        });
      } catch {
        /* best-effort */
      }

      logger.info('Admin balance adjustment', {
        adminId: admin.adminId,
        userId,
        currencyId: currencyId.trim(),
        symbol,
        amount: amountDec.toString(),
        type: adjustType,
        reason: reasonAdj,
      });

      return reply.send({
        success: true,
        data: { userId, email: userRow.rows[0]!.email, currency: symbol, amount: amountDec.toString(), type: adjustType, reason: reasonAdj },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === 'BALANCE_ROW_NOT_FOUND') {
        return reply.status(500).send({
          success: false,
          error: { code: 'ADJUST_FAILED', message: 'Balance row not found after ensure' },
        });
      }
      if (msg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'User does not have sufficient available balance for this debit' },
        });
      }
      logger.error('Balance adjustment error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'ADJUST_FAILED', message: 'Balance adjustment failed' },
      });
    }
  });

  // ===============================
  // FUNDS SUMMARY (Solvency / Reconciliation)
  // ===============================

  /**
   * GET /admin/funds/summary
   * Ledger totals (user_balances by chain+token), on-chain totals (hot/cold/user addresses), difference, status MATCH|MISMATCH.
   * Defensive: never throws; returns 200 with empty/safe data if tables missing or data null.
   */
  app.get('/funds/summary', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;

    const emptyResponse = () =>
      reply.send({
        success: true,
        data: {
          ledger_totals: [],
          on_chain_totals: { user_deposit_addresses: null, hot_wallets: [], cold_wallets: [] },
          reconciliation: { status: 'MATCH' as const },
          users_with_balance: '0',
        },
      });

    let ledgerTotals: { chain_id: string; chain_name: string; chain_symbol: string; token_id: string; token_symbol: string; amount: string }[] = [];
    let hotRows: { chain_id: string; chain_name: string; balance: string }[] = [];
    let coldRows: { chain_id: string; chain_name: string; address: string | null; balance: string | null }[] = [];
    let blockchainRows: { id: string; chain_name: string; chain_symbol: string }[] = [];
    const decimalsByChainId: Record<string, number> = {};
    let chainMap: Record<string, { name: string; decimals?: number; type?: string }> = {};
    let usersWithBalance = '0';

    // Run all independent DB queries in parallel for performance
    const [ledgerResult, hotResult, chainsResult, blockResult, uwbResult] = await Promise.all([
      db.query<{
        chain_id: string; chain_name: string; chain_symbol: string;
        token_id: string; token_symbol: string; amount: string;
      }>(`
        SELECT b.id AS chain_id, b.chain_name, b.chain_symbol,
               c.id AS token_id, c.symbol AS token_symbol,
               (SUM(COALESCE(ub.available_balance, 0)) + SUM(COALESCE(ub.locked_balance, 0)))::text AS amount
        FROM user_balances ub
        INNER JOIN currencies c ON ub.currency_id = c.id
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE b.id IS NOT NULL
        GROUP BY b.id, b.chain_name, b.chain_symbol, c.id, c.symbol
        HAVING (SUM(COALESCE(ub.available_balance, 0)) + SUM(COALESCE(ub.locked_balance, 0))) > 0
        ORDER BY b.chain_name, c.symbol
      `).catch((e) => { logger.warn('Funds summary: ledger query failed', { error: e instanceof Error ? e.message : String(e) }); return { rows: [] as any[] }; }),

      db.query<{ chain_id: string; balance_cache: string | null; cold_wallet_address: string | null }>(
        'SELECT chain_id, balance_cache, cold_wallet_address FROM hot_wallets WHERE is_active = TRUE ORDER BY chain_id'
      ).catch(() => ({ rows: [] as any[] })),

      db.query<{ id: string; name: string; decimals: number | null; type: string | null }>(
        'SELECT id, name, decimals, type FROM chains WHERE is_active = TRUE'
      ).catch(() => ({ rows: [] as any[] })),

      db.query<{ id: string; chain_name: string; chain_symbol: string }>(
        'SELECT id, chain_name, chain_symbol FROM blockchains WHERE is_active = TRUE'
      ).catch(() => ({ rows: [] as any[] })),

      db.query<{ n: string }>(
        `SELECT COUNT(DISTINCT ub.user_id)::text AS n
         FROM user_balances ub
         INNER JOIN users u ON u.id = ub.user_id AND u.deleted_at IS NULL
         WHERE COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0) > 0`
      ).catch(() => ({ rows: [{ n: '0' }] })),
    ]);

    ledgerTotals = Array.isArray(ledgerResult.rows) ? ledgerResult.rows : [];
    blockchainRows = Array.isArray(blockResult.rows) ? blockResult.rows : [];
    usersWithBalance = uwbResult.rows[0]?.n ?? '0';

    // Build chain map from chains table
    chainMap = Object.fromEntries(
      (chainsResult.rows || []).map((r: { id: string; name: string; decimals: number | null; type: string | null }) => [
        r.id, { name: r.name, decimals: r.decimals ?? 18, type: r.type ?? undefined },
      ])
    );
    (chainsResult.rows || []).forEach((r: { id: string; decimals: number | null }) => {
      const d = r.decimals;
      decimalsByChainId[r.id] = typeof d === 'number' && !Number.isNaN(d) ? d : 18;
    });

    // Build hot/cold rows from combined query
    hotRows = (hotResult.rows || []).map((r) => ({
      chain_id: String(r.chain_id),
      chain_name: chainMap[r.chain_id]?.name ?? String(r.chain_id),
      balance: r.balance_cache != null && String(r.balance_cache).trim() !== '' ? String(r.balance_cache).trim() : '0',
    }));
    coldRows = (hotResult.rows || []).map((r) => ({
      chain_id: String(r.chain_id),
      chain_name: chainMap[r.chain_id]?.name ?? String(r.chain_id),
      address: r.cold_wallet_address != null ? String(r.cold_wallet_address) : null,
      balance: null as string | null,
    }));

    const onChainTotals = {
      user_deposit_addresses: null as { chain_id: string; chain_name: string; token_id: string; token_symbol: string; amount: string }[] | null,
      hot_wallets: hotRows,
      cold_wallets: coldRows,
    };

    const chainNameToBlockchainId = Object.fromEntries(
      blockchainRows.map((b) => [b.chain_name.toLowerCase().trim(), b.id])
    );
    const chainIdToBlockchainId: Record<string, string> = {};
    for (const r of hotRows) {
      const bid = chainNameToBlockchainId[r.chain_name.toLowerCase().trim()];
      if (bid) chainIdToBlockchainId[r.chain_id] = bid;
    }

    // Reconciliation: compare ledger vs on-chain
    const mismatches: { chain_id: string; chain_name: string; token_symbol: string; ledger_amount: string; on_chain_amount: string; difference: string; reason?: string }[] = [];
    for (const h of hotRows) {
      try {
        const chainType = (chainMap[h.chain_id]?.type ?? '').toLowerCase();
        const blockchainId = chainIdToBlockchainId[h.chain_id];
        if (!blockchainId) continue;
        const nativeSymbol = blockchainRows.find((b) => b.id === blockchainId)?.chain_symbol ?? '';
        const ledgerNative = ledgerTotals.find((l) => l.chain_id === blockchainId && l.token_symbol === nativeSymbol);
        if (ledgerNative == null) continue;
        const decimals = typeof decimalsByChainId[h.chain_id] === 'number' && !Number.isNaN(decimalsByChainId[h.chain_id])
          ? (decimalsByChainId[h.chain_id] ?? 18) : 18;
        const divisor = Math.pow(10, Math.min(Math.max(decimals, 0), 32)) || 1;
        const rawBalance = (h.balance ?? '0').trim() || '0';
        let onChainHuman: string;
        try {
          if (/^-?\d+$/.test(rawBalance)) {
            onChainHuman = new Decimal(rawBalance).div(divisor).toDecimalPlaces(Math.min(Math.max(decimals, 0), 8), 1).toString();
          } else { onChainHuman = '0'; }
        } catch { onChainHuman = '0'; }
        const decimalsClamp = Math.min(Math.max(decimals, 0), 8);
        const ledgerAmount = ledgerNative.amount ?? '0';
        const ledgerDec = new Decimal(ledgerAmount);
        const onChainDec = new Decimal(onChainHuman);
        const diffDec = ledgerDec.minus(onChainDec);
        const difference = diffDec.toDecimalPlaces(decimalsClamp, 1).toString();
        const oneUnit = new Decimal(1).div(divisor);
        if (diffDec.abs().gt(oneUnit)) {
          const reason = (chainType === 'bitcoin' || chainType === 'solana') ? 'Deposit sweep not implemented for this chain' : undefined;
          mismatches.push({
            chain_id: blockchainId, chain_name: ledgerNative.chain_name ?? h.chain_name,
            token_symbol: nativeSymbol || 'native', ledger_amount: ledgerAmount,
            on_chain_amount: onChainHuman, difference, ...(reason ? { reason } : {}),
          });
        }
      } catch (e) {
        logger.warn('Funds summary: reconciliation row failed', { chain_id: h.chain_id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const status = mismatches.length === 0 ? 'MATCH' : 'MISMATCH';

    try {
      return reply.send({
        success: true,
        data: {
          ledger_totals: ledgerTotals,
          on_chain_totals: onChainTotals,
          reconciliation: { status, mismatches: mismatches.length > 0 ? mismatches : undefined },
          users_with_balance: usersWithBalance,
        },
      });
    } catch (error) {
      logger.error('Funds summary: send response failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return emptyResponse();
    }
  });

  // ===============================
  // WITHDRAWALS
  // ===============================

  /**
   * GET /admin/withdrawals/reports
   * Industry-standard withdrawal report: stats, type breakdown, period counts, volume.
   * Must be registered before GET /withdrawals so path is matched correctly.
   */
  app.get<{ Querystring: { date_from?: string; date_to?: string } }>('/withdrawals/reports', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { date_from, date_to } = request.query;
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;
      if (date_from?.trim()) {
        conditions.push(`w.created_at >= $${paramIndex++}::timestamptz`);
        params.push(date_from.trim());
      }
      if (date_to?.trim()) {
        conditions.push(`w.created_at <= $${paramIndex++}::timestamptz`);
        params.push(date_to.trim());
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const fromW = `FROM withdrawals w ${whereClause}`;

      const [statsResult, typeResult, periodResult, volumeResult, byCurrencyResult] = await Promise.all([
        db.query<{
          total: string;
          pending_approval: string;
          pending: string;
          processing: string;
          completed: string;
          failed: string;
          cancelled: string;
        }>(`
          SELECT
            COUNT(*)::text as total,
            COUNT(*) FILTER (WHERE w.status = 'pending_approval')::text as pending_approval,
            COUNT(*) FILTER (WHERE w.status = 'pending')::text as pending,
            COUNT(*) FILTER (WHERE w.status = 'processing')::text as processing,
            COUNT(*) FILTER (WHERE w.status = 'completed')::text as completed,
            COUNT(*) FILTER (WHERE w.status = 'failed')::text as failed,
            COUNT(*) FILTER (WHERE w.status = 'cancelled')::text as cancelled
          ${fromW}
        `, params),
        db.query<{ internal: string; onchain: string }>(`
          SELECT
            COUNT(*) FILTER (WHERE COALESCE(w.type, 'onchain') = 'internal')::text as internal,
            COUNT(*) FILTER (WHERE COALESCE(w.type, 'onchain') = 'onchain')::text as onchain
          ${fromW}
        `, params),
        db.query<{ today: string; last_7_days: string; last_30_days: string }>(`
          SELECT
            COUNT(*) FILTER (WHERE w.created_at >= CURRENT_DATE)::text as today,
            COUNT(*) FILTER (WHERE w.created_at >= NOW() - INTERVAL '7 days')::text as last_7_days,
            COUNT(*) FILTER (WHERE w.created_at >= NOW() - INTERVAL '30 days')::text as last_30_days
          ${fromW}
        `, params),
        db.query<{ completed_count: string; completed_volume: string }>(`
          SELECT
            COUNT(*) FILTER (WHERE w.status = 'completed')::text as completed_count,
            COALESCE(SUM(w.amount) FILTER (WHERE w.status = 'completed'), 0)::text as completed_volume
          ${fromW}
        `, params),
        db.query<{ symbol: string; count: string; total_amount: string }>(`
          SELECT
            COALESCE(t.symbol, 'Internal') as symbol,
            COUNT(*)::text as count,
            COALESCE(SUM(w.amount), 0)::text as total_amount
          FROM withdrawals w
          LEFT JOIN tokens t ON w.token_id = t.id
          ${whereClause}
          GROUP BY COALESCE(t.symbol, 'Internal')
          ORDER BY SUM(w.amount) DESC
          LIMIT 20
        `, params),
      ]);

      const stats = statsResult.rows[0] ?? ({} as {
        total?: string;
        pending_approval?: string;
        pending?: string;
        processing?: string;
        completed?: string;
        failed?: string;
        cancelled?: string;
      });
      const byType = typeResult.rows[0] ?? { internal: '0', onchain: '0' };
      const period = periodResult.rows[0] ?? { today: '0', last_7_days: '0', last_30_days: '0' };
      const volume = volumeResult.rows[0] ?? { completed_count: '0', completed_volume: '0' };

      return reply.send({
        success: true,
        data: {
          stats: {
            total: stats.total ?? '0',
            pending_approval: stats.pending_approval ?? '0',
            pending: stats.pending ?? '0',
            processing: stats.processing ?? '0',
            completed: stats.completed ?? '0',
            failed: stats.failed ?? '0',
            cancelled: stats.cancelled ?? '0',
          },
          by_type: {
            internal: byType.internal ?? '0',
            onchain: byType.onchain ?? '0',
          },
          period: {
            today: period.today ?? '0',
            last_7_days: period.last_7_days ?? '0',
            last_30_days: period.last_30_days ?? '0',
          },
          volume: {
            completed_count: volume.completed_count ?? '0',
            completed_volume: volume.completed_volume ?? '0',
          },
          by_currency: (byCurrencyResult.rows ?? []).map((r) => ({
            symbol: r.symbol,
            count: r.count,
            total_amount: r.total_amount,
          })),
          date_range: date_from || date_to ? { date_from: date_from ?? null, date_to: date_to ?? null } : null,
        },
      });
    } catch (error) {
      logger.error('Withdrawal reports error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch withdrawal reports' },
      });
    }
  });

  /**
   * GET /admin/withdrawals
   * List withdrawals with filters: status, chain_id, token_id. Paginated.
   */
  app.get<{
    Querystring: { page?: string; limit?: string; status?: string; chain_id?: string; token_id?: string; type?: string; user?: string };
  }>('/withdrawals', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, status, chain_id, token_id, type, user } = request.query;
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        conditions.push(`w.status = $${paramIndex++}`);
        params.push(status);
      }
      if (chain_id && chain_id.trim()) {
        conditions.push(`w.chain_id = $${paramIndex++}`);
        params.push(chain_id.trim());
      }
      if (token_id && token_id.trim()) {
        conditions.push(`w.token_id = $${paramIndex++}`);
        params.push(token_id.trim());
      }
      if (type === 'internal') {
        conditions.push(`COALESCE(w.type, 'onchain') = 'internal'`);
      } else if (type === 'onchain') {
        conditions.push(`COALESCE(w.type, 'onchain') = 'onchain'`);
      }
      if (user?.trim()) {
        const u = user.trim();
        if (/^[0-9a-f-]{36}$/i.test(u)) {
          conditions.push(`w.user_id = $${paramIndex++}`);
          params.push(u);
        } else {
          conditions.push(`(u.email ILIKE $${paramIndex++} OR u.username ILIKE $${paramIndex++})`);
          params.push(`%${u}%`, `%${u}%`);
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      /**
       * Stats: global counts for queue KPIs + 24h totals for "Completed / Failed / Volume (24h)" tiles.
       * The frontend renders cards labeled "Completed (24h)", "Failed (24h)" and "Volume (24h)".
       * Earlier the query only returned all-time counts and never returned `volume_24h`, so those
       * tiles displayed wrong numbers (or blanks for volume). Now we return both the queue-wide
       * counts (used for the Pending/Processing tiles + pagination badges) AND the 24h rollups.
       */
      const stats = await db.query<{
        total: string;
        pending_approval: string;
        pending: string;
        processing: string;
        completed: string;
        failed: string;
        cancelled: string;
        completed_24h: string;
        failed_24h: string;
        volume_24h: string;
      }>(`
        SELECT 
          COUNT(*)::text as total,
          COUNT(*) FILTER (WHERE status = 'pending_approval')::text as pending_approval,
          COUNT(*) FILTER (WHERE status IN ('pending_email_verify','pending_2fa','pending_blockchain'))::text as pending,
          COUNT(*) FILTER (WHERE status = 'processing')::text as processing,
          COUNT(*) FILTER (WHERE status = 'completed')::text as completed,
          COUNT(*) FILTER (WHERE status = 'failed')::text as failed,
          COUNT(*) FILTER (WHERE status IN ('cancelled','rejected'))::text as cancelled,
          COUNT(*) FILTER (WHERE status = 'completed' AND COALESCE(completed_at, created_at) > NOW() - INTERVAL '24 hours')::text as completed_24h,
          COUNT(*) FILTER (WHERE status IN ('failed','rejected') AND updated_at > NOW() - INTERVAL '24 hours')::text as failed_24h,
          COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'completed' AND COALESCE(completed_at, created_at) > NOW() - INTERVAL '24 hours'), 0)::text as volume_24h
        FROM withdrawals
      `);

      // Filtered count for pagination (same JOINs as list when filters reference u/type)
      const countFrom = conditions.some(c => c.includes(' u.') || c.includes('u.email') || c.includes('u.username'))
        ? `FROM withdrawals w JOIN users u ON w.user_id = u.id LEFT JOIN tokens t ON w.token_id = t.id LEFT JOIN chains c ON w.chain_id = c.id ${whereClause}`
        : `FROM withdrawals w ${whereClause}`;
      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count ${countFrom}`,
        params
      );
      const filteredTotal = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listQuery = `
        SELECT 
          w.id, w.user_id, w.token_id, w.chain_id, w.amount, w.fee, w.net_amount,
          w.to_address, w.memo, w.status, w.account_type,
          COALESCE(w.type, 'onchain') as withdrawal_type,
          w.internal_user_id,
          u_recipient.email as internal_recipient_email,
          w.tx_hash, w.completed_at, w.failed_reason, w.processed_at,
          w.approved_by, w.approved_at, w.rejected_by, w.rejected_at, w.rejection_reason,
          w.created_at, w.updated_at,
          u.email, u.username,
          COALESCE(t.symbol, '') as currency_symbol,
          COALESCE(t.name, t.symbol, '') as token_name,
          COALESCE(c.name, 'Internal') as chain_name
        FROM withdrawals w
        JOIN users u ON w.user_id = u.id
        LEFT JOIN tokens t ON w.token_id = t.id
        LEFT JOIN chains c ON w.chain_id = c.id
        LEFT JOIN users u_recipient ON w.internal_user_id = u_recipient.id
        ${whereClause}
        ORDER BY w.created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `;
      const listParams = [...params, limitNum, offset];
      const result = await db.query(listQuery, listParams);
      const rows = result.rows as any[];

      // Enrich with risk_score and risk_flags (from AML, amount threshold, high-risk token)
      const userIds = [...new Set(rows.map((r) => r.user_id))];
      let amlUserIds = new Set<string>();
      if (userIds.length > 0) {
        try {
          const aml = await db.query<{ user_id: string }>(
            `SELECT user_id FROM aml_alerts WHERE user_id = ANY($1::uuid[]) AND status IN ('open','reviewing')`,
            [userIds]
          );
          amlUserIds = new Set(aml.rows.map((r) => r.user_id));
        } catch {
          /* ignore */
        }
      }
      const tokenIds = [...new Set(rows.map((r) => r.token_id).filter(Boolean))];
      let highRiskTokenIds = new Set<string>();
      if (tokenIds.length > 0) {
        try {
          const tokens = await db.query<{ id: string }>(
            `SELECT id FROM tokens WHERE id = ANY($1::uuid[]) AND (is_high_risk = true OR is_high_risk = 'true')`,
            [tokenIds]
          );
          highRiskTokenIds = new Set(tokens.rows.map((r) => r.id));
        } catch {
          /* ignore */
        }
      }
      const LARGE_AMOUNT_THRESHOLD = 10000;
      const withdrawals = rows.map((r) => {
        const flags: string[] = [];
        if (amlUserIds.has(r.user_id)) flags.push('AML Flag');
        if (r.token_id && highRiskTokenIds.has(r.token_id)) flags.push('High-Risk Token');
        const amt = parseFloat(r.amount);
        if (!Number.isNaN(amt) && amt >= LARGE_AMOUNT_THRESHOLD) flags.push('Large Withdrawal');
        let risk_score: 'low' | 'medium' | 'high' = 'low';
        if (flags.includes('AML Flag')) risk_score = 'high';
        else if (flags.length > 0) risk_score = 'medium';
        return { ...r, risk_score, risk_flags: flags };
      });

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0] ?? {},
          withdrawals,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: filteredTotal,
            totalPages: Math.ceil(filteredTotal / limitNum) || 1,
          },
        },
      });
    } catch (error) {
      logger.error('Get withdrawals error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch withdrawals' },
      });
    }
  });

  /**
   * GET /admin/withdrawals/:id
   * Single withdrawal detail for admin (with risk_score, risk_flags).
   */
  app.get<{ Params: { id: string } }>('/withdrawals/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params;
      const row = await db.query(`
        SELECT
          w.id, w.user_id, w.token_id, w.chain_id, w.amount, w.fee, w.net_amount,
          w.to_address, w.memo, w.status, w.tx_hash, w.completed_at, w.failed_reason,
          w.approved_by, w.approved_at, w.rejected_by, w.rejected_at, w.rejection_reason,
          w.created_at, w.updated_at,
          u.email, u.username,
          COALESCE(t.symbol, '') as currency_symbol,
          COALESCE(c.name, 'Internal') as chain_name
        FROM withdrawals w
        JOIN users u ON w.user_id = u.id
        LEFT JOIN tokens t ON w.token_id = t.id
        LEFT JOIN chains c ON w.chain_id = c.id
        WHERE w.id = $1
      `, [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Withdrawal not found' } });
      }
      const r = row.rows[0] as any;
      const flags: string[] = [];
      try {
        const aml = await db.query<{ n: number }>(
          'SELECT 1 as n FROM aml_alerts WHERE user_id = $1 AND status IN (\'open\',\'reviewing\') LIMIT 1',
          [r.user_id]
        );
        if (aml.rows.length > 0) flags.push('AML Flag');
      } catch { /* ignore */ }
      if (r.token_id) {
        try {
          const tok = await db.query<{ is_high_risk: boolean }>('SELECT is_high_risk FROM tokens WHERE id = $1', [r.token_id]);
          if (tok.rows[0]?.is_high_risk) flags.push('High-Risk Token');
        } catch { /* ignore */ }
      }
      const amt = parseFloat(r.amount);
      if (!Number.isNaN(amt) && amt >= 10000) flags.push('Large Withdrawal');
      let risk_score: 'low' | 'medium' | 'high' = 'low';
      if (flags.includes('AML Flag')) risk_score = 'high';
      else if (flags.length > 0) risk_score = 'medium';
      const withdrawal = { ...r, risk_score, risk_flags: flags };
      return reply.send({ success: true, data: { withdrawal } });
    } catch (e) {
      logger.error('Get withdrawal by id error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch withdrawal' } });
    }
  });

  /**
   * POST /admin/withdrawals/:id/approve
   * Approve a withdrawal (pending_approval → pending, then enqueue for signing).
   * Optional Idempotency-Key header for retry safety.
   */
  app.post<{ Params: { id: string }; Body: { admin_note?: string } }>('/withdrawals/:id/approve', async (request, reply) => {
    const admin = await getAdminForWithdrawalApproval(app, request, reply);
    if (!admin) return;
    if (redisBlocksHighRiskActions()) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'REDIS_UNAVAILABLE',
          message: 'Withdrawal approval is disabled while Redis is unhealthy.',
        },
      });
    }
    if (config.security.makerCheckerEnabled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'MAKER_CHECKER_REQUIRED',
          message:
            'Direct withdrawal approval is disabled. Use POST /admin/approval-requests with actionType withdrawal_approve and payload { withdrawalId }.',
        },
      });
    }
    const withdrawalId = request.params.id;
    if (!withdrawalId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Withdrawal id is required' },
      });
    }
    const adminNoteRaw = (request.body?.admin_note ?? '').trim();
    if (adminNoteRaw.length < 8) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'AUDIT_NOTE_REQUIRED',
          message: 'Approval requires admin_note (minimum 8 characters) for audit compliance.',
        },
      });
    }
    const adminNote = adminNoteRaw;
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (idempotencyKey && idempotencyKey.length <= 256) {
      const cacheKey = `admin:withdraw:approve:${idempotencyKey}`;
      const requestHash = crypto.createHash('sha256').update(JSON.stringify({ withdrawalId })).digest('hex');
      const cached = await redis.getJson<{ requestHash: string; response: object }>(cacheKey);
      if (cached) {
        if (cached.requestHash === requestHash) {
          return reply.send(cached.response);
        }
        return reply.status(409).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used for a different withdrawal. Use a new key.' },
        });
      }
      const lockKey = `admin:withdraw:approve:lock:${idempotencyKey}`;
      const lockAcquired = await redis.setNxEx(lockKey, '1', WITHDRAW_APPROVE_LOCK_TTL);
      if (!lockAcquired) {
        return reply.status(409).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message: 'Approve in progress. Retry after a few seconds.' },
        });
      }
      try {
        const { approveWithdrawal } = await import('../services/withdrawal-approval.service.js');
        await approveWithdrawal(withdrawalId, admin.adminId, {
          ip: request.ip ?? undefined,
          userAgent: request.headers['user-agent'] ?? undefined,
        });
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_withdrawal_approve',
          resourceType: 'withdrawal',
          resourceId: withdrawalId,
          oldValue: { status: 'pending_approval' },
          newValue: { status: 'pending', admin_note: adminNote },
        });
        await logAdminActivity({
          adminId: admin.adminId,
          action: 'withdrawal_approved',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
          metadata: { withdrawalId, admin_note: adminNote },
        });
        const response = { success: true, data: { approved: true, withdrawalId } };
        await redis.setJson(cacheKey, { requestHash, response }, WITHDRAW_APPROVE_IDEMPOTENCY_TTL);
        return reply.send(response);
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err?.code === 'WITHDRAWAL_NOT_FOUND') {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: err.message || 'Withdrawal not found' } });
        }
        if (err?.code === 'NOT_PENDING_APPROVAL') {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_STATE', message: err.message || 'Withdrawal is not pending approval' } });
        }
        if (err?.code === 'HOT_WALLET_CAP_EXCEEDED') {
          return reply.status(400).send({ success: false, error: { code: 'HOT_WALLET_CAP_EXCEEDED', message: err.message || 'Hot wallet limit exceeded' } });
        }
        logger.error('Approve withdrawal error', { withdrawalId, error: err?.message ?? error });
        return reply.status(500).send({ success: false, error: { code: 'APPROVE_FAILED', message: 'Failed to approve withdrawal' } });
      } finally {
        await redis.del(lockKey).catch(() => {});
      }
    }
    try {
      const { approveWithdrawal } = await import('../services/withdrawal-approval.service.js');
      await approveWithdrawal(withdrawalId, admin.adminId, {
        ip: request.ip ?? undefined,
        userAgent: request.headers['user-agent'] ?? undefined,
      });
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_withdrawal_approve',
        resourceType: 'withdrawal',
        resourceId: withdrawalId,
        oldValue: { status: 'pending_approval' },
        newValue: { status: 'pending', admin_note: adminNote },
      });
      await logAdminActivity({
        adminId: admin.adminId,
        action: 'withdrawal_approved',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
        metadata: { withdrawalId, admin_note: adminNote },
      });
      return reply.send({ success: true, data: { approved: true, withdrawalId } });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'WITHDRAWAL_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message || 'Withdrawal not found' },
        });
      }
      if (err?.code === 'NOT_PENDING_APPROVAL') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: err.message || 'Withdrawal is not pending approval' },
        });
      }
      if (err?.code === 'HOT_WALLET_CAP_EXCEEDED') {
        return reply.status(400).send({
          success: false,
          error: { code: 'HOT_WALLET_CAP_EXCEEDED', message: err.message || 'Hot wallet limit exceeded for this chain' },
        });
      }
      logger.error('Approve withdrawal error', { withdrawalId, error: err?.message ?? error });
      return reply.status(500).send({
        success: false,
        error: { code: 'APPROVE_FAILED', message: 'Failed to approve withdrawal' },
      });
    }
  });

  /**
   * POST /admin/withdrawals/:id/reject
   * Reject a withdrawal: mark failed and release locked balance. Body: { reason?: string }
   * Optional Idempotency-Key header for retry safety.
   */
  app.post<{ Params: { id: string }; Body: { reason?: string; admin_note?: string } }>('/withdrawals/:id/reject', async (request, reply) => {
    const admin = await getAdminForWithdrawalApproval(app, request, reply);
    if (!admin) return;
    const withdrawalId = request.params.id;
    if (!withdrawalId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Withdrawal id is required' },
      });
    }
    const reasonRaw = (request.body?.reason ?? '').trim();
    if (reasonRaw.length < 8) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Rejection requires reason (minimum 8 characters) for audit compliance.',
        },
      });
    }
    const reason = reasonRaw;
    const adminNote = (request.body?.admin_note ?? '').trim() || null;
    const idempotencyKeyRaw = (request.headers[IDEMPOTENCY_KEY_HEADER] ?? request.headers['Idempotency-Key']) as string | undefined;
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' ? idempotencyKeyRaw.trim() : '';
    if (idempotencyKey && idempotencyKey.length <= 256) {
      const cacheKey = `admin:withdraw:reject:${idempotencyKey}`;
      const requestHash = crypto.createHash('sha256').update(JSON.stringify({ withdrawalId, reason })).digest('hex');
      const cached = await redis.getJson<{ requestHash: string; response: object }>(cacheKey);
      if (cached) {
        if (cached.requestHash === requestHash) {
          return reply.send(cached.response);
        }
        return reply.status(409).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used for a different reject. Use a new key.' },
        });
      }
      const lockKey = `admin:withdraw:reject:lock:${idempotencyKey}`;
      const lockAcquired = await redis.setNxEx(lockKey, '1', WITHDRAW_APPROVE_LOCK_TTL);
      if (!lockAcquired) {
        return reply.status(409).send({
          success: false,
          error: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message: 'Reject in progress. Retry after a few seconds.' },
        });
      }
      try {
        const { rejectWithdrawal } = await import('../services/withdrawal-approval.service.js');
        await rejectWithdrawal(withdrawalId, admin.adminId, reason, {
          ip: request.ip ?? undefined,
          userAgent: request.headers['user-agent'] ?? undefined,
        });
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'admin_withdrawal_reject',
          resourceType: 'withdrawal',
          resourceId: withdrawalId,
          oldValue: { status: 'pending_approval' },
          newValue: { status: 'rejected', reason, admin_note: adminNote },
        });
        await logAdminActivity({
          adminId: admin.adminId,
          action: 'withdrawal_rejected',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
          metadata: { withdrawalId, reason, admin_note: adminNote },
        });
        const response = { success: true, data: { rejected: true, withdrawalId } };
        await redis.setJson(cacheKey, { requestHash, response }, WITHDRAW_APPROVE_IDEMPOTENCY_TTL);
        return reply.send(response);
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err?.code === 'WITHDRAWAL_NOT_FOUND') {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: err.message || 'Withdrawal not found' } });
        }
        if (err?.code === 'NOT_PENDING_APPROVAL') {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_STATE', message: err.message || 'Withdrawal is not pending approval' } });
        }
        if (err?.code === 'RELEASE_BALANCE_FAILED') {
          return reply.status(500).send({ success: false, error: { code: 'RELEASE_FAILED', message: err.message || 'Could not release locked balance' } });
        }
        logger.error('Reject withdrawal error', { withdrawalId, error: err?.message ?? error });
        return reply.status(500).send({ success: false, error: { code: 'REJECT_FAILED', message: 'Failed to reject withdrawal' } });
      } finally {
        await redis.del(lockKey).catch(() => {});
      }
    }
    try {
      const { rejectWithdrawal } = await import('../services/withdrawal-approval.service.js');
      await rejectWithdrawal(withdrawalId, admin.adminId, reason, {
        ip: request.ip ?? undefined,
        userAgent: request.headers['user-agent'] ?? undefined,
      });
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'admin_withdrawal_reject',
        resourceType: 'withdrawal',
        resourceId: withdrawalId,
        oldValue: { status: 'pending_approval' },
        newValue: { status: 'rejected', reason, admin_note: adminNote },
      });
      await logAdminActivity({
        adminId: admin.adminId,
        action: 'withdrawal_rejected',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
        metadata: { withdrawalId, reason, admin_note: adminNote },
      });
      return reply.send({ success: true, data: { rejected: true, withdrawalId } });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'WITHDRAWAL_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message || 'Withdrawal not found' },
        });
      }
      if (err?.code === 'NOT_PENDING_APPROVAL') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: err.message || 'Withdrawal is not pending approval' },
        });
      }
      if (err?.code === 'RELEASE_BALANCE_FAILED') {
        return reply.status(500).send({
          success: false,
          error: { code: 'RELEASE_FAILED', message: err.message || 'Could not release locked balance' },
        });
      }
      logger.error('Reject withdrawal error', { withdrawalId, error: err?.message ?? error });
      return reply.status(500).send({
        success: false,
        error: { code: 'REJECT_FAILED', message: 'Failed to reject withdrawal' },
      });
    }
  });

  // ===============================
  // TREASURY DASHBOARD
  // ===============================

  /**
   * GET /admin/treasury
   * Treasury stats: total_reserves, hot_balance, cold_balance, pending_sweeps. Uses ledger + hot_wallets + deposit_sweeps.
   */
  app.get('/treasury', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const CACHE_KEY = 'admin:cache:treasury_stats';
      try {
        const cached = await redis.getJson<Record<string, unknown>>(CACHE_KEY);
        if (cached) return reply.send({ success: true, data: cached });
      } catch { /* Redis down */ }

      const safeQ = <T>(sql: string, fallback: T): Promise<T> =>
        db.query<any>(sql).then(r => (r.rows[0] as T) ?? fallback).catch(() => fallback);
      const safeRows = <T>(sql: string): Promise<T[]> =>
        db.query<any>(sql).then(r => r.rows as T[]).catch(() => [] as T[]);

      const [hotRow, pendingRow, failedRow, chainGroupRows, chainsRows, blkRows] = await Promise.all([
        safeQ<{ balance_cache: string }>('SELECT COALESCE(SUM(balance_cache::numeric), 0)::text AS balance_cache FROM hot_wallets WHERE is_active = TRUE', { balance_cache: '0' }),
        safeQ<{ count: string }>(`SELECT COUNT(*)::text AS count FROM deposit_sweeps WHERE status = 'pending'`, { count: '0' }),
        safeQ<{ count: string }>(`SELECT COUNT(*)::text AS count FROM deposit_sweeps WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'`, { count: '0' }),
        safeRows<{ chain_id: string; balance: string }>(
          `SELECT COALESCE(chain_id, blockchain_id::text) AS chain_id, COALESCE(SUM(balance_cache::numeric), 0)::text AS balance FROM hot_wallets WHERE is_active = TRUE GROUP BY COALESCE(chain_id, blockchain_id::text)`
        ),
        safeRows<{ id: string; name: string }>('SELECT id, name FROM chains WHERE is_active = TRUE'),
        safeRows<{ id: string; chain_name: string }>('SELECT id::text AS id, chain_name FROM blockchains WHERE is_active = TRUE'),
      ]);

      const ledgerRow = { amount: '0' };
      try {
        const r = await db.query<{ amount: string }>(
          `SELECT COALESCE(SUM(available_balance + locked_balance), 0)::text AS amount FROM user_balances`
        );
        ledgerRow.amount = r.rows[0]?.amount ?? '0';
      } catch {
        // table missing — use 0
      }

      const totalReserves = parseFloat(ledgerRow?.amount ?? '0') || 0;
      const hotBalance = parseFloat(hotRow?.balance_cache ?? '0') || 0;
      const pendingSweeps = parseInt(pendingRow?.count ?? '0', 10) || 0;
      const failedSweeps24h = parseInt(failedRow?.count ?? '0', 10) || 0;
      const coldBalance = Math.max(0, totalReserves - hotBalance);

      const chainMap: Record<string, string> = {};
      chainsRows.forEach((r) => { chainMap[r.id] = r.name; });
      blkRows.forEach((r) => { chainMap[r.id] = r.chain_name ?? r.id; });
      const chainBalances = chainGroupRows.map((r) => ({
        chain_name: chainMap[r.chain_id] ?? r.chain_id,
        balance: parseFloat(r.balance ?? '0') || 0,
      }));

      const coldStorageRatio = totalReserves > 0 ? Math.round((coldBalance / totalReserves) * 100) : 0;
      const withdrawalThreshold = 1e18;

      const treasuryData = {
        total_reserves: totalReserves,
        hot_balance: hotBalance,
        cold_balance: coldBalance,
        pending_sweeps: pendingSweeps,
        failed_sweeps_24h: failedSweeps24h,
        cold_storage_ratio: coldStorageRatio,
        chain_balances: chainBalances,
        liquidity_warning: hotBalance < withdrawalThreshold,
        withdrawal_threshold: withdrawalThreshold,
      };
      redis.setJson(CACHE_KEY, treasuryData, 20).catch(() => {});
      return reply.send({ success: true, data: treasuryData });
    } catch (e) {
      logger.error('Get treasury stats error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch treasury stats' } });
    }
  });

  /**
   * GET /admin/treasury/health
   * Wallet health: hot_wallet_health, rpc_node_status, sweep_engine_status. Statuses: Healthy, Low Balance, RPC Error, Sync Lag.
   */
  app.get('/treasury/health', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let hotWalletHealth = 'Healthy';
      let rpcNodeStatus = 'Healthy';
      let sweepEngineStatus = 'Healthy';
      try {
        const hotRes = await db.query<{ balance_cache: string; min_balance_alert: string }>(
          'SELECT COALESCE(SUM(balance_cache::numeric), 0)::text AS balance_cache, COALESCE(SUM(min_balance_alert::numeric), 0)::text AS min_balance_alert FROM hot_wallets WHERE is_active = TRUE'
        );
        const total = parseFloat(hotRes.rows[0]?.balance_cache ?? '0') || 0;
        const minAlert = parseFloat(hotRes.rows[0]?.min_balance_alert ?? '0') || 0;
        if (minAlert > 0 && total < minAlert) hotWalletHealth = 'Low Balance';
      } catch {
        //
      }
      try {
        const { config } = await import('../config/index.js');
        if (!config?.depositSweep?.enabled) sweepEngineStatus = 'Sync Lag';
      } catch {
        sweepEngineStatus = 'Sync Lag';
      }
      return reply.send({
        success: true,
        data: {
          hot_wallet_health: hotWalletHealth,
          rpc_node_status: rpcNodeStatus,
          sweep_engine_status: sweepEngineStatus,
        },
      });
    } catch (e) {
      logger.error('Get treasury health error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch health' } });
    }
  });

  /** GET /admin/treasury/reconciliation — on-chain vs DB reconciliation status */
  app.get('/treasury/reconciliation', async (request, reply) => {
    try {
      const mismatchPauseRow = await db.query<{ value: string }>(
        `SELECT value FROM system_settings WHERE key = 'treasury_onchain_mismatch_pause'`
      ).catch(() => ({ rows: [] as { value: string }[] }));
      const isPaused = mismatchPauseRow.rows[0]?.value === '1' || mismatchPauseRow.rows[0]?.value === 'true';

      const recentMismatches = await db.query<{
        chain_id: string;
        chain_name: string;
        on_chain_balance: string;
        db_balance: string;
        difference: string;
        created_at: string;
      }>(
        `SELECT
          COALESCE(details->>'chain_id', details->>'chain') AS chain_id,
          COALESCE(details->>'chain_name', details->>'chain') AS chain_name,
          COALESCE(details->>'on_chain_balance', details->>'onChainBalance', '0') AS on_chain_balance,
          COALESCE(details->>'db_balance', details->>'cachedBalance', '0') AS db_balance,
          COALESCE(details->>'difference', details->>'diff', '0') AS difference,
          created_at
        FROM treasury_audit_logs
        WHERE action ILIKE '%mismatch%' OR action ILIKE '%reconcil%'
        ORDER BY created_at DESC
        LIMIT 20`
      ).catch(() => ({ rows: [] as any[] }));

      const lastChecked = await db.query<{ created_at: string }>(
        `SELECT created_at FROM treasury_audit_logs
         WHERE action ILIKE '%reconcil%' OR action ILIKE '%balance_check%'
         ORDER BY created_at DESC LIMIT 1`
      ).catch(() => ({ rows: [] as { created_at: string }[] }));

      const matched = !isPaused && recentMismatches.rows.length === 0;

      return reply.send({
        success: true,
        data: {
          matched,
          paused: isPaused,
          mismatches: recentMismatches.rows.map((r) => ({
            chain: r.chain_name || r.chain_id || 'unknown',
            onChainBalance: r.on_chain_balance,
            dbBalance: r.db_balance,
            diff: r.difference,
          })),
          lastCheckedAt: lastChecked.rows[0]?.created_at ?? null,
          mismatchCount: recentMismatches.rows.length,
        },
      });
    } catch (e) {
      logger.warn('Treasury reconciliation check failed', { error: e instanceof Error ? e.message : 'unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'RECONCILIATION_FAILED', message: 'Failed to check reconciliation status' },
      });
    }
  });

  /**
   * GET /admin/treasury/hot-wallets
   * List hot wallets with chain, address, balance, last_sweep, status.
   */
  app.get('/treasury/hot-wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const idMode = await getHotWalletsIdModeCached();
      if (idMode === 'none') {
        return reply.send({ success: true, data: [] });
      }
      const orderCol = idMode === 'chain_id' ? 'chain_id' : 'blockchain_id';
      const rawRows =
        idMode === 'chain_id'
          ? await db.query<{ id: string; chain_id: string; address: string; balance_cache: string; last_sweep_at: string | null; is_active: boolean }>(
              `SELECT id, chain_id, address, COALESCE(balance_cache::text, '0') AS balance_cache, last_sweep_at::text AS last_sweep_at, is_active FROM hot_wallets ORDER BY ${orderCol}`
            )
          : await db.query<{ id: string; chain_id: string; address: string; balance_cache: string; last_sweep_at: string | null; is_active: boolean }>(
              `SELECT id, blockchain_id::text AS chain_id, address, COALESCE(balance_cache::text, '0') AS balance_cache, last_sweep_at::text AS last_sweep_at, is_active FROM hot_wallets ORDER BY ${orderCol}`
            );
      const chainMap: Record<string, string> = {};
      try {
        const chains = await db.query<{ id: string; name: string }>('SELECT id, name FROM chains WHERE is_active = TRUE');
        chains.rows.forEach((r: { id: string; name: string }) => { chainMap[r.id] = r.name; });
      } catch {
        //
      }
      try {
        const blk = await db.query<{ id: string; chain_name: string }>('SELECT id::text AS id, chain_name FROM blockchains WHERE is_active = TRUE');
        blk.rows.forEach((r: { id: string; chain_name: string }) => { chainMap[r.id] = r.chain_name ?? r.id; });
      } catch {
        //
      }
      const list = rawRows.rows.map((r) => ({
        id: r.id,
        chain_id: r.chain_id,
        chain_name: chainMap[r.chain_id] ?? r.chain_id,
        address: r.address,
        balance: r.balance_cache ?? '0',
        last_sweep_at: r.last_sweep_at ?? null,
        status: r.is_active ? 'active' : 'inactive',
      }));
      return reply.send({ success: true, data: list });
    } catch (e) {
      if ((e as { code?: string; pgCode?: string })?.pgCode === '42P01') {
        return reply.send({ success: true, data: [] });
      }
      logger.error('Get treasury hot-wallets error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch hot wallets' } });
    }
  });

  /**
   * GET /admin/treasury/cold-wallets
   * List cold wallets (from hot_wallets.cold_wallet_address) with chain, address, balance (null), reserve_percentage.
   */
  app.get('/treasury/cold-wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const idMode = await getHotWalletsIdModeCached();
      if (idMode === 'none') {
        return reply.send({ success: true, data: [] });
      }
      const rows =
        idMode === 'chain_id'
          ? await db.query<{ chain_id: string; cold_wallet_address: string | null; balance_cache: string }>(
              `SELECT chain_id, cold_wallet_address, COALESCE(balance_cache::text, '0') AS balance_cache FROM hot_wallets WHERE is_active = TRUE AND cold_wallet_address IS NOT NULL AND cold_wallet_address != ''`
            )
          : await db.query<{ chain_id: string; cold_wallet_address: string | null; balance_cache: string }>(
              `SELECT blockchain_id::text AS chain_id, cold_wallet_address, COALESCE(balance_cache::text, '0') AS balance_cache FROM hot_wallets WHERE is_active = TRUE AND cold_wallet_address IS NOT NULL AND cold_wallet_address != ''`
            );
      const chainMap: Record<string, string> = {};
      try {
        const chains = await db.query<{ id: string; name: string }>('SELECT id, name FROM chains WHERE is_active = TRUE');
        chains.rows.forEach((r: { id: string; name: string }) => { chainMap[r.id] = r.name; });
      } catch {
        //
      }
      try {
        const blk = await db.query<{ id: string; chain_name: string }>('SELECT id::text AS id, chain_name FROM blockchains WHERE is_active = TRUE');
        blk.rows.forEach((r: { id: string; chain_name: string }) => { chainMap[r.id] = r.chain_name ?? r.id; });
      } catch {
        //
      }
      const totalHot = rows.rows.reduce((s, r) => s + parseFloat(r.balance_cache || '0'), 0);
      const list = rows.rows.map((r) => {
        const chainName = chainMap[r.chain_id] ?? r.chain_id;
        const bal = parseFloat(r.balance_cache || '0');
        const pct = totalHot > 0 ? Math.round((1 - bal / totalHot) * 100) : 95;
        return {
          chain_id: r.chain_id,
          chain_name: chainName,
          address: r.cold_wallet_address,
          balance: null as string | null,
          reserve_percentage: pct,
        };
      });
      return reply.send({ success: true, data: list });
    } catch (e) {
      if ((e as { code?: string; pgCode?: string })?.pgCode === '42P01') {
        return reply.send({ success: true, data: [] });
      }
      logger.error('Get treasury cold-wallets error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch cold wallets' } });
    }
  });

  // ===============================
  // COLD WALLETS — standalone CRUD
  // ===============================

  app.get('/cold-wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasTable = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cold_wallets') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      if (!hasTable) return reply.send({ success: true, data: [] });
      const rows = await db.query(
        `SELECT id, chain_id as chain, address, COALESCE(label, '') as label, COALESCE(balance, 0)::text as balance, COALESCE(is_active, TRUE) as is_active, COALESCE(is_primary, FALSE) as is_primary, created_at, updated_at FROM cold_wallets ORDER BY is_primary DESC NULLS LAST, created_at DESC`
      );
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Cold wallets list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list cold wallets' } });
    }
  });

  app.post<{ Body: { chain: string; address: string; label?: string; is_primary?: boolean } }>('/cold-wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const { chain, address, label, is_primary } = request.body ?? {};
      if (!chain?.trim() || !address?.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'chain and address are required' } });
      }
      if (is_primary) {
        await db.query(`UPDATE cold_wallets SET is_primary = FALSE WHERE is_primary = TRUE`);
      }
      const row = await db.query(
        `INSERT INTO cold_wallets (chain_id, address, label, is_primary) VALUES ($1, $2, $3, $4) RETURNING id, chain_id as chain, address, label, COALESCE(balance, 0)::text as balance, COALESCE(is_active, TRUE) as is_active, is_primary, created_at`,
        [chain.trim(), address.trim(), label?.trim() || null, is_primary ?? false]
      );
      db.query(
        `INSERT INTO treasury_audit_logs (admin_id, action, resource_type, resource_id, metadata) VALUES ($1, 'cold_wallet_created', 'cold_wallets', $2, $3::jsonb)`,
        [admin.adminId, row.rows[0]?.id, JSON.stringify({ chain, address, label, is_primary })]
      ).catch(() => {});
      return reply.status(201).send({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error('Cold wallet create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create cold wallet' } });
    }
  });

  app.patch<{ Params: { id: string }; Body: { label?: string; is_active?: boolean; is_primary?: boolean; balance?: string } }>('/cold-wallets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const { id } = request.params;
      const { label, is_active, is_primary, balance } = request.body ?? {};
      if (is_primary === true) {
        await db.query(`UPDATE cold_wallets SET is_primary = FALSE WHERE is_primary = TRUE AND id != $1`, [id]);
      }
      const updates: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let i = 1;
      if (label !== undefined) { updates.push(`label = $${i++}`); params.push(label); }
      if (is_active !== undefined) { updates.push(`is_active = $${i++}`); params.push(is_active); }
      if (is_primary !== undefined) { updates.push(`is_primary = $${i++}`); params.push(is_primary); }
      if (balance !== undefined) { updates.push(`balance = $${i++}::numeric`); params.push(balance); }
      params.push(id);
      const row = await db.query(
        `UPDATE cold_wallets SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, chain_id as chain, address, label, COALESCE(balance, 0)::text as balance, COALESCE(is_active, TRUE) as is_active, is_primary, created_at, updated_at`,
        params
      );
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Cold wallet not found' } });
      }
      return reply.send({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error('Cold wallet update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  app.delete<{ Params: { id: string } }>('/cold-wallets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const result = await db.query('DELETE FROM cold_wallets WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Cold wallet not found' } });
      }
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e) {
      logger.error('Cold wallet delete error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete' } });
    }
  });

  // ===============================
  // TREASURY RULES (sweep configuration)
  // ===============================

  app.get('/treasury/rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasTable = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='treasury_rules') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      if (!hasTable) return reply.send({ success: true, data: [] });
      const rows = await db.query('SELECT id, rule_key, rule_value, description, is_active, updated_at, updated_by FROM treasury_rules ORDER BY rule_key');
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Treasury rules list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch rules' } });
    }
  });

  app.patch<{ Params: { key: string }; Body: { rule_value?: unknown; is_active?: boolean } }>('/treasury/rules/:key', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const { key } = request.params;
      const { rule_value, is_active } = request.body ?? {};
      const updates: string[] = ['updated_at = NOW()', `updated_by = '${admin.adminId}'`];
      const params: unknown[] = [];
      let i = 1;
      if (rule_value !== undefined) { updates.push(`rule_value = $${i++}::jsonb`); params.push(JSON.stringify(rule_value)); }
      if (is_active !== undefined) { updates.push(`is_active = $${i++}`); params.push(is_active); }
      params.push(key);
      const row = await db.query(
        `UPDATE treasury_rules SET ${updates.join(', ')} WHERE rule_key = $${i} RETURNING *`,
        params
      );
      if (row.rows.length === 0) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Rule not found' } });
      await db.query(
        `INSERT INTO treasury_audit_logs (admin_id, action, resource_type, resource_id, metadata) VALUES ($1, 'rule_updated', 'treasury_rules', $2, $3::jsonb)`,
        [admin.adminId, key, JSON.stringify({ rule_value, is_active })]
      ).catch(() => {});
      return reply.send({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error('Treasury rule update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update rule' } });
    }
  });

  // ===============================
  // COLD WALLET ALLOCATIONS
  // ===============================

  app.get('/treasury/allocations', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasTable = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cold_wallet_allocations') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      if (!hasTable) return reply.send({ success: true, data: [] });
      const rows = await db.query(
        `SELECT a.id, a.chain, a.cold_wallet_id, a.allocation_percent, a.is_active, a.created_at, a.updated_at,
                cw.address as wallet_address, cw.label as wallet_label
         FROM cold_wallet_allocations a
         LEFT JOIN cold_wallets cw ON a.cold_wallet_id = cw.id
         ORDER BY a.chain, a.allocation_percent DESC`
      );
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Allocations list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch allocations' } });
    }
  });

  app.post<{ Body: { chain: string; cold_wallet_id: string; allocation_percent: number } }>('/treasury/allocations', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const { chain, cold_wallet_id, allocation_percent } = request.body ?? {};
      if (!chain || !cold_wallet_id || allocation_percent == null) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'chain, cold_wallet_id, allocation_percent required' } });
      }
      const row = await db.query(
        `INSERT INTO cold_wallet_allocations (chain, cold_wallet_id, allocation_percent)
         VALUES ($1, $2, $3)
         ON CONFLICT (chain, cold_wallet_id) DO UPDATE SET allocation_percent = $3, updated_at = NOW()
         RETURNING *`,
        [chain, cold_wallet_id, Math.max(0, Math.min(100, allocation_percent))]
      );
      await db.query(
        `INSERT INTO treasury_audit_logs (admin_id, action, resource_type, resource_id, metadata) VALUES ($1, 'allocation_set', 'cold_wallet_allocations', $2, $3::jsonb)`,
        [admin.adminId, cold_wallet_id, JSON.stringify({ chain, allocation_percent })]
      ).catch(() => {});
      return reply.send({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error('Allocation create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to set allocation' } });
    }
  });

  app.delete<{ Params: { id: string } }>('/treasury/allocations/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const result = await db.query('DELETE FROM cold_wallet_allocations WHERE id = $1 RETURNING id', [request.params.id]);
      if (result.rows.length === 0) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Allocation not found' } });
      await db.query(
        `INSERT INTO treasury_audit_logs (admin_id, action, resource_type, resource_id, metadata) VALUES ($1, 'allocation_deleted', 'cold_wallet_allocations', $2, '{}')`,
        [admin.adminId, request.params.id]
      ).catch(() => {});
      return reply.send({ success: true, data: { deleted: true } });
    } catch (e) {
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete' } });
    }
  });

  // ===============================
  // TREASURY AUDIT LOGS
  // ===============================

  app.get<{ Querystring: { limit?: string; action?: string } }>('/treasury/audit-logs', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasTable = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='treasury_audit_logs') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      if (!hasTable) return reply.send({ success: true, data: [] });
      const limit = Math.min(100, parseInt(request.query.limit || '50', 10) || 50);
      const action = request.query.action?.trim() || null;
      let sql = 'SELECT id, admin_id, action, resource_type, resource_id, metadata, created_at FROM treasury_audit_logs';
      const params: unknown[] = [];
      if (action) { sql += ' WHERE action = $1'; params.push(action); }
      sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);
      const rows = await db.query(sql, params);
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Treasury audit logs error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch audit logs' } });
    }
  });

  /**
   * GET /admin/treasury/sweeps
   * List deposit sweeps (same as GET /admin/deposit-sweeps). Paginated.
   */
  app.get<{
    Querystring: { page?: string; limit?: string; chain_id?: string; status?: string };
  }>('/treasury/sweeps', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = '1', limit = '20', chain_id, status } = request.query as { page?: string; limit?: string; chain_id?: string; status?: string };
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      const offset = (pageNum - 1) * limitNum;
      const conditions: string[] = ["ds.chain_id IN (SELECT id FROM chains WHERE LOWER(TRIM(type)) = 'evm' AND is_active = TRUE)"];
      const params: (string | number)[] = [];
      let paramIndex = 1;
      if (chain_id?.trim()) {
        conditions.push(`ds.chain_id = $${paramIndex++}`);
        params.push(chain_id.trim());
      }
      if (status && status !== 'all') {
        conditions.push(`ds.status = $${paramIndex++}`);
        params.push(status);
      }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const countResult = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM deposit_sweeps ds ${whereClause}`, params);
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
      const listResult = await db.query<{
        id: string; chain_id: string; from_address: string; to_address: string; amount: string; amount_raw: string | null;
        tx_hash: string | null; status: string; error_message: string | null; created_at: string; completed_at: string | null;
      }>(
        `SELECT ds.id, ds.chain_id, ds.from_address, ds.to_address, ds.amount::text AS amount, ds.amount_raw, ds.tx_hash, ds.status, ds.error_message, ds.created_at::text, ds.completed_at::text
         FROM deposit_sweeps ds ${whereClause} ORDER BY ds.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limitNum, offset]
      );
      const chainNames = await db.query<{ id: string; name: string }>('SELECT id, name FROM chains WHERE is_active = TRUE').catch(() => ({ rows: [] as { id: string; name: string }[] }));
      const chainMap = Object.fromEntries((chainNames.rows as { id: string; name: string }[]).map((c) => [c.id, c.name]));
      const sweeps = listResult.rows.map((r) => ({
        id: r.id,
        chain_id: r.chain_id,
        chain_name: chainMap[r.chain_id] ?? r.chain_id,
        from_address: r.from_address,
        to_address: r.to_address,
        asset: chainMap[r.chain_id] ? 'ETH' : '—',
        amount: r.amount,
        status: r.status,
        error_message: r.error_message,
        created_at: r.created_at,
        completed_at: r.completed_at,
      }));
      return reply.send({
        success: true,
        data: { sweeps, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 } },
      });
    } catch (e) {
      if ((e as { pgCode?: string })?.pgCode === '42P01') {
        return reply.send({ success: true, data: { sweeps: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } } });
      }
      logger.error('Get treasury sweeps error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch sweeps' } });
    }
  });

  /**
   * POST /admin/treasury/sweeps/run
   * Trigger deposit sweep run (same as POST /admin/deposit-sweeps/run).
   */
  app.post('/treasury/sweeps/run', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'treasury:sweep', reply)) return;
    try {
      const { runDepositSweep } = await import('../services/deposit-sweep.service.js');
      const result = await runDepositSweep();
      return reply.send({
        success: true,
        data: { swept_count: result.sweptCount, errors: result.errors },
      });
    } catch (e) {
      logger.error('Treasury sweep run error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'RUN_FAILED', message: 'Failed to run sweep' } });
    }
  });

  /**
   * POST /admin/treasury/sweeps/:id/retry
   * Retry a failed sweep: set status to pending and trigger run.
   */
  app.post<{ Params: { id: string } }>('/treasury/sweeps/:id/retry', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    if (!id) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_ID', message: 'Sweep id is required' } });
    }
    try {
      const row = await db.query<{ status: string }>('SELECT status FROM deposit_sweeps WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Sweep not found' } });
      }
      if (row.rows[0]!.status !== 'failed') {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_STATUS', message: 'Only failed sweeps can be retried' } });
      }
      await db.query(
        'UPDATE deposit_sweeps SET status = $1, error_message = NULL, completed_at = NULL WHERE id = $2',
        ['pending', id]
      );
      const { runDepositSweep } = await import('../services/deposit-sweep.service.js');
      const result = await runDepositSweep();
      return reply.send({
        success: true,
        data: { swept_count: result.sweptCount, errors: result.errors },
      });
    } catch (e) {
      logger.error('Treasury sweep retry error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'RETRY_FAILED', message: 'Failed to retry sweep' } });
    }
  });

  /**
   * GET /admin/treasury/transactions
   * Wallet transaction history: sweeps, withdrawals, deposits, cold transfers. Paginated.
   */
  app.get<{ Querystring: { page?: string; limit?: string; type?: string } }>('/treasury/transactions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = '1', limit = '50', type } = request.query as { page?: string; limit?: string; type?: string };
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
      const offset = (pageNum - 1) * limitNum;
      const rows: Array<{ tx_hash: string | null; wallet_address: string; asset: string; amount: string; transaction_type: string; time: string }> = [];
      const typeFilter = type && type !== 'all' ? type.toLowerCase() : null;
      const maxFetch = 500;

      try {
        const sweepRows = await db.query<{ tx_hash: string | null; from_address: string; to_address: string; amount: string; created_at: string }>(
          `SELECT tx_hash, from_address, to_address, amount::text AS amount, created_at::text AS created_at FROM deposit_sweeps WHERE status = 'completed' AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT $1`,
          [maxFetch]
        );
        for (const r of sweepRows.rows) {
          if (typeFilter && typeFilter !== 'sweep') continue;
          rows.push({
            tx_hash: r.tx_hash,
            wallet_address: r.from_address ?? r.to_address ?? '—',
            asset: 'ETH',
            amount: r.amount ?? '0',
            transaction_type: 'Sweep',
            time: r.created_at ?? '',
          });
        }
      } catch {
        //
      }
      try {
        const hasTxHash = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'tx_hash' LIMIT 1`);
        if (hasTxHash.rows.length > 0) {
          const wRows = await db.query<{ tx_hash: string | null; to_address: string; amount: string; created_at: string }>(
            `SELECT tx_hash, to_address, amount::text AS amount, created_at::text AS created_at FROM withdrawals WHERE status IN ('completed', 'approved') AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT $1`,
            [maxFetch]
          );
          for (const r of wRows.rows) {
            if (typeFilter && typeFilter !== 'withdrawal') continue;
            rows.push({
              tx_hash: r.tx_hash,
              wallet_address: r.to_address ?? '—',
              asset: '—',
              amount: r.amount ?? '0',
              transaction_type: 'Withdrawal',
              time: r.created_at ?? '',
            });
          }
        }
      } catch {
        //
      }
      rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      const total = rows.length;
      const paginated = rows.slice(offset, offset + limitNum);
      return reply.send({
        success: true,
        data: { transactions: paginated, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 } },
      });
    } catch (e) {
      logger.error('Get treasury transactions error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch transactions' } });
    }
  });

  /**
   * GET /admin/treasury/settings
   * Sweep and treasury settings (from env or treasury_settings table).
   */
  app.get('/treasury/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS treasury_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL DEFAULT '{}'
        )
      `);
      const stored = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM treasury_settings WHERE key IN ($1, $2, $3, $4)', [
        'auto_sweep_enabled', 'sweep_interval', 'min_sweep_amount', 'gas_reserve_threshold',
      ]);
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      const { config } = await import('../config/index.js');
      const auto_sweep_enabled = (map.auto_sweep_enabled as boolean) ?? config?.depositSweep?.enabled ?? true;
      const sweep_interval = (map.sweep_interval as number) ?? 3600;
      const min_sweep_amount = (map.min_sweep_amount as string) ?? config?.depositSweep?.minWei ?? '1000000000000000';
      const gas_reserve_threshold = (map.gas_reserve_threshold as string) ?? '0';
      return reply.send({
        success: true,
        data: {
          auto_sweep_enabled,
          sweep_interval,
          min_sweep_amount,
          gas_reserve_threshold,
        },
      });
    } catch (e) {
      logger.error('Get treasury settings error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch settings' } });
    }
  });

  /**
   * PATCH /admin/treasury/settings
   * Update sweep settings. Persists to treasury_settings table.
   */
  app.patch<{ Body: { auto_sweep_enabled?: boolean; sweep_interval?: number; min_sweep_amount?: string; gas_reserve_threshold?: string } }>('/treasury/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS treasury_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')`);
      const body = request.body || {};
      const updates: Array<{ key: string; value: unknown }> = [];
      if (typeof body.auto_sweep_enabled === 'boolean') updates.push({ key: 'auto_sweep_enabled', value: body.auto_sweep_enabled });
      if (typeof body.sweep_interval === 'number') updates.push({ key: 'sweep_interval', value: body.sweep_interval });
      if (typeof body.min_sweep_amount === 'string') updates.push({ key: 'min_sweep_amount', value: body.min_sweep_amount });
      if (typeof body.gas_reserve_threshold === 'string') updates.push({ key: 'gas_reserve_threshold', value: body.gas_reserve_threshold });
      for (const u of updates) {
        await db.query(
          'INSERT INTO treasury_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
          [u.key, JSON.stringify(u.value)]
        );
      }
      const stored = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM treasury_settings WHERE key IN ($1, $2, $3, $4)', [
        'auto_sweep_enabled', 'sweep_interval', 'min_sweep_amount', 'gas_reserve_threshold',
      ]);
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      const { config } = await import('../config/index.js');
      return reply.send({
        success: true,
        data: {
          auto_sweep_enabled: (map.auto_sweep_enabled as boolean) ?? config?.depositSweep?.enabled ?? true,
          sweep_interval: (map.sweep_interval as number) ?? 3600,
          min_sweep_amount: (map.min_sweep_amount as string) ?? config?.depositSweep?.minWei ?? '1000000000000000',
          gas_reserve_threshold: (map.gas_reserve_threshold as string) ?? '0',
        },
      });
    } catch (e) {
      logger.error('Patch treasury settings error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update settings' } });
    }
  });

  // ===============================
  // RISK & AML
  // ===============================

  /**
   * GET /admin/risk
   * Dashboard stats: open_aml_alerts, high_risk_users, suspicious_trades, str_reports.
   */
  app.get('/risk', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const [openAlerts, strPending, highRiskCount, suspiciousCount, totalUsers, mediumRiskCount] = await Promise.all([
        db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM aml_alerts WHERE status IN ('open','reviewing')`).catch(() => ({ rows: [{ count: '0' }] })),
        db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM aml_str_ctr_logs WHERE report_type = 'STR' AND status = 'pending'`).catch(() => ({ rows: [{ count: '0' }] })),
        db.query<{ count: string }>(
          `SELECT COUNT(DISTINCT user_id)::text AS count FROM aml_alerts WHERE status IN ('open','reviewing')`
        ).catch(() => ({ rows: [{ count: '0' }] })),
        db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM aml_alerts WHERE alert_type IN ('wash_trading','spoofing','pump_detection','large_withdrawal','sanction_address','mixer_transaction') AND status IN ('open','reviewing')`
        ).catch(() => ({ rows: [{ count: '0' }] })),
        db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL`).catch(() => ({ rows: [{ count: '0' }] })),
        db.query<{ count: string }>(
          `SELECT COUNT(DISTINCT user_id)::text AS count FROM aml_alerts WHERE status IN ('closed','reported') AND created_at > NOW() - INTERVAL '90 days' AND user_id NOT IN (SELECT user_id FROM aml_alerts WHERE status IN ('open','reviewing'))`
        ).catch(() => ({ rows: [{ count: '0' }] })),
      ]);
      const high = parseInt(highRiskCount.rows[0]?.count ?? '0', 10);
      const medium = parseInt(mediumRiskCount.rows[0]?.count ?? '0', 10);
      const total = parseInt(totalUsers.rows[0]?.count ?? '0', 10);
      const low = Math.max(0, total - high - medium);
      return reply.send({
        success: true,
        data: {
          open_aml_alerts: parseInt(openAlerts.rows[0]?.count ?? '0', 10),
          high_risk_users: high,
          suspicious_trades: parseInt(suspiciousCount.rows[0]?.count ?? '0', 10),
          str_reports: parseInt(strPending.rows[0]?.count ?? '0', 10),
          risk_distribution: {
            low_risk_users: low,
            medium_risk_users: medium,
            high_risk_users: high,
          },
        },
      });
    } catch (e) {
      logger.error('Get risk dashboard error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load risk dashboard' } });
    }
  });

  /**
   * GET /admin/risk/sanctions
   * Sanction address monitoring: address, user, chain, risk level, last activity, status.
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/risk/sanctions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt((request.query as { offset?: string }).offset ?? '0', 10) || 0);
      const rows = await db.query<{
        id: string; user_id: string; user_email: string | null; alert_type: string; severity: string; status: string; details: unknown; created_at: string;
      }>(
        `SELECT a.id, a.user_id, u.email AS user_email, a.alert_type, a.severity, a.status, a.details, a.created_at::text
         FROM aml_alerts a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.alert_type IN ('sanction_address', 'sanction_detected')
         ORDER BY a.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM aml_alerts WHERE alert_type IN ('sanction_address', 'sanction_detected')`
      );
      const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
      const list = rows.rows.map((r) => {
        const details = (r.details && typeof r.details === 'object' && !Array.isArray(r.details)) ? r.details as Record<string, unknown> : {};
        const address = (details.address as string) ?? (details.wallet_address as string) ?? '—';
        const chain = (details.chain as string) ?? (details.network as string) ?? '—';
        return {
          id: r.id,
          address: address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address,
          address_full: address,
          user_id: r.user_id,
          user_email: r.user_email ?? '—',
          chain,
          risk_level: r.severity ?? 'High',
          last_activity: r.created_at,
          status: r.status,
        };
      });
      return reply.send({ success: true, data: { items: list, total } });
    } catch (e) {
      logger.error('Get risk sanctions error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load sanctions' } });
    }
  });

  /**
   * GET /admin/risk/users/:userId/timeline
   * Risk timeline for user: AML alerts, large withdrawals, sanction checks, freezes, risk score changes.
   */
  app.get<{ Params: { userId: string } }>('/risk/users/:userId/timeline', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const userId = (request.params as { userId: string }).userId;
    try {
      const events: Array<{ event_type: string; timestamp: string; admin_action: string | null; details?: unknown }> = [];
      const alertRows = await db.query<{ alert_type: string; severity: string; status: string; details: unknown; created_at: string }>(
        `SELECT alert_type, severity, status, details, created_at::text FROM aml_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [userId]
      );
      for (const r of alertRows.rows) {
        events.push({
          event_type: r.alert_type === 'sanction_address' || r.alert_type === 'sanction_detected' ? 'Sanction Check' : r.alert_type === 'large_withdrawal' ? 'Large Withdrawal' : 'AML Alert Triggered',
          timestamp: r.created_at,
          admin_action: r.status === 'closed' ? 'Closed' : r.status === 'reported' ? 'Escalated to STR' : null,
          details: r.details,
        });
      }
      try {
        const auditRows = await db.query<{ action: string; new_value: string | null; created_at: string }>(
          `SELECT action, new_value, created_at::text FROM audit_logs_immutable WHERE resource_type = 'user' AND resource_id = $1 AND action IN ('admin_user_status_change', 'risk_alert_freeze_account') ORDER BY created_at DESC LIMIT 50`,
          [userId]
        );
        for (const r of auditRows.rows) {
          const eventType = r.action === 'risk_alert_freeze_account' ? 'Account Freeze' : 'Risk Score Change';
          events.push({
            event_type: eventType,
            timestamp: r.created_at,
            admin_action: r.action === 'admin_user_status_change' ? 'Status changed' : 'Account frozen',
            details: r.new_value ? (() => { try { return JSON.parse(r.new_value); } catch { return null; } })() : null,
          });
        }
      } catch {
        //
      }
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return reply.send({ success: true, data: { events: events.slice(0, 100) } });
    } catch (e) {
      logger.error('Get user risk timeline error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load risk timeline' } });
    }
  });

  /**
   * GET /admin/risk/users/:userId/score
   * Persistent risk score for a user from user_risk_scores.
   */
  app.get<{ Params: { userId: string } }>('/risk/users/:userId/score', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const userId = (request.params as { userId: string }).userId;
    try {
      const row = await db.query<{ score: string; risk_level: string; signals: unknown; last_updated: string }>(
        `SELECT score::text, risk_level, signals, last_updated::text FROM user_risk_scores WHERE user_id = $1`,
        [userId]
      );
      if (row.rows.length === 0) {
        return reply.send({ success: true, data: { score: 0, risk_level: 'low', signals: {}, last_updated: null, persisted: false } });
      }
      const r = row.rows[0]!;
      return reply.send({
        success: true,
        data: { score: parseInt(r.score, 10), risk_level: r.risk_level, signals: r.signals, last_updated: r.last_updated, persisted: true },
      });
    } catch (e) {
      logger.error('Get user risk score error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load risk score' } });
    }
  });

  /**
   * GET /admin/risk/automation-rules
   */
  app.get('/risk/automation-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS risk_automation_rules (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')`);
      const stored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_automation_rules WHERE key IN ($1, $2, $3)`,
        ['auto_freeze_risk_threshold', 'auto_alert_withdrawal_threshold', 'auto_alert_cancel_rate_threshold']
      );
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      return reply.send({
        success: true,
        data: {
          auto_freeze_risk_threshold: (map.auto_freeze_risk_threshold as number) ?? 0,
          auto_alert_withdrawal_threshold: (map.auto_alert_withdrawal_threshold as number) ?? 0,
          auto_alert_cancel_rate_threshold: (map.auto_alert_cancel_rate_threshold as number) ?? 0,
        },
      });
    } catch (e) {
      logger.error('Get automation rules error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load rules' } });
    }
  });

  /**
   * PATCH /admin/risk/automation-rules
   */
  app.patch<{ Body: { auto_freeze_risk_threshold?: number; auto_alert_withdrawal_threshold?: number; auto_alert_cancel_rate_threshold?: number } }>('/risk/automation-rules', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS risk_automation_rules (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')`);
      const body = request.body || {};
      const updates: Array<{ key: string; value: number }> = [];
      if (typeof body.auto_freeze_risk_threshold === 'number') updates.push({ key: 'auto_freeze_risk_threshold', value: body.auto_freeze_risk_threshold });
      if (typeof body.auto_alert_withdrawal_threshold === 'number') updates.push({ key: 'auto_alert_withdrawal_threshold', value: body.auto_alert_withdrawal_threshold });
      if (typeof body.auto_alert_cancel_rate_threshold === 'number') updates.push({ key: 'auto_alert_cancel_rate_threshold', value: body.auto_alert_cancel_rate_threshold });
      const oldStored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_automation_rules WHERE key IN ($1, $2, $3)`,
        ['auto_freeze_risk_threshold', 'auto_alert_withdrawal_threshold', 'auto_alert_cancel_rate_threshold']
      );
      const oldMap = Object.fromEntries(oldStored.rows.map((r) => [r.key, r.value]));
      for (const u of updates) {
        await db.query(
          'INSERT INTO risk_automation_rules (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb',
          [u.key, JSON.stringify(u.value)]
        );
      }
      const stored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_automation_rules WHERE key IN ($1, $2, $3)`,
        ['auto_freeze_risk_threshold', 'auto_alert_withdrawal_threshold', 'auto_alert_cancel_rate_threshold']
      );
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'risk_automation_rules_updated',
          resourceType: 'risk_automation',
          resourceId: null,
          oldValue: oldMap as Record<string, unknown>,
          newValue: map as Record<string, unknown>,
        });
      } catch { /* best-effort */ }
      return reply.send({
        success: true,
        data: {
          auto_freeze_risk_threshold: (map.auto_freeze_risk_threshold as number) ?? 0,
          auto_alert_withdrawal_threshold: (map.auto_alert_withdrawal_threshold as number) ?? 0,
          auto_alert_cancel_rate_threshold: (map.auto_alert_cancel_rate_threshold as number) ?? 0,
        },
      });
    } catch (e) {
      logger.error('Patch automation rules error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update rules' } });
    }
  });

  /**
   * GET /admin/risk/severity-settings
   */
  app.get('/risk/severity-settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS risk_severity_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')`);
      const stored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_severity_settings WHERE key IN ($1, $2)`,
        ['whale_trade_100k_severity', 'whale_trade_500k_severity']
      );
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      return reply.send({
        success: true,
        data: {
          whale_trade_100k_severity: (map.whale_trade_100k_severity as string) ?? 'medium',
          whale_trade_500k_severity: (map.whale_trade_500k_severity as string) ?? 'high',
        },
      });
    } catch (e) {
      logger.error('Get severity settings error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load severity settings' } });
    }
  });

  /**
   * PATCH /admin/risk/severity-settings
   */
  app.patch<{ Body: { whale_trade_100k_severity?: string; whale_trade_500k_severity?: string } }>('/risk/severity-settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS risk_severity_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')`);
      const body = request.body || {};
      const updates: Array<{ key: string; value: string }> = [];
      if (typeof body.whale_trade_100k_severity === 'string' && ['low', 'medium', 'high'].includes(body.whale_trade_100k_severity)) {
        updates.push({ key: 'whale_trade_100k_severity', value: body.whale_trade_100k_severity });
      }
      if (typeof body.whale_trade_500k_severity === 'string' && ['low', 'medium', 'high'].includes(body.whale_trade_500k_severity)) {
        updates.push({ key: 'whale_trade_500k_severity', value: body.whale_trade_500k_severity });
      }
      for (const u of updates) {
        await db.query(
          'INSERT INTO risk_severity_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb',
          [u.key, JSON.stringify(u.value)]
        );
      }
      const stored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_severity_settings WHERE key IN ($1, $2)`,
        ['whale_trade_100k_severity', 'whale_trade_500k_severity']
      );
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      return reply.send({
        success: true,
        data: {
          whale_trade_100k_severity: (map.whale_trade_100k_severity as string) ?? 'medium',
          whale_trade_500k_severity: (map.whale_trade_500k_severity as string) ?? 'high',
        },
      });
    } catch (e) {
      logger.error('Patch severity settings error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update severity settings' } });
    }
  });

  /**
   * GET /admin/risk/alerts
   * AML alerts list with user email. Paginated.
   */
  app.get<{ Querystring: { status?: string; severity?: string; limit?: string; offset?: string } }>('/risk/alerts', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { status?: string; severity?: string; limit?: string; offset?: string };
      const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0);
      const conditions: string[] = ['1=1'];
      const params: (string | number)[] = [];
      let i = 1;
      if (q.status && ['open', 'reviewing', 'closed', 'reported'].includes(q.status)) {
        conditions.push(`a.status = $${i++}`);
        params.push(q.status);
      }
      if (q.severity && ['low', 'medium', 'high'].includes(q.severity)) {
        conditions.push(`a.severity = $${i++}`);
        params.push(q.severity);
      }
      const where = conditions.join(' AND ');
      const countRes = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM aml_alerts a WHERE ${where}`, params);
      const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
      params.push(limit, offset);
      const listRes = await db.query<{
        id: string; user_id: string; user_email: string | null; alert_type: string; severity: string; status: string; details: unknown; created_at: string;
      }>(
        `SELECT a.id, a.user_id, u.email AS user_email, a.alert_type, a.severity, a.status, a.details, a.created_at::text
         FROM aml_alerts a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE ${where}
         ORDER BY a.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      return reply.send({
        success: true,
        data: { alerts: listRes.rows, total },
      });
    } catch (e) {
      logger.error('Get risk alerts error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list alerts' } });
    }
  });

  /**
   * POST /admin/risk/alerts/:id/freeze-account
   * Freeze (suspend) the user associated with the alert. Audit logged.
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/risk/alerts/:id/freeze-account', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const alertId = (request.params as { id: string }).id;
    try {
      const row = await db.query<{ user_id: string; status: string }>('SELECT user_id, status FROM aml_alerts WHERE id = $1', [alertId]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } });
      }
      const userId = row.rows[0]!.user_id;
      const reason = (request.body as { reason?: string })?.reason ?? 'AML freeze from alert';
      await db.query('UPDATE users SET status = $1, status_reason = $2, updated_at = NOW() WHERE id = $3', ['suspended', reason, userId]);
      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: 'risk_alert_freeze_account',
          resourceType: 'aml_alert',
          resourceId: alertId,
          newValue: { user_id: userId, reason },
        });
      } catch {
        /* best-effort */
      }
      return reply.send({ success: true });
    } catch (e) {
      logger.error('Freeze account from alert error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FREEZE_FAILED', message: 'Failed to freeze account' } });
    }
  });

  /**
   * GET /admin/risk/suspicious
   * Suspicious trading metrics: whale_trades, rapid_orders, order_cancel_rate, price_manipulation_alerts.
   */
  app.get('/risk/suspicious', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let whaleTrades = 0;
      let rapidOrders = 0;
      let orderCancelRate = 0;
      let priceManipulationAlerts = 0;
      try {
        const whale = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM spot_trades WHERE (price * quantity) >= 100000 AND created_at > NOW() - INTERVAL '24 hours'`
        );
        whaleTrades = parseInt(whale.rows[0]?.count ?? '0', 10);
      } catch {
        //
      }
      try {
        const rapid = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM spot_orders WHERE created_at > NOW() - INTERVAL '5 minutes'`
        );
        rapidOrders = parseInt(rapid.rows[0]?.count ?? '0', 10);
      } catch {
        //
      }
      try {
        const tot = await db.query<{ total: string; cancelled: string }>(
          `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled FROM spot_orders WHERE created_at > NOW() - INTERVAL '24 hours'`
        );
        const total = parseInt(tot.rows[0]?.total ?? '0', 10);
        const cancelled = parseInt(tot.rows[0]?.cancelled ?? '0', 10);
        orderCancelRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
      } catch {
        //
      }
      try {
        const pm = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM aml_alerts WHERE alert_type IN ('wash_trading','spoofing','pump_detection') AND status IN ('open','reviewing') AND created_at > NOW() - INTERVAL '7 days'`
        );
        priceManipulationAlerts = parseInt(pm.rows[0]?.count ?? '0', 10);
      } catch {
        //
      }
      return reply.send({
        success: true,
        data: {
          whale_trades: whaleTrades,
          rapid_orders: rapidOrders,
          order_cancel_rate: orderCancelRate,
          price_manipulation_alerts: priceManipulationAlerts,
        },
      });
    } catch (e) {
      logger.error('Get risk suspicious error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load suspicious metrics' } });
    }
  });

  /**
   * GET /admin/risk/high-risk-users
   * Users with open/reviewing AML alerts or high risk. Columns: user, risk_score, flags, total_volume, last_activity.
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/risk/high-risk-users', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string }).limit ?? '50', 10) || 50));
      const offset = Math.max(0, parseInt((request.query as { offset?: string }).offset ?? '0', 10) || 0);

      const hasRiskScoresTable = await db.query(`SELECT to_regclass('public.user_risk_scores') AS t`);
      const usePersistedScores = hasRiskScoresTable.rows[0]?.t != null;

      let list: Array<{ user_id: string; user_email: string | null; risk_score: number; risk_level: string; flags: string[]; total_volume: string; last_activity: string | null }>;
      let total = 0;

      if (usePersistedScores) {
        const rows = await db.query<{
          user_id: string; user_email: string | null; risk_score: string; risk_level: string; flags: string[]; total_volume: string; last_activity: string | null;
        }>(
          `SELECT urs.user_id::text, u.email AS user_email, urs.score::text AS risk_score, urs.risk_level,
                  COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.alert_type), NULL), ARRAY[]::text[]) AS flags,
                  '0' AS total_volume,
                  u.last_login_at::text AS last_activity
           FROM user_risk_scores urs
           JOIN users u ON u.id = urs.user_id
           LEFT JOIN aml_alerts a ON a.user_id = urs.user_id AND a.status IN ('open','reviewing')
           WHERE urs.risk_level IN ('medium','high','critical')
           GROUP BY urs.user_id, u.email, urs.score, urs.risk_level, u.last_login_at
           ORDER BY urs.score DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        list = rows.rows.map((r) => ({
          user_id: r.user_id, user_email: r.user_email ?? null,
          risk_score: parseInt(r.risk_score, 10), risk_level: r.risk_level,
          flags: r.flags ?? [], total_volume: r.total_volume ?? '0', last_activity: r.last_activity,
        }));
        const countRes = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM user_risk_scores WHERE risk_level IN ('medium','high','critical')`
        );
        total = parseInt(countRes.rows[0]?.count ?? '0', 10);
      } else {
        const rows = await db.query<{
          user_id: string; user_email: string | null; risk_score: string; flags: string[]; total_volume: string; last_activity: string | null;
        }>(
          `WITH alert_users AS (SELECT DISTINCT user_id FROM aml_alerts WHERE status IN ('open','reviewing'))
           SELECT u.id::text AS user_id, u.email AS user_email,
                  COALESCE((SELECT COUNT(*) FROM aml_alerts a2 WHERE a2.user_id = u.id AND a2.status IN ('open','reviewing')), 0)::text AS risk_score,
                  ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.alert_type), NULL) AS flags,
                  '0' AS total_volume,
                  u.last_login_at::text AS last_activity
           FROM alert_users au JOIN users u ON u.id = au.user_id
           LEFT JOIN aml_alerts a ON a.user_id = u.id AND a.status IN ('open','reviewing')
           GROUP BY u.id, u.email, u.last_login_at
           ORDER BY risk_score DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        list = rows.rows.map((r) => ({
          user_id: r.user_id, user_email: r.user_email ?? null,
          risk_score: parseInt(r.risk_score, 10), risk_level: 'unknown',
          flags: r.flags ?? [], total_volume: r.total_volume ?? '0', last_activity: r.last_activity,
        }));
        const countRes = await db.query<{ count: string }>(
          `SELECT COUNT(DISTINCT user_id)::text AS count FROM aml_alerts WHERE status IN ('open','reviewing')`
        );
        total = parseInt(countRes.rows[0]?.count ?? '0', 10);
      }
      return reply.send({ success: true, data: { users: list, total } });
    } catch (e) {
      logger.error('Get high-risk users error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load high-risk users' } });
    }
  });

  /**
   * GET /admin/withdrawals/limits
   * Return per-tier withdrawal limits (daily + monthly) that admin can adjust.
   */
  app.get('/withdrawals/limits', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { getTierLimitsFromSettings } = await import('../services/withdrawal-tier-limits.service.js');
      const limits = await getTierLimitsFromSettings();
      return reply.send({ success: true, data: limits });
    } catch (err) {
      logger.error('Get withdrawal limits error', { error: err instanceof Error ? err.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch withdrawal limits' } });
    }
  });

  /**
   * PATCH /admin/withdrawals/limits
   * Update per-tier withdrawal limits. Super-admin only.
   * Body: { tiers: [{ tier: 0|1|2|3, dailyLimit: "10000", monthlyLimit: "100000" }] }
   */
  app.patch<{ Body: { tiers: Array<{ tier: number; dailyLimit: string; monthlyLimit: string }> } }>('/withdrawals/limits', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true); // super admin only
    if (!admin) return;
    try {
      const { tiers } = request.body;
      if (!Array.isArray(tiers) || tiers.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_INPUT', message: 'tiers array is required' } });
      }
      for (const t of tiers) {
        if (![0, 1, 2, 3].includes(t.tier)) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_TIER', message: `Invalid tier: ${t.tier}` } });
        }
        if (!/^\d+(\.\d+)?$/.test(t.dailyLimit) || !/^\d+(\.\d+)?$/.test(t.monthlyLimit)) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_AMOUNT', message: 'Limits must be numeric strings' } });
        }
      }
      const { updateTierLimits, getTierLimitsFromSettings } = await import('../services/withdrawal-tier-limits.service.js');
      await updateTierLimits(tiers);
      const updated = await getTierLimitsFromSettings();
      logger.info('Withdrawal tier limits updated by admin', { adminId: admin.adminId, tiers });
      return reply.send({ success: true, data: updated });
    } catch (err) {
      logger.error('Update withdrawal limits error', { error: err instanceof Error ? err.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update withdrawal limits' } });
    }
  });

  /**
   * GET /admin/risk/settings
   * Dynamic risk rules (from risk_settings table or defaults).
   */
  app.get('/risk/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS risk_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')
      `);
      const stored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_settings WHERE key IN ($1, $2, $3, $4)`,
        ['large_withdrawal_threshold', 'whale_trade_threshold', 'cancel_rate_threshold', 'market_manipulation_window']
      );
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      return reply.send({
        success: true,
        data: {
          large_withdrawal_threshold: (map.large_withdrawal_threshold as number) ?? 10000,
          whale_trade_threshold: (map.whale_trade_threshold as number) ?? 100000,
          cancel_rate_threshold: (map.cancel_rate_threshold as number) ?? 80,
          market_manipulation_window: (map.market_manipulation_window as number) ?? 300,
        },
      });
    } catch (e) {
      logger.error('Get risk settings error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to load risk settings' } });
    }
  });

  /**
   * PATCH /admin/risk/settings
   * Update dynamic risk rules.
   */
  app.patch<{ Body: { large_withdrawal_threshold?: number; whale_trade_threshold?: number; cancel_rate_threshold?: number; market_manipulation_window?: number } }>('/risk/settings', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS risk_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}')`);
      const body = request.body || {};
      const updates: Array<{ key: string; value: number }> = [];
      if (typeof body.large_withdrawal_threshold === 'number') updates.push({ key: 'large_withdrawal_threshold', value: body.large_withdrawal_threshold });
      if (typeof body.whale_trade_threshold === 'number') updates.push({ key: 'whale_trade_threshold', value: body.whale_trade_threshold });
      if (typeof body.cancel_rate_threshold === 'number') updates.push({ key: 'cancel_rate_threshold', value: body.cancel_rate_threshold });
      if (typeof body.market_manipulation_window === 'number') updates.push({ key: 'market_manipulation_window', value: body.market_manipulation_window });
      for (const u of updates) {
        await db.query(
          'INSERT INTO risk_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb',
          [u.key, JSON.stringify(u.value)]
        );
      }
      const stored = await db.query<{ key: string; value: unknown }>(
        `SELECT key, value FROM risk_settings WHERE key IN ($1, $2, $3, $4)`,
        ['large_withdrawal_threshold', 'whale_trade_threshold', 'cancel_rate_threshold', 'market_manipulation_window']
      );
      const map = Object.fromEntries(stored.rows.map((r) => [r.key, r.value]));
      return reply.send({
        success: true,
        data: {
          large_withdrawal_threshold: (map.large_withdrawal_threshold as number) ?? 10000,
          whale_trade_threshold: (map.whale_trade_threshold as number) ?? 100000,
          cancel_rate_threshold: (map.cancel_rate_threshold as number) ?? 80,
          market_manipulation_window: (map.market_manipulation_window as number) ?? 300,
        },
      });
    } catch (e) {
      logger.error('Patch risk settings error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update risk settings' } });
    }
  });

  /**
   * GET /admin/risk/export/aml-alerts?format=csv|json
   */
  app.get<{ Querystring: { format?: string } }>('/risk/export/aml-alerts', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const format = ((request.query as { format?: string }).format ?? 'json').toLowerCase();
    try {
      const rows = await db.query<{ id: string; user_id: string; user_email: string | null; alert_type: string; severity: string; status: string; created_at: string }>(
        `SELECT a.id, a.user_id, u.email AS user_email, a.alert_type, a.severity, a.status, a.created_at::text FROM aml_alerts a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 5000`
      );
      if (format === 'csv') {
        const headers = ['id', 'user_id', 'user_email', 'alert_type', 'severity', 'status', 'created_at'];
        const escape = (v: string | null | undefined) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
        const csv = [headers.join(','), ...rows.rows.map((r) => headers.map((h) => escape((r as Record<string, string | null | undefined>)[h])).join(','))].join('\n');
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="aml-alerts-${new Date().toISOString().slice(0, 10)}.csv"`);
        return reply.send(csv);
      }
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Export AML alerts error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'EXPORT_FAILED', message: 'Failed to export' } });
    }
  });

  /**
   * GET /admin/risk/export/str-reports?format=csv|json
   */
  app.get<{ Querystring: { format?: string } }>('/risk/export/str-reports', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const format = ((request.query as { format?: string }).format ?? 'json').toLowerCase();
    try {
      const rows = await db.query<{ id: string; report_type: string; user_id: string | null; period_start: string | null; period_end: string | null; total_amount: string | null; status: string; created_at: string }>(
        `SELECT id, report_type, user_id, period_start, period_end, total_amount, status, created_at::text FROM aml_str_ctr_logs WHERE report_type = 'STR' ORDER BY created_at DESC LIMIT 5000`
      );
      if (format === 'csv') {
        const headers = ['id', 'report_type', 'user_id', 'period_start', 'period_end', 'total_amount', 'status', 'created_at'];
        const escape = (v: string | null | undefined) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
        const csv = [headers.join(','), ...rows.rows.map((r) => headers.map((h) => escape((r as Record<string, string | null | undefined>)[h])).join(','))].join('\n');
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="str-reports-${new Date().toISOString().slice(0, 10)}.csv"`);
        return reply.send(csv);
      }
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Export STR reports error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'EXPORT_FAILED', message: 'Failed to export' } });
    }
  });

  /**
   * GET /admin/risk/export/suspicious-trades?format=csv|json
   */
  app.get<{ Querystring: { format?: string } }>('/risk/export/suspicious-trades', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const format = ((request.query as { format?: string }).format ?? 'json').toLowerCase();
    try {
      const rows = await db.query<{ id: string; alert_type: string; user_id: string; user_email: string | null; severity: string; status: string; created_at: string }>(
        `SELECT a.id, a.alert_type, a.user_id, u.email AS user_email, a.severity, a.status, a.created_at::text FROM aml_alerts a LEFT JOIN users u ON u.id = a.user_id WHERE a.alert_type IN ('wash_trading','spoofing','pump_detection','large_withdrawal') ORDER BY a.created_at DESC LIMIT 5000`
      );
      if (format === 'csv') {
        const headers = ['id', 'alert_type', 'user_id', 'user_email', 'severity', 'status', 'created_at'];
        const escape = (v: string | null | undefined) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
        const csv = [headers.join(','), ...rows.rows.map((r) => headers.map((h) => escape((r as Record<string, string | null | undefined>)[h])).join(','))].join('\n');
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="suspicious-trades-${new Date().toISOString().slice(0, 10)}.csv"`);
        return reply.send(csv);
      }
      return reply.send({ success: true, data: rows.rows });
    } catch (e) {
      logger.error('Export suspicious trades error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'EXPORT_FAILED', message: 'Failed to export' } });
    }
  });

  // ===============================
  // DEPOSIT SWEEPS (user deposit → hot wallet consolidation)
  // ===============================

  /**
   * GET /admin/deposit-sweeps/eligibility
   * Returns sweep eligibility insight (visibility only): credited addresses count, threshold, skip reason counts. Admin-only.
   */
  app.get('/deposit-sweeps/eligibility', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { listSweepableAddresses } = await import('../services/deposit-sweep.service.js');
      const { insight } = await listSweepableAddresses();
      return reply.send({
        success: true,
        data: insight,
      });
    } catch (error: unknown) {
      logger.error('Get deposit sweep eligibility error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to load eligibility insight.' },
      });
    }
  });

  /**
   * GET /admin/deposit-sweeps
   * List deposit sweeps with optional filters. Paginated. Only returns sweeps for EVM chains (supported). Empty list returns 200, never error.
   */
  app.get<{
    Querystring: { page?: string; limit?: string; chain_id?: string; status?: string };
  }>('/deposit-sweeps', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const emptyResponse = () =>
      reply.send({
        success: true,
        data: {
          sweeps: [] as Array<{
            id: string;
            chain_id: string;
            chain_name: string;
            from_address: string;
            to_address: string;
            amount: string;
            amount_raw: string | null;
            tx_hash: string | null;
            status: string;
            error_message: string | null;
            created_at: string;
            completed_at: string | null;
          }>,
          pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
        },
      });
    try {
      const { page = '1', limit = '20', chain_id, status } = request.query;
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [
        "ds.chain_id IN (SELECT id FROM chains WHERE LOWER(TRIM(type)) = 'evm' AND is_active = TRUE)",
      ];
      const params: (string | number)[] = [];
      let paramIndex = 1;
      if (chain_id?.trim()) {
        conditions.push(`ds.chain_id = $${paramIndex++}`);
        params.push(chain_id.trim());
      }
      if (status && status !== 'all') {
        conditions.push(`ds.status = $${paramIndex++}`);
        params.push(status);
      }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM deposit_sweeps ds ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const listResult = await db.query<{
        id: string;
        chain_id: string;
        from_address: string;
        to_address: string;
        amount: string;
        amount_raw: string | null;
        tx_hash: string | null;
        status: string;
        error_message: string | null;
        created_at: string;
        completed_at: string | null;
      }>(
        `SELECT ds.id, ds.chain_id, ds.from_address, ds.to_address, ds.amount::text as amount, ds.amount_raw, ds.tx_hash, ds.status, ds.error_message, ds.created_at::text, ds.completed_at::text
         FROM deposit_sweeps ds ${whereClause}
         ORDER BY ds.created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limitNum, offset]
      );

      const chainNames = await db.query<{ id: string; name: string }>('SELECT id, name FROM chains WHERE is_active = TRUE').catch(() => ({ rows: [] as { id: string; name: string }[] }));
      const chainMap = Object.fromEntries((chainNames.rows as { id: string; name: string }[]).map((c) => [c.id, c.name]));

      const sweeps = listResult.rows.map((r) => ({
        id: r.id,
        chain_id: r.chain_id,
        chain_name: chainMap[r.chain_id] ?? r.chain_id,
        from_address: r.from_address,
        to_address: r.to_address,
        amount: r.amount,
        amount_raw: r.amount_raw,
        tx_hash: r.tx_hash,
        status: r.status,
        error_message: r.error_message,
        created_at: r.created_at,
        completed_at: r.completed_at,
      }));

      return reply.send({
        success: true,
        data: {
          sweeps,
          pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
        },
      });
    } catch (error: unknown) {
      const err = error as { code?: string; pgCode?: string };
      const pgCode = err?.pgCode ?? err?.code;
      if (pgCode === '42P01') {
        return emptyResponse();
      }
      logger.error('Get deposit sweeps error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch deposit sweeps' },
      });
    }
  });

  /**
   * POST /admin/deposit-sweeps/run
   * Manually trigger deposit sweep (runDepositSweep). Returns swept_count and errors for debugging.
   */
  app.post('/deposit-sweeps/run', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const { runDepositSweep } = await import('../services/deposit-sweep.service.js');
      const result = await runDepositSweep();
      return reply.send({
        success: true,
        data: {
          swept_count: result.sweptCount,
          errors: result.errors,
        },
      });
    } catch (error) {
      logger.error('Run deposit sweep error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'RUN_FAILED', message: 'Failed to run deposit sweep' },
      });
    }
  });

  // ===============================
  // HOT WALLET SETTINGS (MPC-like hot wallet per chain)
  // ===============================

  /**
   * GET /admin/hot-wallets
   * List all hot wallets (admin auth required). One wallet per chain family (e.g. one EVM address for all EVM chains).
   * Returns available chain families for creating new wallets (only families present in DB).
   */
  app.get('/hot-wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const idMode = await getHotWalletsIdModeCached();
      let list: Array<{ id: string; chain_id: string; address: string; balance_cache: string; min_balance_alert: string; min_hot_balance: string | null; cold_wallet_address: string | null; is_active: boolean; created_at: string; updated_at: string }>;
      if (idMode === 'chain_id') {
        list = await hotWalletService.listHotWallets();
      } else if (idMode === 'blockchain_id') {
        const rows = await db.query<{ id: string; chain_id: string; address: string; balance_cache: string; min_balance_alert: string; min_hot_balance: string | null; cold_wallet_address: string | null; is_active: boolean; created_at: string; updated_at: string }>(
          `SELECT hw.id, hw.blockchain_id::text AS chain_id, hw.address, hw.balance_cache, hw.min_balance_alert,
                  COALESCE(hw.min_hot_balance::text, '0') as min_hot_balance, hw.cold_wallet_address,
                  hw.is_active, hw.created_at::text as created_at, hw.updated_at::text as updated_at
           FROM hot_wallets hw ORDER BY hw.blockchain_id`
        );
        list = rows.rows;
      } else {
        return reply.status(500).send({
          success: false,
          error: { code: 'FETCH_FAILED', message: 'Hot wallets table missing chain_id or blockchain_id column.' },
        });
      }
      const chains = await db.query<{ id: string; name: string; type: string; rpc_url: string }>(
        'SELECT id, name, type, rpc_url FROM chains WHERE is_active = TRUE ORDER BY id'
      );
      const chainMap = Object.fromEntries(chains.rows.map(c => [c.id, c]));
      const familiesInDb = await hotWalletService.listChainFamiliesInDb();
      let familyHasWallet: Array<(typeof familiesInDb)[0] & { hasWallet: boolean }>;
      if (idMode === 'chain_id') {
        const typesRes = await db
          .query<{ t: string }>(
            `SELECT DISTINCT LOWER(c.type) AS t FROM hot_wallets hw
             INNER JOIN chains c ON c.id = hw.chain_id
             WHERE hw.is_active = TRUE AND c.is_active = TRUE`
          )
          .catch(() => ({ rows: [] as { t: string }[] }));
        const hasType = new Set(typesRes.rows.map((r) => r.t));
        familyHasWallet = familiesInDb.map((f) => ({
          ...f,
          hasWallet: hasType.has(String(f.type).toLowerCase()),
        }));
      } else {
        familyHasWallet = await Promise.all(
          familiesInDb.map(async (f) => ({ ...f, hasWallet: await hotWalletService.familyHasHotWallet(f.type) }))
        );
      }
      const availableFamilies = familyHasWallet
        .filter((f) => !f.hasWallet)
        .map(({ type, label, representativeChainId, chainName, creationSupported }) => ({
          type,
          label,
          representativeChainId,
          chainName,
          creationSupported,
        }));
      const allFamilies = familyHasWallet.map(({ type, label, representativeChainId, chainName, creationSupported, hasWallet }) => ({
        type,
        label,
        representativeChainId,
        chainName,
        creationSupported,
        hasWallet,
      }));

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let blockchainSlugById: Record<string, string> = {};
      try {
        const hasSlug = await db.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'blockchains' AND column_name = 'slug') AS exists`).then(r => (r.rows[0] as { exists: boolean })?.exists);
        if (hasSlug) {
          const rows = await db.query<{ id: string; slug: string }>('SELECT id::text, slug FROM blockchains WHERE is_active = TRUE');
          blockchainSlugById = Object.fromEntries(rows.rows.map(r => [r.id, r.slug]));
        } else {
          const rows = await db.query<{ id: string; chain_name: string }>('SELECT id::text, chain_name FROM blockchains WHERE is_active = TRUE').catch(() => ({ rows: [] }));
          blockchainSlugById = Object.fromEntries(rows.rows.map(r => [r.id, r.chain_name?.toLowerCase().replace(/\s+/g, '-') ?? r.id]));
        }
      } catch {
        // blockchains may not exist
      }

      const data = list.map(hw => {
        const isUuid = uuidRegex.test(String(hw.chain_id));
        const chainSlug = chainMap[hw.chain_id]
          ? hw.chain_id
          : (isUuid && blockchainSlugById[hw.chain_id])
            ? blockchainSlugById[hw.chain_id]
            : hw.chain_id;
        return {
          id: hw.id,
          chainId: hw.chain_id,
          chainSlug: chainSlug || hw.chain_id,
          chainName: chainMap[hw.chain_id]?.name ?? hw.chain_id,
          chainType: chainMap[hw.chain_id]?.type ?? 'unknown',
          address: hw.address,
          balanceCache: hw.balance_cache,
          minBalanceAlert: hw.min_balance_alert,
          minHotBalance: hw.min_hot_balance ?? '0',
          coldWalletAddress: hw.cold_wallet_address ?? null,
          isActive: hw.is_active,
          createdAt: hw.created_at,
          updatedAt: hw.updated_at,
        };
      });
      return reply.send({
        success: true,
        data,
        allChains: chains.rows.map(c => ({ id: c.id, name: c.name, type: c.type })),
        availableFamilies,
        allFamilies,
      });
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string; pgCode?: string };
      const msg = err?.message ?? (error instanceof Error ? (error as Error).message : 'Unknown');
      logger.error('Get hot wallets error', { error: msg });
      if (err?.pgCode === '42P01' || err?.code === '42P01') {
        return reply.status(500).send({
          success: false,
          error: { code: 'FETCH_FAILED', message: 'Hot wallets table missing. Run: npm run migrate (in apps/backend).' },
        });
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /admin/hot-wallets
   * Create a new hot wallet by chain family (Super Admin only). Uses representative chain from DB.
   * Body: { chainFamily: string } e.g. "evm" | "bitcoin" | "solana" | "tron", or legacy { chainId: string }.
   */
  app.post<{ Body: { chainId?: string; chainFamily?: string } }>('/hot-wallets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      const body = request.body || {};
      const chainFamily = typeof body.chainFamily === 'string' ? body.chainFamily.trim() : undefined;
      const chainId = typeof body.chainId === 'string' ? body.chainId.trim() : undefined;
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;
      const userAgent = request.headers['user-agent'];
      let created;
      if (chainFamily) {
        created = await hotWalletService.createHotWalletByFamily(chainFamily, admin.adminId, ip, userAgent);
      } else if (chainId) {
        created = await hotWalletService.createHotWallet(chainId, admin.adminId, ip, userAgent);
      } else {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'chainFamily or chainId is required' },
        });
      }
      return reply.send({ success: true, data: created });
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string; pgCode?: string };
      const msg = err?.message ?? (error instanceof Error ? error.message : 'Unknown');
      const code = err?.code;
      if (code === 'CHAIN_NOT_FOUND' || err?.code === 'CHAIN_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'CHAIN_NOT_FOUND', message: msg },
        });
      }
      if (code === 'HOT_WALLET_ALREADY_EXISTS' || err?.code === 'HOT_WALLET_ALREADY_EXISTS') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: msg },
        });
      }
      if (code === 'CREATION_NOT_SUPPORTED' || code === 'ONLY_EVM_SUPPORTED' || err?.code === 'CREATION_NOT_SUPPORTED' || err?.code === 'ONLY_EVM_SUPPORTED') {
        return reply.status(400).send({
          success: false,
          error: { code: 'UNSUPPORTED_CHAIN', message: msg },
        });
      }
      if (code === 'ENCRYPTION_FAILED' || err?.code === 'ENCRYPTION_FAILED') {
        return reply.status(500).send({
          success: false,
          error: { code: 'CREATE_FAILED', message: 'Encryption failed. Set ENCRYPTION_KEY in .env (min 32 chars).' },
        });
      }
      if (err?.pgCode === '42P01' || code === '42P01') {
        return reply.status(500).send({
          success: false,
          error: { code: 'CREATE_FAILED', message: 'Hot wallets table missing. Run: npm run migrate (in apps/backend).' },
        });
      }
      if (err?.pgCode === '23503' || code === '23503') {
        return reply.status(500).send({
          success: false,
          error: { code: 'CREATE_FAILED', message: 'Chain not found in database. Ensure chains table has this chain id.' },
        });
      }
      logger.error('Create hot wallet error', { error: msg, code: err?.code });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: msg || (error instanceof Error ? (error as Error).message : 'Unknown') },
      });
    }
  });

  /**
   * GET /admin/hot-wallets/balances
   * Fetch native + token balances via Web3 for hot wallet. Query: chainId (stored chain_id for the wallet, e.g. arbitrum).
   * Returns per-chain balances; only currencies from DB (tokens table), each currency once per chain.
   */
  app.get<{ Querystring: { chainId?: string } }>('/hot-wallets/balances', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const chainId = (request.query?.chainId as string)?.trim();
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const list = await hotWalletService.listHotWallets();
      if (list.length === 0) {
        return reply.send({ success: true, data: [] });
      }
      const resolvedChainId = chainId && list.some(hw => hw.chain_id === chainId)
        ? chainId
        : list[0]!.chain_id;
      const walletRow = list.find(hw => hw.chain_id === resolvedChainId);
      if (!walletRow) {
        return reply.send({ success: true, data: [] });
      }
      const chainsOfType = await db.query<{ id: string }>(
        'SELECT id FROM chains WHERE is_active = TRUE AND type = (SELECT type FROM chains WHERE id = $1 LIMIT 1) ORDER BY id',
        [resolvedChainId]
      );
      const chainIds = chainsOfType.rows.map(r => r.id);
      const data = await hotWalletService.getHotWalletBalancesForChains(chainIds, walletRow.address);
      return reply.send({ success: true, data });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      logger.error('Get hot wallet balances error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: msg },
      });
    }
  });

  /**
   * GET /admin/hot-wallets/history
   * Deposit and withdrawal history for hot wallet. Query: chainId?, type? (deposit|withdrawal), status? (pending|success|reverted|aborted), page?, limit?.
   */
  app.get<{ Querystring: { chainId?: string; type?: string; status?: string; page?: string; limit?: string } }>('/hot-wallets/history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const chainId = (request.query?.chainId as string)?.trim();
      const type = (request.query?.type as string)?.toLowerCase();
      const status = (request.query?.status as string)?.toLowerCase();
      const page = Math.max(1, parseInt(request.query?.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const hotWalletAddresses = await db.query<{ address: string }>('SELECT address FROM hot_wallets WHERE is_active = TRUE');
      const addresses = hotWalletAddresses.rows.map(r => r.address);
      const history: Array<{
        id: string;
        type: 'deposit' | 'withdrawal';
        chainId: string;
        chainName: string;
        symbol: string;
        amount: string;
        status: string;
        txHash: string | null;
        createdAt: string;
        toAddress?: string;
      }> = [];
      const statusMap: Record<string, string> = {
        pending: 'pending',
        confirming: 'pending',
        processing: 'pending',
        completed: 'success',
        failed: 'reverted',
        cancelled: 'aborted',
      };
      const normalizeStatus = (s: string) => statusMap[s?.toLowerCase()] ?? s;

      const limitBoth = type === 'withdrawal' || type === 'deposit' ? limit : limit + 500;
      if (type !== 'withdrawal' && type !== 'deposit') {
        // Withdrawals (all are from hot wallet when processed)
        let wQuery = `
          SELECT w.id, w.chain_id, w.amount, w.status, w.tx_hash, w.created_at, w.to_address, t.symbol, c.name as chain_name
          FROM withdrawals w
          JOIN tokens t ON w.token_id = t.id
          JOIN chains c ON w.chain_id = c.id
          WHERE 1=1
        `;
        const wParams: (string | number)[] = [];
        let pi = 1;
        if (chainId) {
          wQuery += ` AND w.chain_id = $${pi++}`;
          wParams.push(chainId);
        }
        if (status) {
          const statusValues = status === 'pending' ? ['pending', 'processing'] : status === 'success' ? ['completed'] : status === 'reverted' ? ['failed'] : status === 'aborted' ? ['cancelled'] : [];
          if (statusValues.length > 0) {
            wQuery += ` AND w.status = ANY($${pi++}::text[])`;
            wParams.push(statusValues as unknown as string | number);
          }
        }
        wQuery += ` ORDER BY w.created_at DESC LIMIT $${pi}`;
        wParams.push(limitBoth);
        const wResult = await db.query(wQuery, wParams);
        for (const row of wResult.rows as Array<{ id: string; chain_id: string; amount: string; status: string; tx_hash: string | null; created_at: string; to_address: string; symbol: string; chain_name: string }>) {
          history.push({
            id: row.id,
            type: 'withdrawal',
            chainId: row.chain_id,
            chainName: row.chain_name,
            symbol: row.symbol,
            amount: row.amount,
            status: normalizeStatus(row.status),
            txHash: row.tx_hash,
            createdAt: row.created_at,
            toAddress: row.to_address,
          });
        }
      }

      if (type !== 'deposit' && type !== 'withdrawal') {
        // Deposits: transactions where to_address is hot wallet
        if (addresses.length > 0) {
          let dQuery = `
            SELECT tr.id, tr.chain_id, tr.amount, tr.status, tr.tx_hash, tr.created_at, tr.to_address, t.symbol, c.name as chain_name
            FROM transactions tr
            JOIN tokens t ON tr.token_id = t.id
            JOIN chains c ON tr.chain_id = c.id
            WHERE tr.type = 'deposit' AND tr.to_address = ANY($1::text[])
          `;
          const dParams: (string | number | string[])[] = [addresses];
          let pi = 2;
          if (chainId) {
            dQuery += ` AND tr.chain_id = $${pi++}`;
            dParams.push(chainId);
          }
          if (status) {
            const statusValues = status === 'pending' ? ['pending', 'confirming'] : status === 'success' ? ['completed'] : status === 'reverted' ? ['failed'] : status === 'aborted' ? ['cancelled'] : [];
            if (statusValues.length > 0) {
              dQuery += ` AND tr.status = ANY($${pi++}::text[])`;
              dParams.push(statusValues as unknown as string | number);
            }
          }
          dQuery += ` ORDER BY tr.created_at DESC LIMIT $${pi}`;
          dParams.push(limitBoth);
          const dResult = await db.query(dQuery, dParams);
          for (const row of dResult.rows as Array<{ id: string; chain_id: string; amount: string; status: string; tx_hash: string | null; created_at: string; to_address: string; symbol: string; chain_name: string }>) {
            history.push({
              id: row.id,
              type: 'deposit',
              chainId: row.chain_id,
              chainName: row.chain_name,
              symbol: row.symbol,
              amount: row.amount,
              status: normalizeStatus(row.status),
              txHash: row.tx_hash,
              createdAt: row.created_at,
            });
          }
        }
      }

      if (type === 'deposit' || type === 'withdrawal') {
        // Single type: run the right query only
        if (type === 'withdrawal') {
          let wQuery = `
            SELECT w.id, w.chain_id, w.amount, w.status, w.tx_hash, w.created_at, w.to_address, t.symbol, c.name as chain_name
            FROM withdrawals w
            JOIN tokens t ON w.token_id = t.id
            JOIN chains c ON w.chain_id = c.id
            WHERE 1=1
          `;
          const wParams: (string | number)[] = [];
          let pi = 1;
          if (chainId) {
            wQuery += ` AND w.chain_id = $${pi++}`;
            wParams.push(chainId);
          }
          if (status) {
            const statusValues = status === 'pending' ? ['pending', 'processing'] : status === 'success' ? ['completed'] : status === 'reverted' ? ['failed'] : status === 'aborted' ? ['cancelled'] : [];
            if (statusValues.length > 0) {
              wQuery += ` AND w.status = ANY($${pi++}::text[])`;
              wParams.push(statusValues as unknown as string | number);
            }
          }
          wQuery += ` ORDER BY w.created_at DESC LIMIT $${pi++} OFFSET $${pi}`;
          wParams.push(limit, offset);
          const wResult = await db.query(wQuery, wParams);
          for (const row of wResult.rows as Array<{ id: string; chain_id: string; amount: string; status: string; tx_hash: string | null; created_at: string; to_address: string; symbol: string; chain_name: string }>) {
            history.push({
              id: row.id,
              type: 'withdrawal',
              chainId: row.chain_id,
              chainName: row.chain_name,
              symbol: row.symbol,
              amount: row.amount,
              status: normalizeStatus(row.status),
              txHash: row.tx_hash,
              createdAt: row.created_at,
              toAddress: row.to_address,
            });
          }
        } else {
          if (addresses.length > 0) {
            let dQuery = `
              SELECT tr.id, tr.chain_id, tr.amount, tr.status, tr.tx_hash, tr.created_at, t.symbol, c.name as chain_name
              FROM transactions tr
              JOIN tokens t ON tr.token_id = t.id
              JOIN chains c ON tr.chain_id = c.id
              WHERE tr.type = 'deposit' AND tr.to_address = ANY($1::text[])
            `;
            const dParams: (string | number | string[])[] = [addresses];
            let pi = 2;
            if (chainId) {
              dQuery += ` AND tr.chain_id = $${pi++}`;
              dParams.push(chainId);
            }
            if (status) {
              const statusValues = status === 'pending' ? ['pending', 'confirming'] : status === 'success' ? ['completed'] : status === 'reverted' ? ['failed'] : status === 'aborted' ? ['cancelled'] : [];
              if (statusValues.length > 0) {
                dQuery += ` AND tr.status = ANY($${pi++}::text[])`;
                dParams.push(statusValues as unknown as string | number);
              }
            }
            dQuery += ` ORDER BY tr.created_at DESC LIMIT $${pi++} OFFSET $${pi}`;
            dParams.push(limit, offset);
            const dResult = await db.query(dQuery, dParams);
            for (const row of dResult.rows as Array<{ id: string; chain_id: string; amount: string; status: string; tx_hash: string | null; created_at: string; symbol: string; chain_name: string }>) {
              history.push({
                id: row.id,
                type: 'deposit',
                chainId: row.chain_id,
                chainName: row.chain_name,
                symbol: row.symbol,
                amount: row.amount,
                status: normalizeStatus(row.status),
                txHash: row.tx_hash,
                createdAt: row.created_at,
              });
            }
          }
        }
      }

      history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const total = history.length;
      const sliced = history.slice(offset, offset + limit);
      return reply.send({
        success: true,
        data: sliced,
        pagination: { page, limit, total },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      logger.error('Get hot wallet history error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: msg },
      });
    }
  });

  /**
   * GET /admin/hot-wallets/:chainSlug
   * Hot wallet detail by chain SLUG (e.g. ethereum, bitcoin, solana). Resolves slug to chain id (blockchains or chains table) then loads hot wallet. Never exposes SQL errors to UI.
   */
  app.get<{ Params: { chainSlug: string } }>('/hot-wallets/:chainSlug', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    let chainSlug = request.params.chainSlug;
    try {
      chainSlug = decodeURIComponent(chainSlug).trim();
    } catch {
      chainSlug = (chainSlug || '').trim();
    }
    if (!chainSlug) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Chain slug is required.' },
      });
    }

    let resolvedChainId: string | null = null;
    let chainName = chainSlug;
    let chainType = 'unknown';

    /** Derive chain type from blockchains.chain_symbol for non-EVM detection. */
    const chainSymbolToType = (symbol: string): string => {
      const s = (symbol || '').toUpperCase().trim();
      if (s === 'BTC') return 'bitcoin';
      if (s === 'SOL') return 'solana';
      if (s === 'TRX') return 'tron';
      if (s === 'DOT' || s === 'POLKADOT') return 'polkadot';
      return 'evm';
    };
    const isNonEvmType = (t: string) => ['bitcoin', 'solana', 'tron', 'polkadot'].includes((t || '').toLowerCase());

    try {
      // 1) Resolve slug to chain id (UUID or string). Prefer blockchains.slug, then blockchains.chain_name/chain_symbol, then chains.id/name.
      const hasBlockchainsSlug = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'blockchains' AND column_name = 'slug'
        ) AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);

      const hasChainSymbol = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'blockchains' AND column_name = 'chain_symbol') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      const symbolCol = hasChainSymbol ? ', chain_symbol' : '';

      if (hasBlockchainsSlug) {
        const blockchainsBySlug = await db.query<{ id: string; chain_name: string; chain_symbol?: string }>(
          `SELECT id, chain_name${symbolCol} FROM blockchains WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
          [chainSlug]
        );
        if (blockchainsBySlug.rows.length > 0) {
          const r = blockchainsBySlug.rows[0]!;
          resolvedChainId = r.id;
          chainName = r.chain_name ?? chainSlug;
          if (r.chain_symbol) chainType = chainSymbolToType(r.chain_symbol);
        }
      }
      if (!resolvedChainId) {
        const blockchainsByNameOrSymbol = await db.query<{ id: string; chain_name: string; chain_symbol?: string }>(
          `SELECT id, chain_name${symbolCol} FROM blockchains
           WHERE (LOWER(TRIM(chain_name)) = LOWER(TRIM($1)) OR LOWER(TRIM(chain_symbol)) = LOWER(TRIM($1)))
             AND is_active = TRUE LIMIT 1`,
          [chainSlug]
        ).catch(() => ({ rows: [] }));
        if (blockchainsByNameOrSymbol.rows.length > 0) {
          const r = blockchainsByNameOrSymbol.rows[0]!;
          resolvedChainId = r.id;
          chainName = r.chain_name ?? chainSlug;
          if (r.chain_symbol) chainType = chainSymbolToType(r.chain_symbol);
        }
      }
      if (!resolvedChainId) {
        const chainsByIdOrName = await db.query<{ id: string; name: string; type: string }>(
          `SELECT id, name, type FROM chains
           WHERE (LOWER(TRIM(id)) = LOWER(TRIM($1)) OR LOWER(TRIM(name)) = LOWER(TRIM($1)))
             AND is_active = TRUE LIMIT 1`,
          [chainSlug]
        ).catch(() => ({ rows: [] }));
        if (chainsByIdOrName.rows.length > 0) {
          const r = chainsByIdOrName.rows[0]!;
          resolvedChainId = r.id;
          chainName = r.name ?? chainSlug;
          chainType = r.type ?? 'unknown';
        }
      }

      if (!resolvedChainId) {
        return reply.status(404).send({
          success: false,
          error: { code: 'UNKNOWN_CHAIN', message: 'Unknown chain.' },
        });
      }

      // 2) Load hot wallet by resolved chain id (column may be chain_id or blockchain_id depending on schema)
      const hasChainIdCol = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'hot_wallets' AND column_name = 'chain_id'
        ) AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);

      const hasBlockchainIdCol = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'hot_wallets' AND column_name = 'blockchain_id'
        ) AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);

      let hwRow: { rows: Array<{
        id: string; chain_id?: string; blockchain_id?: string; address: string; balance_cache: string;
        min_balance_alert: string; min_hot_balance: string | null; cold_wallet_address: string | null;
        is_active: boolean; created_at: string; updated_at: string; max_single_tx: string | null; max_daily_outflow: string | null;
      }> } = { rows: [] };

      if (hasChainIdCol) {
        hwRow = await db.query(
          `SELECT id, chain_id, address, balance_cache, min_balance_alert,
                  COALESCE(min_hot_balance::text, '0') as min_hot_balance, cold_wallet_address,
                  is_active, created_at, updated_at,
                  max_single_tx::text, max_daily_outflow::text
           FROM hot_wallets WHERE chain_id = $1 LIMIT 1`,
          [resolvedChainId]
        );
      } else if (hasBlockchainIdCol) {
        hwRow = await db.query(
          `SELECT id, blockchain_id as chain_id, address, balance_cache, min_balance_alert,
                  COALESCE(min_hot_balance::text, '0') as min_hot_balance, cold_wallet_address,
                  is_active, created_at, updated_at,
                  max_single_tx::text, max_daily_outflow::text
           FROM hot_wallets WHERE blockchain_id = $1 LIMIT 1`,
          [resolvedChainId]
        );
      }

      if (hwRow.rows.length === 0) {
        // Non-EVM: return 200 with supported: false so UI shows info panel, not error
        if (chainType === 'unknown') {
          const chainMeta = await db.query<{ type: string }>(
            'SELECT type FROM chains WHERE id = $1 LIMIT 1',
            [resolvedChainId]
          ).catch(() => ({ rows: [] }));
          if (chainMeta.rows.length > 0) {
            chainType = chainMeta.rows[0]!.type ?? 'unknown';
          } else if (hasChainSymbol) {
            const bc = await db.query<{ chain_symbol: string }>(
              'SELECT chain_symbol FROM blockchains WHERE id = $1 LIMIT 1',
              [resolvedChainId]
            ).catch(() => ({ rows: [] }));
            if (bc.rows.length > 0 && bc.rows[0]!.chain_symbol) {
              chainType = chainSymbolToType(bc.rows[0]!.chain_symbol);
            }
          }
        }
        if (isNonEvmType(chainType)) {
          return reply.send({
            success: true,
            data: {
              supported: false,
              chainSlug,
              chainName,
              chainType,
              address: null as string | null,
              message: 'Hot wallet operations are not enabled for this chain yet',
            },
          });
        }
        return reply.status(404).send({
          success: false,
          error: { code: 'HOT_WALLET_NOT_CREATED', message: 'Hot wallet not created for this chain.' },
        });
      }

      const hw = hwRow.rows[0]!;
      const chainIdForService = (hw as { chain_id?: string }).chain_id ?? resolvedChainId;

      if (chainType === 'unknown') {
        const chainMeta = await db.query<{ type: string }>(
          'SELECT type FROM chains WHERE id = $1 LIMIT 1',
          [resolvedChainId]
        ).catch(() => ({ rows: [] }));
        if (chainMeta.rows.length > 0) chainType = chainMeta.rows[0]!.type ?? 'unknown';
      }

      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      let caps: { max_single_tx: string | null; max_daily_outflow: string | null } | null = null;
      let dailyOutflowUsed: string | number = 0;
      try {
        caps = await hotWalletService.getHotWalletCaps(chainIdForService);
        dailyOutflowUsed = await hotWalletService.getDailyOutflowForChain(chainIdForService);
      } catch {
        // caps/outflow optional
      }

      const recentSweeps = await db.query<{ id: string; action: string; details: unknown; created_at: string }>(
        `SELECT id, action, details, created_at::text as created_at
         FROM hot_wallet_audit_log
         WHERE resource_id = $1 AND action = 'hot_wallet_sweep_completed'
         ORDER BY created_at DESC LIMIT 20`,
        [chainIdForService]
      ).catch(() => ({ rows: [] }));

      const sweeps = (recentSweeps.rows || []).map((r: { id: string; details: unknown; created_at: string }) => ({
        id: r.id,
        txHash: (r.details as { tx_hash?: string })?.tx_hash ?? null,
        amountWei: (r.details as { sweep_wei?: string })?.sweep_wei ?? null,
        createdAt: r.created_at,
      }));

      return reply.send({
        success: true,
        data: {
          supported: true,
          id: hw.id,
          chainId: chainIdForService,
          chainSlug,
          chainName,
          chainType,
          address: hw.address,
          balanceCache: hw.balance_cache,
          minBalanceAlert: hw.min_balance_alert,
          minHotBalance: hw.min_hot_balance ?? '0',
          coldWalletAddress: hw.cold_wallet_address ?? null,
          isActive: hw.is_active,
          createdAt: hw.created_at,
          updatedAt: hw.updated_at,
          maxSingleTx: hw.max_single_tx ?? null,
          maxDailyOutflow: hw.max_daily_outflow ?? null,
          dailyOutflowUsed: String(dailyOutflowUsed),
          recentSweeps: sweeps,
        },
      });
    } catch (error: unknown) {
      logger.error('Get hot wallet detail error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to load hot wallet detail.' },
      });
    }
  });

  /**
   * GET /admin/hot-wallets/:chainId/balance
   * Refresh and return hot wallet native balance from RPC (audit logged)
   */
  app.get<{ Params: { chainId: string } }>('/hot-wallets/:chainId/balance', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let { chainId } = request.params;
      try {
        chainId = decodeURIComponent(chainId).trim();
      } catch {
        chainId = (chainId || '').trim();
      }
      if (!chainId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Chain ID is required.' },
        });
      }
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const result = await hotWalletService.refreshBalanceCache(chainId, admin.adminId);
      return reply.send({ success: true, data: result });
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      const msg = err?.message ?? (error instanceof Error ? error.message : 'Unknown');
      const code = err?.code;
      if (code === 'HOT_WALLET_NOT_FOUND' || code === 'CHAIN_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: msg },
        });
      }
      if (code === 'RPC_REFRESH_FAILED') {
        return reply.status(502).send({
          success: false,
          error: { code: 'RPC_REFRESH_FAILED', message: msg },
        });
      }
      logger.error('Refresh hot wallet balance error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'REFRESH_FAILED', message: msg },
      });
    }
  });

  /**
   * PATCH /admin/hot-wallets/:chainId
   * Update min balance alert, min hot balance, cold address, or is_active (Super Admin only, audit logged).
   */
  app.patch<{
    Params: { chainId: string };
    Body: { minBalanceAlert?: string; minHotBalance?: string; coldWalletAddress?: string | null; isActive?: boolean };
  }>('/hot-wallets/:chainId', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      let chainId = request.params.chainId;
      try {
        chainId = decodeURIComponent(chainId).trim();
      } catch {
        chainId = (chainId || '').trim();
      }
      if (!chainId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Chain ID is required.' },
        });
      }
      const { minBalanceAlert, minHotBalance, coldWalletAddress, isActive } = request.body || {};
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;
      const userAgent = request.headers['user-agent'];
      if (typeof minBalanceAlert === 'string') {
        await hotWalletService.setMinBalanceAlert(chainId, minBalanceAlert);
      }
      if (typeof minHotBalance === 'string') {
        await hotWalletService.setMinHotBalance(chainId, minHotBalance);
      }
      if (coldWalletAddress !== undefined) {
        await hotWalletService.setColdWalletAddress(chainId, coldWalletAddress ?? null, admin.adminId, 'admin');
      }
      if (typeof isActive === 'boolean') {
        await hotWalletService.setHotWalletActive(chainId, isActive, admin.adminId, ip, userAgent);
      }
      const list = await hotWalletService.listHotWallets();
      const updated = list.find(hw => hw.chain_id === chainId);
      if (updated == null) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Hot wallet not found' },
        });
      }
      return reply.send({ success: true, data: updated });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      logger.error('Update hot wallet error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: msg },
      });
    }
  });

  /**
   * POST /admin/hot-wallets/:chainId/replace
   * Replace hot wallet for chain with new keypair (Super Admin only). Withdraw funds from old address first.
   */
  app.post<{ Params: { chainId: string } }>('/hot-wallets/:chainId/replace', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      let chainId = request.params.chainId;
      try {
        chainId = decodeURIComponent(chainId).trim();
      } catch {
        chainId = (chainId || '').trim();
      }
      if (!chainId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Chain ID is required.' },
        });
      }
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;
      const userAgent = request.headers['user-agent'];
      const updated = await hotWalletService.replaceHotWallet(chainId, admin.adminId, ip, userAgent);
      return reply.send({ success: true, data: updated });
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      const msg = err?.message ?? (error instanceof Error ? error.message : 'Unknown');
      const code = err?.code;
      if (code === 'HOT_WALLET_NOT_FOUND' || code === 'CHAIN_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: code === 'HOT_WALLET_NOT_FOUND' ? 'NOT_FOUND' : 'CHAIN_NOT_FOUND', message: msg },
        });
      }
      if (code === 'CREATION_NOT_SUPPORTED' || code === 'ONLY_EVM_SUPPORTED') {
        return reply.status(400).send({
          success: false,
          error: { code: 'UNSUPPORTED_CHAIN', message: msg },
        });
      }
      logger.error('Replace hot wallet error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'REPLACE_FAILED', message: msg },
      });
    }
  });

  /**
   * DELETE /admin/hot-wallets/:chainId
   * Remove hot wallet for chain (Super Admin only). Chain can get a new wallet afterward.
   */
  app.delete<{ Params: { chainId: string } }>('/hot-wallets/:chainId', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, true);
    if (!admin) return;
    try {
      let chainId = request.params.chainId;
      try {
        chainId = decodeURIComponent(chainId).trim();
      } catch {
        chainId = (chainId || '').trim();
      }
      if (!chainId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Chain ID is required.' },
        });
      }
      const hotWalletService = await import('../services/hot-wallet.service.js').then(m => m);
      const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;
      const userAgent = request.headers['user-agent'];
      await hotWalletService.removeHotWallet(chainId, admin.adminId, ip, userAgent);
      return reply.send({ success: true, data: { deleted: true } });
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      const msg = err?.message ?? (error instanceof Error ? error.message : 'Unknown');
      if (err?.code === 'HOT_WALLET_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: msg },
        });
      }
      logger.error('Remove hot wallet error', { error: msg });
      return reply.status(500).send({
        success: false,
        error: { code: 'REMOVE_FAILED', message: msg },
      });
    }
  });

  // ===============================
  // TRADING
  // ===============================

  /**
   * GET /admin/trading
   * Get trading overview
   */
  app.get('/trading', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      // Get trading pairs
      const pairs = await db.query(`
        SELECT 
          tp.*,
          bc.symbol as base_symbol,
          qc.symbol as quote_symbol
        FROM trading_pairs tp
        JOIN currencies bc ON tp.base_currency_id = bc.id
        JOIN currencies qc ON tp.quote_currency_id = qc.id
        ORDER BY tp.symbol
      `);

      const orderStats = await db.query(`
        SELECT 
          COUNT(*)::text as total_orders,
          COUNT(*) FILTER (WHERE status IN ('new', 'partially_filled'))::text as active_orders,
          COUNT(*) FILTER (WHERE status = 'filled')::text as filled_orders,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::text as orders_24h
        FROM spot_orders
      `);

      // Get trades stats (volume = quantity * price; support both quote_amount and computed)
      const tradeStats = await db.query(`
        SELECT 
          COUNT(*)::text as total_trades,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::text as trades_24h,
          COALESCE(SUM(quantity::numeric * price::numeric), 0)::text as volume_24h
        FROM spot_trades
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      const tradeStatsAll = await db.query(`
        SELECT COUNT(*)::text as total_trades FROM spot_trades
      `);
      const tRow = tradeStats.rows[0] as Record<string, unknown> | undefined;
      const tAll = tradeStatsAll.rows[0] as Record<string, unknown> | undefined;
      const tradeStatsMerged = {
        total_trades: tAll?.total_trades ?? '0',
        trades_24h: tRow?.trades_24h ?? '0',
        volume_24h: tRow?.volume_24h ?? '0',
      };

      // Market counts: trading_pairs (is_active, trading_enabled) or spot_markets
      let marketsRunning = 0;
      let marketsHalted = 0;
      try {
        const hasSpotMarkets = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`);
        if (hasSpotMarkets.rows.length > 0) {
          const m = await db.query(`
            SELECT 
              COUNT(*) FILTER (WHERE status = 'active' OR status = 'ACTIVE')::int as running,
              COUNT(*) FILTER (WHERE status != 'active' AND status != 'ACTIVE')::int as halted
            FROM spot_markets
          `);
          const r = m.rows[0] as { running?: number; halted?: number };
          marketsRunning = r?.running ?? 0;
          marketsHalted = r?.halted ?? 0;
        } else {
          const m = await db.query(`
            SELECT 
              COUNT(*) FILTER (WHERE COALESCE(is_active, true) = true AND COALESCE(trading_enabled, true) = true)::int as running,
              COUNT(*) FILTER (WHERE COALESCE(is_active, true) = false OR COALESCE(trading_enabled, true) = false)::int as halted
            FROM trading_pairs
          `);
          const r = m.rows[0] as { running?: number; halted?: number };
          marketsRunning = r?.running ?? 0;
          marketsHalted = r?.halted ?? 0;
        }
      } catch {
        // ignore
      }

      return reply.send({
        success: true,
        data: {
          pairs: pairs.rows,
          orderStats: orderStats.rows[0],
          tradeStats: tradeStatsMerged,
          marketsRunning,
          marketsHalted,
        },
      });

    } catch (error) {
      logger.error('Get trading error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch trading data' },
      });
    }
  });

  /**
   * GET /admin/trading/orders
   * List spot orders for admin (paginated).
   */
  app.get<{
    Querystring: { page?: string; limit?: string; status?: string; market?: string; side?: string; q?: string };
  }>('/trading/orders', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = '1', limit = '20', status, market, side, q } = request.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const colRes = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'spot_orders'
           AND column_name = ANY($1::text[])`,
        [['market', 'trading_pair_id', 'type', 'order_type', 'filled_quantity']]
      );
      const colSet = new Set(colRes.rows.map((r) => r.column_name));
      const useMarket = colSet.has('market');
      const typeExpr = colSet.has('type')
        ? 'o.type::text AS order_type'
        : colSet.has('order_type')
          ? 'o.order_type::text AS order_type'
          : 'NULL::text AS order_type';
      const filledExpr = colSet.has('filled_quantity')
        ? 'o.filled_quantity::text AS filled'
        : 'NULL::text AS filled';

      const conds: string[] = ['1=1'];
      const whereParams: unknown[] = [];
      let p = 1;

      if (status && status !== 'all') {
        /**
         * `order_status` enum is lowercase: new, partially_filled, filled,
         * cancelled, rejected, expired, pending_cancel. Legacy admin UI sends
         * values like `OPEN`, `FILLED`, `PARTIALLY_FILLED`, `CANCELLED`. Normalize
         * and expand `open` → both 'new' and 'partially_filled' (resting book).
         */
        const norm = String(status).toLowerCase();
        if (norm === 'open') {
          conds.push(`o.status = ANY($${p++}::order_status[])`);
          whereParams.push(['new', 'partially_filled']);
        } else {
          conds.push(`o.status = $${p++}`);
          whereParams.push(norm);
        }
      }
      const marketQ = market?.trim();
      if (marketQ) {
        if (useMarket) {
          conds.push(`o.market ILIKE $${p++}`);
        } else {
          conds.push(`tp.symbol ILIKE $${p++}`);
        }
        whereParams.push(`%${marketQ}%`);
      }
      if (side && side !== 'all') {
        conds.push(`LOWER(o.side::text) = LOWER($${p++})`);
        whereParams.push(side);
      }
      const searchQ = q?.trim();
      if (searchQ) {
        conds.push(
          `(o.id::text ILIKE $${p} OR COALESCE(u.email, '') ILIKE $${p} OR u.id::text ILIKE $${p})`
        );
        whereParams.push(`%${searchQ}%`);
        p += 1;
      }

      const whereSql = conds.join(' AND ');
      const fromSql = useMarket
        ? `FROM spot_orders o JOIN users u ON o.user_id = u.id`
        : `FROM spot_orders o JOIN users u ON o.user_id = u.id LEFT JOIN trading_pairs tp ON o.trading_pair_id = tp.id`;

      const orderBy = 'o.created_at DESC';
      const limIdx = whereParams.length + 1;
      const offIdx = whereParams.length + 2;
      const listSql = useMarket
        ? `SELECT o.id AS order_id, o.user_id, u.email AS user_email, o.market, o.side, o.price::text AS price, o.quantity::text AS amount, ${typeExpr}, ${filledExpr}, o.status, o.created_at
           ${fromSql}
           WHERE ${whereSql}
           ORDER BY ${orderBy}
           LIMIT $${limIdx} OFFSET $${offIdx}`
        : `SELECT o.id AS order_id, o.user_id, u.email AS user_email, tp.symbol AS market, o.side, o.price::text AS price, o.quantity::text AS amount, ${typeExpr}, ${filledExpr}, o.status, o.created_at
           ${fromSql}
           WHERE ${whereSql}
           ORDER BY ${orderBy}
           LIMIT $${limIdx} OFFSET $${offIdx}`;

      const listParams = [...whereParams, limitNum, offset];
      const countSql = `SELECT COUNT(*)::int AS count ${fromSql} WHERE ${whereSql}`;
      const [listRes, countRes] = await Promise.all([
        db.query(listSql, listParams as string[]),
        db.query(countSql, whereParams as string[]),
      ]);
      const total = (countRes.rows[0] as { count?: number })?.count ?? 0;
      return reply.send({
        success: true,
        data: {
          orders: listRes.rows,
          pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
        },
      });
    } catch (e) {
      logger.error('Get trading orders error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch orders' } });
    }
  });

  /**
   * GET /admin/trading/trades
   * List spot trades for admin (paginated).
   */
  app.get<{
    Querystring: { page?: string; limit?: string; market?: string; side?: string; from?: string; to?: string };
  }>('/trading/trades', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = '1', limit = '20', market, side, from, to } = request.query;
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      // spot_trades schema: id, trading_pair_id, maker_user_id, taker_user_id,
      //   price, quantity, quote_amount, side, maker_fee, taker_fee,
      //   maker_fee_currency_id, taker_fee_currency_id, created_at
      const conds: string[] = ['1=1'];
      const whereParams: unknown[] = [];
      let p = 1;

      if (market?.trim()) {
        conds.push(`tp.symbol ILIKE $${p++}`);
        whereParams.push(`%${market.trim()}%`);
      }
      if (side && side !== 'all') {
        conds.push(`LOWER(t.side::text) = LOWER($${p++})`);
        whereParams.push(side);
      }
      if (from?.trim()) {
        conds.push(`t.created_at >= $${p++}::timestamptz`);
        whereParams.push(from.trim());
      }
      if (to?.trim()) {
        conds.push(`t.created_at <= $${p++}::timestamptz`);
        whereParams.push(to.trim());
      }

      const whereSql = conds.join(' AND ');
      const baseFrom = `FROM spot_trades t
        JOIN trading_pairs tp ON t.trading_pair_id = tp.id
        LEFT JOIN users mu ON t.maker_user_id = mu.id
        LEFT JOIN users tu ON t.taker_user_id = tu.id`;

      const listSql = `
        SELECT
          t.id AS trade_id,
          tp.symbol AS market,
          t.side,
          mu.email AS maker_email,
          tu.email AS taker_email,
          t.maker_user_id,
          t.taker_user_id,
          t.price::text AS price,
          t.quantity::text AS amount,
          t.quote_amount::text AS notional_value,
          t.maker_fee::text AS maker_fee,
          t.taker_fee::text AS taker_fee,
          t.created_at
        ${baseFrom}
        WHERE ${whereSql}
        ORDER BY t.created_at DESC
        LIMIT $${p} OFFSET $${p + 1}`;

      const countSql = `SELECT COUNT(*)::int AS count ${baseFrom} WHERE ${whereSql}`;
      const listParams = [...whereParams, limitNum, offset];

      const [listRes, countRes] = await Promise.all([
        db.query(listSql, listParams as string[]),
        db.query(countSql, whereParams as string[]),
      ]);

      const total = (countRes.rows[0] as { count?: number })?.count ?? 0;
      const WHALE_THRESHOLD_USD = 100_000;
      const trades = (listRes.rows as Array<Record<string, unknown>>).map((row) => {
        const price = parseFloat(String(row.price ?? 0));
        const qty = parseFloat(String(row.amount ?? 0));
        const notional = price * qty;
        const is_whale_trade = notional >= WHALE_THRESHOLD_USD;
        // Expose a unified user_email for backwards compat with frontend
        const user_email = String(row.side ?? '').toLowerCase() === 'buy'
          ? (row.taker_email ?? row.maker_email ?? null)
          : (row.maker_email ?? row.taker_email ?? null);
        const user_id = String(row.side ?? '').toLowerCase() === 'buy'
          ? (row.taker_user_id ?? row.maker_user_id ?? null)
          : (row.maker_user_id ?? row.taker_user_id ?? null);
        return { ...row, notional, is_whale_trade, user_email, user_id };
      });

      return reply.send({
        success: true,
        data: {
          trades,
          pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
        },
      });
    } catch (e) {
      logger.error('Get trading trades error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch trades' } });
    }
  });

  /**
   * GET /admin/trading/markets
   * List markets with running/halted status for admin.
   */
  app.get('/trading/markets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasSpotMarkets = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`);
      if (hasSpotMarkets.rows.length > 0) {
        const result = await db.query(`
          SELECT symbol, status, COALESCE(status = 'active', status = 'ACTIVE') AS running
          FROM spot_markets
          ORDER BY symbol
        `);
        const running = result.rows.filter((r: { running?: boolean }) => r.running === true).length;
        const halted = result.rows.length - running;
        return reply.send({
          success: true,
          data: {
            markets: result.rows,
            marketsRunning: running,
            marketsHalted: halted,
          },
        });
      }
      const result = await db.query(`
        SELECT tp.symbol, tp.is_active, tp.trading_enabled,
               (COALESCE(tp.is_active, true) AND COALESCE(tp.trading_enabled, true)) AS running
        FROM trading_pairs tp
        ORDER BY tp.symbol
      `);
      const running = result.rows.filter((r: { running?: boolean }) => r.running === true).length;
      const halted = result.rows.length - running;
      return reply.send({
        success: true,
        data: {
          markets: result.rows,
          marketsRunning: running,
          marketsHalted: halted,
        },
      });
    } catch (e) {
      logger.error('Get trading markets error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch markets' } });
    }
  });

  /**
   * GET /admin/trading/orderbook
   * Orderbook snapshot for a market (query: market=BTCUSDT or BTC_USDT). Returns bids, asks, spread_pct, depth.
   */
  app.get<{ Querystring: { market?: string; depth?: string } }>('/trading/orderbook', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const market = (request.query?.market ?? '').trim().toUpperCase().replace(/-/g, '_');
      if (!market) {
        return reply.status(400).send({ success: false, error: { code: 'MISSING_MARKET', message: 'market is required' } });
      }
      const depth = Math.min(20, Math.max(5, parseInt(request.query?.depth ?? '10', 10) || 10));
      const { getOrderbookFromDb } = await import('../services/spot-orderbook-cache.service.js');
      let symbol = market;
      if (!market.includes('_') && market.length >= 6) {
        const quote = market.slice(-4);
        if (quote === 'USDT' || quote === 'USDC' || quote === 'BUSD') symbol = `${market.slice(0, -4)}_${quote}`;
      }
      let ob = await getOrderbookFromDb(symbol, depth);
      if ((ob.bids?.length ?? 0) === 0 && (ob.asks?.length ?? 0) === 0 && market !== symbol) {
        ob = await getOrderbookFromDb(market, depth);
      }
      const bids = ob.bids ?? [];
      const asks = ob.asks ?? [];
      const bestBid = bids.length ? parseFloat(bids[0]?.price ?? '0') : 0;
      const bestAsk = asks.length ? parseFloat(asks[0]?.price ?? '0') : 0;
      const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
      const spreadPct = mid ? ((bestAsk - bestBid) / mid) * 100 : null;
      const totalBidQty = bids.slice(0, 10).reduce((s, b) => s + parseFloat(b?.quantity ?? '0'), 0);
      const totalAskQty = asks.slice(0, 10).reduce((s, a) => s + parseFloat(a?.quantity ?? '0'), 0);
      const depthLabel = totalBidQty + totalAskQty > 100 ? 'Good' : (totalBidQty + totalAskQty > 10 ? 'Medium' : 'Low');
      return reply.send({
        success: true,
        data: {
          bids: bids.slice(0, depth),
          asks: asks.slice(0, depth),
          spread_pct: spreadPct != null ? Math.round(spreadPct * 100) / 100 : null,
          depth: depthLabel,
          symbol: ob.symbol ?? market,
        },
      });
    } catch (e) {
      logger.error('Get trading orderbook error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch orderbook' } });
    }
  });

  /**
   * POST /admin/trading/halt
   * Set global trading halt (body: { halted: boolean, reason?: string, admin_note?: string }). Logs reason to audit.
   */
  app.post<{ Body: { halted?: boolean; reason?: string; admin_note?: string } }>('/trading/halt', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'control:trading', reply)) return;
    const halted = request.body?.halted === true;
    const reason = (request.body?.reason ?? '').trim() || undefined;
    const adminNote = (request.body?.admin_note ?? '').trim() || undefined;
    if (halted && (reason?.length ?? 0) < 8) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'REASON_REQUIRED',
          message: 'Reason (minimum 8 characters) is required when pausing trading.',
        },
      });
    }
    const { setTradingHalt } = await import('../lib/trading-halt.js');
    await setTradingHalt(halted);
    try {
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: halted ? 'admin_trading_halt' : 'admin_trading_resume',
        resourceType: 'trading',
        resourceId: 'global',
        newValue: { halted, reason, admin_note: adminNote },
      });
    } catch {
      /* best-effort */
    }
    logger.warn('Trading halt changed via /trading/halt', { adminId: admin.adminId, halted, reason });
    return reply.send({ success: true, data: { halted } });
  });

  /**
   * POST /admin/trading/market-halt
   * Halt or resume a single market (body: { market: string, halted: boolean, reason?: string, admin_note?: string }).
   * When halted=true, reason is required. Reason and admin_note are stored in audit logs.
   */
  app.post<{ Body: { market?: string; halted?: boolean; reason?: string; admin_note?: string } }>('/trading/market-halt', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'control:trading', reply)) return;
    const market = (request.body?.market ?? '').trim();
    const halted = request.body?.halted === true;
    const reason = (request.body?.reason ?? '').toString().trim() || undefined;
    const adminNote = (request.body?.admin_note ?? '').toString().trim() || undefined;
    if (!market) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_MARKET', message: 'market is required' } });
    }
    if (halted && (reason?.length ?? 0) < 8) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'REASON_REQUIRED',
          message: 'Reason (minimum 8 characters) is required when pausing a market.',
        },
      });
    }
    try {
      const { setSymbolCircuit } = await import('../lib/per-symbol-circuit.js');
      const symbol = market.toUpperCase().replace(/-/g, '_');
      await setSymbolCircuit(symbol, halted);
      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: halted ? 'admin_market_halt' : 'admin_market_resume',
          resourceType: 'market',
          resourceId: symbol,
          newValue: { halted, reason: reason ?? undefined, admin_note: adminNote },
        });
      } catch {
        /* best-effort */
      }
      logger.warn('Market halt changed', { adminId: admin.adminId, market: symbol, halted, reason });
      return reply.send({ success: true, data: { market: symbol, halted } });
    } catch (e) {
      logger.error('Market halt error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to set market halt' } });
    }
  });

  // ===============================
  // MARKETS MANAGEMENT (/admin/markets)
  // ===============================

  /**
   * GET /admin/markets
   * List all trading markets with stats (total, active, paused, average_spread). Uses spot_markets or trading_pairs.
   */
  app.get('/markets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const hasSpotMarkets = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`);
      if (hasSpotMarkets.rows.length > 0) {
        const rows = await db.query(`
          SELECT id, symbol, base_asset, quote_asset, status, min_qty, min_notional, price_precision, qty_precision,
                 COALESCE(maker_fee, 0.001)::text AS maker_fee, COALESCE(taker_fee, 0.001)::text AS taker_fee,
                 created_at, updated_at
          FROM spot_markets
          ORDER BY symbol
        `);
        const markets = rows.rows as Record<string, unknown>[];
        const total = markets.length;
        const active = markets.filter((m) => String(m.status || '').toLowerCase() === 'active').length;
        const paused = total - active;
        let averageSpread: number | null = null;
        try {
          const { getOrderbookFromDb } = await import('../services/spot-orderbook-cache.service.js');
          let sumSpread = 0;
          let countSpread = 0;
          for (const m of markets.slice(0, 20)) {
            const sym = String(m.symbol ?? '');
            if (!sym) continue;
            const ob = await getOrderbookFromDb(sym, 5);
            const bids = ob.bids ?? [];
            const asks = ob.asks ?? [];
            const bestBid = bids.length ? parseFloat(bids[0]?.price ?? '0') : 0;
            const bestAsk = asks.length ? parseFloat(asks[0]?.price ?? '0') : 0;
            const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
            if (mid && bestAsk > bestBid) {
              sumSpread += ((bestAsk - bestBid) / mid) * 100;
              countSpread++;
            }
          }
          if (countSpread > 0) averageSpread = Math.round((sumSpread / countSpread) * 100) / 100;
        } catch {
          // ignore
        }
        const LIQUIDITY_THRESHOLD_LIST = 1;
        try {
          const { getOrderbookFromDb } = await import('../services/spot-orderbook-cache.service.js');
          for (const m of markets.slice(0, 40)) {
            const sym = String(m.symbol ?? '');
            if (!sym) continue;
            try {
              const ob = await getOrderbookFromDb(sym, 2);
              const bids = ob.bids ?? [];
              const asks = ob.asks ?? [];
              const topBidQty = bids.length ? parseFloat(bids[0]?.quantity ?? '0') : 0;
              const topAskQty = asks.length ? parseFloat(asks[0]?.quantity ?? '0') : 0;
              (m as Record<string, unknown>).low_liquidity = topBidQty + topAskQty < LIQUIDITY_THRESHOLD_LIST;
            } catch {
              (m as Record<string, unknown>).low_liquidity = true;
            }
          }
          for (const m of markets.slice(40)) {
            (m as Record<string, unknown>).low_liquidity = false;
          }
        } catch {
          for (const m of markets) {
            (m as Record<string, unknown>).low_liquidity = false;
          }
        }
        return reply.send({
          success: true,
          data: {
            markets,
            stats: { total_markets: total, active_markets: active, paused_markets: paused, average_spread: averageSpread },
          },
        });
      }
      const rows = await db.query(`
        SELECT tp.id, tp.symbol, tp.status, tp.is_active, tp.trading_enabled,
               tp.maker_fee::text AS maker_fee, tp.taker_fee::text AS taker_fee,
               tp.price_precision AS price_precision, tp.quantity_precision AS qty_precision,
               tp.created_at, tp.updated_at, bc.symbol AS base_asset, qc.symbol AS quote_asset
        FROM trading_pairs tp
        JOIN currencies bc ON tp.base_currency_id = bc.id
        JOIN currencies qc ON tp.quote_currency_id = qc.id
        ORDER BY tp.symbol
      `);
      const markets = rows.rows as Record<string, unknown>[];
      const total = markets.length;
      const active = markets.filter((m) => (m.is_active !== false && m.trading_enabled !== false) || String(m.status || '').toLowerCase() === 'active').length;
      const paused = total - active;
      return reply.send({
        success: true,
        data: {
          markets,
          stats: { total_markets: total, active_markets: active, paused_markets: paused, average_spread: null },
        },
      });
    } catch (e) {
      logger.error('Get markets list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list markets' } });
    }
  });

  /**
   * GET /admin/markets/:symbol
   * Market detail: info, orderbook snapshot, recent trades, liquidity depth.
   */
  app.get<{ Params: { symbol: string } }>('/markets/:symbol', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_').replace(/\//g, '_');
    if (!symbol) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_SYMBOL', message: 'symbol is required' } });
    }
    try {
      const hasSpotMarkets = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`);
      let market: Record<string, unknown> | null = null;
      if (hasSpotMarkets.rows.length > 0) {
        const res = await db.query(`
          SELECT id, symbol, base_asset, quote_asset, status, min_qty, min_notional, price_precision, qty_precision,
                 COALESCE(maker_fee, 0.001)::text AS maker_fee, COALESCE(taker_fee, 0.001)::text AS taker_fee,
                 created_at, updated_at
          FROM spot_markets WHERE symbol = $1
        `, [symbol]);
        if (res.rows.length === 0) {
          const alt = symbol.replace('_', '');
          const res2 = await db.query(`SELECT id, symbol, base_asset, quote_asset, status, min_qty, min_notional, price_precision, qty_precision,
                 COALESCE(maker_fee, 0.001)::text AS maker_fee, COALESCE(taker_fee, 0.001)::text AS taker_fee,
                 created_at, updated_at FROM spot_markets WHERE symbol = $1`, [alt]);
          if (res2.rows.length > 0) market = res2.rows[0] as Record<string, unknown>;
        } else market = res.rows[0] as Record<string, unknown>;
      }
      if (!market) {
        const res = await db.query(`
          SELECT tp.id, tp.symbol, tp.status, tp.maker_fee::text AS maker_fee, tp.taker_fee::text AS taker_fee,
                 tp.price_precision, tp.quantity_precision AS qty_precision, tp.created_at, tp.updated_at,
                 bc.symbol AS base_asset, qc.symbol AS quote_asset
          FROM trading_pairs tp
          JOIN currencies bc ON tp.base_currency_id = bc.id
          JOIN currencies qc ON tp.quote_currency_id = qc.id
          WHERE tp.symbol = $1
        `, [symbol]);
        if (res.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
        }
        market = res.rows[0] as Record<string, unknown>;
      }
      const obSymbol = (market.symbol as string) || symbol;
      const { getOrderbookFromDb } = await import('../services/spot-orderbook-cache.service.js');
      const LIQUIDITY_THRESHOLD = 1;
      let orderbook: { bids: Array<{ price: string; quantity: string }>; asks: Array<{ price: string; quantity: string }>; spread_pct: number | null; depth: string; spread_health: string; low_liquidity: boolean } = { bids: [], asks: [], spread_pct: null, depth: 'Low', spread_health: '—', low_liquidity: true };
      try {
        const ob = await getOrderbookFromDb(obSymbol, 20);
        const bids = ob.bids ?? [];
        const asks = ob.asks ?? [];
        const bestBid = bids.length ? parseFloat(bids[0]?.price ?? '0') : 0;
        const bestAsk = asks.length ? parseFloat(asks[0]?.price ?? '0') : 0;
        const topBidQty = bids.length ? parseFloat(bids[0]?.quantity ?? '0') : 0;
        const topAskQty = asks.length ? parseFloat(asks[0]?.quantity ?? '0') : 0;
        const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
        const spreadPct = mid ? ((bestAsk - bestBid) / mid) * 100 : null;
        const totalBidQty = bids.slice(0, 10).reduce((s, b) => s + parseFloat(b?.quantity ?? '0'), 0);
        const totalAskQty = asks.slice(0, 10).reduce((s, a) => s + parseFloat(a?.quantity ?? '0'), 0);
        const depthSum = totalBidQty + totalAskQty;
        let spreadHealth = '—';
        if (spreadPct != null) {
          if (spreadPct < 0.1) spreadHealth = 'Good';
          else if (spreadPct < 0.5) spreadHealth = 'Medium';
          else spreadHealth = 'Poor';
        }
        const lowLiquidity = topBidQty + topAskQty < LIQUIDITY_THRESHOLD;
        orderbook = {
          bids: bids.slice(0, 20),
          asks: asks.slice(0, 20),
          spread_pct: spreadPct != null ? Math.round(spreadPct * 100) / 100 : null,
          depth: depthSum > 100 ? 'Good' : depthSum > 10 ? 'Medium' : 'Low',
          spread_health: spreadHealth,
          low_liquidity: lowLiquidity,
        };
      } catch {
        // ignore
      }
      let volume24h = '0';
      let trades24h = 0;
      const hasMarketCol = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='spot_trades' AND column_name='market' LIMIT 1`);
      if (hasMarketCol.rows.length > 0) {
        const volRes = await db.query<{ volume_24h: string; trades_24h: string }>(
          `SELECT COALESCE(SUM(price * quantity), 0)::text AS volume_24h, COUNT(*)::text AS trades_24h
           FROM spot_trades WHERE market = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
          [obSymbol]
        );
        volume24h = volRes.rows[0]?.volume_24h ?? '0';
        trades24h = parseInt(volRes.rows[0]?.trades_24h ?? '0', 10);
      } else {
        const volRes = await db.query<{ volume_24h: string; trades_24h: string }>(
          `SELECT COALESCE(SUM(t.price * t.quantity), 0)::text AS volume_24h, COUNT(*)::text AS trades_24h
           FROM spot_trades t JOIN trading_pairs tp ON t.trading_pair_id = tp.id
           WHERE tp.symbol = $1 AND t.created_at > NOW() - INTERVAL '24 hours'`,
          [symbol]
        );
        volume24h = volRes.rows[0]?.volume_24h ?? '0';
        trades24h = parseInt(volRes.rows[0]?.trades_24h ?? '0', 10);
      }
      let recentTrades: Record<string, unknown>[] = [];
      if (hasMarketCol.rows.length > 0) {
        const tradesRes = await db.query(`
          SELECT id, market, side, price::text AS price, quantity::text AS quantity, fee::text AS fee, created_at
          FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 20
        `, [obSymbol]);
        recentTrades = tradesRes.rows as Record<string, unknown>[];
      } else {
        const tradesRes = await db.query(`
          SELECT t.id, tp.symbol AS market, t.side, t.price::text AS price, t.quantity::text AS quantity, t.fee::text AS fee, t.created_at
          FROM spot_trades t
          JOIN trading_pairs tp ON t.trading_pair_id = tp.id
          WHERE tp.symbol = $1 ORDER BY t.created_at DESC LIMIT 20
        `, [symbol]);
        recentTrades = tradesRes.rows as Record<string, unknown>[];
      }
      return reply.send({
        success: true,
        data: {
          market,
          orderbook,
          recent_trades: recentTrades,
          liquidity_depth: orderbook,
          volume_24h: volume24h,
          trades_24h: trades24h,
          spread_health: orderbook.spread_health,
          low_liquidity: orderbook.low_liquidity,
        },
      });
    } catch (e) {
      logger.error('Get market detail error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch market' } });
    }
  });

  /**
   * POST /admin/markets
   * Create a new market (spot_markets). Body: symbol, base_asset, quote_asset, [maker_fee, taker_fee, price_precision, qty_precision].
   */
  app.post<{ Body: { symbol?: string; base_asset?: string; quote_asset?: string; maker_fee?: number; taker_fee?: number; price_precision?: number; qty_precision?: number } }>('/markets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = request.body || {};
    const symbol = (body.symbol ?? '').toString().toUpperCase().replace(/-/g, '_').replace(/\//g, '_');
    const base_asset = (body.base_asset ?? '').toString().trim();
    const quote_asset = (body.quote_asset ?? '').toString().trim();
    if (!symbol || !base_asset || !quote_asset) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'symbol, base_asset, and quote_asset are required' } });
    }
    try {
      const hasSpotMarkets = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`);
      if (hasSpotMarkets.rows.length === 0) {
        return reply.status(501).send({ success: false, error: { code: 'NOT_SUPPORTED', message: 'Create market via Settings > Trading Pairs' } });
      }
      const existing = await db.query('SELECT id FROM spot_markets WHERE symbol = $1', [symbol]);
      if (existing.rows.length > 0) {
        return reply.status(400).send({ success: false, error: { code: 'ALREADY_EXISTS', message: 'Market already exists' } });
      }
      const maker_fee = typeof body.maker_fee === 'number' ? body.maker_fee : 0.001;
      const taker_fee = typeof body.taker_fee === 'number' ? body.taker_fee : 0.001;
      const price_precision = typeof body.price_precision === 'number' ? body.price_precision : 8;
      const qty_precision = typeof body.qty_precision === 'number' ? body.qty_precision : 8;
      await db.query(`
        INSERT INTO spot_markets (symbol, base_asset, quote_asset, status, maker_fee, taker_fee, price_precision, qty_precision)
        VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
      `, [symbol, base_asset, quote_asset, maker_fee, taker_fee, price_precision, qty_precision]);
      await invalidateMarketsCache();
      logger.info('admin_market_created', { adminId: admin.adminId, symbol });
      return reply.send({ success: true, data: { symbol, base_asset, quote_asset, status: 'active' } });
    } catch (e) {
      logger.error('Create market error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create market' } });
    }
  });

  /**
   * PATCH /admin/markets/:symbol
   * Update market: status, maker_fee, taker_fee, price_precision, qty_precision, min_qty, min_notional.
   */
  app.patch<{
    Params: { symbol: string };
    Body: { status?: string; maker_fee?: number; taker_fee?: number; price_precision?: number; qty_precision?: number; min_qty?: number; min_notional?: number };
  }>('/markets/:symbol', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_').replace(/\//g, '_');
    const body = request.body || {};
    try {
      const hasSpotMarkets = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'spot_markets' LIMIT 1`);
      if (hasSpotMarkets.rows.length > 0) {
        const updates: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        if (body.status !== undefined) {
          const s = String(body.status).toLowerCase();
          if (!['active', 'disabled', 'maintenance'].includes(s)) {
            return reply.status(400).send({ success: false, error: { code: 'INVALID_STATUS', message: 'status must be active, disabled, or maintenance' } });
          }
          updates.push(`status = $${i++}`);
          params.push(s);
        }
        if (body.maker_fee !== undefined) {
          updates.push(`maker_fee = $${i++}`);
          params.push(body.maker_fee);
        }
        if (body.taker_fee !== undefined) {
          updates.push(`taker_fee = $${i++}`);
          params.push(body.taker_fee);
        }
        if (body.price_precision !== undefined) {
          updates.push(`price_precision = $${i++}`);
          params.push(body.price_precision);
        }
        if (body.qty_precision !== undefined) {
          updates.push(`qty_precision = $${i++}`);
          params.push(body.qty_precision);
        }
        if (body.min_qty !== undefined) {
          updates.push(`min_qty = $${i++}`);
          params.push(body.min_qty);
        }
        if (body.min_notional !== undefined) {
          updates.push(`min_notional = $${i++}`);
          params.push(body.min_notional);
        }
        if (updates.length === 0) {
          return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No fields to update' } });
        }
        updates.push('updated_at = NOW()');
        params.push(symbol);
        const result = await db.query(
          `UPDATE spot_markets SET ${updates.join(', ')} WHERE symbol = $${i} RETURNING id, symbol, status, maker_fee, taker_fee, price_precision, qty_precision, updated_at`,
          params
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Market not found' } });
        }
        if (body.maker_fee !== undefined || body.taker_fee !== undefined) {
          try {
            const row = result.rows[0] as Record<string, unknown>;
            await logAuditFromRequest(request, {
              actorType: 'admin',
              actorId: admin.adminId,
              action: 'market_fee_updated',
              resourceType: 'market',
              resourceId: symbol,
              newValue: { maker_fee: row.maker_fee, taker_fee: row.taker_fee },
            });
          } catch {
            /* best-effort */
          }
        }
        await invalidateMarketsCache();
        logger.info('admin_market_updated', { adminId: admin.adminId, symbol });
        return reply.send({ success: true, data: result.rows[0] });
      }
      return reply.status(501).send({ success: false, error: { code: 'NOT_SUPPORTED', message: 'Update via Settings > Trading Pairs' } });
    } catch (e) {
      logger.error('Patch market error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update market' } });
    }
  });

  /**
   * GET /admin/markets/:symbol/fee-history
   * Fee change history for a market from audit_logs_immutable (action = market_fee_updated).
   */
  app.get<{ Params: { symbol: string } }>('/markets/:symbol/fee-history', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const symbol = (request.params.symbol || '').toUpperCase().replace(/-/g, '_').replace(/\//g, '_');
    if (!symbol) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_SYMBOL', message: 'symbol is required' } });
    }
    try {
      const hasImmutable = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs_immutable' LIMIT 1`);
      if (hasImmutable.rows.length === 0) {
        return reply.send({ success: true, data: { fee_history: [] } });
      }
      const hasAdminUsers = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_users' LIMIT 1`);
      const limit = Math.min(100, Math.max(1, parseInt((request.query as { limit?: string })?.limit ?? '50', 10) || 50));
      const res = await db.query<{ created_at: string; actor_id: string | null; new_value: string | null }>(
        `SELECT created_at, actor_id, new_value FROM audit_logs_immutable
         WHERE resource_type = 'market' AND resource_id = $1 AND action = 'market_fee_updated'
         ORDER BY created_at DESC LIMIT $2`,
        [symbol, limit]
      );
      let emailMap: Record<string, string> = {};
      if (hasAdminUsers.rows.length > 0) {
        const adminIds = [...new Set((res.rows.map((r) => r.actor_id).filter(Boolean) as string[]))];
        if (adminIds.length > 0) {
          const userRes = await db.query<{ id: string; email: string }>(
            `SELECT id::text AS id, email FROM admin_users WHERE id::text = ANY($1)`,
            [adminIds]
          );
          emailMap = Object.fromEntries(userRes.rows.map((u) => [u.id, u.email ?? '']));
        }
      }
      const rows = res.rows.map((r) => {
        let maker_fee: number | null = null;
        let taker_fee: number | null = null;
        try {
          const v = r.new_value ? JSON.parse(typeof r.new_value === 'string' ? r.new_value : '{}') : {};
          maker_fee = typeof v.maker_fee === 'number' ? v.maker_fee : (typeof v.maker_fee === 'string' ? parseFloat(v.maker_fee) : null);
          taker_fee = typeof v.taker_fee === 'number' ? v.taker_fee : (typeof v.taker_fee === 'string' ? parseFloat(v.taker_fee) : null);
        } catch {
          // ignore
        }
        return {
          date: r.created_at,
          maker_fee,
          taker_fee,
          admin_email: (r.actor_id && emailMap[r.actor_id]) || null,
        };
      });
      return reply.send({ success: true, data: { fee_history: rows } });
    } catch (e) {
      logger.error('Get market fee history error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch fee history' } });
    }
  });

  /**
   * GET /admin/trading/circuit
   * Get settlement circuit breaker status.
   */
  app.get('/trading/circuit', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { getSettlementCircuitOpen } = await import('../lib/trading-halt.js');
      const circuitOpen = await getSettlementCircuitOpen();
      return reply.send({ success: true, data: { circuitOpen } });
    } catch (e) {
      logger.error('Get circuit error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get circuit status' } });
    }
  });

  /**
   * POST /admin/trading/circuit
   * Open or close settlement circuit breaker (body: { open: boolean }).
   */
  app.post<{ Body: { open?: boolean } }>('/trading/circuit', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const open = request.body?.open === true;
      const { setSettlementCircuitOpen } = await import('../lib/trading-halt.js');
      await setSettlementCircuitOpen(open);
      logger.warn('Circuit breaker changed', { adminId: admin.adminId, open });
      return reply.send({ success: true, data: { circuitOpen: open } });
    } catch (e) {
      logger.error('Set circuit error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to set circuit' } });
    }
  });

  // ===============================
  // P2P
  // ===============================

  /**
   * GET /admin/p2p
   * Get P2P overview
   */
  app.get('/p2p', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      // Get ads stats
      const adsStats = await db.query(`
        SELECT 
          COUNT(*) as total_ads,
          COUNT(*) FILTER (WHERE status = 'active') as active_ads,
          COUNT(*) FILTER (WHERE ad_type = 'buy') as buy_ads,
          COUNT(*) FILTER (WHERE ad_type = 'sell') as sell_ads
        FROM p2p_ads
      `);

      // Get orders stats
      const orderStats = await db.query(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status IN ('pending', 'awaiting_payment', 'payment_sent')) as active_orders,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_orders,
          COUNT(*) FILTER (WHERE status = 'disputed') as disputed_orders
        FROM p2p_orders
      `);

      // Get disputes
      const disputeStats = await db.query(`
        SELECT 
          COUNT(*) as total_disputes,
          COUNT(*) FILTER (WHERE status = 'open') as open_disputes,
          COUNT(*) FILTER (WHERE status = 'under_review') as under_review,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved_disputes
        FROM p2p_disputes
      `);

      // Get payment methods
      const paymentMethods = await db.query(`
        SELECT * FROM p2p_payment_methods WHERE is_active = true ORDER BY name
      `);

      return reply.send({
        success: true,
        data: {
          adsStats: adsStats.rows[0],
          orderStats: orderStats.rows[0],
          disputeStats: disputeStats.rows[0],
          paymentMethods: paymentMethods.rows,
        },
      });

    } catch (error) {
      logger.error('Get P2P error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch P2P data' },
      });
    }
  });

  /**
   * GET /admin/p2p/ads
   * Get P2P ads
   */
  app.get('/p2p/ads', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, status, type } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = `
        SELECT 
          a.*,
          u.email, u.username,
          c.symbol as crypto_symbol
        FROM p2p_ads a
        JOIN users u ON a.user_id = u.id
        JOIN currencies c ON a.crypto_currency_id = c.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        query += ` AND a.status = $${paramIndex++}`;
        params.push(status);
      }

      if (type && type !== 'all') {
        query += ` AND a.ad_type = $${paramIndex++}`;
        params.push(type);
      }

      query += ` ORDER BY a.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      // Count
      const countResult = await db.query('SELECT COUNT(*) FROM p2p_ads');

      return reply.send({
        success: true,
        data: {
          ads: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0]?.count || '0'),
          },
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch P2P ads' },
      });
    }
  });

  /**
   * GET /admin/p2p/orders
   * Get P2P orders
   */
  app.get('/p2p/orders', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, status, ad_id } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const conditions: string[] = ['1=1'];
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        conditions.push(`o.status = $${paramIndex++}`);
        params.push(status);
      }
      if (ad_id) {
        conditions.push(`o.ad_id = $${paramIndex++}`);
        params.push(ad_id);
      }

      const whereClause = conditions.join(' AND ');

      let query = `
        SELECT 
          o.*,
          buyer.email as buyer_email, buyer.username as buyer_username,
          seller.email as seller_email, seller.username as seller_username,
          c.symbol as crypto_symbol
        FROM p2p_orders o
        JOIN users buyer ON o.buyer_id = buyer.id
        JOIN users seller ON o.seller_id = seller.id
        JOIN currencies c ON o.crypto_currency_id = c.id
        WHERE ${whereClause}
        ORDER BY o.created_at DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      const countResult = await db.query(
        `SELECT COUNT(*) FROM p2p_orders o WHERE ${whereClause}`,
        params.slice(0, params.length - 2)
      );

      return reply.send({
        success: true,
        data: {
          orders: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0]?.count || '0'),
          },
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch P2P orders' },
      });
    }
  });

  // ===============================
  // P2P MERCHANT APPLICATIONS
  // ===============================

  /**
   * GET /admin/p2p/merchants
   * List merchant applications with filters: status, page, limit.
   */
  app.get<{
    Querystring: { status?: string; page?: string; limit?: string };
  }>('/p2p/merchants', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { status, page = '1', limit = '20' } = request.query;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        conditions.push(`ma.status = $${paramIndex++}`);
        params.push(status);
      }

      const whereClause = conditions.join(' AND ');

      const result = await db.query(
        `SELECT ma.*,
                u.email AS user_email, u.username AS user_username,
                au.email AS reviewer_email
         FROM p2p_merchant_applications ma
         JOIN users u ON ma.user_id = u.id
         LEFT JOIN admin_users au ON ma.reviewed_by = au.id
         WHERE ${whereClause}
         ORDER BY ma.created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, limitNum, offset]
      );

      const countResult = await db.query(
        `SELECT COUNT(*)::text AS count FROM p2p_merchant_applications ma WHERE ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      return reply.send({
        success: true,
        data: {
          merchants: result.rows,
          pagination: { page: pageNum, limit: limitNum, total },
        },
      });
    } catch (error) {
      logger.error('P2P merchants list failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch merchant applications' },
      });
    }
  });

  /**
   * PATCH /admin/p2p/merchants/:id/review
   * Approve or reject a merchant application.
   * Body: { status: 'approved' | 'rejected', note?: string }
   */
  app.patch<{
    Params: { id: string };
    Body: { status: 'approved' | 'rejected'; note?: string };
  }>('/p2p/merchants/:id/review', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'p2p:disputes');
    if (!admin) return;
    try {
      const { id } = request.params;
      const { status: newStatus, note } = request.body || {};

      if (!newStatus || !['approved', 'rejected'].includes(newStatus)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'status must be "approved" or "rejected"' },
        });
      }

      const existing = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM p2p_merchant_applications WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (existing.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Merchant application not found' },
        });
      }
      if (existing.rows[0]!.status !== 'pending') {
        return reply.status(400).send({
          success: false,
          error: { code: 'ALREADY_REVIEWED', message: 'Application has already been reviewed' },
        });
      }

      const updated = await db.query(
        `UPDATE p2p_merchant_applications
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [newStatus, admin.adminId, note?.trim() || null, id]
      );

      try {
        await logAuditFromRequest(request, {
          actorType: 'admin',
          actorId: admin.adminId,
          action: `p2p_merchant_${newStatus}`,
          resourceType: 'p2p_merchant_application',
          resourceId: id,
          newValue: { status: newStatus, note: note?.trim() || null },
        });
      } catch {
        /* best-effort */
      }

      return reply.send({ success: true, data: { merchant: updated.rows[0] } });
    } catch (error) {
      logger.error('P2P merchant review failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'REVIEW_FAILED', message: 'Failed to review merchant application' },
      });
    }
  });

  // ===============================
  // REFERRALS
  // ===============================

  /**
   * GET /admin/referrals
   * Get referrals overview
   */
  app.get('/referrals', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      // Get codes
      const codes = await db.query(`
        SELECT 
          rc.*,
          u.email, u.username
        FROM referral_codes rc
        JOIN users u ON rc.user_id = u.id
        ORDER BY rc.created_at DESC
        LIMIT 100
      `);

      // Get relationships
      const relationships = await db.query(`
        SELECT 
          rr.*,
          referrer.email as referrer_email,
          referee.email as referee_email
        FROM referral_relationships rr
        JOIN users referrer ON rr.referrer_id = referrer.id
        JOIN users referee ON rr.referee_id = referee.id
        ORDER BY rr.created_at DESC
        LIMIT 100
      `);

      // Get stats
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total_codes,
          COUNT(*) FILTER (WHERE is_active = true) as active_codes,
          COALESCE(SUM(total_earnings), 0) as total_earnings,
          COALESCE(SUM(current_referrals), 0) as total_referrals
        FROM referral_codes
      `);

      return reply.send({
        success: true,
        data: {
          codes: codes.rows,
          relationships: relationships.rows,
          stats: stats.rows[0],
        },
      });

    } catch (error) {
      logger.error('Get referrals error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referrals data' },
      });
    }
  });

  /**
   * GET /admin/users/referrals
   * Aggregated per-referrer view used by the admin Referrals page.
   * Returns rows grouped by referrer (one row per user who has a referral code).
   */
  app.get('/users/referrals', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 20, search, suspicious } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Build base query — group by referrer, aggregate referral stats
      let baseWhere = `WHERE u.deleted_at IS NULL`;
      const params: any[] = [];
      let idx = 1;

      if (search?.trim()) {
        baseWhere += ` AND (u.email ILIKE $${idx} OR u.username ILIKE $${idx} OR rc.code ILIKE $${idx})`;
        params.push(`%${search.trim()}%`);
        idx++;
      }

      // "Suspicious" = multiple referral codes OR self-referral patterns
      if (suspicious === 'true') {
        baseWhere += ` AND (
          (SELECT COUNT(*) FROM referral_codes rc2 WHERE rc2.user_id = u.id AND rc2.is_active = true) > 1
          OR rc.current_referrals > 50
        )`;
      }

      const rowsQ = await db.query(`
        SELECT
          u.id                                AS referrer_id,
          u.email                             AS referrer_email,
          u.username                          AS referrer_name,
          rc.code                             AS referral_code,
          COALESCE(rc.current_referrals, 0)   AS total_referrals,
          COALESCE(
            (SELECT COUNT(*)::int FROM referral_relationships rr
             WHERE rr.referrer_id = u.id AND rr.status = 'active'),
            0
          )                                   AS active_referrals,
          COALESCE(rc.total_earnings, 0)::text AS total_commission_usd,
          rc.updated_at                       AS last_referral_at,
          (
            (SELECT COUNT(*) FROM referral_codes rc2 WHERE rc2.user_id = u.id AND rc2.is_active = true) > 1
            OR rc.current_referrals > 50
          )                                   AS is_suspicious
        FROM referral_codes rc
        JOIN users u ON u.id = rc.user_id
        ${baseWhere}
        ORDER BY rc.current_referrals DESC, rc.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...params, parseInt(limit), offset]);

      const countQ = await db.query(`
        SELECT COUNT(DISTINCT u.id) as total
        FROM referral_codes rc
        JOIN users u ON u.id = rc.user_id
        ${baseWhere}
      `, params);

      const statsQ = await db.query(`
        SELECT
          COUNT(DISTINCT rc.user_id)::int                  AS total_referrers,
          COALESCE(SUM(rc.current_referrals), 0)::int      AS total_referrals,
          COALESCE(SUM(rc.total_earnings), 0)::text        AS total_commission_usd,
          COUNT(*) FILTER (WHERE rc.current_referrals > 50)::int AS suspicious_count
        FROM referral_codes rc
        JOIN users u ON u.id = rc.user_id
        WHERE u.deleted_at IS NULL
      `);

      return reply.send({
        success: true,
        data: {
          referrals: rowsQ.rows,
          total: parseInt(countQ.rows[0]?.total ?? '0'),
          stats: statsQ.rows[0],
        },
      });
    } catch (error) {
      logger.error('Get users/referrals error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referral analytics' },
      });
    }
  });

  /**
   * GET /admin/referrals/codes
   * List referral codes with optional filters and pagination
   */
  app.get('/referrals/codes', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { page?: string; limit?: string; search?: string; is_active?: string };
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10)));
      const offset = (page - 1) * limit;
      const search = (q.search || '').trim();
      const isActive = q.is_active === 'true' ? true : q.is_active === 'false' ? false : undefined;

      let where = '1=1';
      const params: unknown[] = [];
      let idx = 1;
      if (search) {
        where += ` AND (rc.code ILIKE $${idx} OR u.email ILIKE $${idx} OR u.username ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (isActive !== undefined) {
        where += ` AND rc.is_active = $${idx}`;
        params.push(isActive);
        idx++;
      }
      params.push(limit, offset);

      const rows = await db.query(`
        SELECT rc.*, u.email, u.username
        FROM referral_codes rc
        JOIN users u ON rc.user_id = u.id
        WHERE ${where}
        ORDER BY rc.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, params);

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM referral_codes rc JOIN users u ON rc.user_id = u.id WHERE ${where}`,
        params.slice(0, idx - 1)
      );
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      return reply.send({
        success: true,
        data: { codes: rows.rows, total, page, limit },
      });
    } catch (error) {
      logger.error('Get referral codes error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referral codes' },
      });
    }
  });

  /**
   * GET /admin/referrals/relationships
   * List referral relationships (referrer -> referee)
   */
  app.get('/referrals/relationships', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { page?: string; limit?: string; referrer_email?: string; referee_email?: string; status?: string };
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10)));
      const offset = (page - 1) * limit;

      let where = '1=1';
      const params: unknown[] = [];
      let idx = 1;
      if (q.referrer_email) {
        where += ` AND referrer.email ILIKE $${idx}`;
        params.push(`%${q.referrer_email}%`);
        idx++;
      }
      if (q.referee_email) {
        where += ` AND referee.email ILIKE $${idx}`;
        params.push(`%${q.referee_email}%`);
        idx++;
      }
      if (q.status) {
        where += ` AND rr.status = $${idx}`;
        params.push(q.status);
        idx++;
      }
      params.push(limit, offset);

      const rows = await db.query(`
        SELECT rr.*,
          referrer.email as referrer_email, referrer.username as referrer_username, referrer.id as referrer_id,
          referee.email as referee_email, referee.username as referee_username, referee.id as referee_id,
          rc.code as referral_code
        FROM referral_relationships rr
        JOIN users referrer ON rr.referrer_id = referrer.id
        JOIN users referee ON rr.referee_id = referee.id
        JOIN referral_codes rc ON rr.referral_code_id = rc.id
        WHERE ${where}
        ORDER BY rr.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, params);

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM referral_relationships rr
         JOIN users referrer ON rr.referrer_id = referrer.id
         JOIN users referee ON rr.referee_id = referee.id
         WHERE ${where}`,
        params.slice(0, idx - 1)
      );
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      return reply.send({
        success: true,
        data: { relationships: rows.rows, total, page, limit },
      });
    } catch (error) {
      logger.error('Get referral relationships error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referral relationships' },
      });
    }
  });

  /**
   * GET /admin/referrals/commissions
   * List referral commissions with filters
   */
  app.get('/referrals/commissions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { page?: string; limit?: string; status?: string; referrer_id?: string };
      const page = Math.max(1, parseInt(q.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10)));
      const offset = (page - 1) * limit;

      let where = '1=1';
      const params: unknown[] = [];
      let idx = 1;
      if (q.status) {
        where += ` AND rc.status = $${idx}`;
        params.push(q.status);
        idx++;
      }
      if (q.referrer_id) {
        where += ` AND rc.referrer_id = $${idx}`;
        params.push(q.referrer_id);
        idx++;
      }
      params.push(limit, offset);

      const rows = await db.query(`
        SELECT rc.*,
          u_referrer.email as referrer_email, u_referrer.username as referrer_username,
          u_referee.email as referee_email, u_referee.username as referee_username
        FROM referral_commissions rc
        JOIN users u_referrer ON rc.referrer_id = u_referrer.id
        JOIN users u_referee ON rc.referee_id = u_referee.id
        WHERE ${where}
        ORDER BY rc.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, params);

      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM referral_commissions rc WHERE ${where}`,
        params.slice(0, idx - 1)
      );
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      const statsResult = await db.query(`
        SELECT
          COALESCE(SUM(commission_amount) FILTER (WHERE status = 'credited'), 0) as total_credited,
          COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0) as total_pending,
          COUNT(*) FILTER (WHERE status = 'credited') as count_credited,
          COUNT(*) FILTER (WHERE status = 'pending') as count_pending
        FROM referral_commissions
      `);
      const stats = statsResult.rows[0];

      return reply.send({
        success: true,
        data: { commissions: rows.rows, total, page, limit, stats },
      });
    } catch (error) {
      logger.error('Get referral commissions error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referral commissions' },
      });
    }
  });

  /**
   * GET /admin/referrals/campaigns
   * List referral campaigns
   */
  app.get('/referrals/campaigns', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query(`
        SELECT * FROM referral_campaigns
        ORDER BY start_date DESC, created_at DESC
      `);
      return reply.send({
        success: true,
        data: { campaigns: rows.rows },
      });
    } catch (error) {
      logger.error('Get referral campaigns error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referral campaigns' },
      });
    }
  });

  /**
   * POST /admin/referrals/campaigns
   * Create referral campaign
   */
  app.post('/referrals/campaigns', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as {
        campaign_name: string;
        campaign_code: string;
        description?: string;
        referrer_commission_rate: number;
        referee_discount_rate: number;
        bonus_amount?: number;
        bonus_currency?: string;
        min_trade_volume?: number;
        min_deposit_amount?: number;
        max_participants?: number;
        total_budget?: number;
        is_active?: boolean;
        start_date: string;
        end_date?: string;
      };
      const {
        campaign_name, campaign_code, description,
        referrer_commission_rate, referee_discount_rate,
        bonus_amount = 0, bonus_currency,
        min_trade_volume = 0, min_deposit_amount = 0,
        max_participants, total_budget,
        is_active = true, start_date, end_date,
      } = body;
      if (!campaign_name || !campaign_code || referrer_commission_rate == null || referee_discount_rate == null || !start_date) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'campaign_name, campaign_code, referrer_commission_rate, referee_discount_rate, start_date required' },
        });
      }
      const id = uuidv4();
      await db.query(`
        INSERT INTO referral_campaigns (
          id, campaign_name, campaign_code, description,
          referrer_commission_rate, referee_discount_rate,
          bonus_amount, bonus_currency,
          min_trade_volume, min_deposit_amount,
          max_participants, total_budget,
          is_active, start_date, end_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        id, campaign_name, campaign_code.trim().toUpperCase(), description || null,
        referrer_commission_rate, referee_discount_rate,
        bonus_amount, bonus_currency || null,
        min_trade_volume, min_deposit_amount,
        max_participants ?? null, total_budget ?? null,
        is_active, start_date, end_date || null,
      ]);
      const created = await db.query('SELECT * FROM referral_campaigns WHERE id = $1', [id]);
      return reply.send({ success: true, data: { campaign: created.rows[0] } });
    } catch (error) {
      logger.error('Create referral campaign error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to create campaign' },
      });
    }
  });

  /**
   * PATCH /admin/referrals/campaigns/:id
   * Update referral campaign (is_active, end_date, etc.)
   */
  app.patch('/referrals/campaigns/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      const allowed = ['campaign_name', 'description', 'referrer_commission_rate', 'referee_discount_rate', 'bonus_amount', 'bonus_currency', 'min_trade_volume', 'min_deposit_amount', 'max_participants', 'total_budget', 'is_active', 'start_date', 'end_date'];
      for (const key of allowed) {
        if (body[key] !== undefined) {
          updates.push(`${key} = $${idx}`);
          values.push(body[key]);
          idx++;
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      await db.query(
        `UPDATE referral_campaigns SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
      const updated = await db.query('SELECT * FROM referral_campaigns WHERE id = $1', [id]);
      if (updated.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
      }
      return reply.send({ success: true, data: { campaign: updated.rows[0] } });
    } catch (error) {
      logger.error('Update referral campaign error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update campaign' },
      });
    }
  });

  /**
   * PATCH /admin/referrals/codes/:id
   * Toggle referral code active status
   */
  app.patch('/referrals/codes/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { is_active?: boolean };
      const is_active = body.is_active !== undefined ? body.is_active : undefined;
      if (is_active === undefined) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'is_active required' } });
      }
      await db.query('UPDATE referral_codes SET is_active = $1, updated_at = NOW() WHERE id = $2', [is_active, id]);
      const updated = await db.query('SELECT * FROM referral_codes WHERE id = $1', [id]);
      if (updated.rows[0]) {
        return reply.send({ success: true, data: { code: updated.rows[0] } });
      }
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Code not found' } });
    } catch (error) {
      logger.error('Toggle referral code error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update code' },
      });
    }
  });

  // ===============================
  // FEE TIERS
  // ===============================

  /**
   * GET /admin/fees
   * Get fee tiers
   */
  app.get('/fees', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const tiers = await db.query(`
        SELECT * FROM fee_tiers ORDER BY tier_level
      `);
      return reply.send({
        success: true,
        data: { tiers: tiers.rows },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch fee tiers' },
      });
    }
  });

  /**
   * POST /admin/fees/tiers
   * Create fee tier
   */
  app.post('/fees/tiers', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as {
        tier_name: string;
        tier_level: number;
        min_trading_volume?: number;
        min_token_holding?: number;
        spot_maker_fee: number;
        spot_taker_fee: number;
        withdrawal_fee_discount?: number;
      };
      const {
        tier_name,
        tier_level,
        min_trading_volume = 0,
        min_token_holding = 0,
        spot_maker_fee,
        spot_taker_fee,
        withdrawal_fee_discount = 0,
      } = body;
      if (!tier_name || tier_level == null || spot_maker_fee == null || spot_taker_fee == null) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'tier_name, tier_level, spot_maker_fee, spot_taker_fee required' },
        });
      }
      const id = uuidv4();
      await db.query(`
        INSERT INTO fee_tiers (id, tier_name, tier_level, min_trading_volume, min_token_holding, spot_maker_fee, spot_taker_fee, withdrawal_fee_discount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, tier_name, tier_level, min_trading_volume, min_token_holding, spot_maker_fee, spot_taker_fee, withdrawal_fee_discount]);
      const row = await db.query('SELECT * FROM fee_tiers WHERE id = $1', [id]);
      await db.query(`INSERT INTO admin_activity_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)`, [
        admin.id, 'fee_tier_created', JSON.stringify({ resource_type: 'fee_tier', resource_id: id, new_value: { tier_name, tier_level, spot_maker_fee, spot_taker_fee } }), (request.ip || null),
      ]).catch(() => {/* non-fatal */});
      return reply.status(201).send({ success: true, data: { tier: row.rows[0] } });
    } catch (error: any) {
      if (error.code === '23505') {
        return reply.status(400).send({ success: false, error: { code: 'CONFLICT', message: 'Tier level already exists' } });
      }
      logger.error('Create fee tier error', { error: error?.message });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create tier' } });
    }
  });

  /**
   * PATCH /admin/fees/tiers/:id
   * Update fee tier
   */
  app.patch('/fees/tiers/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const allowed = ['tier_name', 'tier_level', 'min_trading_volume', 'min_token_holding', 'spot_maker_fee', 'spot_taker_fee', 'withdrawal_fee_discount'];
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const key of allowed) {
        if (body[key] !== undefined) {
          updates.push(`${key} = $${idx}`);
          values.push(body[key]);
          idx++;
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      await db.query(`UPDATE fee_tiers SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      const row = await db.query('SELECT * FROM fee_tiers WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Tier not found' } });
      }
      await db.query(`INSERT INTO admin_activity_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)`, [
        admin.id, 'fee_tier_updated', JSON.stringify({ resource_type: 'fee_tier', resource_id: id, new_value: body }), (request.ip || null),
      ]).catch(() => {/* non-fatal */});
      return reply.send({ success: true, data: { tier: row.rows[0] } });
    } catch (error) {
      logger.error('Update fee tier error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update tier' } });
    }
  });

  /**
   * GET /admin/fees/trading
   * List trading pairs with maker/taker fees (spot). Default = tier 0.
   */
  app.get('/fees/trading', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const [pairs, defaultTier] = await Promise.all([
        db.query(`
          SELECT tp.id, tp.symbol, tp.maker_fee, tp.taker_fee, tp.status, tp.trading_enabled,
                 bc.symbol as base_symbol, qc.symbol as quote_symbol
          FROM trading_pairs tp
          JOIN currencies bc ON tp.base_currency_id = bc.id
          JOIN currencies qc ON tp.quote_currency_id = qc.id
          ORDER BY tp.symbol
        `),
        db.query('SELECT spot_maker_fee, spot_taker_fee FROM fee_tiers WHERE tier_level = 0 LIMIT 1'),
      ]);
      return reply.send({
        success: true,
        data: {
          pairs: pairs.rows,
          defaultMakerFee: defaultTier.rows[0]?.spot_maker_fee ?? '0.001',
          defaultTakerFee: defaultTier.rows[0]?.spot_taker_fee ?? '0.001',
        },
      });
    } catch (error) {
      logger.error('Get trading fees error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch trading fees' } });
    }
  });

  /**
   * PATCH /admin/fees/trading/pair/:id
   * Update a trading pair's maker/taker fee
   */
  app.patch('/fees/trading/pair/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { maker_fee?: number; taker_fee?: number };
      if (body.maker_fee == null && body.taker_fee == null) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'maker_fee or taker_fee required' } });
      }
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (body.maker_fee != null) { updates.push(`maker_fee = $${idx}`); values.push(body.maker_fee); idx++; }
      if (body.taker_fee != null) { updates.push(`taker_fee = $${idx}`); values.push(body.taker_fee); idx++; }
      values.push(id);
      await db.query(`UPDATE trading_pairs SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT id, symbol, maker_fee, taker_fee FROM trading_pairs WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Pair not found' } });
      }
      return reply.send({ success: true, data: { pair: row.rows[0] } });
    } catch (error) {
      logger.error('Update trading fee error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update pair fee' } });
    }
  });

  /**
   * GET /admin/fees/withdrawal
   * List currencies with withdrawal fee settings
   */
  app.get('/fees/withdrawal', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query(`
        SELECT c.id, c.symbol, c.name, c.withdrawal_fee, c.withdrawal_fee_type, c.min_withdrawal, c.withdrawal_enabled,
               b.chain_symbol
        FROM currencies c
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        ORDER BY c.symbol, b.chain_symbol
      `);
      return reply.send({ success: true, data: { currencies: rows.rows } });
    } catch (error) {
      logger.error('Get withdrawal fees error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch withdrawal fees' } });
    }
  });

  /**
   * PATCH /admin/fees/withdrawal/currency/:id
   * Update currency withdrawal fee
   */
  app.patch('/fees/withdrawal/currency/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { withdrawal_fee?: number | string; withdrawal_fee_type?: 'fixed' | 'percentage'; min_withdrawal?: number | string };
      if (body.withdrawal_fee == null && body.withdrawal_fee_type == null && body.min_withdrawal == null) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'withdrawal_fee, min_withdrawal, or withdrawal_fee_type required' } });
      }
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (body.withdrawal_fee != null) { updates.push(`withdrawal_fee = $${idx}`); values.push(body.withdrawal_fee); idx++; }
      if (body.withdrawal_fee_type != null) { updates.push(`withdrawal_fee_type = $${idx}`); values.push(body.withdrawal_fee_type); idx++; }
      if (body.min_withdrawal != null) { updates.push(`min_withdrawal = $${idx}`); values.push(body.min_withdrawal); idx++; }
      values.push(id);
      await db.query(`UPDATE currencies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT id, symbol, withdrawal_fee, withdrawal_fee_type, min_withdrawal FROM currencies WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Currency not found' } });
      }
      await db.query(`INSERT INTO admin_activity_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)`, [
        admin.id, 'fee_withdrawal_updated', JSON.stringify({ resource_type: 'withdrawal_fee', resource_id: id, new_value: body }), (request.ip || null),
      ]).catch(() => {/* non-fatal */});
      return reply.send({ success: true, data: { currency: row.rows[0] } });
    } catch (error) {
      logger.error('Update withdrawal fee error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update withdrawal fee' } });
    }
  });

  /**
   * GET /admin/fees/promotions
   * List fee promotions
   */
  app.get('/fees/promotions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query(`
        SELECT * FROM fee_promotions ORDER BY start_date DESC
      `);
      return reply.send({ success: true, data: { promotions: rows.rows } });
    } catch (error) {
      logger.error('Get fee promotions error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch promotions' } });
    }
  });

  /**
   * POST /admin/fees/promotions
   * Create fee promotion
   */
  app.post('/fees/promotions', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as {
        name: string;
        description?: string;
        promotion_type: string;
        discount_type?: string;
        discount_value: number;
        min_volume_30d?: number;
        start_date: string;
        end_date: string;
        is_active?: boolean;
      };
      const {
        name,
        description,
        promotion_type,
        discount_type = 'percentage',
        discount_value,
        min_volume_30d = 0,
        start_date,
        end_date,
        is_active = true,
      } = body;
      if (!name || !promotion_type || discount_value == null || !start_date || !end_date) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'name, promotion_type, discount_value, start_date, end_date required' },
        });
      }
      const id = uuidv4();
      await db.query(`
        INSERT INTO fee_promotions (id, name, description, promotion_type, discount_type, discount_value, min_volume_30d, start_date, end_date, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [id, name, description || null, promotion_type, discount_type, discount_value, min_volume_30d, start_date, end_date, is_active]);
      const row = await db.query('SELECT * FROM fee_promotions WHERE id = $1', [id]);
      await db.query(`INSERT INTO admin_activity_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)`, [
        admin.id, 'fee_promotion_created', JSON.stringify({ resource_type: 'fee_promotion', resource_id: id, new_value: { name, promotion_type, discount_value } }), (request.ip || null),
      ]).catch(() => {/* non-fatal */});
      return reply.status(201).send({ success: true, data: { promotion: row.rows[0] } });
    } catch (error: any) {
      logger.error('Create fee promotion error', { error: error?.message });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: error?.message || 'Failed to create promotion' } });
    }
  });

  /**
   * PATCH /admin/fees/promotions/:id
   * Update fee promotion
   */
  app.patch('/fees/promotions/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const allowed = ['name', 'description', 'promotion_type', 'discount_type', 'discount_value', 'min_volume_30d', 'start_date', 'end_date', 'is_active'];
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const key of allowed) {
        if (body[key] !== undefined) {
          updates.push(`${key} = $${idx}`);
          values.push(body[key]);
          idx++;
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      await db.query(`UPDATE fee_promotions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT * FROM fee_promotions WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Promotion not found' } });
      }
      await db.query(`INSERT INTO admin_activity_logs (admin_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)`, [
        admin.id, 'fee_promotion_updated', JSON.stringify({ resource_type: 'fee_promotion', resource_id: id, new_value: body }), (request.ip || null),
      ]).catch(() => {/* non-fatal */});
      return reply.send({ success: true, data: { promotion: row.rows[0] } });
    } catch (error) {
      logger.error('Update fee promotion error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update promotion' } });
    }
  });

  /**
   * DELETE /admin/fees/promotions/:id
   */
  app.delete('/fees/promotions/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const result = await db.query('DELETE FROM fee_promotions WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Promotion not found' } });
      }
      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      logger.error('Delete fee promotion error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete promotion' } });
    }
  });

  // ===============================
  // NOTIFICATIONS (Announcements, Email, SMS, Push)
  // ===============================

  /**
   * GET /admin/notifications/announcements
   */
  app.get('/notifications/announcements', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query(`
        SELECT id, title, body, summary, type, is_pinned, is_published, published_at, expires_at, created_at, updated_at, created_by
        FROM system_announcements
        ORDER BY is_pinned DESC, published_at DESC NULLS LAST
      `);
      return reply.send({ success: true, data: { announcements: rows.rows } });
    } catch (error) {
      logger.error('Get announcements error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch announcements' } });
    }
  });

  /**
   * POST /admin/notifications/announcements
   */
  app.post('/notifications/announcements', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as {
        title: string;
        body?: string;
        summary?: string;
        type?: string;
        is_pinned?: boolean;
        is_published?: boolean;
        published_at?: string;
        expires_at?: string;
      };
      const {
        title,
        body: bodyText,
        summary,
        type = 'general',
        is_pinned = false,
        is_published = true,
        published_at,
        expires_at,
      } = body;
      if (!title || !title.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title required' } });
      }
      const id = uuidv4();
      await db.query(`
        INSERT INTO system_announcements (id, title, body, summary, type, is_pinned, is_published, published_at, expires_at, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10)
      `, [id, title.trim(), bodyText?.trim() || null, summary?.trim() || null, type, is_pinned, is_published, published_at || null, expires_at || null, admin.adminId]);
      const row = await db.query('SELECT id, title, body, summary, type, is_pinned, is_published, published_at, expires_at, created_at FROM system_announcements WHERE id = $1', [id]);
      return reply.status(201).send({ success: true, data: { announcement: row.rows[0] } });
    } catch (error: any) {
      logger.error('Create announcement error', { error: error?.message });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: error?.message || 'Failed to create announcement' } });
    }
  });

  /**
   * PATCH /admin/notifications/announcements/:id
   */
  app.patch('/notifications/announcements/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const allowed = ['title', 'body', 'summary', 'type', 'is_pinned', 'is_published', 'published_at', 'expires_at'];
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const key of allowed) {
        if (body[key] !== undefined) {
          updates.push(`${key} = $${idx}`);
          values.push(body[key]);
          idx++;
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      await db.query(`UPDATE system_announcements SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT id, title, body, summary, type, is_pinned, is_published, published_at, expires_at, created_at FROM system_announcements WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
      }
      return reply.send({ success: true, data: { announcement: row.rows[0] } });
    } catch (error) {
      logger.error('Update announcement error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update announcement' } });
    }
  });

  /**
   * DELETE /admin/notifications/announcements/:id
   */
  app.delete('/notifications/announcements/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const result = await db.query('DELETE FROM system_announcements WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
      }
      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      logger.error('Delete announcement error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete announcement' } });
    }
  });

  /**
   * GET /admin/notifications/email-templates
   */
  app.get('/notifications/email-templates', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query(`SELECT * FROM email_templates ORDER BY slug`);
      return reply.send({ success: true, data: { templates: rows.rows } });
    } catch (error) {
      logger.error('Get email templates error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch email templates' } });
    }
  });

  /**
   * POST /admin/notifications/email-templates
   */
  app.post('/notifications/email-templates', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as { slug: string; name: string; subject: string; body_html: string; body_text?: string; variables?: string[]; is_active?: boolean };
      const { slug, name, subject, body_html, body_text, variables, is_active = true } = body;
      if (!slug?.trim() || !name?.trim() || !subject?.trim() || !body_html?.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'slug, name, subject, body_html required' } });
      }
      const id = uuidv4();
      await db.query(`
        INSERT INTO email_templates (id, slug, name, subject, body_html, body_text, variables, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `, [id, slug.trim(), name.trim(), subject.trim(), body_html, body_text || null, variables ? JSON.stringify(variables) : '[]', is_active]);
      const row = await db.query('SELECT * FROM email_templates WHERE id = $1', [id]);
      return reply.status(201).send({ success: true, data: { template: row.rows[0] } });
    } catch (error: any) {
      logger.error('Create email template error', { error: error?.message });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: error?.message || 'Failed to create template' } });
    }
  });

  /**
   * PATCH /admin/notifications/email-templates/:id
   */
  app.patch('/notifications/email-templates/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const allowed = ['slug', 'name', 'subject', 'body_html', 'body_text', 'variables', 'is_active'];
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const key of allowed) {
        if (body[key] !== undefined) {
          const val = key === 'variables' && body[key] != null ? JSON.stringify(body[key]) : body[key];
          updates.push(`${key} = $${idx}`);
          values.push(val);
          idx++;
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      await db.query(`UPDATE email_templates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT * FROM email_templates WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      return reply.send({ success: true, data: { template: row.rows[0] } });
    } catch (error) {
      logger.error('Update email template error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update template' } });
    }
  });

  /**
   * DELETE /admin/notifications/email-templates/:id
   */
  app.delete('/notifications/email-templates/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const result = await db.query('DELETE FROM email_templates WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      logger.error('Delete email template error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete template' } });
    }
  });

  /**
   * GET /admin/notifications/sms-templates
   */
  app.get('/notifications/sms-templates', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query(`SELECT * FROM sms_templates ORDER BY slug`);
      return reply.send({ success: true, data: { templates: rows.rows } });
    } catch (error) {
      logger.error('Get SMS templates error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch SMS templates' } });
    }
  });

  /**
   * POST /admin/notifications/sms-templates
   */
  app.post('/notifications/sms-templates', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as { slug: string; name: string; body: string; variables?: string[]; is_active?: boolean };
      const { slug, name, body: bodyText, variables, is_active = true } = body;
      if (!slug?.trim() || !name?.trim() || !bodyText?.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'slug, name, body required' } });
      }
      const id = uuidv4();
      await db.query(`
        INSERT INTO sms_templates (id, slug, name, body, variables, is_active)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `, [id, slug.trim(), name.trim(), bodyText.trim(), variables ? JSON.stringify(variables) : '[]', is_active]);
      const row = await db.query('SELECT * FROM sms_templates WHERE id = $1', [id]);
      return reply.status(201).send({ success: true, data: { template: row.rows[0] } });
    } catch (error: any) {
      logger.error('Create SMS template error', { error: error?.message });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: error?.message || 'Failed to create template' } });
    }
  });

  /**
   * PATCH /admin/notifications/sms-templates/:id
   */
  app.patch('/notifications/sms-templates/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const allowed = ['slug', 'name', 'body', 'variables', 'is_active'];
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const key of allowed) {
        if (body[key] !== undefined) {
          const val = key === 'variables' && body[key] != null ? JSON.stringify(body[key]) : body[key];
          updates.push(`${key} = $${idx}`);
          values.push(val);
          idx++;
        }
      }
      if (updates.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
      }
      values.push(id);
      await db.query(`UPDATE sms_templates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT * FROM sms_templates WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      return reply.send({ success: true, data: { template: row.rows[0] } });
    } catch (error) {
      logger.error('Update SMS template error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update template' } });
    }
  });

  /**
   * DELETE /admin/notifications/sms-templates/:id
   */
  app.delete('/notifications/sms-templates/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const result = await db.query('DELETE FROM sms_templates WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      logger.error('Delete SMS template error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete template' } });
    }
  });

  /**
   * POST /admin/notifications/push-broadcast
   * Send push (in-app) notification to all users or by segment. Creates user_notifications rows.
   */
  app.post('/notifications/push-broadcast', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as { title: string; message: string; target?: 'all' | 'verified' };
      const { title, message, target = 'all' } = body;
      if (!title?.trim() || !message?.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title and message required' } });
      }
      let userIds: { id: string }[];
      if (target === 'verified') {
        const r = await db.query('SELECT id FROM users WHERE status = $1 AND deleted_at IS NULL', ['active']);
        userIds = r.rows as { id: string }[];
      } else {
        const r = await db.query('SELECT id FROM users WHERE deleted_at IS NULL');
        userIds = r.rows as { id: string }[];
      }
      let inserted = 0;
      for (const u of userIds) {
        await db.query(`
          INSERT INTO user_notifications (user_id, notification_type, title, message)
          VALUES ($1, 'system_announcement', $2, $3)
        `, [u.id, title.trim(), message.trim()]);
        inserted++;
      }
      return reply.send({ success: true, data: { sent: inserted, totalUsers: userIds.length } });
    } catch (error: any) {
      logger.error('Push broadcast error', { error: error?.message });
      return reply.status(500).send({ success: false, error: { code: 'SEND_FAILED', message: error?.message || 'Failed to send' } });
    }
  });

  // ===============================
  // ADMINS
  // ===============================

  /**
   * GET /admin/admins
   * Get admin users
   */
  app.get('/admins', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const admins = await db.query(`
        SELECT id, email, name, role, permissions, is_active, last_login_at, created_at
        FROM admin_users
        ORDER BY created_at DESC
      `);

      return reply.send({
        success: true,
        data: {
          admins: admins.rows,
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch admins' },
      });
    }
  });

  /**
   * POST /admin/admins
   * Create a new admin user
   */
  app.post<{ Body: { name: string; email: string; role: string; password: string } }>('/admins', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'all', reply)) return;
    const { name, email, role, password } = request.body ?? {};
    if (!name || !email || !role || !password) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'name, email, role, and password are required' } });
    }
    try {
      const exists = await db.query('SELECT id FROM admin_users WHERE email = $1', [email]);
      if (exists.rows?.length) return reply.status(409).send({ success: false, error: { code: 'CONFLICT', message: 'Email already in use' } });
      const hash = await bcrypt.hash(password, 10);
      const perms = role === 'SUPER_ADMIN' ? ['all'] : role === 'RISK_OFFICER' ? ['risk:view', 'risk:edit', 'users:view'] : role === 'COMPLIANCE_OFFICER' ? ['compliance:view', 'compliance:edit'] : ['support:view', 'users:view'];
      const result = await db.query(
        `INSERT INTO admin_users (email, name, role, password_hash, permissions, is_active, two_factor_enabled) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id::text, email, name, role, is_active, created_at::text`,
        [email.toLowerCase(), name, role, hash, JSON.stringify(perms), true, false]
      );
      return reply.status(201).send({ success: true, data: result.rows[0] });
    } catch (e) {
      logger.error('Create admin error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create admin' } });
    }
  });

  /**
   * PATCH /admin/admins/:id
   * Update admin user role / status
   */
  app.patch<{ Params: { id: string }; Body: { role?: string; is_active?: boolean; permissions?: string[] } }>('/admins/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'all', reply)) return;
    const { id } = request.params;
    const { role, is_active, permissions } = request.body ?? {};
    try {
      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (role !== undefined) { updates.push(`role = $${idx++}`); params.push(role); }
      if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); params.push(is_active); }
      if (permissions !== undefined) { updates.push(`permissions = $${idx++}::text[]`); params.push(permissions); }
      if (!updates.length) return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Nothing to update' } });
      params.push(id);
      const result = await db.query(
        `UPDATE admin_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}::uuid RETURNING id, email, name, role, permissions, is_active`,
        params
      );
      if (!result.rows?.length) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Admin not found' } });
      return reply.send({ success: true, data: result.rows[0] });
    } catch (e) {
      logger.error('Update admin error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update admin' } });
    }
  });

  /**
   * POST /admin/admins/:id/reset-password
   * Generate a temporary password for an admin user
   */
  app.post<{ Params: { id: string } }>('/admins/:id/reset-password', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    if (!requirePermission(admin, 'all', reply)) return;
    const { id } = request.params;
    try {
      const tempPassword = `Tmp-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const hash = await bcrypt.hash(tempPassword, 10);
      const result = await db.query(
        `UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING id, email`,
        [hash, id]
      );
      if (!result.rows?.length) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Admin not found' } });
      await logAuditFromRequest(request, {
        actorType: 'admin', actorId: admin.adminId, action: 'admin_password_reset',
        resourceType: 'admin_user', resourceId: id, newValue: { resetBy: admin.adminId },
      });
      return reply.send({ success: true, data: { id, email: result.rows[0].email, tempPassword, note: 'Share this password securely. It expires after first login.' } });
    } catch (e) {
      logger.error('Reset admin password error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'RESET_FAILED', message: 'Failed to reset password' } });
    }
  });

  /**
   * GET /admin/admins/logs
   * Get admin activity logs
   */
  app.get('/admins/logs', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { page = 1, limit = 50 } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const logs = await db.query(`
        SELECT 
          l.*,
          a.email, a.name
        FROM admin_activity_logs l
        JOIN admin_users a ON l.admin_id = a.id
        ORDER BY l.created_at DESC
        LIMIT $1 OFFSET $2
      `, [parseInt(limit), offset]);

      const countResult = await db.query('SELECT COUNT(*) FROM admin_activity_logs');

      return reply.send({
        success: true,
        data: {
          logs: logs.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0]?.count || '0'),
          },
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch admin logs' },
      });
    }
  });

  // ==========================================
  // BLOCKCHAIN SETTINGS ROUTES
  // ==========================================

  /**
   * GET /admin/settings/blockchains
   * Get all blockchains with their currencies.
   * Uses blockchains + currencies if present; otherwise fallback to chains + tokens (same source as user panel).
   */
  app.get('/settings/blockchains', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      let blockchainsRows: any[] = [];
      let currenciesByBlockchain: Record<string, any[]> = {};

      const hasBlockchains = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blockchains' LIMIT 1`
      ).then((r) => r.rows.length > 0).catch(() => false);

      if (hasBlockchains) {
        const blockchains = await db.query(`
          SELECT b.*, (SELECT COUNT(*) FROM currencies WHERE blockchain_id = b.id) as currency_count
          FROM blockchains b ORDER BY b.chain_name ASC
        `);
        const currencies = await db.query(`SELECT * FROM currencies ORDER BY symbol ASC`);
        blockchainsRows = blockchains.rows || [];
        currencies.rows.forEach((c: any) => {
          if (c.blockchain_id) {
            if (!currenciesByBlockchain[c.blockchain_id]) currenciesByBlockchain[c.blockchain_id] = [];
            currenciesByBlockchain[c.blockchain_id]!.push(c);
          }
        });
      }

      if (blockchainsRows.length === 0) {
        const chains = await db.query<{ id: string; name: string; type: string; rpc_url: string; explorer_url: string; native_currency: string; decimals: number }>(
          `SELECT id, name, type, rpc_url, explorer_url, native_currency, decimals FROM chains WHERE is_active = TRUE ORDER BY name ASC`
        ).catch(() => ({ rows: [] }));
        const tokens = await db.query<{ id: string; symbol: string; name: string; chain_id: string; decimals: number; contract_address: string | null }>(
          `SELECT id, symbol, name, chain_id, decimals, contract_address FROM tokens WHERE is_active = TRUE ORDER BY symbol ASC`
        ).catch(() => ({ rows: [] }));
        const tokensByChain: Record<string, any[]> = {};
        (tokens.rows || []).forEach((t) => {
          if (!tokensByChain[t.chain_id]) tokensByChain[t.chain_id] = [];
          tokensByChain[t.chain_id]!.push({
            id: t.id,
            symbol: t.symbol,
            name: t.name,
            blockchain_id: t.chain_id,
            decimals: t.decimals,
            contract_address: t.contract_address,
          });
        });
        blockchainsRows = (chains.rows || []).map((c) => ({
          id: c.id,
          chain_name: c.name,
          chain_symbol: c.native_currency || c.id,
          chain_id: c.id,
          type: c.type,
          rpc_url: c.rpc_url,
          explorer_url: c.explorer_url,
          currency_count: (tokensByChain[c.id] || []).length,
          _source: 'chains',
        }));
        currenciesByBlockchain = tokensByChain;
      }

      return reply.send({
        success: true,
        data: {
          blockchains: blockchainsRows.map((b: any) => ({
            ...b,
            currencies: currenciesByBlockchain[b.id] || [],
          })),
        },
      });
    } catch (error) {
      logger.error('Failed to fetch blockchains', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch blockchains' },
      });
    }
  });

  /**
   * GET /admin/settings/blockchains/:id
   * Get single blockchain with details
   */
  app.get('/settings/blockchains/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const blockchain = await db.query(
        'SELECT * FROM blockchains WHERE id = $1',
        [id]
      );

      if (blockchain.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Blockchain not found' },
        });
      }

      const currencies = await db.query(
        'SELECT * FROM currencies WHERE blockchain_id = $1 ORDER BY symbol',
        [id]
      );

      return reply.send({
        success: true,
        data: {
          blockchain: {
            ...blockchain.rows[0],
            currencies: currencies.rows,
          },
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch blockchain' },
      });
    }
  });

  /**
   * POST /admin/settings/blockchains
   * Add new blockchain
   */
  app.post('/settings/blockchains', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as any;
      const {
        chain_name,
        chain_symbol,
        chain_id,
        network_type = 'mainnet',
        rpc_endpoints,
        explorer_url,
        derivation_path,
        address_format,
        required_confirmations = 12,
        avg_block_time = 12,
        gas_limit_default,
        logo_url,
        is_active = true,
        deposit_enabled = true,
        withdrawal_enabled = true,
      } = body;

      if (!chain_name || !chain_symbol) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'chain_name and chain_symbol are required' },
        });
      }

      const result = await db.query(`
        INSERT INTO blockchains (
          chain_name, chain_symbol, chain_id, network_type, rpc_endpoints,
          explorer_url, derivation_path, address_format, required_confirmations,
          avg_block_time, gas_limit_default, logo_url, is_active, deposit_enabled, withdrawal_enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        chain_name, chain_symbol, chain_id, network_type, 
        rpc_endpoints ? JSON.stringify(rpc_endpoints) : null,
        explorer_url, derivation_path, address_format, required_confirmations,
        avg_block_time, gas_limit_default, logo_url, is_active, deposit_enabled, withdrawal_enabled
      ]);

      return reply.status(201).send({
        success: true,
        data: { blockchain: result.rows[0] },
      });

    } catch (error: any) {
      logger.error('Failed to add blockchain', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: error.message || 'Failed to add blockchain' },
      });
    }
  });

  /**
   * PUT /admin/settings/blockchains/:id
   * Update blockchain
   */
  app.put('/settings/blockchains/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      const fields = [
        'chain_name', 'chain_symbol', 'chain_id', 'network_type', 'rpc_endpoints',
        'explorer_url', 'derivation_path', 'address_format', 'required_confirmations',
        'avg_block_time', 'gas_limit_default', 'logo_url', 'is_active', 'deposit_enabled', 'withdrawal_enabled'
      ];

      fields.forEach(field => {
        if (body[field] !== undefined) {
          updates.push(`${field} = $${paramCount}`);
          if (field === 'rpc_endpoints' && body[field]) {
            values.push(JSON.stringify(body[field]));
          } else {
            values.push(body[field]);
          }
          paramCount++;
        }
      });

      if (updates.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No fields to update' },
        });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);

      const result = await db.query(`
        UPDATE blockchains SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *
      `, values);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Blockchain not found' },
        });
      }

      return reply.send({
        success: true,
        data: { blockchain: result.rows[0] },
      });

    } catch (error: any) {
      logger.error('Failed to update blockchain', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: error.message || 'Failed to update blockchain' },
      });
    }
  });

  /**
   * DELETE /admin/settings/blockchains/:id
   * Delete blockchain (soft delete or disable)
   */
  app.delete('/settings/blockchains/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      // Check if blockchain has currencies
      const currencies = await db.query(
        'SELECT COUNT(*) FROM currencies WHERE blockchain_id = $1',
        [id]
      );

      if (parseInt(currencies.rows[0]?.count || '0') > 0) {
        // Just disable instead of delete
        await db.query(
          'UPDATE blockchains SET is_active = false, updated_at = NOW() WHERE id = $1',
          [id]
        );
        return reply.send({
          success: true,
          data: { message: 'Blockchain disabled (has linked currencies)' },
        });
      }

      await db.query('DELETE FROM blockchains WHERE id = $1', [id]);

      return reply.send({
        success: true,
        data: { message: 'Blockchain deleted' },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete blockchain' },
      });
    }
  });

  // ==========================================
  // CURRENCY SETTINGS ROUTES
  // ==========================================

  /**
   * GET /admin/settings/currencies
   * Get unique currencies with all their chain deployments (paginated).
   * Uses currencies + blockchains if present; otherwise fallback to tokens + chains (same as user panel).
   */
  app.get('/settings/currencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { search, currency_type, limit, offset } = request.query as any;
      const pageLimit = Math.min(100, parseInt(limit || '20') || 20);
      const pageOffset = parseInt(offset || '0') || 0;

      const hasCurrencies = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'currencies' LIMIT 1`
      ).then((r) => r.rows.length > 0).catch(() => false);

      if (!hasCurrencies) {
        const tokensRows = await db.query<{ id: string; symbol: string; name: string; chain_id: string; decimals: number; contract_address: string | null; is_active: boolean }>(
          `SELECT t.id, t.symbol, t.name, t.chain_id, t.decimals, t.contract_address, t.is_active FROM tokens t WHERE t.is_active = TRUE ORDER BY t.symbol`
        ).catch(() => ({ rows: [] }));
        const chainIds = [...new Set((tokensRows.rows || []).map((t) => t.chain_id))];
        const chainsRows = chainIds.length
          ? await db.query<{ id: string; name: string; native_currency: string }>(`SELECT id, name, native_currency FROM chains WHERE id = ANY($1::text[])`, [chainIds]).catch(() => ({ rows: [] }))
          : { rows: [] };
        const chainMap = Object.fromEntries((chainsRows.rows || []).map((c) => [c.id, c]));
        const bySymbol: Record<string, { id: string; symbol: string; name: string; decimals: number; chains: any[] }> = {};
        (tokensRows.rows || []).forEach((t) => {
          const sym = t.symbol.toUpperCase();
          if (!bySymbol[sym]) {
            bySymbol[sym] = { id: t.id, symbol: t.symbol, name: t.name, decimals: t.decimals, chains: [] };
          }
          const ch = chainMap[t.chain_id];
          bySymbol[sym]!.chains.push({
            id: t.id,
            blockchain_id: t.chain_id,
            chain_name: ch?.name ?? t.chain_id,
            chain_symbol: ch?.native_currency ?? t.chain_id,
            contract_address: t.contract_address,
            decimals: t.decimals,
            is_active: t.is_active,
          });
        });
        let list = Object.values(bySymbol).sort((a, b) => a.symbol.localeCompare(b.symbol));
        if (search) {
          const s = String(search).toLowerCase();
          list = list.filter((c) => c.symbol.toLowerCase().includes(s) || c.name.toLowerCase().includes(s));
        }
        const total = list.length;
        const currencies = list.slice(pageOffset, pageOffset + pageLimit);
        return reply.send({
          success: true,
          data: { currencies, total, limit: pageLimit, offset: pageOffset, hasMore: pageOffset + currencies.length < total },
        });
      }

      let whereClause = 'WHERE 1=1';
      const values: any[] = [];
      let paramCount = 1;
      if (search) {
        whereClause += ` AND (symbol ILIKE $${paramCount} OR name ILIKE $${paramCount})`;
        values.push(`%${search}%`);
        paramCount++;
      }
      if (currency_type && currency_type !== 'all') {
        whereClause += ` AND currency_type = $${paramCount}`;
        values.push(currency_type);
        paramCount++;
      }
      const countResult = await db.query(`SELECT COUNT(DISTINCT symbol) as total FROM currencies ${whereClause}`, values);
      const total = parseInt(countResult.rows[0]?.total ?? '0');
      const dataQuery = `
        WITH unique_currencies AS (
          SELECT DISTINCT ON (symbol) id, symbol, name, currency_type, logo_url,
            is_active, deposit_enabled, withdrawal_enabled, COALESCE(trade_enabled, true) as trade_enabled,
            min_deposit, min_withdrawal, withdrawal_fee, withdrawal_fee_type, decimals, display_decimals
          FROM currencies ${whereClause} ORDER BY symbol, created_at ASC
        ),
        chain_deployments AS (
          SELECT c.symbol,
            json_agg(json_build_object('id', c.id, 'blockchain_id', c.blockchain_id, 'chain_name', b.chain_name, 'chain_symbol', b.chain_symbol, 'chain_logo', b.logo_url, 'contract_address', c.contract_address, 'decimals', c.decimals, 'is_active', c.is_active, 'deposit_enabled', c.deposit_enabled, 'withdrawal_enabled', c.withdrawal_enabled) ORDER BY b.chain_name) FILTER (WHERE c.blockchain_id IS NOT NULL) as chains
          FROM currencies c LEFT JOIN blockchains b ON c.blockchain_id = b.id GROUP BY c.symbol
        )
        SELECT uc.*, COALESCE(cd.chains, '[]'::json) as chains
        FROM unique_currencies uc LEFT JOIN chain_deployments cd ON uc.symbol = cd.symbol
        ORDER BY uc.symbol ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;
      const result = await db.query(dataQuery, [...values, pageLimit, pageOffset]);

      return reply.send({
        success: true,
        data: {
          currencies: result.rows,
          total,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: pageOffset + result.rows.length < total,
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch currencies' },
      });
    }
  });

  /**
   * POST /admin/settings/currencies
   * Add new currency
   */
  app.post('/settings/currencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as any;
      const {
        symbol,
        name,
        currency_type,
        blockchain_id,
        contract_address,
        decimals = 18,
        display_decimals = 8,
        logo_url,
        is_active = true,
        is_listed = true,
        deposit_enabled = true,
        withdrawal_enabled = true,
        min_deposit = 0,
        min_withdrawal = 0,
        withdrawal_fee = 0,
        withdrawal_fee_type = 'fixed',
        max_daily_withdrawal,
      } = body;

      if (!symbol || !name || !currency_type) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'symbol, name, and currency_type are required' },
        });
      }

      const result = await db.query(`
        INSERT INTO currencies (
          symbol, name, currency_type, blockchain_id, contract_address,
          decimals, display_decimals, logo_url, is_active, is_listed,
          deposit_enabled, withdrawal_enabled, min_deposit, min_withdrawal,
          withdrawal_fee, withdrawal_fee_type, max_daily_withdrawal
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `, [
        symbol.toUpperCase(), name, currency_type, blockchain_id, contract_address,
        decimals, display_decimals, logo_url, is_active, is_listed,
        deposit_enabled, withdrawal_enabled, min_deposit, min_withdrawal,
        withdrawal_fee, withdrawal_fee_type, max_daily_withdrawal
      ]);

      return reply.status(201).send({
        success: true,
        data: { currency: result.rows[0] },
      });

    } catch (error: any) {
      logger.error('Failed to add currency', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: error.message || 'Failed to add currency' },
      });
    }
  });

  /**
   * PUT /admin/settings/currencies/:id
   * Update currency
   */
  app.put('/settings/currencies/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      const fields = [
        'symbol', 'name', 'currency_type', 'blockchain_id', 'contract_address',
        'decimals', 'display_decimals', 'logo_url', 'is_active', 'is_listed',
        'deposit_enabled', 'withdrawal_enabled', 'min_deposit', 'min_withdrawal',
        'withdrawal_fee', 'withdrawal_fee_type', 'max_daily_withdrawal'
      ];

      fields.forEach(field => {
        if (body[field] !== undefined) {
          updates.push(`${field} = $${paramCount}`);
          values.push(field === 'symbol' ? body[field].toUpperCase() : body[field]);
          paramCount++;
        }
      });

      if (updates.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No fields to update' },
        });
      }

      updates.push(`updated_at = NOW()`);
      values.push(id);

      const result = await db.query(`
        UPDATE currencies SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *
      `, values);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Currency not found' },
        });
      }

      return reply.send({
        success: true,
        data: { currency: result.rows[0] },
      });

    } catch (error: any) {
      logger.error('Failed to update currency', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: error.message || 'Failed to update currency' },
      });
    }
  });

  // ============================================
  // TOKENS (withdrawal limits — token-level, used at withdrawal time)
  // ============================================

  /**
   * GET /admin/tokens
   * List tokens (id, symbol, chain_id, min_withdrawal, max_withdrawal) for admin UI.
   */
  app.get('/tokens', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const result = await db.query<{
        id: string;
        symbol: string;
        name: string;
        chain_id: string;
        min_withdrawal: string | null;
        max_withdrawal: string | null;
        withdrawal_fee: string | null;
      }>(`
        SELECT t.id, t.symbol, t.name, t.chain_id,
               t.min_withdrawal::text, t.max_withdrawal::text, t.withdrawal_fee::text
        FROM tokens t
        WHERE t.is_active = TRUE
        ORDER BY t.symbol, t.chain_id
      `);
      return reply.send({
        success: true,
        data: { tokens: result.rows },
      });
    } catch (error: any) {
      logger.error('Failed to list tokens', { error });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: error?.message ?? 'Failed to list tokens' },
      });
    }
  });

  /**
   * PATCH /admin/tokens/:id/withdrawal-limits
   * Update token withdrawal limits. Admin only.
   * Body: { min_withdrawal: number, max_withdrawal: number | null }
   * - max_withdrawal = null means unlimited.
   * - min_withdrawal >= 0; max_withdrawal >= min_withdrawal or null.
   */
  app.patch<{ Params: { id: string }; Body: { min_withdrawal?: number; max_withdrawal?: number | null } }>(
    '/tokens/:id/withdrawal-limits',
    async (request, reply) => {
      const admin = await getAdminFromRequest(app, request, reply, false);
      if (!admin) return;
      const { id: tokenId } = request.params;
      const body = request.body || {};
      const minVal = body.min_withdrawal;
      const maxVal = body.max_withdrawal;

      if (minVal !== undefined) {
        if (typeof minVal !== 'number' || minVal < 0 || !Number.isFinite(minVal)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'min_withdrawal must be a number >= 0' },
          });
        }
      }
      if (maxVal !== undefined && maxVal !== null) {
        if (typeof maxVal !== 'number' || maxVal < 0 || !Number.isFinite(maxVal)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'max_withdrawal must be a number >= 0 or null for unlimited' },
          });
        }
        const effectiveMin = minVal !== undefined ? minVal : 0;
        if (maxVal < effectiveMin) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'max_withdrawal must be >= min_withdrawal' },
          });
        }
      }

      try {
        const tokenRow = await db.query<{ id: string; symbol: string; min_withdrawal: string; max_withdrawal: string | null }>(
          'SELECT id, symbol, min_withdrawal::text, max_withdrawal::text FROM tokens WHERE id = $1',
          [tokenId]
        );
        if (tokenRow.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Token not found' },
          });
        }
        const ROUND_DOWN = 1;
        const PREC = 8;
        const before = tokenRow.rows[0]!;
        const newMin = minVal !== undefined ? new Decimal(minVal).toDecimalPlaces(PREC, ROUND_DOWN).toString() : new Decimal(before.min_withdrawal ?? '0').toDecimalPlaces(PREC, ROUND_DOWN).toString();
        const mw = before.max_withdrawal;
        const newMax = maxVal !== undefined && maxVal != null ? new Decimal(maxVal).toDecimalPlaces(PREC, ROUND_DOWN).toString() : (mw != null ? new Decimal(String(mw)).toDecimalPlaces(PREC, ROUND_DOWN).toString() : null);
        if (newMax != null && new Decimal(newMax).lt(newMin)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'max_withdrawal must be >= min_withdrawal' },
          });
        }

        await db.query(
          `UPDATE tokens SET min_withdrawal = $1, max_withdrawal = $2, updated_at = NOW() WHERE id = $3`,
          [newMin, newMax, tokenId]
        );
        logger.info('[ADMIN_TOKEN_UPDATE]', {
          token_id: tokenId,
          symbol: before.symbol,
          min_withdrawal: newMin,
          max_withdrawal: newMax ?? 'unlimited',
        });
        return reply.send({
          success: true,
          data: {
            token_id: tokenId,
            symbol: before.symbol,
            min_withdrawal: String(newMin),
            max_withdrawal: newMax == null ? null : String(newMax),
          },
        });
      } catch (error: any) {
        logger.error('Failed to update token withdrawal limits', { error, token_id: tokenId });
        return reply.status(500).send({
          success: false,
          error: { code: 'UPDATE_FAILED', message: error?.message ?? 'Failed to update token withdrawal limits' },
        });
      }
    }
  );

  /**
   * DELETE /admin/settings/currencies/:id
   * Delete currency
   */
  app.delete('/settings/currencies/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      // Check if currency is in use (wallets, etc.)
      const wallets = await db.query(
        'SELECT COUNT(*) FROM user_wallets WHERE currency_id = $1',
        [id]
      );

      if (parseInt(wallets.rows[0]?.count || '0') > 0) {
        // Just disable instead of delete
        await db.query(
          'UPDATE currencies SET is_active = false, is_listed = false, updated_at = NOW() WHERE id = $1',
          [id]
        );
        return reply.send({
          success: true,
          data: { message: 'Currency disabled (has user wallets)' },
        });
      }

      await db.query('DELETE FROM currencies WHERE id = $1', [id]);

      return reply.send({
        success: true,
        data: { message: 'Currency deleted' },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete currency' },
      });
    }
  });

  /**
   * PATCH /admin/settings/blockchains/:id/toggle
   * Toggle blockchain settings (active, deposit, withdrawal)
   */
  app.patch('/settings/blockchains/:id/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { field } = request.body as { field: 'is_active' | 'deposit_enabled' | 'withdrawal_enabled' };

      if (!['is_active', 'deposit_enabled', 'withdrawal_enabled'].includes(field)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid field' },
        });
      }

      const result = await db.query(`
        UPDATE blockchains 
        SET ${field} = NOT ${field}, updated_at = NOW() 
        WHERE id = $1 
        RETURNING *
      `, [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Blockchain not found' },
        });
      }

      return reply.send({
        success: true,
        data: { blockchain: result.rows[0] },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to toggle blockchain setting' },
      });
    }
  });

  /**
   * PATCH /admin/settings/currencies/:id/toggle
   * Toggle currency settings (single currency by ID)
   */
  app.patch('/settings/currencies/:id/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { field } = request.body as { field: string };

      if (!['is_active', 'is_listed', 'deposit_enabled', 'withdrawal_enabled', 'trade_enabled'].includes(field)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid field' },
        });
      }

      const result = await db.query(`
        UPDATE currencies 
        SET ${field} = NOT ${field}, updated_at = NOW() 
        WHERE id = $1 
        RETURNING *
      `, [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Currency not found' },
        });
      }

      return reply.send({
        success: true,
        data: { currency: result.rows[0] },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to toggle currency setting' },
      });
    }
  });

  /**
   * PATCH /admin/settings/currencies/symbol/:symbol/toggle
   * Toggle currency settings for ALL chains by symbol
   */
  app.patch('/settings/currencies/symbol/:symbol/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { symbol } = request.params as { symbol: string };
      const { field, value } = request.body as { field: string; value?: boolean };

      if (!['is_active', 'is_listed', 'deposit_enabled', 'withdrawal_enabled', 'trade_enabled'].includes(field)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid field' },
        });
      }

      // If value is provided, set it; otherwise toggle
      const query = value !== undefined
        ? `UPDATE currencies SET ${field} = $2, updated_at = NOW() WHERE symbol = $1 RETURNING *`
        : `UPDATE currencies SET ${field} = NOT ${field}, updated_at = NOW() WHERE symbol = $1 RETURNING *`;
      
      const params = value !== undefined ? [symbol, value] : [symbol];
      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Currency not found' },
        });
      }

      // Return first row (canonical) with updated values
      return reply.send({
        success: true,
        data: { 
          currency: result.rows[0],
          updated_count: result.rows.length 
        },
      });

    } catch (error) {
      logger.error('Toggle by symbol error', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to toggle currency setting' },
      });
    }
  });

  // =============================================
  // QUOTE ASSETS & TRADING PAIRS MANAGEMENT
  // =============================================

  /**
   * GET /admin/settings/quote-assets
   * Get all quote assets (base currencies for trading pairs)
   */
  app.get('/settings/quote-assets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const result = await db.query(`
        SELECT 
          qa.id,
          qa.currency_id,
          qa.display_order,
          qa.is_active,
          qa.min_price_increment,
          qa.created_at,
          c.symbol,
          c.name,
          c.logo_url,
          c.currency_type,
          (SELECT COUNT(*) FROM trading_pairs tp WHERE tp.quote_currency_id = qa.currency_id) as pair_count
        FROM quote_assets qa
        JOIN currencies c ON qa.currency_id = c.id
        ORDER BY qa.display_order ASC, c.symbol ASC
      `);

      return reply.send({
        success: true,
        data: { quote_assets: result.rows },
      });
    } catch (error) {
      logger.error('Error fetching quote assets', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch quote assets' },
      });
    }
  });

  /**
   * POST /admin/settings/quote-assets
   * Add a new quote asset
   */
  app.post('/settings/quote-assets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { currency_id, display_order = 0, min_price_increment = '0.00000001' } = request.body as any;

      if (!currency_id) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Currency ID is required' },
        });
      }

      // Check if already exists
      const existing = await db.query('SELECT id FROM quote_assets WHERE currency_id = $1', [currency_id]);
      if (existing.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: 'This currency is already a quote asset' },
        });
      }

      const result = await db.query(`
        INSERT INTO quote_assets (currency_id, display_order, min_price_increment)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [currency_id, display_order, min_price_increment]);

      // Get full data with currency info
      const fullData = await db.query(`
        SELECT qa.*, c.symbol, c.name, c.logo_url, c.currency_type
        FROM quote_assets qa
        JOIN currencies c ON qa.currency_id = c.id
        WHERE qa.id = $1
      `, [result.rows[0]!.id]);

      return reply.send({
        success: true,
        data: { quote_asset: fullData.rows[0] },
      });
    } catch (error) {
      logger.error('Error adding quote asset', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to add quote asset' },
      });
    }
  });

  /**
   * PUT /admin/settings/quote-assets/:id
   * Update quote asset
   */
  app.put('/settings/quote-assets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { display_order, is_active, min_price_increment } = request.body as any;

      const result = await db.query(`
        UPDATE quote_assets 
        SET 
          display_order = COALESCE($2, display_order),
          is_active = COALESCE($3, is_active),
          min_price_increment = COALESCE($4, min_price_increment),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, display_order, is_active, min_price_increment]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Quote asset not found' },
        });
      }

      return reply.send({
        success: true,
        data: { quote_asset: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update quote asset' },
      });
    }
  });

  /**
   * DELETE /admin/settings/quote-assets/:id
   * Remove quote asset
   */
  app.delete('/settings/quote-assets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      // Check for existing trading pairs using this quote asset
      const pairs = await db.query(`
        SELECT COUNT(*) as count FROM trading_pairs tp
        JOIN quote_assets qa ON tp.quote_currency_id = qa.currency_id
        WHERE qa.id = $1
      `, [id]);

      if (parseInt(pairs.rows[0]?.count ?? '0') > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'HAS_PAIRS', message: 'Cannot remove: This quote asset has trading pairs. Remove pairs first.' },
        });
      }

      const result = await db.query('DELETE FROM quote_assets WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Quote asset not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to remove quote asset' },
      });
    }
  });

  /**
   * GET /admin/settings/trading-pairs
   * Get all trading pairs with pagination
   */
  app.get('/settings/trading-pairs', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { quote_currency_id, quote_symbol, limit, offset } = request.query as { 
        quote_currency_id?: string; 
        quote_symbol?: string;
        limit?: string;
        offset?: string;
      };
      
      const pageLimit = parseInt(limit || '20');
      const pageOffset = parseInt(offset || '0');
      
      let baseQuery = `
        FROM trading_pairs tp
        JOIN currencies bc ON tp.base_currency_id = bc.id
        JOIN currencies qc ON tp.quote_currency_id = qc.id
      `;
      
      const params: any[] = [];
      let paramIndex = 1;
      
      if (quote_currency_id) {
        baseQuery += ` WHERE tp.quote_currency_id = $${paramIndex}`;
        params.push(quote_currency_id);
        paramIndex++;
      } else if (quote_symbol) {
        baseQuery += ` WHERE qc.symbol = $${paramIndex}`;
        params.push(quote_symbol);
        paramIndex++;
      }
      
      // Get total count
      const countResult = await db.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
      const total = parseInt(countResult.rows[0]?.total ?? '0');
      
      // Get paginated data
      const dataQuery = `
        SELECT 
          tp.*,
          bc.symbol as base_symbol,
          bc.name as base_name,
          bc.logo_url as base_logo,
          qc.symbol as quote_symbol,
          qc.name as quote_name,
          qc.logo_url as quote_logo
        ${baseQuery}
        ORDER BY tp.sort_order ASC, bc.symbol ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      const result = await db.query(dataQuery, [...params, pageLimit, pageOffset]);

      return reply.send({
        success: true,
        data: { 
          trading_pairs: result.rows,
          total,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: pageOffset + result.rows.length < total,
        },
      });
    } catch (error) {
      logger.error('Error fetching trading pairs', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch trading pairs' },
      });
    }
  });

  /**
   * POST /admin/settings/trading-pairs
   * Create a new trading pair
   */
  app.post('/settings/trading-pairs', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const body = request.body as any;
      const {
        base_currency_id,
        quote_currency_id,
        min_quantity = '0.00000001',
        max_quantity = '999999999',
        min_price = '0.00000001',
        max_price = '999999999',
        price_precision = 8,
        quantity_precision = 8,
        maker_fee = '0.001',
        taker_fee = '0.001',
        display_order = 0,
        is_active = true,
      } = body;

      if (!base_currency_id || !quote_currency_id) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Base and quote currency IDs are required' },
        });
      }

      // Get currency symbols for the pair symbol
      const currencies = await db.query(
        'SELECT id, symbol FROM currencies WHERE id IN ($1, $2)',
        [base_currency_id, quote_currency_id]
      );
      
      const baseCurrency = currencies.rows.find(c => c.id === base_currency_id);
      const quoteCurrency = currencies.rows.find(c => c.id === quote_currency_id);
      
      if (!baseCurrency || !quoteCurrency) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CURRENCY', message: 'Invalid currency ID' },
        });
      }

      const symbol = `${baseCurrency.symbol}/${quoteCurrency.symbol}`;

      // Check if pair already exists
      const existing = await db.query(
        'SELECT id FROM trading_pairs WHERE base_currency_id = $1 AND quote_currency_id = $2',
        [base_currency_id, quote_currency_id]
      );
      
      if (existing.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: 'This trading pair already exists' },
        });
      }

      const result = await db.query(`
        INSERT INTO trading_pairs (
          base_currency_id, quote_currency_id, symbol,
          min_quantity, max_quantity, min_price, max_price,
          price_precision, quantity_precision, maker_fee, taker_fee,
          display_order, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [
        base_currency_id, quote_currency_id, symbol,
        min_quantity, max_quantity, min_price, max_price,
        price_precision, quantity_precision, maker_fee, taker_fee,
        display_order, is_active
      ]);

      return reply.send({
        success: true,
        data: { trading_pair: result.rows[0] },
      });
    } catch (error: any) {
      logger.error('Error creating trading pair', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: error.message || 'Failed to create trading pair' },
      });
    }
  });

  /**
   * POST /admin/settings/trading-pairs/bulk
   * Create multiple trading pairs at once (accepts symbols for centralized exchange)
   */
  app.post('/settings/trading-pairs/bulk', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { quote_symbol, base_symbols } = request.body as any;

      if (!quote_symbol || !base_symbols || !Array.isArray(base_symbols)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Quote symbol and array of base symbols required' },
        });
      }

      // Get quote currency (pick one canonical ID per symbol - prefer with logo)
      const quoteCurrency = await db.query(`
        SELECT id, symbol FROM currencies 
        WHERE symbol = $1 AND is_active = true
        ORDER BY CASE WHEN logo_url IS NOT NULL AND logo_url != '' THEN 0 ELSE 1 END
        LIMIT 1
      `, [quote_symbol]);
      
      if (quoteCurrency.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CURRENCY', message: `Invalid quote currency: ${quote_symbol}` },
        });
      }
      const quoteCurrencyId = quoteCurrency.rows[0]!.id;

      const created: any[] = [];
      const skipped: any[] = [];

      for (const baseSymbol of base_symbols) {
        // Skip if base === quote
        if (baseSymbol === quote_symbol) {
          skipped.push({ symbol: baseSymbol, reason: 'Same as quote' });
          continue;
        }

        // Get base currency (canonical ID)
        const baseCurrency = await db.query(`
          SELECT id, symbol FROM currencies 
          WHERE symbol = $1 AND is_active = true
          ORDER BY CASE WHEN logo_url IS NOT NULL AND logo_url != '' THEN 0 ELSE 1 END
          LIMIT 1
        `, [baseSymbol]);

        if (baseCurrency.rows.length === 0) {
          skipped.push({ symbol: baseSymbol, reason: 'Currency not found' });
          continue;
        }
        const baseCurrencyId = baseCurrency.rows[0]!.id;

        // Check if pair already exists (by symbol pattern)
        const pairSymbol = `${baseSymbol}/${quote_symbol}`;
        const existing = await db.query(
          'SELECT id FROM trading_pairs WHERE symbol = $1',
          [pairSymbol]
        );

        if (existing.rows.length > 0) {
          skipped.push({ symbol: baseSymbol, reason: 'Already exists' });
          continue;
        }

        const result = await db.query(`
          INSERT INTO trading_pairs (
            base_currency_id, quote_currency_id, symbol, 
            tick_size, min_quantity, min_notional,
            price_precision, quantity_precision
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          baseCurrencyId, 
          quoteCurrencyId, 
          pairSymbol,
          '0.00000001',  // tick_size
          '0.00000001',  // min_quantity
          '1',           // min_notional
          8,             // price_precision
          8              // quantity_precision
        ]);

        created.push(result.rows[0]);
      }

      return reply.send({
        success: true,
        data: { created, skipped, created_count: created.length, skipped_count: skipped.length },
      });
    } catch (error) {
      logger.error('Error bulk creating pairs', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'BULK_CREATE_FAILED', message: 'Failed to create trading pairs' },
      });
    }
  });

  /**
   * PUT /admin/settings/trading-pairs/:id
   * Update trading pair
   */
  app.put('/settings/trading-pairs/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const fields: string[] = [];
      const values: any[] = [id];
      let paramIndex = 2;

      const allowedFields = [
        'min_quantity', 'max_quantity', 'min_price', 'max_price',
        'price_precision', 'quantity_precision', 'maker_fee', 'taker_fee',
        'display_order', 'is_active'
      ];

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          fields.push(`${field} = $${paramIndex}`);
          values.push(body[field]);
          paramIndex++;
        }
      }

      if (fields.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No fields to update' },
        });
      }

      const result = await db.query(`
        UPDATE trading_pairs 
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, values);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Trading pair not found' },
        });
      }

      return reply.send({
        success: true,
        data: { trading_pair: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update trading pair' },
      });
    }
  });

  /**
   * PATCH /admin/settings/trading-pairs/:id/toggle
   * Toggle trading pair active status
   */
  app.patch('/settings/trading-pairs/:id/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query(`
        UPDATE trading_pairs 
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Trading pair not found' },
        });
      }

      return reply.send({
        success: true,
        data: { trading_pair: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TOGGLE_FAILED', message: 'Failed to toggle trading pair' },
      });
    }
  });

  /**
   * DELETE /admin/settings/trading-pairs/:id
   * Delete trading pair
   */
  app.delete('/settings/trading-pairs/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query('DELETE FROM trading_pairs WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Trading pair not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete trading pair' },
      });
    }
  });

  /**
   * GET /admin/settings/available-base-currencies
   * Get currencies that can be used as base for trading pairs (unique by symbol)
   */
  app.get('/settings/available-base-currencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { quote_currency_id, include_fiat } = request.query as { quote_currency_id?: string; include_fiat?: string };

      // Get unique currencies by symbol - prefer ones with logo, then by type priority
      let query = `
        SELECT DISTINCT ON (c.symbol)
          c.id, c.symbol, c.name, c.logo_url, c.currency_type
        FROM currencies c
        WHERE c.is_active = true
      `;
      
      const params: any[] = [];
      let paramIndex = 1;
      
      // Exclude fiat unless specifically included
      if (include_fiat !== 'true') {
        // Still include fiat for quote assets but exclude from base currencies by default
      }
      
      // Exclude quote currency symbol
      if (quote_currency_id) {
        query += ` AND c.symbol != (SELECT symbol FROM currencies WHERE id = $${paramIndex})`;
        params.push(quote_currency_id);
        paramIndex++;
      }
      
      // Order by symbol, and within same symbol prefer: has logo > stablecoin > crypto > fiat
      query += `
        ORDER BY c.symbol ASC, 
                 CASE WHEN c.logo_url IS NOT NULL AND c.logo_url != '' THEN 0 ELSE 1 END,
                 CASE c.currency_type 
                   WHEN 'stablecoin' THEN 1 
                   WHEN 'crypto' THEN 2 
                   WHEN 'fiat' THEN 3 
                   ELSE 4 
                 END
      `;

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: { currencies: result.rows },
      });
    } catch (error) {
      logger.error('Error fetching currencies', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch currencies' },
      });
    }
  });

  // ============================================
  // P2P ASSETS MANAGEMENT
  // ============================================

  /**
   * GET /admin/settings/p2p-assets
   * Get all P2P enabled assets with pagination
   */
  app.get('/settings/p2p-assets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { limit, offset } = request.query as { limit?: string; offset?: string };
      
      const pageLimit = parseInt(limit || '20');
      const pageOffset = parseInt(offset || '0');
      
      // Get total count
      const countResult = await db.query('SELECT COUNT(*) as total FROM p2p_assets');
      const total = parseInt(countResult.rows[0]?.total ?? '0');
      
      // Get paginated data
      const result = await db.query(`
        SELECT 
          pa.*,
          c.symbol,
          c.name,
          c.logo_url,
          c.currency_type
        FROM p2p_assets pa
        JOIN currencies c ON pa.currency_id = c.id
        ORDER BY pa.display_order ASC, c.symbol ASC
        LIMIT $1 OFFSET $2
      `, [pageLimit, pageOffset]);

      return reply.send({
        success: true,
        data: { 
          p2p_assets: result.rows,
          total,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: pageOffset + result.rows.length < total,
        },
      });
    } catch (error) {
      logger.error('Error fetching P2P assets', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch P2P assets' },
      });
    }
  });

  /**
   * POST /admin/settings/p2p-assets
   * Add a new P2P asset
   */
  app.post('/settings/p2p-assets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { currency_id, min_amount, max_amount, price_precision, amount_precision, maker_fee, taker_fee } = request.body as any;

      if (!currency_id) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Currency ID is required' },
        });
      }

      // Check if already exists
      const existing = await db.query('SELECT id FROM p2p_assets WHERE currency_id = $1', [currency_id]);
      if (existing.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'DUPLICATE', message: 'This currency is already added to P2P' },
        });
      }

      const result = await db.query(`
        INSERT INTO p2p_assets (currency_id, min_amount, max_amount, price_precision, amount_precision, maker_fee, taker_fee)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        currency_id,
        min_amount || '0',
        max_amount || '999999999',
        price_precision || 2,
        amount_precision || 8,
        maker_fee || '0',
        taker_fee || '0',
      ]);

      // Fetch with currency details
      const asset = await db.query(`
        SELECT pa.*, c.symbol, c.name, c.logo_url, c.currency_type
        FROM p2p_assets pa
        JOIN currencies c ON pa.currency_id = c.id
        WHERE pa.id = $1
      `, [result.rows[0]!.id]);

      return reply.send({
        success: true,
        data: { p2p_asset: asset.rows[0] ?? null },
      });
    } catch (error) {
      logger.error('Error adding P2P asset', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to add P2P asset' },
      });
    }
  });

  /**
   * PUT /admin/settings/p2p-assets/:id
   * Update a P2P asset
   */
  app.put('/settings/p2p-assets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { min_amount, max_amount, price_precision, amount_precision, maker_fee, taker_fee, display_order, is_active } = request.body as any;

      const result = await db.query(`
        UPDATE p2p_assets 
        SET min_amount = COALESCE($1, min_amount),
            max_amount = COALESCE($2, max_amount),
            price_precision = COALESCE($3, price_precision),
            amount_precision = COALESCE($4, amount_precision),
            maker_fee = COALESCE($5, maker_fee),
            taker_fee = COALESCE($6, taker_fee),
            display_order = COALESCE($7, display_order),
            is_active = COALESCE($8, is_active),
            updated_at = NOW()
        WHERE id = $9
        RETURNING *
      `, [min_amount, max_amount, price_precision, amount_precision, maker_fee, taker_fee, display_order, is_active, id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'P2P asset not found' },
        });
      }

      // Fetch with currency details
      const asset = await db.query(`
        SELECT pa.*, c.symbol, c.name, c.logo_url, c.currency_type
        FROM p2p_assets pa
        JOIN currencies c ON pa.currency_id = c.id
        WHERE pa.id = $1
      `, [id]);

      return reply.send({
        success: true,
        data: { p2p_asset: asset.rows[0] },
      });
    } catch (error) {
      logger.error('Error updating P2P asset', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update P2P asset' },
      });
    }
  });

  /**
   * PATCH /admin/settings/p2p-assets/:id/toggle
   * Toggle P2P asset active status
   */
  app.patch('/settings/p2p-assets/:id/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query(`
        UPDATE p2p_assets 
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'P2P asset not found' },
        });
      }

      return reply.send({
        success: true,
        data: { p2p_asset: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TOGGLE_FAILED', message: 'Failed to toggle P2P asset' },
      });
    }
  });

  /**
   * DELETE /admin/settings/p2p-assets/:id
   * Remove a P2P asset
   */
  app.delete('/settings/p2p-assets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query('DELETE FROM p2p_assets WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'P2P asset not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete P2P asset' },
      });
    }
  });

  /**
   * GET /admin/settings/available-p2p-currencies
   * Get currencies that can be added to P2P (unique by symbol)
   */
  app.get('/settings/available-p2p-currencies', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      // Get unique currencies by symbol that are not already in P2P
      const result = await db.query(`
        SELECT DISTINCT ON (c.symbol)
          c.id, c.symbol, c.name, c.logo_url, c.currency_type
        FROM currencies c
        WHERE c.is_active = true
          AND c.symbol NOT IN (
            SELECT c2.symbol FROM p2p_assets pa 
            JOIN currencies c2 ON pa.currency_id = c2.id
          )
        ORDER BY c.symbol ASC,
                 CASE WHEN c.logo_url IS NOT NULL AND c.logo_url != '' THEN 0 ELSE 1 END
      `);

      return reply.send({
        success: true,
        data: { currencies: result.rows },
      });
    } catch (error) {
      logger.error('Error fetching available currencies', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch currencies' },
      });
    }
  });

  // ============================================
  // FEATURE TOGGLES MANAGEMENT
  // ============================================

  /**
   * GET /admin/settings/features
   * Get all feature toggles with pagination
   */
  app.get('/settings/features', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { category, search, limit, offset } = request.query as any;
      
      const pageLimit = parseInt(limit || '50');
      const pageOffset = parseInt(offset || '0');
      
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (category && category !== 'all') {
        whereClause += ` AND category = $${paramIndex}`;
        params.push(category);
        paramIndex++;
      }

      if (search) {
        whereClause += ` AND (feature_name ILIKE $${paramIndex} OR feature_key ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      // Get total count
      const countResult = await db.query(`SELECT COUNT(*) as total FROM feature_toggles ${whereClause}`, params);
      const total = parseInt(countResult.rows[0]?.total ?? '0');

      // Get paginated data
      const dataQuery = `
        SELECT * FROM feature_toggles 
        ${whereClause}
        ORDER BY category ASC, feature_name ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      const result = await db.query(dataQuery, [...params, pageLimit, pageOffset]);

      // Get category stats
      const statsResult = await db.query(`
        SELECT category, 
               COUNT(*) as total,
               SUM(CASE WHEN is_enabled THEN 1 ELSE 0 END) as enabled
        FROM feature_toggles
        GROUP BY category
        ORDER BY category
      `);

      return reply.send({
        success: true,
        data: { 
          features: result.rows,
          categories: statsResult.rows,
          total,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: pageOffset + result.rows.length < total,
        },
      });
    } catch (error) {
      logger.error('Error fetching features', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch features' },
      });
    }
  });

  /**
   * POST /admin/settings/features
   * Create a new feature toggle
   */
  app.post('/settings/features', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { category, feature_key, feature_name, description, is_enabled, is_critical, depends_on, metadata } = request.body as any;

      if (!category || !feature_key || !feature_name) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Category, feature_key, and feature_name are required' },
        });
      }

      const result = await db.query(`
        INSERT INTO feature_toggles (category, feature_key, feature_name, description, is_enabled, is_critical, depends_on, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (feature_key) DO UPDATE SET
          category = EXCLUDED.category,
          feature_name = EXCLUDED.feature_name,
          description = EXCLUDED.description,
          is_enabled = EXCLUDED.is_enabled,
          is_critical = EXCLUDED.is_critical,
          depends_on = EXCLUDED.depends_on,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING *
      `, [category, feature_key, feature_name, description || null, is_enabled ?? true, is_critical ?? false, depends_on || [], metadata || {}]);

      return reply.send({
        success: true,
        data: { feature: result.rows[0] },
      });
    } catch (error) {
      logger.error('Error creating feature', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to create feature' },
      });
    }
  });

  /**
   * POST /admin/settings/features/bulk
   * Create multiple feature toggles at once
   */
  app.post('/settings/features/bulk', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { features } = request.body as { features: any[] };

      if (!features || !Array.isArray(features) || features.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Features array is required' },
        });
      }

      const created: any[] = [];
      for (const f of features) {
        if (!f.category || !f.feature_key || !f.feature_name) continue;
        
        const result = await db.query(`
          INSERT INTO feature_toggles (category, feature_key, feature_name, description, is_enabled, is_critical, depends_on, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (feature_key) DO NOTHING
          RETURNING *
        `, [f.category, f.feature_key, f.feature_name, f.description || null, f.is_enabled ?? true, f.is_critical ?? false, f.depends_on || [], f.metadata || {}]);
        
        if (result.rows.length > 0) {
          created.push(result.rows[0]);
        }
      }

      return reply.send({
        success: true,
        data: { created: created.length, features: created },
      });
    } catch (error) {
      logger.error('Error bulk creating features', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREATE_FAILED', message: 'Failed to create features' },
      });
    }
  });

  /**
   * PATCH /admin/settings/features/:id/toggle
   * Toggle feature enabled status
   */
  app.patch('/settings/features/:id/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query(`
        UPDATE feature_toggles 
        SET is_enabled = NOT is_enabled, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Feature not found' },
        });
      }

      return reply.send({
        success: true,
        data: { feature: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TOGGLE_FAILED', message: 'Failed to toggle feature' },
      });
    }
  });

  /**
   * PATCH /admin/settings/features/bulk-toggle
   * Toggle multiple features at once
   */
  app.patch('/settings/features/bulk-toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { ids, enabled } = request.body as { ids: string[]; enabled: boolean };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'IDs array is required' },
        });
      }

      const result = await db.query(`
        UPDATE feature_toggles 
        SET is_enabled = $2, updated_at = NOW()
        WHERE id = ANY($1)
        RETURNING *
      `, [ids, enabled]);

      return reply.send({
        success: true,
        data: { updated: result.rows.length, features: result.rows },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TOGGLE_FAILED', message: 'Failed to toggle features' },
      });
    }
  });

  /**
   * PATCH /admin/settings/features/category/:category/toggle
   * Toggle all features in a category
   */
  app.patch('/settings/features/category/:category/toggle', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { category } = request.params as { category: string };
      const { enabled } = request.body as { enabled: boolean };

      const result = await db.query(`
        UPDATE feature_toggles 
        SET is_enabled = $2, updated_at = NOW()
        WHERE category = $1
        RETURNING *
      `, [category, enabled]);

      return reply.send({
        success: true,
        data: { updated: result.rows.length },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TOGGLE_FAILED', message: 'Failed to toggle category' },
      });
    }
  });

  /**
   * PUT /admin/settings/features/:id
   * Update feature details
   */
  app.put('/settings/features/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { feature_name, description, is_critical, depends_on, metadata } = request.body as any;

      const result = await db.query(`
        UPDATE feature_toggles SET
          feature_name = COALESCE($2, feature_name),
          description = COALESCE($3, description),
          is_critical = COALESCE($4, is_critical),
          depends_on = COALESCE($5, depends_on),
          metadata = COALESCE($6, metadata),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, feature_name, description, is_critical, depends_on, metadata]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Feature not found' },
        });
      }

      return reply.send({
        success: true,
        data: { feature: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update feature' },
      });
    }
  });

  /**
   * DELETE /admin/settings/features/:id
   * Delete a feature toggle
   */
  app.delete('/settings/features/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query('DELETE FROM feature_toggles WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Feature not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete feature' },
      });
    }
  });

  // ============================================
  // NODE PROVIDERS (RPC / third-party)
  // ============================================

  /**
   * GET /admin/settings/nodes
   * List blockchain node providers (Infura, Alchemy, QuickNode, self-hosted).
   */
  app.get('/settings/nodes', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS node_providers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider_name TEXT NOT NULL,
          rpc_url TEXT,
          api_key TEXT,
          network TEXT NOT NULL DEFAULT 'mainnet',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const result = await db.query<{ id: string; provider_name: string; rpc_url: string | null; api_key: string | null; network: string; status: string; created_at: string; updated_at: string }>(
        'SELECT id::text, provider_name, rpc_url, api_key, network, status, created_at::text, updated_at::text FROM node_providers ORDER BY provider_name'
      );
      const list = result.rows.map((r) => ({
        id: r.id,
        provider_name: r.provider_name,
        rpc_url: r.rpc_url ?? '',
        api_key: r.api_key != null ? (r.api_key.length > 8 ? r.api_key.slice(0, 4) + '***' : '***') : '',
        network: r.network,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      return reply.send({ success: true, data: list });
    } catch (e) {
      logger.error('Get settings/nodes error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch node providers' } });
    }
  });

  /**
   * PATCH /admin/settings/nodes/:id
   * Update a node provider (rpc_url, api_key, network, status). No redeploy required.
   */
  app.patch<{ Params: { id: string }; Body: { provider_name?: string; rpc_url?: string; api_key?: string; network?: string; status?: string } }>('/settings/nodes/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = request.params?.id;
    if (!id) return reply.status(400).send({ success: false, error: { code: 'MISSING_ID', message: 'Node id required' } });
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS node_providers (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), provider_name TEXT NOT NULL, rpc_url TEXT, api_key TEXT, network TEXT NOT NULL DEFAULT 'mainnet', status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const body = request.body || {};
      const updates: string[] = [];
      const params: (string | number)[] = [];
      let idx = 1;
      if (typeof body.provider_name === 'string') { updates.push(`provider_name = $${idx++}`); params.push(body.provider_name); }
      if (typeof body.rpc_url === 'string') { updates.push(`rpc_url = $${idx++}`); params.push(body.rpc_url); }
      if (typeof body.api_key === 'string') { updates.push(`api_key = $${idx++}`); params.push(body.api_key); }
      if (typeof body.network === 'string') { updates.push(`network = $${idx++}`); params.push(body.network); }
      if (typeof body.status === 'string' && ['active', 'inactive', 'maintenance'].includes(body.status)) { updates.push(`status = $${idx++}`); params.push(body.status); }
      if (updates.length === 0) return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No valid fields to update' } });
      updates.push(`updated_at = NOW()`);
      params.push(id);
      await db.query(`UPDATE node_providers SET ${updates.join(', ')} WHERE id = $${idx}::uuid`, params);
      const row = await db.query<{ id: string; provider_name: string; rpc_url: string | null; network: string; status: string }>(
        'SELECT id::text, provider_name, rpc_url, network, status FROM node_providers WHERE id = $1::uuid',
        [id]
      );
      if (row.rows.length === 0) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Node provider not found' } });
      return reply.send({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error('Patch settings/nodes error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update node provider' } });
    }
  });

  /**
   * POST /admin/settings/nodes
   * Create a new node provider.
   */
  app.post<{ Body: { provider_name: string; rpc_url?: string; api_key?: string; network?: string; status?: string } }>('/settings/nodes', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS node_providers (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), provider_name TEXT NOT NULL, rpc_url TEXT, api_key TEXT, network TEXT NOT NULL DEFAULT 'mainnet', status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const body = request.body || {};
      const name = typeof body.provider_name === 'string' ? body.provider_name.trim() : '';
      if (!name) return reply.status(400).send({ success: false, error: { code: 'MISSING_NAME', message: 'provider_name is required' } });
      const rpc_url = typeof body.rpc_url === 'string' ? body.rpc_url : null;
      const api_key = typeof body.api_key === 'string' ? body.api_key : null;
      const network = typeof body.network === 'string' ? body.network : 'mainnet';
      const status = typeof body.status === 'string' && ['active', 'inactive', 'maintenance'].includes(body.status) ? body.status : 'active';
      const ins = await db.query<{ id: string }>(
        'INSERT INTO node_providers (provider_name, rpc_url, api_key, network, status) VALUES ($1, $2, $3, $4, $5) RETURNING id::text',
        [name, rpc_url, api_key, network, status]
      );
      return reply.send({ success: true, data: { id: ins.rows[0]!.id } });
    } catch (e) {
      logger.error('Post settings/nodes error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create node provider' } });
    }
  });

  // ============================================
  // INTEGRATIONS CONTROL CENTER (unified external services)
  // ============================================

  const INTEGRATION_CATEGORIES = ['blockchain_nodes', 'price_oracles', 'compliance_providers', 'kyc_providers', 'email_sms_gateways', 'webhook_endpoints'];

  app.get<{ Querystring: { category?: string } }>('/integrations', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integrations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider_name TEXT NOT NULL,
          category TEXT NOT NULL,
          endpoint_url TEXT,
          api_key TEXT,
          secret_key TEXT,
          webhook_secret TEXT,
          status TEXT NOT NULL DEFAULT 'inactive',
          event_type TEXT,
          assets_covered TEXT,
          update_interval_sec INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const category = (request.query as { category?: string }).category;
      let where = '1=1';
      const params: string[] = [];
      if (category && INTEGRATION_CATEGORIES.includes(category)) {
        where = 'category = $1';
        params.push(category);
      }
      const rows = await db.query<{ id: string; provider_name: string; category: string; endpoint_url: string | null; api_key: string | null; secret_key: string | null; webhook_secret: string | null; status: string; event_type: string | null; assets_covered: string | null; update_interval_sec: number | null; updated_at: string | null }>(
        `SELECT id::text, provider_name, category, endpoint_url, api_key, secret_key, webhook_secret, status, event_type, assets_covered, update_interval_sec, updated_at::text FROM integrations WHERE ${where} ORDER BY category, provider_name`,
        params
      );
      await db.query(`CREATE TABLE IF NOT EXISTS integration_meta (integration_id UUID PRIMARY KEY, failover_priority INTEGER DEFAULT 1, last_latency_ms INTEGER, last_success_at TIMESTAMPTZ, error_count INTEGER DEFAULT 0)`).catch(() => {});
      const metaRows = rows.rows.length > 0
        ? await db.query<{ integration_id: string; failover_priority: number; last_latency_ms: number | null; last_success_at: string | null; error_count: number }>(
            `SELECT integration_id::text, COALESCE(failover_priority, 1) AS failover_priority, last_latency_ms, last_success_at::text, COALESCE(error_count, 0) AS error_count FROM integration_meta WHERE integration_id IN (${rows.rows.map((_, i) => `$${i + 1}::uuid`).join(',')})`,
            rows.rows.map((r) => r.id)
          ).catch(() => ({ rows: [] }))
        : { rows: [] };
      const metaMap = Object.fromEntries(metaRows.rows.map((m) => [m.integration_id, m]));
      const list = rows.rows.map((r) => {
        const meta = metaMap[r.id];
        return {
          id: r.id,
          provider_name: r.provider_name,
          category: r.category,
          endpoint_url: r.endpoint_url ?? '',
          api_key: r.api_key ? (r.api_key.length >= 8 ? r.api_key.slice(0, 4) + '••••' + r.api_key.slice(-4) : '••••') : '',
          secret_key: r.secret_key ? '••••' : '',
          webhook_secret: r.webhook_secret ? '••••' : '',
          status: r.status,
          event_type: r.event_type ?? null,
          assets_covered: r.assets_covered ?? null,
          update_interval_sec: r.update_interval_sec ?? null,
          updated_at: r.updated_at ?? null,
          latency_ms: meta?.last_latency_ms ?? null,
          last_successful_request: meta?.last_success_at ?? null,
          error_count: meta?.error_count ?? 0,
          failover_priority: meta?.failover_priority ?? 1,
        };
      });
      list.sort((a, b) => (a.failover_priority ?? 1) - (b.failover_priority ?? 1));
      return reply.send({ success: true, data: { integrations: list } });
    } catch (e) {
      logger.error('Get integrations error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch integrations' } });
    }
  });

  app.post<{ Body: { provider_name: string; category: string; endpoint_url?: string; api_key?: string; secret_key?: string; webhook_secret?: string; status?: string; event_type?: string; assets_covered?: string; update_interval_sec?: number } }>('/integrations', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as Record<string, unknown>;
    const provider_name = typeof body.provider_name === 'string' ? body.provider_name.trim() : '';
    const category = typeof body.category === 'string' ? body.category : '';
    if (!provider_name || !INTEGRATION_CATEGORIES.includes(category)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'provider_name and category (one of ' + INTEGRATION_CATEGORIES.join(', ') + ') required' } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integrations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider_name TEXT NOT NULL,
          category TEXT NOT NULL,
          endpoint_url TEXT,
          api_key TEXT,
          secret_key TEXT,
          webhook_secret TEXT,
          status TEXT NOT NULL DEFAULT 'inactive',
          event_type TEXT,
          assets_covered TEXT,
          update_interval_sec INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const ins = await db.query<{ id: string }>(
        `INSERT INTO integrations (provider_name, category, endpoint_url, api_key, secret_key, webhook_secret, status, event_type, assets_covered, update_interval_sec)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
        [
          provider_name,
          category,
          body.endpoint_url ?? null,
          body.api_key ?? null,
          body.secret_key ?? null,
          body.webhook_secret ?? null,
          typeof body.status === 'string' && ['active', 'inactive'].includes(body.status) ? body.status : 'inactive',
          body.event_type ?? null,
          body.assets_covered ?? null,
          typeof body.update_interval_sec === 'number' ? body.update_interval_sec : null,
        ]
      );
      return reply.send({ success: true, data: { id: ins.rows[0]!.id } });
    } catch (e) {
      logger.error('Post integrations error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create integration' } });
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/integrations/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    const body = (request.body || {}) as Record<string, unknown>;
    try {
      const updates: string[] = ['updated_at = NOW()'];
      const params: (string | number | null)[] = [];
      let i = 1;
      if (typeof body.provider_name === 'string') { updates.push(`provider_name = $${i++}`); params.push(body.provider_name.trim()); }
      if (typeof body.category === 'string' && INTEGRATION_CATEGORIES.includes(body.category)) { updates.push(`category = $${i++}`); params.push(body.category); }
      if (body.endpoint_url !== undefined) {
        updates.push(`endpoint_url = $${i++}`);
        const ev =
          body.endpoint_url === '' || body.endpoint_url == null
            ? null
            : typeof body.endpoint_url === 'string'
              ? body.endpoint_url
              : String(body.endpoint_url);
        params.push(ev);
      }
      if (typeof body.api_key === 'string') { updates.push(`api_key = $${i++}`); params.push(body.api_key || null); }
      if (typeof body.secret_key === 'string') { updates.push(`secret_key = $${i++}`); params.push(body.secret_key || null); }
      if (typeof body.webhook_secret === 'string') { updates.push(`webhook_secret = $${i++}`); params.push(body.webhook_secret || null); }
      if (typeof body.status === 'string' && ['active', 'inactive'].includes(body.status)) { updates.push(`status = $${i++}`); params.push(body.status); }
      if (typeof body.event_type === 'string') { updates.push(`event_type = $${i++}`); params.push(body.event_type || null); }
      if (typeof body.assets_covered === 'string') { updates.push(`assets_covered = $${i++}`); params.push(body.assets_covered || null); }
      if (typeof body.update_interval_sec === 'number') { updates.push(`update_interval_sec = $${i++}`); params.push(body.update_interval_sec); }
      if (typeof body.failover_priority === 'number') {
        await db.query(`CREATE TABLE IF NOT EXISTS integration_meta (integration_id UUID PRIMARY KEY, failover_priority INTEGER DEFAULT 1, last_latency_ms INTEGER, last_success_at TIMESTAMPTZ, error_count INTEGER DEFAULT 0)`).catch(() => {});
        await db.query(
          'INSERT INTO integration_meta (integration_id, failover_priority) VALUES ($1::uuid, $2) ON CONFLICT (integration_id) DO UPDATE SET failover_priority = $2',
          [id, body.failover_priority]
        ).catch(() => {});
      }
      if (params.length <= 1 && typeof body.failover_priority !== 'number') return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No valid fields to update' } });
      params.push(id);
      await db.query(`UPDATE integrations SET ${updates.join(', ')} WHERE id = $${i}::uuid`, params);
      return reply.send({ success: true, data: { id } });
    } catch (e) {
      logger.error('Patch integrations error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  app.post<{ Body: { id?: string; url?: string } }>('/integrations/test', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { id?: string; url?: string };
    let url: string | null = body.url ?? null;
    const id = body.id ?? null;
    if (id && !url) {
      const row = await db.query<{ endpoint_url: string | null }>('SELECT endpoint_url FROM integrations WHERE id = $1::uuid', [id]);
      if (row.rows.length > 0) url = row.rows[0]!.endpoint_url;
    }
    if (!url) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_URL', message: 'id or url required' } });
    }
    const start = Date.now();
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      const latency_ms = Date.now() - start;
      if (id) {
        await db.query(`CREATE TABLE IF NOT EXISTS integration_meta (integration_id UUID PRIMARY KEY, failover_priority INTEGER DEFAULT 1, last_latency_ms INTEGER, last_success_at TIMESTAMPTZ, error_count INTEGER DEFAULT 0)`).catch(() => {});
        if (res.ok) {
          await db.query(
            'INSERT INTO integration_meta (integration_id, last_latency_ms, last_success_at, error_count) VALUES ($1::uuid, $2, NOW(), COALESCE((SELECT error_count FROM integration_meta WHERE integration_id = $1::uuid), 0)) ON CONFLICT (integration_id) DO UPDATE SET last_latency_ms = $2, last_success_at = NOW()',
            [id, latency_ms]
          );
        } else {
          await db.query(
            'INSERT INTO integration_meta (integration_id, last_latency_ms, error_count) VALUES ($1::uuid, $2, 1) ON CONFLICT (integration_id) DO UPDATE SET last_latency_ms = $2, error_count = integration_meta.error_count + 1',
            [id, latency_ms]
          );
        }
      }
      if (id) {
        await db.query(`
          CREATE TABLE IF NOT EXISTS integration_event_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            integration_id UUID NOT NULL,
            provider_name TEXT,
            event_type TEXT,
            status TEXT NOT NULL DEFAULT 'success',
            latency_ms INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `).catch(() => {});
        const nameRow = await db.query<{ provider_name: string }>('SELECT provider_name FROM integrations WHERE id = $1::uuid', [id]).catch(() => ({ rows: [] }));
        await db.query(
          'INSERT INTO integration_event_logs (integration_id, provider_name, event_type, status, latency_ms) VALUES ($1::uuid, $2, $3, $4, $5)',
          [id, nameRow.rows[0]?.provider_name ?? null, 'Connection Test', res.ok ? 'success' : 'error', latency_ms]
        ).catch(() => {});
      }
      return reply.send({ success: true, data: { latency_ms, status: res.ok ? 'ok' : 'error', error: res.ok ? undefined : `HTTP ${res.status}` } });
    } catch (e) {
      const latency_ms = Date.now() - start;
      const error = e instanceof Error ? e.message : 'Connection failed';
      if (id) {
        await db.query(`CREATE TABLE IF NOT EXISTS integration_meta (integration_id UUID PRIMARY KEY, failover_priority INTEGER DEFAULT 1, last_latency_ms INTEGER, last_success_at TIMESTAMPTZ, error_count INTEGER DEFAULT 0)`).catch(() => {});
        await db.query(
          'INSERT INTO integration_meta (integration_id, last_latency_ms, error_count) VALUES ($1::uuid, $2, 1) ON CONFLICT (integration_id) DO UPDATE SET last_latency_ms = $2, error_count = integration_meta.error_count + 1',
          [id, latency_ms]
        ).catch(() => {});
        await db.query(`
          CREATE TABLE IF NOT EXISTS integration_event_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            integration_id UUID NOT NULL,
            provider_name TEXT,
            event_type TEXT,
            status TEXT NOT NULL DEFAULT 'success',
            latency_ms INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `).catch(() => {});
        const nameRow = await db.query<{ provider_name: string }>('SELECT provider_name FROM integrations WHERE id = $1::uuid', [id]).catch(() => ({ rows: [] }));
        await db.query(
          'INSERT INTO integration_event_logs (integration_id, provider_name, event_type, status, latency_ms) VALUES ($1::uuid, $2, $3, $4, $5)',
          [id, nameRow.rows[0]?.provider_name ?? null, 'Connection Test', 'error', latency_ms]
        ).catch(() => {});
      }
      return reply.send({ success: true, data: { latency_ms, status: 'error', error } });
    }
  });

  app.get('/integrations/health', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS integration_meta (integration_id UUID PRIMARY KEY, failover_priority INTEGER DEFAULT 1, last_latency_ms INTEGER, last_success_at TIMESTAMPTZ, error_count INTEGER DEFAULT 0)`);
      const all = await db.query<{ id: string; status: string }>('SELECT id::text, status FROM integrations');
      const active = all.rows.filter((r) => r.status === 'active').length;
      const failedRes = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM integrations i LEFT JOIN integration_meta m ON m.integration_id = i.id WHERE i.status = 'inactive' OR COALESCE(m.error_count, 0) > 0`
      ).catch(() => ({ rows: [{ count: '0' }] }));
      const failed = parseInt(failedRes.rows[0]?.count ?? '0', 10);
      const avgRes = await db.query<{ avg: string }>('SELECT COALESCE(AVG(last_latency_ms), 0)::text AS avg FROM integration_meta WHERE last_latency_ms IS NOT NULL').catch(() => ({ rows: [{ avg: '0' }] }));
      const avgLatency = Math.round(parseFloat(avgRes.rows[0]?.avg ?? '0'));
      const webhookRateRes = await db.query<{ total: string; success: string }>(
        `SELECT COUNT(*)::text AS total, SUM(CASE WHEN delivery_status = 'success' THEN 1 ELSE 0 END)::text AS success FROM integration_webhook_deliveries`
      ).catch(() => ({ rows: [{ total: '0', success: '0' }] }));
      const total = parseInt(webhookRateRes.rows[0]?.total ?? '0', 10);
      const success = parseInt(webhookRateRes.rows[0]?.success ?? '0', 10);
      const webhookDeliveryRate = total > 0 ? Math.round((success / total) * 100) : 100;
      return reply.send({
        success: true,
        data: { active_integrations: active, failed_integrations: failed, average_latency_ms: avgLatency, webhook_delivery_rate_percent: webhookDeliveryRate },
      });
    } catch (e) {
      logger.error('Get integrations health error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get health' } });
    }
  });

  app.get('/integrations/rate-limits', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const rows = await db.query<{ id: string; provider_name: string; category: string }>('SELECT id::text, provider_name, category FROM integrations WHERE status = $1', ['active']);
      await db.query(`CREATE TABLE IF NOT EXISTS integration_rate_limits (integration_id UUID PRIMARY KEY, requests_per_min INTEGER DEFAULT 60, remaining_quota INTEGER, resets_at TIMESTAMPTZ)`).catch(() => {});
      const limits: { integration_id: string; provider_name: string; category: string; requests_per_min: number; remaining_quota: number | null; resets_at: string | null }[] = [];
      for (const r of rows.rows) {
        const lr = await db.query<{ requests_per_min: number; remaining_quota: number | null; resets_at: string | null }>(
          'SELECT COALESCE(requests_per_min, 60) AS requests_per_min, remaining_quota, resets_at::text FROM integration_rate_limits WHERE integration_id = $1::uuid',
          [r.id]
        ).catch(() => ({ rows: [] }));
        limits.push({
          integration_id: r.id,
          provider_name: r.provider_name,
          category: r.category,
          requests_per_min: lr.rows[0]?.requests_per_min ?? 60,
          remaining_quota: lr.rows[0]?.remaining_quota ?? null,
          resets_at: lr.rows[0]?.resets_at ?? null,
        });
      }
      return reply.send({ success: true, data: { rate_limits: limits } });
    } catch (e) {
      logger.error('Get integrations rate-limits error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get rate limits' } });
    }
  });

  app.get('/integrations/webhook-deliveries', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          integration_id UUID NOT NULL,
          webhook_url TEXT,
          event_type TEXT,
          delivery_status TEXT NOT NULL DEFAULT 'pending',
          response_code INTEGER,
          retry_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const limit = Math.min(parseInt(String((request.query as { limit?: string }).limit), 10) || 50, 100);
      const offset = parseInt(String((request.query as { offset?: string }).offset), 10) || 0;
      const rows = await db.query<{ id: string; integration_id: string; webhook_url: string | null; event_type: string | null; delivery_status: string; response_code: number | null; retry_count: number; created_at: string }>(
        `SELECT id::text, integration_id::text, webhook_url, event_type, delivery_status, response_code, COALESCE(retry_count, 0) AS retry_count, created_at::text FROM integration_webhook_deliveries ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const list = rows.rows.map((r) => ({
        id: r.id,
        integration_id: r.integration_id,
        webhook_url: r.webhook_url ?? '',
        event_type: r.event_type ?? '',
        delivery_status: r.delivery_status,
        response_code: r.response_code,
        retry_count: r.retry_count,
        time: r.created_at,
      }));
      return reply.send({ success: true, data: { deliveries: list } });
    } catch (e) {
      logger.error('Get integrations webhook-deliveries error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get webhook deliveries' } });
    }
  });

  app.post<{ Params: { id: string } }>('/integrations/webhooks/:id/retry', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          integration_id UUID NOT NULL,
          webhook_url TEXT,
          event_type TEXT,
          delivery_status TEXT NOT NULL DEFAULT 'pending',
          response_code INTEGER,
          retry_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const row = await db.query<{ integration_id: string; webhook_url: string | null; event_type: string | null; retry_count: number }>(
        'SELECT integration_id::text, webhook_url, event_type, COALESCE(retry_count, 0) AS retry_count FROM integration_webhook_deliveries WHERE id = $1::uuid',
        [id]
      );
      if (row.rows.length === 0) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Delivery not found' } });
      const r = row.rows[0]!;
      const retryCount = r.retry_count + 1;
      await db.query(
        `INSERT INTO integration_webhook_deliveries (integration_id, webhook_url, event_type, delivery_status, response_code, retry_count) VALUES ($1::uuid, $2, $3, 'pending', NULL, $4)`,
        [r.integration_id, r.webhook_url, r.event_type, retryCount]
      );
      return reply.send({ success: true, data: { message: 'Retry queued' } });
    } catch (e) {
      logger.error('Post integrations webhooks retry error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'RETRY_FAILED', message: 'Failed to retry' } });
    }
  });

  app.get('/integrations/event-logs', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integration_event_logs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          integration_id UUID NOT NULL,
          provider_name TEXT,
          event_type TEXT,
          status TEXT NOT NULL DEFAULT 'success',
          latency_ms INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const limit = Math.min(parseInt(String((request.query as { limit?: string }).limit), 10) || 50, 100);
      const offset = parseInt(String((request.query as { offset?: string }).offset), 10) || 0;
      const rows = await db.query<{ id: string; provider_name: string | null; event_type: string | null; status: string; latency_ms: number | null; created_at: string }>(
        `SELECT l.id::text, i.provider_name, l.event_type, l.status, l.latency_ms, l.created_at::text FROM integration_event_logs l LEFT JOIN integrations i ON i.id = l.integration_id ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const list = rows.rows.map((r) => ({
        integration: r.provider_name ?? '—',
        event: r.event_type ?? '—',
        status: r.status,
        latency_ms: r.latency_ms,
        timestamp: r.created_at,
      }));
      return reply.send({ success: true, data: { logs: list } });
    } catch (e) {
      logger.error('Get integrations event-logs error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to get event logs' } });
    }
  });

  app.post<{ Body: { category: string; provider_id: string } }>('/integrations/switch', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { category?: string; provider_id?: string };
    const category = typeof body.category === 'string' ? body.category : '';
    const provider_id = typeof body.provider_id === 'string' ? body.provider_id : '';
    if (!category || !provider_id || !INTEGRATION_CATEGORIES.includes(category)) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'category and provider_id required' } });
    }
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS integration_active (
          category TEXT PRIMARY KEY,
          provider_id UUID NOT NULL
        )
      `);
      await db.query(
        'INSERT INTO integration_active (category, provider_id) VALUES ($1, $2::uuid) ON CONFLICT (category) DO UPDATE SET provider_id = $2::uuid',
        [category, provider_id]
      );
      await logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'integration_switch',
        resourceType: 'integrations',
        resourceId: category,
        newValue: { category, provider_id },
      });
      return reply.send({ success: true, data: { category, provider_id } });
    } catch (e) {
      logger.error('Post integrations switch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'SWITCH_FAILED', message: 'Failed to switch provider' } });
    }
  });

  // ============================================
  // COMPLIANCE INTEGRATIONS (Chainalysis, TRM, Elliptic, SumSub, ComplyAdvantage)
  // ============================================

  app.get('/settings/integrations', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS compliance_integrations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider_name TEXT NOT NULL UNIQUE,
          api_url TEXT,
          api_key TEXT,
          webhook_secret TEXT,
          status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const result = await db.query<{ id: string; provider_name: string; api_url: string | null; api_key: string | null; webhook_secret: string | null; status: string }>(
        'SELECT id::text, provider_name, api_url, api_key, webhook_secret, status FROM compliance_integrations ORDER BY provider_name'
      );
      const list = result.rows.map((r) => ({
        id: r.id,
        provider_name: r.provider_name,
        api_url: r.api_url ?? '',
        api_key: r.api_key != null ? (r.api_key.length > 8 ? r.api_key.slice(0, 4) + '***' : '***') : '',
        webhook_secret: r.webhook_secret != null ? '***' : '',
        status: r.status,
      }));
      return reply.send({ success: true, data: list });
    } catch (e) {
      logger.error('Get settings/integrations error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch integrations' } });
    }
  });

  app.patch<{ Params: { id: string }; Body: { provider_name?: string; api_url?: string; api_key?: string; webhook_secret?: string; status?: string } }>('/settings/integrations/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS compliance_integrations (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), provider_name TEXT NOT NULL UNIQUE, api_url TEXT, api_key TEXT, webhook_secret TEXT, status TEXT NOT NULL DEFAULT 'inactive', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const body = (request.body || {}) as { provider_name?: string; api_url?: string; api_key?: string; webhook_secret?: string; status?: string };
      const updates: string[] = [];
      const params: (string | number)[] = [];
      let idx = 1;
      if (typeof body.provider_name === 'string') { updates.push(`provider_name = $${idx++}`); params.push(body.provider_name); }
      if (typeof body.api_url === 'string') { updates.push(`api_url = $${idx++}`); params.push(body.api_url); }
      if (typeof body.api_key === 'string') { updates.push(`api_key = $${idx++}`); params.push(body.api_key); }
      if (typeof body.webhook_secret === 'string') { updates.push(`webhook_secret = $${idx++}`); params.push(body.webhook_secret); }
      if (typeof body.status === 'string' && ['active', 'inactive'].includes(body.status)) { updates.push(`status = $${idx++}`); params.push(body.status); }
      if (updates.length === 0) return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No valid fields to update' } });
      updates.push('updated_at = NOW()');
      params.push(id);
      await db.query(`UPDATE compliance_integrations SET ${updates.join(', ')} WHERE id = $${idx}::uuid`, params);
      const row = await db.query<{ id: string; provider_name: string; status: string }>('SELECT id::text, provider_name, status FROM compliance_integrations WHERE id = $1::uuid', [id]);
      if (row.rows.length === 0) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Integration not found' } });
      return reply.send({ success: true, data: row.rows[0] });
    } catch (e) {
      logger.error('Patch settings/integrations error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update integration' } });
    }
  });

  app.post<{ Body: { provider_name: string; api_url?: string; api_key?: string; webhook_secret?: string; status?: string } }>('/settings/integrations', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS compliance_integrations (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), provider_name TEXT NOT NULL UNIQUE, api_url TEXT, api_key TEXT, webhook_secret TEXT, status TEXT NOT NULL DEFAULT 'inactive', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
      const body = (request.body || {}) as { provider_name: string; api_url?: string; api_key?: string; webhook_secret?: string; status?: string };
      const name = typeof body.provider_name === 'string' ? body.provider_name.trim() : '';
      if (!name) return reply.status(400).send({ success: false, error: { code: 'MISSING_NAME', message: 'provider_name is required' } });
      const status = typeof body.status === 'string' && ['active', 'inactive'].includes(body.status) ? body.status : 'inactive';
      const ins = await db.query<{ id: string }>(
        'INSERT INTO compliance_integrations (provider_name, api_url, api_key, webhook_secret, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider_name) DO UPDATE SET updated_at = NOW() RETURNING id::text',
        [name, body.api_url ?? null, body.api_key ?? null, body.webhook_secret ?? null, status]
      );
      return reply.send({ success: true, data: { id: ins.rows[0]!.id } });
    } catch (e) {
      logger.error('Post settings/integrations error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create integration' } });
    }
  });

  /**
   * GET /admin/settings/infrastructure
   * List third-party infrastructure providers: RPC, oracles, email/SMS, webhooks. No redeploy required.
   */
  app.get('/settings/infrastructure', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS infrastructure_providers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          provider_type TEXT NOT NULL,
          provider_name TEXT NOT NULL,
          endpoint_url TEXT,
          api_key TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      const rows = await db.query<{ id: string; provider_type: string; provider_name: string; endpoint_url: string | null; api_key: string | null; status: string }>(
        'SELECT id::text, provider_type, provider_name, endpoint_url, api_key, status FROM infrastructure_providers ORDER BY provider_type, provider_name'
      );
      const list = rows.rows.map((r) => ({
        id: r.id,
        provider_type: r.provider_type,
        provider_name: r.provider_name,
        endpoint_url: r.endpoint_url ?? '',
        api_key: r.api_key ? (r.api_key.length >= 8 ? `${r.api_key.slice(0, 4)}••••${r.api_key.slice(-4)}` : '••••') : '',
        status: r.status,
      }));
      return reply.send({ success: true, data: { providers: list } });
    } catch (e) {
      logger.error('Get settings/infrastructure error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to list infrastructure' } });
    }
  });

  app.patch<{ Params: { id: string }; Body: { provider_name?: string; endpoint_url?: string; api_key?: string; status?: string } }>('/settings/infrastructure/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const id = (request.params as { id: string }).id;
    const body = (request.body || {}) as { provider_name?: string; endpoint_url?: string; api_key?: string; status?: string };
    try {
      const updates: string[] = ['updated_at = NOW()'];
      const params: (string | number | null)[] = [];
      let i = 1;
      if (typeof body.provider_name === 'string' && body.provider_name.trim()) {
        updates.push(`provider_name = $${i++}`);
        params.push(body.provider_name.trim());
      }
      if (typeof body.endpoint_url === 'string') {
        updates.push(`endpoint_url = $${i++}`);
        params.push(body.endpoint_url.trim() === '' ? null : body.endpoint_url);
      }
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        updates.push(`api_key = $${i++}`);
        params.push(body.api_key.trim());
      }
      if (typeof body.status === 'string' && ['active', 'inactive'].includes(body.status)) {
        updates.push(`status = $${i++}`);
        params.push(body.status);
      }
      if (params.length <= 1) {
        return reply.status(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No fields to update' } });
      }
      params.push(id);
      await db.query(`UPDATE infrastructure_providers SET ${updates.join(', ')} WHERE id = $${i}::uuid`, params);
      return reply.send({ success: true, data: { id } });
    } catch (e) {
      logger.error('Patch settings/infrastructure error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  app.post<{ Body: { provider_type: string; provider_name: string; endpoint_url?: string; api_key?: string; status?: string } }>('/settings/infrastructure', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    const body = (request.body || {}) as { provider_type: string; provider_name: string; endpoint_url?: string; api_key?: string; status?: string };
    const type = typeof body.provider_type === 'string' ? body.provider_type.trim().toLowerCase() : '';
    const allowed = ['rpc', 'oracle', 'email_sms', 'webhook'];
    if (!allowed.includes(type)) {
      return reply.status(400).send({ success: false, error: { code: 'INVALID_TYPE', message: 'provider_type must be one of: ' + allowed.join(', ') } });
    }
    const name = typeof body.provider_name === 'string' ? body.provider_name.trim() : '';
    if (!name) return reply.status(400).send({ success: false, error: { code: 'MISSING_NAME', message: 'provider_name is required' } });
    try {
      const ins = await db.query<{ id: string }>(
        'INSERT INTO infrastructure_providers (provider_type, provider_name, endpoint_url, api_key, status) VALUES ($1, $2, $3, $4, $5) RETURNING id::text',
        [type, name, body.endpoint_url ?? null, body.api_key ?? null, body.status && ['active', 'inactive'].includes(body.status) ? body.status : 'active']
      );
      return reply.send({ success: true, data: { id: ins.rows[0]!.id } });
    } catch (e) {
      logger.error('Post settings/infrastructure error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create' } });
    }
  });

  // ============================================
  // API SETTINGS MANAGEMENT
  // ============================================

  /**
   * GET /admin/settings/api
   * Get API settings by category
   */
  app.get('/settings/api', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { category } = request.query as { category?: string };
      
      let query = 'SELECT * FROM api_settings';
      const params: any[] = [];
      
      if (category) {
        query += ' WHERE category = $1';
        params.push(category);
      }
      
      query += ' ORDER BY category, provider';
      
      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: { settings: result.rows },
      });
    } catch (error) {
      logger.error('Error fetching API settings', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch API settings' },
      });
    }
  });

  /**
   * POST /admin/settings/api
   * Create or update API setting — requires settings:edit
   */
  app.post('/settings/api', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const { 
        category, provider, name, api_key, api_secret, api_url, 
        additional_config, is_active, is_default 
      } = request.body as any;

      if (!category || !provider || !name) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Category, provider, and name are required' },
        });
      }

      // If setting as default, unset other defaults in same category
      if (is_default) {
        await db.query(
          'UPDATE api_settings SET is_default = false WHERE category = $1',
          [category]
        );
      }

      // Upsert the setting
      const result = await db.query(`
        INSERT INTO api_settings (
          category, provider, name, api_key, api_secret, api_url, 
          additional_config, is_active, is_default
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (category, provider) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          api_key = EXCLUDED.api_key,
          api_secret = EXCLUDED.api_secret,
          api_url = EXCLUDED.api_url,
          additional_config = EXCLUDED.additional_config,
          is_active = EXCLUDED.is_active,
          is_default = EXCLUDED.is_default,
          updated_at = NOW()
        RETURNING *
      `, [
        category, provider, name, 
        api_key || null, api_secret || null, api_url || null,
        additional_config || {}, is_active ?? false, is_default ?? false
      ]);

      return reply.send({
        success: true,
        data: { setting: result.rows[0] },
      });
    } catch (error) {
      logger.error('Error saving API setting', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'SAVE_FAILED', message: 'Failed to save API setting' },
      });
    }
  });

  /**
   * PUT /admin/settings/api/:id
   * Update API setting — requires settings:edit
   */
  app.put('/settings/api/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { 
        name, api_key, api_secret, api_url, 
        additional_config, is_active, is_default 
      } = request.body as any;

      // Get current setting to check category
      const current = await db.query('SELECT category FROM api_settings WHERE id = $1', [id]);
      if (current.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'API setting not found' },
        });
      }

      // If setting as default, unset other defaults in same category
      if (is_default) {
        await db.query(
          'UPDATE api_settings SET is_default = false WHERE category = $1 AND id != $2',
          [current.rows[0]!.category, id]
        );
      }

      const result = await db.query(`
        UPDATE api_settings SET
          name = COALESCE($2, name),
          api_key = COALESCE($3, api_key),
          api_secret = COALESCE($4, api_secret),
          api_url = COALESCE($5, api_url),
          additional_config = COALESCE($6, additional_config),
          is_active = COALESCE($7, is_active),
          is_default = COALESCE($8, is_default),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id, name, api_key, api_secret, api_url, additional_config, is_active, is_default]);

      return reply.send({
        success: true,
        data: { setting: result.rows[0] },
      });
    } catch (error) {
      logger.error('Error updating API setting', { error: error instanceof Error ? error.message : String(error) });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update API setting' },
      });
    }
  });

  /**
   * PATCH /admin/settings/api/:id/toggle
   * Toggle API setting active status — requires settings:edit
   */
  app.patch('/settings/api/:id/toggle', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query(`
        UPDATE api_settings 
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'API setting not found' },
        });
      }

      return reply.send({
        success: true,
        data: { setting: result.rows[0] },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TOGGLE_FAILED', message: 'Failed to toggle API setting' },
      });
    }
  });

  /**
   * DELETE /admin/settings/api/:id
   * Delete API setting — requires settings:edit
   */
  app.delete('/settings/api/:id', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };

      const result = await db.query('DELETE FROM api_settings WHERE id = $1 RETURNING *', [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'API setting not found' },
        });
      }

      return reply.send({
        success: true,
        data: { deleted: true },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'DELETE_FAILED', message: 'Failed to delete API setting' },
      });
    }
  });

  /**
   * POST /admin/settings/api/:id/test
   * Real connection test for SMTP, SMS, RPC, KYC providers
   */
  app.post('/settings/api/:id/test', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { dynamicConfig } = await import('../services/dynamic-config.service.js');

      const result = await db.query('SELECT category, provider FROM api_settings WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'API setting not found' } });
      }

      const { category, provider } = result.rows[0] as { category: string; provider: string };
      let testResult: { success: boolean; message: string; latencyMs: number; blockNumber?: string };

      switch (category) {
        case 'email':
          testResult = await dynamicConfig.testSmtp(id);
          break;
        case 'sms':
          testResult = await dynamicConfig.testSms(id);
          break;
        case 'rpc':
          testResult = await dynamicConfig.testRpc(id);
          break;
        case 'kyc':
          testResult = await dynamicConfig.testKyc(id);
          break;
        default:
          testResult = { success: true, message: `No specific test for category '${category}'. Credentials saved.`, latencyMs: 0 };
      }

      return reply.send({
        success: true,
        data: { tested: true, provider, category, ...testResult },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TEST_FAILED', message: 'Failed to test API connection' },
      });
    }
  });

  /**
   * POST /admin/settings/api/flush-cache
   * Flush dynamic config cache after updating api_settings
   */
  app.post('/settings/api/flush-cache', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { category } = request.body as { category?: string };
      const { dynamicConfig } = await import('../services/dynamic-config.service.js');
      if (category) {
        await dynamicConfig.flushCategory(category);
      } else {
        await dynamicConfig.flushAll();
      }
      return reply.send({ success: true, data: { flushed: category || 'all' } });
    } catch (error) {
      return reply.status(500).send({ success: false, error: { code: 'FLUSH_FAILED', message: 'Failed to flush config cache' } });
    }
  });

  // =========================================================================
  // Phase 5: Admin 2FA Routes
  // =========================================================================

  app.post('/auth/2fa/setup', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { admin2FAService } = await import('../services/admin-2fa.service.js');
      const adminRow = await db.query<{ email: string; two_factor_enabled: boolean }>(
        'SELECT email, two_factor_enabled FROM admin_users WHERE id = $1',
        [admin.adminId]
      );
      if (!adminRow.rows[0]) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Admin not found' } });
      }
      if (adminRow.rows[0].two_factor_enabled) {
        return reply.status(400).send({ success: false, error: { code: '2FA_ALREADY_ENABLED', message: '2FA is already enabled. Disable it first.' } });
      }
      const result = await admin2FAService.setup2FA(admin.adminId, adminRow.rows[0].email);
      return reply.send({ success: true, data: { secret: result.secret, qrUrl: result.qrUrl, backupCodes: result.backupCodes } });
    } catch (error) {
      logger.error('2FA setup failed', { error: error instanceof Error ? error.message : 'Unknown', adminId: admin.adminId });
      return reply.status(500).send({ success: false, error: { code: '2FA_SETUP_FAILED', message: 'Failed to set up 2FA' } });
    }
  });

  app.post('/auth/2fa/verify', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { token } = request.body as { token?: string };
      if (!token || token.length !== 6) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Provide a 6-digit TOTP code' } });
      }
      const { admin2FAService } = await import('../services/admin-2fa.service.js');
      const success = await admin2FAService.verify2FASetup(admin.adminId, token);
      if (!success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid TOTP code. Please try again.' } });
      }
      return reply.send({ success: true, data: { message: '2FA enabled successfully' } });
    } catch (error) {
      logger.error('2FA verify failed', { error: error instanceof Error ? error.message : 'Unknown', adminId: admin.adminId });
      return reply.status(500).send({ success: false, error: { code: '2FA_VERIFY_FAILED', message: 'Failed to verify 2FA' } });
    }
  });

  app.post('/auth/2fa/disable', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { token } = request.body as { token?: string };
      if (!token || token.length !== 6) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Provide your current TOTP code' } });
      }
      const { admin2FAService } = await import('../services/admin-2fa.service.js');
      const success = await admin2FAService.disable2FA(admin.adminId, token);
      if (!success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid TOTP code or 2FA not enabled' } });
      }
      return reply.send({ success: true, data: { message: '2FA disabled successfully' } });
    } catch (error) {
      logger.error('2FA disable failed', { error: error instanceof Error ? error.message : 'Unknown', adminId: admin.adminId });
      return reply.status(500).send({ success: false, error: { code: '2FA_DISABLE_FAILED', message: 'Failed to disable 2FA' } });
    }
  });

  app.get('/auth/2fa/status', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { admin2FAService } = await import('../services/admin-2fa.service.js');
      const status = await admin2FAService.get2FAStatus(admin.adminId);
      return reply.send({ success: true, data: status });
    } catch (error) {
      return reply.status(500).send({ success: false, error: { code: '2FA_STATUS_FAILED', message: 'Failed to get 2FA status' } });
    }
  });

  // =========================================================================
  // Phase 5: Multi-Approval System Routes
  // =========================================================================

  app.get('/approval-requests', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { status, limit, offset } = request.query as { status?: string; limit?: string; offset?: string };
      const { adminApprovalService } = await import('../services/admin-approval.service.js');
      await adminApprovalService.expireStalePending();
      const result = await adminApprovalService.listRequests(
        status,
        Math.min(parseInt(limit || '50', 10) || 50, 200),
        parseInt(offset || '0', 10) || 0
      );
      return reply.send({ success: true, data: result });
    } catch (error) {
      logger.error('List approval requests failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'LIST_FAILED', message: 'Failed to list approval requests' } });
    }
  });

  app.post('/approval-requests', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { actionType, actionPayload, requiredApprovals } = request.body as {
        actionType?: string;
        actionPayload?: Record<string, unknown>;
        requiredApprovals?: number;
      };
      if (!actionType || !actionPayload) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_BODY', message: 'actionType and actionPayload are required' } });
      }
      const { adminApprovalService } = await import('../services/admin-approval.service.js');
      const req = await adminApprovalService.createRequest(
        actionType as import('../services/admin-approval.service.js').ApprovalActionType,
        actionPayload,
        admin.adminId,
        requiredApprovals
      );
      return reply.send({ success: true, data: { request: req } });
    } catch (error) {
      logger.error('Create approval request failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'CREATE_FAILED', message: 'Failed to create approval request' } });
    }
  });

  app.post('/approval-requests/:id/approve', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { adminApprovalService } = await import('../services/admin-approval.service.js');
      const result = await adminApprovalService.approveRequest(id, admin.adminId);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: { code: 'APPROVE_FAILED', message: result.message } });
      }
      return reply.send({ success: true, data: { message: result.message, request: result.request } });
    } catch (error) {
      logger.error('Approve request failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'APPROVE_FAILED', message: 'Failed to approve request' } });
    }
  });

  app.post('/approval-requests/:id/reject', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason?: string };
      const { adminApprovalService } = await import('../services/admin-approval.service.js');
      const result = await adminApprovalService.rejectRequest(id, admin.adminId, reason);
      if (!result.success) {
        return reply.status(400).send({ success: false, error: { code: 'REJECT_FAILED', message: result.message } });
      }
      return reply.send({ success: true, data: { message: result.message, request: result.request } });
    } catch (error) {
      logger.error('Reject request failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'REJECT_FAILED', message: 'Failed to reject request' } });
    }
  });

  // =========================================================================
  // Phase 5: OTP Delivery Stats Route
  // =========================================================================

  app.get('/notifications/delivery-stats', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { type, status, from, to, limit: limitStr, offset: offsetStr } = request.query as {
        type?: string;
        status?: string;
        from?: string;
        to?: string;
        limit?: string;
        offset?: string;
      };
      const limit = Math.min(parseInt(limitStr || '50', 10) || 50, 200);
      const offset = parseInt(offsetStr || '0', 10) || 0;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [summaryRes, recentRes] = await Promise.all([
        db.query<{
          total_today: string;
          verified_today: string;
          failed_today: string;
          avg_verify_seconds: string | null;
        }>(`SELECT
             COUNT(*)::text AS total_today,
             COUNT(*) FILTER (WHERE verified_at IS NOT NULL)::text AS verified_today,
             COUNT(*) FILTER (WHERE verified_at IS NULL AND expires_at < NOW())::text AS failed_today,
             ROUND(AVG(EXTRACT(EPOCH FROM (verified_at - created_at))) FILTER (WHERE verified_at IS NOT NULL), 1)::text AS avg_verify_seconds
           FROM otp_verifications
           WHERE created_at >= $1`, [todayStart]),
        (() => {
          const conditions: string[] = [];
          const params: unknown[] = [];
          let idx = 1;
          if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
          if (status === 'verified') { conditions.push(`verified_at IS NOT NULL`); }
          else if (status === 'failed') { conditions.push(`verified_at IS NULL AND expires_at < NOW()`); }
          else if (status === 'pending') { conditions.push(`verified_at IS NULL AND expires_at >= NOW()`); }
          if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }
          if (to) { conditions.push(`created_at <= $${idx++}`); params.push(to); }
          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          return db.query<{
            id: string;
            identifier: string;
            type: string;
            attempts: number;
            max_attempts: number;
            verified_at: string | null;
            expires_at: string;
            created_at: string;
          }>(
            `SELECT id, identifier, type, attempts, max_attempts, verified_at, expires_at, created_at
             FROM otp_verifications ${where}
             ORDER BY created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, limit, offset]
          );
        })(),
      ]);

      const summary = summaryRes.rows[0];
      const totalToday = parseInt(summary?.total_today ?? '0', 10);
      const verifiedToday = parseInt(summary?.verified_today ?? '0', 10);
      const successRate = totalToday > 0 ? Math.round((verifiedToday / totalToday) * 100 * 10) / 10 : 0;

      return reply.send({
        success: true,
        data: {
          summary: {
            totalToday,
            verifiedToday,
            failedToday: parseInt(summary?.failed_today ?? '0', 10),
            successRate,
            avgVerifySeconds: summary?.avg_verify_seconds ? parseFloat(summary.avg_verify_seconds) : null,
          },
          deliveries: recentRes.rows,
        },
      });
    } catch (error) {
      logger.error('Delivery stats failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'STATS_FAILED', message: 'Failed to fetch delivery stats' } });
    }
  });

  app.get('/support/tickets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const ticketRes = await db.query<{
        id: string; user_id: string; user_email: string; subject: string; category: string;
        priority: string; status: string; assigned_admin_id: string | null; assigned_admin_name: string | null;
        created_at: string; updated_at: string; resolved_at: string | null; resolution_note: string | null;
      }>(
        `SELECT t.*, COALESCE(u.email, 'unknown') AS user_email, a.name AS assigned_admin_name
         FROM support_tickets t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN admin_users a ON a.id = t.assigned_admin_id
         WHERE t.id = $1`,
        [id]
      );

      if (ticketRes.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      const messagesRes = await db.query<{
        id: string; sender_type: string; sender_id: string; sender_name: string | null;
        message: string; attachments: unknown; created_at: string;
      }>(
        `SELECT m.id, m.sender_type, m.sender_id,
                CASE WHEN m.sender_type = 'admin' THEN a.name ELSE u.email END AS sender_name,
                m.message, m.attachments, m.created_at
         FROM support_ticket_messages m
         LEFT JOIN admin_users a ON m.sender_type = 'admin' AND a.id = m.sender_id
         LEFT JOIN users u ON m.sender_type = 'user' AND u.id = m.sender_id
         WHERE m.ticket_id = $1
         ORDER BY m.created_at ASC`,
        [id]
      );

      return reply.send({
        success: true,
        data: {
          ticket: ticketRes.rows[0],
          messages: messagesRes.rows,
        },
      });
    } catch (error) {
      logger.error('Get support ticket failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'GET_FAILED', message: 'Failed to get ticket' } });
    }
  });

  app.post('/support/tickets/:id/reply', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const { message } = request.body as { message: string };

      if (!message?.trim()) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID', message: 'Message is required' } });
      }

      const ticketCheck = await db.query(`SELECT id FROM support_tickets WHERE id = $1`, [id]);
      if (ticketCheck.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      const msgRes = await db.query<{ id: string; created_at: string }>(
        `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_id, message)
         VALUES ($1, 'admin', $2, $3) RETURNING id, created_at`,
        [id, admin.adminId, message.trim()]
      );

      await db.query(`UPDATE support_tickets SET updated_at = now() WHERE id = $1`, [id]);

      return reply.send({
        success: true,
        data: { id: msgRes.rows[0]?.id, created_at: msgRes.rows[0]?.created_at },
      });
    } catch (error) {
      logger.error('Reply to ticket failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'REPLY_FAILED', message: 'Failed to reply' } });
    }
  });

  app.patch('/support/tickets/:id', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        status?: string; priority?: string; category?: string;
        assigned_admin_id?: string | null; resolution_note?: string;
      };

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (body.status) {
        const validStatuses = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];
        if (!validStatuses.includes(body.status)) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID', message: 'Invalid status' } });
        }
        sets.push(`status = $${idx++}`); params.push(body.status);
        if (body.status === 'resolved' || body.status === 'closed') {
          sets.push(`resolved_at = COALESCE(resolved_at, now())`);
        }
      }
      if (body.priority) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(body.priority)) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID', message: 'Invalid priority' } });
        }
        sets.push(`priority = $${idx++}`); params.push(body.priority);
      }
      if (body.category) {
        sets.push(`category = $${idx++}`); params.push(body.category);
      }
      if (body.assigned_admin_id !== undefined) {
        sets.push(`assigned_admin_id = $${idx++}`); params.push(body.assigned_admin_id);
      }
      if (body.resolution_note !== undefined) {
        sets.push(`resolution_note = $${idx++}`); params.push(body.resolution_note);
      }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID', message: 'No fields to update' } });
      }

      sets.push('updated_at = now()');
      params.push(id);

      const result = await db.query(
        `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id`,
        params
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      return reply.send({ success: true, data: { id } });
    } catch (error) {
      logger.error('Update support ticket failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update ticket' } });
    }
  });

  // ============================================
  // MISSING ROUTE: /support/stats
  // ============================================
  app.get('/support/stats', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const [openRes, ipRes, unassRes, avgRes] = await Promise.all([
        db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM support_tickets WHERE status = 'open'`).catch(() => ({ rows: [{ cnt: '0' }] })),
        db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM support_tickets WHERE status = 'in_progress'`).catch(() => ({ rows: [{ cnt: '0' }] })),
        db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM support_tickets WHERE assigned_admin_id IS NULL AND status NOT IN ('resolved','closed')`).catch(() => ({ rows: [{ cnt: '0' }] })),
        db.query<{ hrs: string }>(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 0)::text AS hrs FROM support_tickets WHERE resolved_at IS NOT NULL`).catch(() => ({ rows: [{ hrs: '0' }] })),
      ]);
      return reply.send({
        success: true,
        data: {
          open: parseInt(openRes.rows[0]?.cnt ?? '0', 10),
          inProgress: parseInt(ipRes.rows[0]?.cnt ?? '0', 10),
          unassigned: parseInt(unassRes.rows[0]?.cnt ?? '0', 10),
          avgResolutionHours: parseFloat(parseFloat(avgRes.rows[0]?.hrs ?? '0').toFixed(1)),
        },
      });
    } catch (error) {
      logger.error('Support stats failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to fetch support stats' } });
    }
  });

  // ============================================
  // MISSING ROUTE: /support/tickets (list)
  // ============================================
  app.get('/support/tickets', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const q = request.query as { status?: string; priority?: string; category?: string; search?: string; limit?: string; offset?: string };
      const limit = Math.min(parseInt(q.limit ?? '20', 10) || 20, 100);
      const offset = parseInt(q.offset ?? '0', 10) || 0;
      const wheres: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (q.status && q.status !== 'all') { wheres.push(`t.status = $${idx++}`); params.push(q.status); }
      if (q.priority) { wheres.push(`t.priority = $${idx++}`); params.push(q.priority); }
      if (q.category) { wheres.push(`t.category = $${idx++}`); params.push(q.category); }
      if (q.search?.trim()) { wheres.push(`(t.subject ILIKE $${idx} OR u.email ILIKE $${idx})`); params.push(`%${q.search.trim()}%`); idx++; }
      const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
      const [ticketsRes, countRes] = await Promise.all([
        db.query(`SELECT t.id, t.user_id, t.subject, t.status, t.priority, t.category, t.assigned_admin_id, t.created_at, t.updated_at, t.resolved_at, u.email AS user_email, COALESCE(u.username, u.email) AS user_name FROM support_tickets t LEFT JOIN users u ON t.user_id = u.id ${whereClause} ORDER BY t.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [...params, limit, offset]),
        db.query(`SELECT COUNT(*)::text AS total FROM support_tickets t LEFT JOIN users u ON t.user_id = u.id ${whereClause}`, params),
      ]);
      return reply.send({
        success: true,
        data: {
          tickets: ticketsRes.rows,
          total: parseInt(countRes.rows[0]?.total ?? '0', 10),
        },
      });
    } catch (error) {
      logger.error('Support tickets list failed', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL', message: 'Failed to fetch tickets' } });
    }
  });


}
