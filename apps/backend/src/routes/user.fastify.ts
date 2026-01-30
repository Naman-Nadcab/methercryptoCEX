import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

export default async function userRoutes(app: FastifyInstance) {
  
  /**
   * GET /user/profile
   * Get user profile
   */
  app.get('/profile', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT 
          u.id, u.email, u.phone, u.username,
          u.first_name, u.last_name, u.avatar_url,
          u.status, u.account_type,
          u.email_verified, u.phone_verified,
          u.two_fa_enabled, u.tier_level,
          u.country_code, u.timezone, u.language,
          u.daily_withdrawal_limit, u.monthly_withdrawal_limit,
          u.default_fiat_currency,
          u.maker_fee_discount, u.taker_fee_discount,
          u.created_at, u.last_login_at,
          rc.code as referral_code,
          pms.total_orders as p2p_total_orders,
          pms.completion_rate as p2p_completion_rate,
          pms.average_rating as p2p_rating,
          pms.is_merchant
        FROM users u
        LEFT JOIN referral_codes rc ON u.id = rc.user_id AND rc.is_active = TRUE
        LEFT JOIN p2p_merchant_stats pms ON u.id = pms.user_id
        WHERE u.id = $1 AND u.deleted_at IS NULL
      `, [userId]);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      return reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch profile' },
      });
    }
  });

  /**
   * PATCH /user/profile
   * Update user profile
   */
  app.patch<{
    Body: {
      username?: string;
      firstName?: string;
      lastName?: string;
      timezone?: string;
      language?: string;
      defaultFiatCurrency?: string;
    };
  }>('/profile', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { username, firstName, lastName, timezone, language, defaultFiatCurrency } = request.body;

      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (username !== undefined) {
        // Check username availability
        const existing = await db.query(
          'SELECT id FROM users WHERE username = $1 AND id != $2',
          [username, userId]
        );
        if (existing.rows.length > 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'USERNAME_TAKEN', message: 'Username is already taken' },
          });
        }
        updates.push(`username = $${paramIndex++}`);
        params.push(username);
      }

      if (firstName !== undefined) {
        updates.push(`first_name = $${paramIndex++}`);
        params.push(firstName);
      }

      if (lastName !== undefined) {
        updates.push(`last_name = $${paramIndex++}`);
        params.push(lastName);
      }

      if (timezone !== undefined) {
        updates.push(`timezone = $${paramIndex++}`);
        params.push(timezone);
      }

      if (language !== undefined) {
        updates.push(`language = $${paramIndex++}`);
        params.push(language);
      }

      if (defaultFiatCurrency !== undefined) {
        updates.push(`default_fiat_currency = $${paramIndex++}`);
        params.push(defaultFiatCurrency.toUpperCase());
      }

      if (updates.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_UPDATES', message: 'No fields to update' },
        });
      }

      updates.push(`updated_at = NOW()`);
      params.push(userId);

      const result = await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );

      return reply.send({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message: 'Failed to update profile' },
      });
    }
  });

  /**
   * GET /user/sessions
   * Get active sessions
   */
  app.get('/sessions', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId, sessionId: currentSessionId } = request.user!;

      const result = await db.query(`
        SELECT 
          id, device_type, device_name, browser, os,
          ip_address, location_country, location_city,
          created_at, last_activity_at,
          CASE WHEN id = $2 THEN TRUE ELSE FALSE END as is_current
        FROM user_sessions
        WHERE user_id = $1 AND is_active = TRUE AND expires_at > NOW()
        ORDER BY last_activity_at DESC
      `, [userId, currentSessionId]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch sessions' },
      });
    }
  });

  /**
   * GET /user/activity
   * Get activity logs
   */
  app.get('/activity', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { limit = 50, offset = 0 } = request.query as any;

      const result = await db.query(`
        SELECT 
          activity_type, activity_details,
          ip_address, created_at
        FROM user_activity_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, parseInt(limit), parseInt(offset)]);

      return reply.send({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch activity' },
      });
    }
  });

  /**
   * GET /user/notifications
   * Get notifications
   */
  app.get('/notifications', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { unreadOnly, limit = 50 } = request.query as any;

      let query = `
        SELECT id, notification_type, title, message, data, is_read, created_at
        FROM user_notifications
        WHERE user_id = $1
      `;
      const params: any[] = [userId];

      if (unreadOnly === 'true') {
        query += ` AND is_read = FALSE`;
      }

      query += ` ORDER BY created_at DESC LIMIT $2`;
      params.push(parseInt(limit));

      const result = await db.query(query, params);

      // Get unread count
      const countResult = await db.query(
        'SELECT COUNT(*) as count FROM user_notifications WHERE user_id = $1 AND is_read = FALSE',
        [userId]
      );

      return reply.send({
        success: true,
        data: {
          notifications: result.rows,
          unreadCount: parseInt(countResult.rows[0].count),
        },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch notifications' },
      });
    }
  });

  /**
   * GET /user/referrals
   * Get referral stats
   */
  app.get('/referrals', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      // Get referral code
      const codeResult = await db.query(`
        SELECT code, current_referrals, total_earnings, referrer_commission_rate
        FROM referral_codes
        WHERE user_id = $1 AND is_active = TRUE
        LIMIT 1
      `, [userId]);

      // Get referred users
      const referralsResult = await db.query(`
        SELECT 
          rr.status, rr.total_commission_earned, rr.created_at,
          u.username, u.email
        FROM referral_relationships rr
        JOIN users u ON rr.referee_id = u.id
        WHERE rr.referrer_id = $1
        ORDER BY rr.created_at DESC
        LIMIT 50
      `, [userId]);

      // Get recent commissions
      const commissionsResult = await db.query(`
        SELECT 
          commission_amount, commission_currency, source_type, created_at
        FROM referral_commissions
        WHERE referrer_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [userId]);

      return reply.send({
        success: true,
        data: {
          referralCode: codeResult.rows[0] || null,
          referrals: referralsResult.rows,
          recentCommissions: commissionsResult.rows,
        },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch referral data' },
      });
    }
  });

  /**
   * GET /user/kyc
   * Get KYC status
   */
  app.get('/kyc', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query(`
        SELECT 
          id, kyc_level, status, 
          legal_first_name, legal_last_name,
          submitted_at, reviewed_at,
          rejection_reason, expires_at
        FROM kyc_applications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId]);

      return reply.send({
        success: true,
        data: result.rows[0] || null,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch KYC status' },
      });
    }
  });
}
