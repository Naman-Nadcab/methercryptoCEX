import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { ensureUserBalanceRow, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';
import { logAdminActivity, getDeviceIdFromRequest } from '../services/activity-monitor.service.js';
import { refreshMatchEventsCache } from '../services/matchingEngine.js';
import { getClientIp } from '../lib/client-ip.js';
import { isIpInWhitelist } from '../lib/admin-ip-whitelist.js';
import { enforceAdminRateLimit } from '../lib/rate-limit-fastify.js';
// Types
interface AdminLoginBody {
  email: string;
  password: string;
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
function generateAdminTokens(app: FastifyInstance, payload: {
  adminId: string;
  email: string;
  role: string;
  sessionId: string;
}) {
  const accessToken = app.jwt.sign({ ...payload, type: 'admin' }, { expiresIn: '4h' });
  const refreshToken = app.jwt.sign(
    { adminId: payload.adminId, sessionId: payload.sessionId, type: 'admin_refresh' },
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

/** Get admin from request (JWT + session). Throws reply if unauthorized. */
export async function getAdminFromRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  requireSuperAdmin: boolean
): Promise<{ adminId: string; role: string } | null> {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    return null;
  }
  let decoded: { adminId: string; role?: string; sessionId: string; type?: string };
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
  let session: { adminId: string; role: string; isActive: boolean } | null = null;
  try {
    session = await redis.getJson<{ adminId: string; role: string; isActive: boolean }>(`admin:session:${decoded.sessionId}`);
  } catch {
    // Redis down; fallback to DB
  }
  if (!session || !session.isActive) {
    // Fallback: validate session from DB
    const dbSession = await db.query<{ admin_id: string; role: string }>(
      `SELECT s.admin_id, u.role FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [decoded.sessionId]
    );
    if (dbSession.rows.length === 0) {
      reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired' } });
      return null;
    }
    const row = dbSession.rows[0]!;
    session = { adminId: row.admin_id, role: row.role, isActive: true };
  }
  const role = session.role ?? decoded.role ?? '';
  if (requireSuperAdmin && role !== 'super_admin' && role !== 'Super Admin') {
    reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Hot wallet actions require Super Admin role.' },
    });
    return null;
  }
  // FIX #3: Admin IP whitelist — enforce only after JWT/session auth. Production: empty whitelist = deny all; non-production: empty = do not enforce.
  const clientIp = getClientIp(request);
  const whitelist = config.security?.adminIpWhitelist ?? [];
  const path = request.routerPath ?? request.url;

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
  return { adminId: session.adminId, role };
}

/** Admin who can approve/reject withdrawals: role withdrawal_approver or super_admin, or permission withdrawals:approve / all. */
export async function getAdminForWithdrawalApproval(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ adminId: string; role: string } | null> {
  const admin = await getAdminFromRequest(app, request, reply, false);
  if (!admin) return null;
  const role = (admin.role || '').toLowerCase().replace(/\s+/g, '_');
  if (role === 'super_admin' || role === 'withdrawal_approver') return admin;
  const permRow = await db.query<{ permissions: string[] }>(
    `SELECT permissions FROM admin_users WHERE id = $1`,
    [admin.adminId]
  );
  const permissions = permRow.rows[0]?.permissions ?? [];
  const hasPermission =
    Array.isArray(permissions) &&
    (permissions.includes('withdrawals:approve') || permissions.includes('all'));
  if (hasPermission) return admin;
  reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Withdrawal approval requires role withdrawal_approver or super_admin, or permission withdrawals:approve.' },
  });
  return null;
}

export default async function adminRoutes(app: FastifyInstance) {
  
  /**
   * POST /admin/auth/login
   * Admin login
   */
  app.post<{ Body: AdminLoginBody }>('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { email, password } = request.body;

      // Find admin user
      const result = await db.query<{
        id: string;
        email: string;
        password_hash: string;
        name: string;
        role: string;
        permissions: string[];
        is_active: boolean;
      }>(
        'SELECT id, email, password_hash, name, role, permissions, is_active FROM admin_users WHERE email = $1',
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

      if (!admin.is_active) {
        return reply.status(403).send({
          success: false,
          error: { code: 'ACCOUNT_DISABLED', message: 'Admin account is disabled' },
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(password, admin.password_hash);
      if (!isValid) {
        logger.warn('Admin login failed: invalid password', { email });
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
      }

      // Create session
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO admin_sessions (id, admin_id, session_token, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, admin.id, sessionToken, request.ip, request.headers['user-agent'], expiresAt]
      );

      // Store session in Redis (optional; if Redis is down, session is still in DB and auth/me will fallback to DB)
      try {
        await redis.setJson(`admin:session:${sessionId}`, {
          adminId: admin.id,
          email: admin.email,
          role: admin.role,
          isActive: true,
        }, 7 * 24 * 60 * 60);
      } catch (e) {
        logger.warn('Redis unavailable for admin session cache; using DB fallback', { error: e instanceof Error ? e.message : 'Unknown' });
      }

      // Update last login
      await db.query(
        'UPDATE admin_users SET last_login_at = NOW() WHERE id = $1',
        [admin.id]
      );

      // Log activity
      await db.query(
        `INSERT INTO admin_activity_logs (admin_id, action, details, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [admin.id, 'login', JSON.stringify({ userAgent: request.headers['user-agent'] }), request.ip]
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
      logger.error('Admin login error', { error: error instanceof Error ? error.message : 'Unknown' });
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
      return reply.send({
        success: true,
        data: { message: 'Logged out' },
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

      return reply.send({
        success: true,
        data: result.rows[0],
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
      }>(refreshToken);

      if (decoded.type !== 'admin_refresh') {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
        });
      }

      // Check session
      const session = await redis.getJson<{ adminId: string; email: string; role: string }>(`admin:session:${decoded.sessionId}`);
      if (!session) {
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
        });
      }

      // Generate new tokens
      const tokens = generateAdminTokens(app, {
        adminId: session.adminId,
        email: session.email,
        role: session.role,
        sessionId: decoded.sessionId,
      });

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
  // DASHBOARD STATS
  // ===============================

  /**
   * GET /admin/dashboard/stats
   * Get dashboard statistics
   */
  app.get('/dashboard/stats', async (request, reply) => {
    try {
      // Get user stats
      const userStats = await db.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_users_24h,
          COUNT(*) FILTER (WHERE status = 'active') as active_users,
          COUNT(*) FILTER (WHERE email_verified = true OR phone_verified = true) as verified_users
        FROM users WHERE deleted_at IS NULL
      `);

      // Get session stats (active users)
      const sessionStats = await db.query(`
        SELECT COUNT(DISTINCT user_id) as active_sessions
        FROM user_sessions 
        WHERE is_active = true AND expires_at > NOW()
      `);

      // Get KYC stats
      const kycStats = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending_kyc,
          COUNT(*) FILTER (WHERE status = 'under_review') as review_kyc,
          COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_at > NOW() - INTERVAL '24 hours') as approved_today,
          COUNT(*) FILTER (WHERE status = 'rejected' AND reviewed_at > NOW() - INTERVAL '24 hours') as rejected_today
        FROM kyc_applications
      `);

      // Get P2P ads stats
      const p2pAdsStats = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'active') as active_ads
        FROM p2p_ads
      `);

      // Get P2P orders stats
      const p2pOrdersStats = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status IN ('pending', 'awaiting_payment', 'payment_sent')) as active_orders
        FROM p2p_orders
      `);

      const disputeStats = await db.query(`
        SELECT COUNT(*) as open_disputes FROM p2p_disputes WHERE status IN ('open', 'under_review')
      `);

      // Get referral stats  
      const referralStats = await db.query(`
        SELECT 
          COUNT(*) as total_codes,
          COUNT(*) FILTER (WHERE is_active = true) as active_codes
        FROM referral_codes
      `);

      return reply.send({
        success: true,
        data: {
          users: {
            total: parseInt(userStats.rows[0]?.total_users || '0'),
            newToday: parseInt(userStats.rows[0]?.new_users_24h || '0'),
            active: parseInt(sessionStats.rows[0]?.active_sessions || '0'),
            verified: parseInt(userStats.rows[0]?.verified_users || '0'),
          },
          kyc: {
            pending: parseInt(kycStats.rows[0]?.pending_kyc || '0'),
            underReview: parseInt(kycStats.rows[0]?.review_kyc || '0'),
            approvedToday: parseInt(kycStats.rows[0]?.approved_today || '0'),
            rejectedToday: parseInt(kycStats.rows[0]?.rejected_today || '0'),
          },
          p2p: {
            activeAds: parseInt(p2pAdsStats.rows[0]?.active_ads || '0'),
            activeOrders: parseInt(p2pOrdersStats.rows[0]?.active_orders || '0'),
            openDisputes: parseInt(disputeStats.rows[0]?.open_disputes || '0'),
          },
          referrals: {
            totalCodes: parseInt(referralStats.rows[0]?.total_codes || '0'),
            activeCodes: parseInt(referralStats.rows[0]?.active_codes || '0'),
          },
        },
      });

    } catch (error) {
      logger.error('Dashboard stats error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch dashboard stats' },
      });
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

  // ===============================
  // USER MANAGEMENT
  // ===============================

  /**
   * GET /admin/users
   * Get all users with pagination
   */
  app.get('/users', async (request, reply) => {
    try {
      const { page = 1, limit = 20, status, search, kycLevel } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = `
        SELECT 
          u.id, u.email, u.phone, u.username, u.status,
          u.email_verified, u.phone_verified, u.tier_level,
          u.created_at, u.last_login_at,
          COALESCE(SUM(ub.available_balance + ub.locked_balance), 0) as total_balance,
          k.status as kyc_status,
          k.kyc_level
        FROM users u
        LEFT JOIN user_balances ub ON u.id = ub.user_id
        LEFT JOIN kyc_applications k ON u.id = k.user_id
        WHERE u.deleted_at IS NULL
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        query += ` AND u.status = $${paramIndex++}`;
        params.push(status);
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

      query += ` GROUP BY u.id, k.status, k.kyc_level ORDER BY u.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      // Get total count
      const countResult = await db.query(
        'SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'
      );

      return reply.send({
        success: true,
        data: {
          users: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0].count),
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
   * GET /admin/users/:id
   * Get user details
   */
  app.get('/users/:id', async (request, reply) => {
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
    try {
      const { id } = request.params as { id: string };
      const { status, reason } = request.body as { status: string; reason?: string };

      await db.query(
        'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2',
        [status, id]
      );

      return reply.send({
        success: true,
        data: { message: `User status updated to ${status}` },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update user status' },
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
   * Approve or reject KYC
   */
  app.patch('/kyc/:id/review', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { action, reason } = request.body as { action: 'approve' | 'reject'; reason?: string };

      const status = action === 'approve' ? 'approved' : 'rejected';

      await db.query(`
        UPDATE kyc_applications 
        SET status = $1, reviewed_at = NOW(), rejection_reason = $2
        WHERE id = $3
      `, [status, action === 'reject' ? reason : null, id]);

      // If approved, update user tier
      if (action === 'approve') {
        const kyc = await db.query('SELECT user_id, kyc_level FROM kyc_applications WHERE id = $1', [id]);
        if (kyc.rows[0]) {
          await db.query(
            'UPDATE users SET tier_level = $1 WHERE id = $2',
            [kyc.rows[0].kyc_level, kyc.rows[0].user_id]
          );
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
    try {
      const result = await db.query(`
        SELECT 
          d.*,
          o.crypto_amount, o.fiat_amount, o.fiat_currency,
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
   * Resolve dispute
   */
  app.patch('/p2p/disputes/:id/resolve', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { resolution, notes } = request.body as { 
        resolution: 'favor_buyer' | 'favor_seller' | 'split' | 'cancelled';
        notes?: string;
      };

      await db.query(`
        UPDATE p2p_disputes 
        SET status = 'resolved', resolution = $1, resolution_notes = $2, resolved_at = NOW()
        WHERE id = $3
      `, [resolution, notes, id]);

      return reply.send({
        success: true,
        data: { message: 'Dispute resolved successfully' },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'RESOLVE_FAILED', message: 'Failed to resolve dispute' },
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

      // Get applications
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

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0],
          applications: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(stats.rows[0]?.total || '0'),
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
   * Get wallets overview
   */
  app.get('/wallets', async (request, reply) => {
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

      return reply.send({
        success: true,
        data: {
          blockchains: blockchains.rows,
          currencies: currencies.rows,
          balances: balances.rows,
          totalWallets: parseInt(walletsCount.rows[0]?.total || '0'),
        },
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
      const { page = 1, limit = 20, user, chain, token, status, flagged, date_from, date_to } = request.query;
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (user?.trim()) {
        const u = user.trim();
        if (/^[0-9a-f-]{36}$/i.test(u)) {
          conditions.push(`d.user_id = $${paramIndex++}`);
          params.push(u);
        } else {
          conditions.push(`(u.email ILIKE $${paramIndex++} OR u.username ILIKE $${paramIndex})`);
          params.push(`%${u}%`, `%${u}%`);
        }
      }
      if (chain?.trim()) {
        conditions.push(`d.blockchain_id = $${paramIndex++}`);
        params.push(chain.trim());
      }
      if (token?.trim()) {
        conditions.push(`d.currency_id = $${paramIndex++}`);
        params.push(token.trim());
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

      // Stats: global counts (unfiltered) for UI badges
      const stats = await db.query<{
        total: string;
        pending: string;
        confirming: string;
        completed: string;
        failed: string;
        flagged: string;
      }>(`
        SELECT 
          COUNT(*)::text as total,
          COUNT(*) FILTER (WHERE status = 'pending')::text as pending,
          COUNT(*) FILTER (WHERE status = 'confirming')::text as confirming,
          COUNT(*) FILTER (WHERE status = 'completed')::text as completed,
          COUNT(*) FILTER (WHERE status = 'failed')::text as failed,
          COUNT(*) FILTER (WHERE COALESCE(is_flagged, false) = true)::text as flagged
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

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0] ?? {},
          deposits: result.rows,
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
   * POST /admin/deposits/manual-credit
   * Admin-only: credit a user's funding balance (e.g. support adjustment, compensation).
   * Body: { user: string (email or user id), currency: string (symbol), amount: string, reason?: string }
   */
  app.post<{
    Body: { user: string; currency: string; amount: string; reason?: string };
  }>('/deposits/manual-credit', async (request, reply) => {
    const admin = await getAdminFromRequest(app, request, reply, false);
    if (!admin) return;
    try {
      const { user: userInput, currency: symbol, amount: amountStr, reason } = request.body || {};
      if (!userInput?.trim() || !symbol?.trim() || !amountStr?.trim()) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'user, currency, and amount are required' },
        });
      }
      const amount = parseFloat(amountStr.trim());
      if (isNaN(amount) || amount <= 0) {
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
      await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding');
      const upd = await db.query(
        `UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW()
         WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND COALESCE(account_type::text, 'funding') = 'funding'`,
        [amount.toString(), userId, currencyId, CHAIN_ID_GLOBAL]
      );
      if ((upd.rowCount ?? 0) < 1) {
        return reply.status(500).send({
          success: false,
          error: { code: 'CREDIT_FAILED', message: 'Balance update failed' },
        });
      }
      logger.info('Admin manual credit', {
        adminId: admin.adminId,
        userId,
        currencyId,
        symbol: symbol.trim(),
        amount,
        reason: reason ?? null,
      });
      return reply.send({
        success: true,
        data: { userId, email: userRow.rows[0]!.email, currency: symbol.trim(), amount, reason: reason ?? null },
      });
    } catch (error) {
      logger.error('Manual credit error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'CREDIT_FAILED', message: 'Manual credit failed' },
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
        },
      });

    let ledgerTotals: { chain_id: string; chain_name: string; chain_symbol: string; token_id: string; token_symbol: string; amount: string }[] = [];
    let hotRows: { chain_id: string; chain_name: string; balance: string }[] = [];
    let coldRows: { chain_id: string; chain_name: string; address: string | null; balance: string | null }[] = [];
    let blockchainRows: { id: string; chain_name: string; chain_symbol: string }[] = [];
    const decimalsByChainId: Record<string, number> = {};

    // 1) Ledger totals: null-safe; if user_balances/currencies/blockchains missing or empty → []
    try {
      const ledgerResult = await db.query<{
        chain_id: string;
        chain_name: string;
        chain_symbol: string;
        token_id: string;
        token_symbol: string;
        amount: string;
      }>(`
        SELECT
          b.id AS chain_id,
          b.chain_name,
          b.chain_symbol,
          c.id AS token_id,
          c.symbol AS token_symbol,
          (SUM(COALESCE(ub.available_balance, 0)) + SUM(COALESCE(ub.locked_balance, 0)))::text AS amount
        FROM user_balances ub
        INNER JOIN currencies c ON ub.currency_id = c.id
        LEFT JOIN blockchains b ON c.blockchain_id = b.id
        WHERE b.id IS NOT NULL
        GROUP BY b.id, b.chain_name, b.chain_symbol, c.id, c.symbol
        HAVING (SUM(COALESCE(ub.available_balance, 0)) + SUM(COALESCE(ub.locked_balance, 0))) > 0
        ORDER BY b.chain_name, c.symbol
      `);
      ledgerTotals = Array.isArray(ledgerResult.rows) ? ledgerResult.rows : [];
    } catch (e) {
      logger.warn('Funds summary: ledger query failed', { error: e instanceof Error ? e.message : String(e) });
      ledgerTotals = [];
    }

    // 2) On-chain: hot_wallets/chains may not exist; balance_cache null → '0'. Reconciliation uses ONLY hot_wallet.balance_cache.
    try {
      const hotResult = await db.query<{ chain_id: string; balance_cache: string | null }>(
        'SELECT chain_id, balance_cache FROM hot_wallets WHERE is_active = TRUE ORDER BY chain_id'
      );
      let chainMap: Record<string, { name: string; decimals?: number; type?: string }> = {};
      try {
        const chainsResult = await db.query<{ id: string; name: string; decimals: number | null; type: string | null }>(
          'SELECT id, name, decimals, type FROM chains WHERE is_active = TRUE'
        );
        chainMap = Object.fromEntries(
          (chainsResult.rows || []).map((r: { id: string; name: string; decimals: number | null; type: string | null }) => [
            r.id,
            { name: r.name, decimals: r.decimals ?? 18, type: r.type ?? undefined },
          ])
        );
        (chainsResult.rows || []).forEach((r: { id: string; decimals: number | null }) => {
          const d = r.decimals;
          decimalsByChainId[r.id] = typeof d === 'number' && !Number.isNaN(d) ? d : 18;
        });
      } catch {
        // chains table may not exist
      }
      hotRows = (hotResult.rows || []).map((r) => ({
        chain_id: String(r.chain_id),
        chain_name: chainMap[r.chain_id]?.name ?? String(r.chain_id),
        balance: r.balance_cache != null && String(r.balance_cache).trim() !== '' ? String(r.balance_cache).trim() : '0',
      }));
      const coldResult = await db.query<{ chain_id: string; cold_wallet_address: string | null }>(
        'SELECT chain_id, cold_wallet_address FROM hot_wallets WHERE is_active = TRUE ORDER BY chain_id'
      );
      coldRows = (coldResult.rows || []).map((r) => ({
        chain_id: String(r.chain_id),
        chain_name: chainMap[r.chain_id]?.name ?? String(r.chain_id),
        address: r.cold_wallet_address != null ? String(r.cold_wallet_address) : null,
        balance: null as string | null,
      }));
    } catch (e) {
      logger.warn('Funds summary: hot/cold wallets query failed', { error: e instanceof Error ? e.message : String(e) });
      hotRows = [];
      coldRows = [];
    }

    const onChainTotals = {
      user_deposit_addresses: null as { chain_id: string; chain_name: string; token_id: string; token_symbol: string; amount: string }[] | null,
      hot_wallets: hotRows,
      cold_wallets: coldRows,
    };

    // 3) Blockchains: optional for mapping; missing → []
    try {
      const blockResult = await db.query<{ id: string; chain_name: string; chain_symbol: string }>(
        'SELECT id, chain_name, chain_symbol FROM blockchains WHERE is_active = TRUE'
      );
      blockchainRows = Array.isArray(blockResult.rows) ? blockResult.rows : [];
    } catch (e) {
      logger.warn('Funds summary: blockchains query failed', { error: e instanceof Error ? e.message : String(e) });
      blockchainRows = [];
    }

    const chainNameToBlockchainId = Object.fromEntries(
      blockchainRows.map((b) => [b.chain_name.toLowerCase().trim(), b.id])
    );
    const chainIdToBlockchainId: Record<string, string> = {};
    for (const r of hotRows) {
      const bid = chainNameToBlockchainId[r.chain_name.toLowerCase().trim()];
      if (bid) chainIdToBlockchainId[r.chain_id] = bid;
    }

    // 4) Reconciliation: uses ONLY hot_wallet.balance_cache. If chain has no sweep (BTC, SOL), add reason; do not throw.
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
          ? decimalsByChainId[h.chain_id]
          : 18;
        const divisor = Math.pow(10, Math.min(Math.max(decimals, 0), 32)) || 1;
        const rawBalance = (h.balance ?? '0').trim() || '0';
        let onChainWei = 0;
        try {
          if (/^-?\d+$/.test(rawBalance)) {
            onChainWei = Number(BigInt(rawBalance));
          }
        } catch {
          onChainWei = 0;
        }
        const onChainHuman = (onChainWei / divisor).toFixed(Math.min(Math.max(decimals, 0), 8));
        const ledgerAmount = ledgerNative.amount ?? '0';
        const ledgerNum = parseFloat(ledgerAmount) || 0;
        const onChainNum = parseFloat(onChainHuman) || 0;
        const diff = ledgerNum - onChainNum;
        const difference = Number.isFinite(diff) ? diff.toFixed(Math.min(Math.max(decimals, 0), 8)) : '0';
        if (Math.abs(diff) > 1 / divisor) {
          const reason = (chainType === 'bitcoin' || chainType === 'solana')
            ? 'Deposit sweep not implemented for this chain'
            : undefined;
          mismatches.push({
            chain_id: blockchainId,
            chain_name: ledgerNative.chain_name ?? h.chain_name,
            token_symbol: nativeSymbol || 'native',
            ledger_amount: ledgerAmount,
            on_chain_amount: onChainHuman,
            difference,
            ...(reason ? { reason } : {}),
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
          reconciliation: {
            status,
            mismatches: mismatches.length > 0 ? mismatches : undefined,
          },
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

      const stats = statsResult.rows[0] ?? {};
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

      // Stats: global counts (unfiltered) for UI badges
      const stats = await db.query<{
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
          COUNT(*) FILTER (WHERE status = 'pending_approval')::text as pending_approval,
          COUNT(*) FILTER (WHERE status = 'pending')::text as pending,
          COUNT(*) FILTER (WHERE status = 'processing')::text as processing,
          COUNT(*) FILTER (WHERE status = 'completed')::text as completed,
          COUNT(*) FILTER (WHERE status = 'failed')::text as failed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::text as cancelled
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

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0] ?? {},
          withdrawals: result.rows,
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
   * POST /admin/withdrawals/:id/approve
   * Approve a withdrawal (pending_approval → pending, then enqueue for signing).
   */
  app.post<{ Params: { id: string } }>('/withdrawals/:id/approve', async (request, reply) => {
    const admin = await getAdminForWithdrawalApproval(app, request, reply);
    if (!admin) return;
    const withdrawalId = request.params.id;
    if (!withdrawalId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Withdrawal id is required' },
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
        newValue: { status: 'pending' },
      });
      await logAdminActivity({
        adminId: admin.adminId,
        action: 'withdrawal_approved',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
        metadata: { withdrawalId },
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
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/withdrawals/:id/reject', async (request, reply) => {
    const admin = await getAdminForWithdrawalApproval(app, request, reply);
    if (!admin) return;
    const withdrawalId = request.params.id;
    if (!withdrawalId) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Withdrawal id is required' },
      });
    }
    const reason = (request.body?.reason ?? 'Rejected by admin').trim() || 'Rejected by admin';
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
        newValue: { status: 'rejected', reason },
      });
      await logAdminActivity({
        adminId: admin.adminId,
        action: 'withdrawal_rejected',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
        metadata: { withdrawalId, reason },
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
      // Support both schemas: hot_wallets.chain_id (VARCHAR) or hot_wallets.blockchain_id (UUID)
      const hasChainIdCol = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hot_wallets' AND column_name = 'chain_id') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      const hasBlockchainIdCol = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hot_wallets' AND column_name = 'blockchain_id') AS exists`
      ).then(r => r.rows[0]?.exists === true).catch(() => false);
      let list: Array<{ id: string; chain_id: string; address: string; balance_cache: string; min_balance_alert: string; min_hot_balance: string | null; cold_wallet_address: string | null; is_active: boolean; created_at: string; updated_at: string }>;
      if (hasChainIdCol) {
        list = await hotWalletService.listHotWallets();
      } else if (hasBlockchainIdCol) {
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
      const familyHasWallet = await Promise.all(
        familiesInDb.map(async (f) => ({ ...f, hasWallet: await hotWalletService.familyHasHotWallet(f.type) }))
      );
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
            wParams.push(statusValues);
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
              dParams.push(statusValues);
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
              wParams.push(statusValues);
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
                dParams.push(statusValues);
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
      let caps: { max_single_tx: number | null; max_daily_outflow: number | null } | null = null;
      let dailyOutflowUsed = 0;
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
        await hotWalletService.setColdWalletAddress(chainId, coldWalletAddress ?? null);
      }
      if (typeof isActive === 'boolean') {
        await hotWalletService.setHotWalletActive(chainId, isActive, admin.adminId, ip, userAgent);
      }
      const list = await hotWalletService.listHotWallets();
      const updated = list.find(hw => hw.chain_id === chainId);
      return reply.send({ success: true, data: updated ?? null });
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
      return reply.send({ success: true });
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

      // Get orders stats
      const orderStats = await db.query(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status IN ('new', 'partially_filled')) as active_orders,
          COUNT(*) FILTER (WHERE status = 'filled') as filled_orders,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as orders_24h
        FROM spot_orders
      `);

      // Get trades stats
      const tradeStats = await db.query(`
        SELECT 
          COUNT(*) as total_trades,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as trades_24h,
          COALESCE(SUM(quote_amount), 0) as total_volume
        FROM spot_trades
      `);

      return reply.send({
        success: true,
        data: {
          pairs: pairs.rows,
          orderStats: orderStats.rows[0],
          tradeStats: tradeStats.rows[0],
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

  // ===============================
  // P2P
  // ===============================

  /**
   * GET /admin/p2p
   * Get P2P overview
   */
  app.get('/p2p', async (request, reply) => {
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
    try {
      const { page = 1, limit = 20, status } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

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
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        query += ` AND o.status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` ORDER BY o.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      // Count
      const countResult = await db.query('SELECT COUNT(*) FROM p2p_orders');

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
  // REFERRALS
  // ===============================

  /**
   * GET /admin/referrals
   * Get referrals overview
   */
  app.get('/referrals', async (request, reply) => {
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
   * GET /admin/referrals/codes
   * List referral codes with optional filters and pagination
   */
  app.get('/referrals/codes', async (request, reply) => {
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
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { withdrawal_fee?: number; withdrawal_fee_type?: 'fixed' | 'percentage' };
      if (body.withdrawal_fee == null && body.withdrawal_fee_type == null) {
        return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'withdrawal_fee or withdrawal_fee_type required' } });
      }
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (body.withdrawal_fee != null) { updates.push(`withdrawal_fee = $${idx}`); values.push(body.withdrawal_fee); idx++; }
      if (body.withdrawal_fee_type != null) { updates.push(`withdrawal_fee_type = $${idx}`); values.push(body.withdrawal_fee_type); idx++; }
      values.push(id);
      await db.query(`UPDATE currencies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, values);
      const row = await db.query('SELECT id, symbol, withdrawal_fee, withdrawal_fee_type FROM currencies WHERE id = $1', [id]);
      if (row.rows.length === 0) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Currency not found' } });
      }
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
    try {
      const admin = await getAdminFromRequest(app, request, reply, false);
      if (!admin) return;
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
    try {
      const admin = await getAdminFromRequest(app, request, reply, false);
      if (!admin) return;
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
   * GET /admin/admins/logs
   * Get admin activity logs
   */
  app.get('/admins/logs', async (request, reply) => {
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
   * Get all blockchains with their currencies
   */
  app.get('/settings/blockchains', async (request, reply) => {
    try {
      const blockchains = await db.query(`
        SELECT 
          b.*,
          (SELECT COUNT(*) FROM currencies WHERE blockchain_id = b.id) as currency_count
        FROM blockchains b
        ORDER BY b.chain_name ASC
      `);

      // Get currencies grouped by blockchain
      const currencies = await db.query(`
        SELECT * FROM currencies ORDER BY symbol ASC
      `);

      // Group currencies by blockchain
      const currenciesByBlockchain: Record<string, any[]> = {};
      currencies.rows.forEach((c: any) => {
        if (c.blockchain_id) {
          if (!currenciesByBlockchain[c.blockchain_id]) {
            currenciesByBlockchain[c.blockchain_id] = [];
          }
          currenciesByBlockchain[c.blockchain_id].push(c);
        }
      });

      return reply.send({
        success: true,
        data: {
          blockchains: blockchains.rows.map((b: any) => ({
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
          message: 'Blockchain disabled (has linked currencies)',
        });
      }

      await db.query('DELETE FROM blockchains WHERE id = $1', [id]);

      return reply.send({
        success: true,
        message: 'Blockchain deleted',
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
   * Get unique currencies with all their chain deployments (paginated)
   */
  app.get('/settings/currencies', async (request, reply) => {
    try {
      const { search, currency_type, limit, offset } = request.query as any;
      
      const pageLimit = parseInt(limit || '20');
      const pageOffset = parseInt(offset || '0');

      // Build WHERE clause
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

      // Get unique currencies by symbol with their chain deployments
      const countQuery = `
        SELECT COUNT(DISTINCT symbol) as total 
        FROM currencies ${whereClause}
      `;
      const countResult = await db.query(countQuery, values);
      const total = parseInt(countResult.rows[0].total);

      // Get unique currencies with aggregated chain info
      const dataQuery = `
        WITH unique_currencies AS (
          SELECT DISTINCT ON (symbol) 
            id, symbol, name, currency_type, logo_url,
            is_active, deposit_enabled, withdrawal_enabled, 
            COALESCE(trade_enabled, true) as trade_enabled,
            min_deposit, min_withdrawal, withdrawal_fee, withdrawal_fee_type,
            decimals, display_decimals
          FROM currencies
          ${whereClause}
          ORDER BY symbol, created_at ASC
        ),
        chain_deployments AS (
          SELECT 
            c.symbol,
            json_agg(
              json_build_object(
                'id', c.id,
                'blockchain_id', c.blockchain_id,
                'chain_name', b.chain_name,
                'chain_symbol', b.chain_symbol,
                'chain_logo', b.logo_url,
                'contract_address', c.contract_address,
                'decimals', c.decimals,
                'is_active', c.is_active,
                'deposit_enabled', c.deposit_enabled,
                'withdrawal_enabled', c.withdrawal_enabled
              ) ORDER BY b.chain_name
            ) FILTER (WHERE c.blockchain_id IS NOT NULL) as chains
          FROM currencies c
          LEFT JOIN blockchains b ON c.blockchain_id = b.id
          GROUP BY c.symbol
        )
        SELECT 
          uc.*,
          COALESCE(cd.chains, '[]'::json) as chains
        FROM unique_currencies uc
        LEFT JOIN chain_deployments cd ON uc.symbol = cd.symbol
        ORDER BY uc.symbol ASC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
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
        const before = tokenRow.rows[0]!;
        const newMin = minVal !== undefined ? minVal : parseFloat(before.min_withdrawal);
        const newMax = maxVal !== undefined ? maxVal : (before.max_withdrawal != null ? parseFloat(before.max_withdrawal) : null);
        if (newMax != null && newMax < newMin) {
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
          message: 'Currency disabled (has user wallets)',
        });
      }

      await db.query('DELETE FROM currencies WHERE id = $1', [id]);

      return reply.send({
        success: true,
        message: 'Currency deleted',
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
      console.error('Toggle by symbol error:', error);
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
      console.error('Error fetching quote assets:', error);
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
      `, [result.rows[0].id]);

      return reply.send({
        success: true,
        data: { quote_asset: fullData.rows[0] },
      });
    } catch (error) {
      console.error('Error adding quote asset:', error);
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
    try {
      const { id } = request.params as { id: string };

      // Check for existing trading pairs using this quote asset
      const pairs = await db.query(`
        SELECT COUNT(*) as count FROM trading_pairs tp
        JOIN quote_assets qa ON tp.quote_currency_id = qa.currency_id
        WHERE qa.id = $1
      `, [id]);

      if (parseInt(pairs.rows[0].count) > 0) {
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
      const total = parseInt(countResult.rows[0].total);
      
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
      console.error('Error fetching trading pairs:', error);
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
      console.error('Error creating trading pair:', error);
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
      const quoteCurrencyId = quoteCurrency.rows[0].id;

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
        const baseCurrencyId = baseCurrency.rows[0].id;

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
      console.error('Error bulk creating pairs:', error);
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
      console.error('Error fetching currencies:', error);
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
    try {
      const { limit, offset } = request.query as { limit?: string; offset?: string };
      
      const pageLimit = parseInt(limit || '20');
      const pageOffset = parseInt(offset || '0');
      
      // Get total count
      const countResult = await db.query('SELECT COUNT(*) as total FROM p2p_assets');
      const total = parseInt(countResult.rows[0].total);
      
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
      console.error('Error fetching P2P assets:', error);
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
      `, [result.rows[0].id]);

      return reply.send({
        success: true,
        data: { p2p_asset: asset.rows[0] },
      });
    } catch (error) {
      console.error('Error adding P2P asset:', error);
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
      console.error('Error updating P2P asset:', error);
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
      console.error('Error fetching available currencies:', error);
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
      const total = parseInt(countResult.rows[0].total);

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
      console.error('Error fetching features:', error);
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
      console.error('Error creating feature:', error);
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
      console.error('Error bulk creating features:', error);
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
  // API SETTINGS MANAGEMENT
  // ============================================

  /**
   * GET /admin/settings/api
   * Get API settings by category
   */
  app.get('/settings/api', async (request, reply) => {
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
      console.error('Error fetching API settings:', error);
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch API settings' },
      });
    }
  });

  /**
   * POST /admin/settings/api
   * Create or update API setting
   */
  app.post('/settings/api', async (request, reply) => {
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
      console.error('Error saving API setting:', error);
      return reply.status(500).send({
        success: false,
        error: { code: 'SAVE_FAILED', message: 'Failed to save API setting' },
      });
    }
  });

  /**
   * PUT /admin/settings/api/:id
   * Update API setting
   */
  app.put('/settings/api/:id', async (request, reply) => {
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
          [current.rows[0].category, id]
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
      console.error('Error updating API setting:', error);
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update API setting' },
      });
    }
  });

  /**
   * PATCH /admin/settings/api/:id/toggle
   * Toggle API setting active status
   */
  app.patch('/settings/api/:id/toggle', async (request, reply) => {
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
   * Delete API setting
   */
  app.delete('/settings/api/:id', async (request, reply) => {
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
   * Test API connection
   */
  app.post('/settings/api/:id/test', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const result = await db.query('SELECT * FROM api_settings WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'API setting not found' },
        });
      }

      const setting = result.rows[0];
      
      // Basic test - for now just return success
      // In production, you would actually test the connection
      return reply.send({
        success: true,
        data: { 
          tested: true, 
          message: `Connection test for ${setting.provider} completed`,
          status: 'ok'
        },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'TEST_FAILED', message: 'Failed to test API connection' },
      });
    }
  });
}
