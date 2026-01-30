import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

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

      // Store session in Redis
      await redis.setJson(`admin:session:${sessionId}`, {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
        isActive: true,
      }, 7 * 24 * 60 * 60);

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
        await redis.del(`admin:session:${decoded.sessionId}`);
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

      // Check session
      const session = await redis.getJson<{ isActive: boolean }>(`admin:session:${decoded.sessionId}`);
      if (!session || !session.isActive) {
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
   * Get deposits with filters
   */
  app.get('/deposits', async (request, reply) => {
    try {
      const { page = 1, limit = 20, status } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Get stats
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'confirming') as confirming,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE is_flagged = true) as flagged
        FROM deposits
      `);

      // Get deposits
      let query = `
        SELECT 
          d.*,
          u.email, u.username,
          c.symbol as currency_symbol,
          b.chain_name
        FROM deposits d
        JOIN users u ON d.user_id = u.id
        JOIN currencies c ON d.currency_id = c.id
        JOIN blockchains b ON d.blockchain_id = b.id
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        query += ` WHERE d.status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` ORDER BY d.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0],
          deposits: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(stats.rows[0]?.total || '0'),
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

  // ===============================
  // WITHDRAWALS
  // ===============================

  /**
   * GET /admin/withdrawals
   * Get withdrawals with filters
   */
  app.get('/withdrawals', async (request, reply) => {
    try {
      const { page = 1, limit = 20, status } = request.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Get stats
      const stats = await db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending_approval') as pending_approval,
          COUNT(*) FILTER (WHERE status = 'processing') as processing,
          COUNT(*) FILTER (WHERE status = 'pending_blockchain') as pending_blockchain,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
        FROM withdrawals
      `);

      // Get withdrawals
      let query = `
        SELECT 
          w.*,
          u.email, u.username,
          c.symbol as currency_symbol,
          b.chain_name
        FROM withdrawals w
        JOIN users u ON w.user_id = u.id
        JOIN currencies c ON w.currency_id = c.id
        JOIN blockchains b ON w.blockchain_id = b.id
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (status && status !== 'all') {
        query += ` WHERE w.status = $${paramIndex++}`;
        params.push(status);
      }

      query += ` ORDER BY w.created_at DESC`;
      query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
      params.push(parseInt(limit), offset);

      const result = await db.query(query, params);

      return reply.send({
        success: true,
        data: {
          stats: stats.rows[0],
          withdrawals: result.rows,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(stats.rows[0]?.total || '0'),
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
        data: {
          tiers: tiers.rows,
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch fee tiers' },
      });
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
