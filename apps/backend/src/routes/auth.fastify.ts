import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { otpService } from '../services/otp.service.js';

// Types
interface SendOTPBody {
  identifier: string; // email or phone
  type?: 'email' | 'phone';
  purpose?: 'signup' | 'login';
}

interface VerifyOTPBody {
  identifier: string;
  otp: string;
  type?: 'email' | 'phone';
  purpose?: 'signup' | 'login';
}

interface SetPasswordBody {
  password: string;
  confirmPassword: string;
}

// Helper to detect if identifier is email or phone
function getIdentifierType(identifier: string): 'email' | 'phone' {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^\+?[1-9]\d{6,14}$/;
  
  if (emailRegex.test(identifier)) {
    return 'email';
  } else if (phoneRegex.test(identifier.replace(/[\s\-\(\)]/g, ''))) {
    return 'phone';
  }
  throw new Error('Invalid identifier. Please enter a valid email or phone number.');
}

// Normalize phone number to standard format with country code
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it starts with +, keep it
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // If it's a 10-digit Indian number, add +91
  if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  
  // If it starts with 91 and is 12 digits, add +
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  
  // For other cases, add + if missing
  if (!cleaned.startsWith('+')) {
    return `+${cleaned}`;
  }
  
  return cleaned;
}

// Generate tokens
function generateTokens(app: FastifyInstance, payload: {
  userId: string;
  email?: string;
  phone?: string;
  role: string;
  sessionId: string;
}) {
  const accessToken = app.jwt.sign(payload, { expiresIn: '15m' });
  const refreshToken = app.jwt.sign(
    { userId: payload.userId, sessionId: payload.sessionId, type: 'refresh' },
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

export default async function authRoutes(app: FastifyInstance) {
  
  /**
   * POST /auth/send-otp
   * Send OTP to email or phone
   */
  app.post<{ Body: SendOTPBody }>('/send-otp', {
    schema: {
      body: {
        type: 'object',
        required: ['identifier'],
        properties: {
          identifier: { type: 'string', minLength: 5 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { identifier } = request.body;
      
      // Detect type first
      let type: 'email' | 'phone';
      try {
        type = getIdentifierType(identifier.trim());
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IDENTIFIER', message: 'Please enter a valid email or phone number' },
        });
      }

      // Normalize identifier based on type
      let cleanIdentifier: string;
      if (type === 'email') {
        cleanIdentifier = identifier.trim().toLowerCase();
      } else {
        cleanIdentifier = normalizePhoneNumber(identifier.trim());
      }

      // Rate limit check
      const rateLimit = await otpService.checkRateLimit(cleanIdentifier);
      if (!rateLimit.allowed) {
        return reply.status(429).send({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many OTP requests. Please try again in ${rateLimit.retryAfter} seconds.`,
          },
        });
      }

      // Generate and send OTP
      let otp: string;
      let expiresAt: Date;
      
      try {
        const result = await otpService.createOTP(cleanIdentifier, type);
        otp = result.otp;
        expiresAt = result.expiresAt;
      } catch (error) {
        logger.error('Failed to create OTP', { error: error instanceof Error ? error.message : 'Unknown' });
        return reply.status(500).send({
          success: false,
          error: { code: 'OTP_CREATE_FAILED', message: 'Failed to create OTP. Please try again.' },
        });
      }
      
      let sent = false;
      try {
        if (type === 'email') {
          sent = await otpService.sendEmailOTP(cleanIdentifier, otp);
        } else {
          // For SMS, send to the normalized phone number
          sent = await otpService.sendSMSOTP(cleanIdentifier, otp);
        }
      } catch (error) {
        logger.error('Failed to send OTP', { error: error instanceof Error ? error.message : 'Unknown' });
      }

      if (!sent) {
        return reply.status(500).send({
          success: false,
          error: { code: 'OTP_SEND_FAILED', message: 'Failed to send OTP. Please try again.' },
        });
      }

      // Check if user exists
      let existingUser = await db.query(
        `SELECT id, email, phone, status, email_verified, phone_verified 
         FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [cleanIdentifier]
      );

      // For phone, also check with last 10 digits if not found
      if (existingUser.rows.length === 0 && type === 'phone') {
        const phoneDigits = cleanIdentifier.replace(/\D/g, '');
        existingUser = await db.query(
          `SELECT id, email, phone, status, email_verified, phone_verified 
           FROM users WHERE phone LIKE $1 AND deleted_at IS NULL`,
          [`%${phoneDigits.slice(-10)}`]
        );
      }

      const isNewUser = existingUser.rows.length === 0;

      logger.info('OTP sent', { identifier: cleanIdentifier, type, isNewUser });

      return reply.send({
        success: true,
        data: {
          type,
          expiresAt,
          isNewUser,
          maskedIdentifier: type === 'email' 
            ? cleanIdentifier.replace(/(.{2})(.*)(@.*)/, '$1***$3')
            : cleanIdentifier.replace(/(\+?\d{2})(\d*)(\d{2})/, '$1****$3'),
        },
      });

    } catch (error) {
      logger.error('Send OTP error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred. Please try again.' },
      });
    }
  });

  /**
   * POST /auth/verify-otp
   * Verify OTP and login/register
   */
  app.post<{ Body: VerifyOTPBody }>('/verify-otp', {
    schema: {
      body: {
        type: 'object',
        required: ['identifier', 'otp'],
        properties: {
          identifier: { type: 'string', minLength: 5 },
          otp: { type: 'string', minLength: 6, maxLength: 6 },
          type: { type: 'string', enum: ['email', 'phone'] },
          purpose: { type: 'string', enum: ['signup', 'login'] },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { identifier, otp, purpose } = request.body;
      
      // Detect type first
      let type: 'email' | 'phone';
      try {
        type = getIdentifierType(identifier.trim());
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IDENTIFIER', message: 'Invalid identifier' },
        });
      }

      // Normalize identifier based on type
      let cleanIdentifier: string;
      if (type === 'email') {
        cleanIdentifier = identifier.trim().toLowerCase();
      } else {
        cleanIdentifier = normalizePhoneNumber(identifier.trim());
      }

      // Verify OTP
      const verification = await otpService.verifyOTP(cleanIdentifier, type, otp);
      
      if (!verification.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // For signup purpose, just verify and set flag - don't create user yet
      if (purpose === 'signup') {
        // Set a flag in Redis that OTP was verified for this identifier
        await redis.set(`otp:verified:${cleanIdentifier}`, 'true', 'EX', 600); // 10 minutes validity
        
        // Check if user exists
        const existingUser = await db.query(
          `SELECT id FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
          [cleanIdentifier]
        );

        if (existingUser.rows.length > 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'USER_EXISTS', message: 'Account already exists. Please login.' },
          });
        }

        return reply.send({
          success: true,
          data: {
            verified: true,
            type,
            message: 'OTP verified successfully. Please set your password.',
          },
        });
      }

      // Check if user exists
      const existingUser = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
        tier_level: number;
        password_hash: string | null;
      }>(
        `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level, password_hash
         FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [cleanIdentifier]
      );

      let user: typeof existingUser.rows[0];
      let isNewUser = false;

      if (existingUser.rows.length === 0) {
        // Create new user
        isNewUser = true;
        
        const salt = await bcrypt.genSalt(12);
        const tempPassword = uuidv4(); // Temporary password, user will set later
        const passwordHash = await bcrypt.hash(tempPassword, salt);
        
        const referralCode = generateReferralCode();

        // For phone-only registration, create a placeholder email
        // Users can add their real email later
        let insertQuery: string;
        let insertParams: any[];
        
        if (type === 'email') {
          insertQuery = `INSERT INTO users (
            email, email_verified, password_hash, salt, status, tier_level
          ) VALUES ($1, TRUE, $2, $3, 'active', 0)
          RETURNING id, email, phone, username, status, email_verified, phone_verified, tier_level, password_hash`;
          insertParams = [cleanIdentifier, passwordHash, salt.substring(0, 64)];
        } else {
          // Phone registration - use phone as email placeholder for NOT NULL constraint
          const placeholderEmail = `${cleanIdentifier.replace(/[^0-9]/g, '')}@phone.local`;
          insertQuery = `INSERT INTO users (
            email, phone, phone_verified, password_hash, salt, status, tier_level
          ) VALUES ($1, $2, TRUE, $3, $4, 'active', 0)
          RETURNING id, email, phone, username, status, email_verified, phone_verified, tier_level, password_hash`;
          insertParams = [placeholderEmail, cleanIdentifier, passwordHash, salt.substring(0, 64)];
        }

        const newUser = await db.query<typeof existingUser.rows[0]>(
          insertQuery,
          insertParams
        );

        user = newUser.rows[0]!;

        // Create referral code for new user
        await db.query(
          `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
          [user.id, referralCode]
        );

        // Initialize P2P merchant stats
        await db.query(
          `INSERT INTO p2p_merchant_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          [user.id]
        );

        logger.info('New user created', { userId: user.id, type });

      } else {
        user = existingUser.rows[0]!;
        
        // Update verification status
        await db.query(
          `UPDATE users SET ${type}_verified = TRUE, status = 'active' WHERE id = $1`,
          [user.id]
        );

        // Update local object
        if (type === 'email') {
          user.email_verified = true;
        } else {
          user.phone_verified = true;
        }
        user.status = 'active';
      }

      // Check if user has completed verification (at least one of email/phone verified)
      const isVerified = user.email_verified || user.phone_verified;

      if (!isVerified) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'VERIFICATION_REQUIRED',
            message: 'Please verify your email or phone number to continue',
          },
        });
      }

      // Create session
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.query(
        `INSERT INTO user_sessions (id, user_id, session_token, device_type, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, user.id, sessionToken, 'web', request.ip, request.headers['user-agent'], expiresAt]
      );

      // Store session in Redis
      await redis.setJson(`session:${sessionId}`, {
        userId: user.id,
        isActive: true,
        createdAt: Date.now(),
      }, 7 * 24 * 60 * 60);

      // Generate tokens
      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId,
      });

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, sessionId, 'login', request.ip, request.headers['user-agent']]
      );

      logger.info('User logged in', { userId: user.id, isNewUser });

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            username: user.username,
            status: user.status,
            emailVerified: user.email_verified,
            phoneVerified: user.phone_verified,
            tierLevel: user.tier_level,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          isNewUser,
        },
      });

    } catch (error) {
      logger.error('Verify OTP error', { 
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        identifier: request.body.identifier,
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred. Please try again.' },
      });
    }
  });

  /**
   * POST /auth/refresh
   * Refresh access token
   */
  app.post<{ Body: { refreshToken: string } }>('/refresh', async (request, reply) => {
    try {
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_TOKEN', message: 'Refresh token required' },
        });
      }

      const decoded = app.jwt.verify<{
        userId: string;
        sessionId: string;
        type: string;
      }>(refreshToken);

      if (decoded.type !== 'refresh') {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' },
        });
      }

      // Check session
      const session = await redis.getJson<{ userId: string; isActive: boolean }>(`session:${decoded.sessionId}`);
      if (!session || !session.isActive) {
        return reply.status(401).send({
          success: false,
          error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
        });
      }

      // Get user
      const userResult = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
      }>(
        'SELECT id, email, phone FROM users WHERE id = $1 AND deleted_at IS NULL',
        [decoded.userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(401).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      // Generate new tokens
      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId: decoded.sessionId,
      });

      return reply.send({
        success: true,
        data: tokens,
      });

    } catch (error) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' },
      });
    }
  });

  /**
   * POST /auth/logout
   * Logout current session
   */
  app.post('/logout', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { sessionId, id: userId } = request.user!;

      // Invalidate session
      await redis.del(`session:${sessionId}`);
      await db.query(
        `UPDATE user_sessions SET is_active = FALSE, revoked_at = NOW() WHERE id = $1`,
        [sessionId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address)
         VALUES ($1, $2, 'logout', $3)`,
        [userId, sessionId, request.ip]
      );

      return reply.send({
        success: true,
        data: { message: 'Logged out successfully' },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'LOGOUT_FAILED', message: 'Logout failed' },
      });
    }
  });

  /**
   * GET /auth/me
   * Get current user
   */
  app.get('/me', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;

      const result = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
        two_fa_enabled: boolean;
        tier_level: number;
        country_code: string | null;
        created_at: Date;
      }>(
        `SELECT id, email, phone, username, first_name, last_name, avatar_url,
                status, email_verified, phone_verified, two_fa_enabled,
                tier_level, country_code, created_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = result.rows[0]!;

      // Get referral code
      const referralResult = await db.query<{ code: string }>(
        'SELECT code FROM referral_codes WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
        [userId]
      );

      return reply.send({
        success: true,
        data: {
          ...user,
          referralCode: referralResult.rows[0]?.code,
        },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch user data' },
      });
    }
  });

  /**
   * POST /auth/add-identifier
   * Add email or phone to existing account
   */
  app.post<{ Body: SendOTPBody }>('/add-identifier', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { identifier } = request.body;
      const cleanIdentifier = identifier.trim().toLowerCase();

      let type: 'email' | 'phone';
      try {
        type = getIdentifierType(cleanIdentifier);
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IDENTIFIER', message: 'Invalid email or phone' },
        });
      }

      // Check if already used
      const existing = await db.query(
        `SELECT id FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [cleanIdentifier]
      );

      if (existing.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: `This ${type} is already registered` },
        });
      }

      // Send OTP
      const { otp, expiresAt } = await otpService.createOTP(cleanIdentifier, type);
      
      if (type === 'email') {
        await otpService.sendEmailOTP(cleanIdentifier, otp);
      } else {
        await otpService.sendSMSOTP(cleanIdentifier, otp);
      }

      // Store pending identifier
      await redis.setJson(`pending:${type}:${userId}`, cleanIdentifier, 600);

      return reply.send({
        success: true,
        data: { type, expiresAt },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to add identifier' },
      });
    }
  });

  /**
   * POST /auth/verify-add-identifier
   * Verify OTP for adding email/phone
   */
  app.post<{ Body: VerifyOTPBody }>('/verify-add-identifier', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { id: userId } = request.user!;
      const { identifier, otp } = request.body;
      const cleanIdentifier = identifier.trim().toLowerCase();

      const type = getIdentifierType(cleanIdentifier);

      // Verify OTP
      const verification = await otpService.verifyOTP(cleanIdentifier, type, otp);
      
      if (!verification.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // Update user
      await db.query(
        `UPDATE users SET ${type} = $1, ${type}_verified = TRUE WHERE id = $2`,
        [cleanIdentifier, userId]
      );

      // Clean up
      await redis.del(`pending:${type}:${userId}`);

      return reply.send({
        success: true,
        data: { message: `${type} added successfully` },
      });

    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: 'Verification failed' },
      });
    }
  });

  /**
   * POST /auth/signup
   * Complete signup with password after OTP verification
   */
  app.post<{
    Body: {
      email?: string;
      phone?: string;
      password: string;
      referralCode?: string;
    };
  }>('/signup', {
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          email: { type: 'string' },
          phone: { type: 'string' },
          password: { type: 'string', minLength: 8, maxLength: 30 },
          referralCode: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { email, phone, password, referralCode } = request.body;

      // Validate password requirements
      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);
      const hasNumber = /[0-9]/.test(password);

      if (!hasUppercase || !hasLowercase || !hasNumber) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PASSWORD',
            message: 'Password must contain uppercase, lowercase, and number',
          },
        });
      }

      // Need at least one identifier
      if (!email && !phone) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_IDENTIFIER', message: 'Email or phone required' },
        });
      }

      const type = email ? 'email' : 'phone';
      let cleanIdentifier: string;
      
      if (type === 'email') {
        cleanIdentifier = email!.trim().toLowerCase();
      } else {
        cleanIdentifier = normalizePhoneNumber(phone!);
      }

      // Check if OTP was recently verified for this identifier
      const otpVerified = await redis.get(`otp:verified:${cleanIdentifier}`);
      if (!otpVerified) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'OTP_NOT_VERIFIED',
            message: 'Please verify OTP first',
          },
        });
      }

      // Check if user already exists
      const existingUser = await db.query(
        `SELECT id FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [cleanIdentifier]
      );

      if (existingUser.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'USER_EXISTS', message: 'Account already exists. Please login.' },
        });
      }

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);

      // Generate referral code for new user
      const userReferralCode = generateReferralCode();

      // Create user
      let insertQuery: string;
      let insertParams: any[];

      if (type === 'email') {
        insertQuery = `INSERT INTO users (
          email, email_verified, password_hash, salt, status, tier_level
        ) VALUES ($1, TRUE, $2, $3, 'active', 0)
        RETURNING id, email, phone, username, status, email_verified, phone_verified, tier_level`;
        insertParams = [cleanIdentifier, passwordHash, salt.substring(0, 64)];
      } else {
        const placeholderEmail = `${cleanIdentifier.replace(/[^0-9]/g, '')}@phone.local`;
        insertQuery = `INSERT INTO users (
          email, phone, phone_verified, password_hash, salt, status, tier_level
        ) VALUES ($1, $2, TRUE, $3, $4, 'active', 0)
        RETURNING id, email, phone, username, status, email_verified, phone_verified, tier_level`;
        insertParams = [placeholderEmail, cleanIdentifier, passwordHash, salt.substring(0, 64)];
      }

      const newUser = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
        tier_level: number;
      }>(insertQuery, insertParams);

      const user = newUser.rows[0]!;

      // Create referral code for new user
      await db.query(
        `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, userReferralCode]
      );

      // Initialize P2P merchant stats
      await db.query(
        `INSERT INTO p2p_merchant_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [user.id]
      );

      // Handle referral if code provided
      if (referralCode) {
        const referrer = await db.query(
          `SELECT user_id FROM referral_codes WHERE code = $1`,
          [referralCode.toUpperCase()]
        );
        if (referrer.rows.length > 0) {
          await db.query(
            `INSERT INTO referral_relationships (referrer_id, referred_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [referrer.rows[0].user_id, user.id]
          );
        }
      }

      // Create session
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO user_sessions (id, user_id, session_token, device_type, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, user.id, sessionToken, 'web', request.ip, request.headers['user-agent'], expiresAt]
      );

      // Store session in Redis
      await redis.setJson(`session:${sessionId}`, {
        userId: user.id,
        isActive: true,
        createdAt: Date.now(),
      }, 7 * 24 * 60 * 60);

      // Generate tokens
      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId,
      });

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, sessionId, 'signup', request.ip, request.headers['user-agent']]
      );

      // Clear the verified OTP flag
      await redis.del(`otp:verified:${cleanIdentifier}`);

      logger.info('New user signed up', { userId: user.id, type });

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            username: user.username,
            status: user.status,
            emailVerified: user.email_verified,
            phoneVerified: user.phone_verified,
            tierLevel: user.tier_level,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });

    } catch (error) {
      logger.error('Signup error', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create account' },
      });
    }
  });

  /**
   * POST /auth/login
   * Login with OTP (after OTP verification)
   */
  app.post<{
    Body: {
      email?: string;
      phone?: string;
      otp: string;
    };
  }>('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['otp'],
        properties: {
          email: { type: 'string' },
          phone: { type: 'string' },
          otp: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { email, phone, otp } = request.body;

      if (!email && !phone) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_IDENTIFIER', message: 'Email or phone required' },
        });
      }

      const type = email ? 'email' : 'phone';
      let cleanIdentifier: string;
      
      if (type === 'email') {
        cleanIdentifier = email!.trim().toLowerCase();
      } else {
        // Normalize phone number to match DB format
        cleanIdentifier = normalizePhoneNumber(phone!);
      }

      // Verify OTP
      const verification = await otpService.verifyOTP(cleanIdentifier, type, otp);

      if (!verification.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // Get user - for phone, also try without normalization as fallback
      let userResult = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
        tier_level: number;
      }>(
        `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level
         FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [cleanIdentifier]
      );

      // If not found and it's phone, try matching with LIKE for flexibility
      if (userResult.rows.length === 0 && type === 'phone') {
        const phoneDigits = phone!.replace(/\D/g, '');
        userResult = await db.query(
          `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level
           FROM users WHERE phone LIKE $1 AND deleted_at IS NULL`,
          [`%${phoneDigits.slice(-10)}`]
        );
      }

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Account not found. Please sign up first.' },
        });
      }

      const user = userResult.rows[0]!;

      if (user.status !== 'active') {
        return reply.status(403).send({
          success: false,
          error: { code: 'ACCOUNT_INACTIVE', message: 'Account is not active' },
        });
      }

      // Create session
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO user_sessions (id, user_id, session_token, device_type, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, user.id, sessionToken, 'web', request.ip, request.headers['user-agent'], expiresAt]
      );

      // Store session in Redis
      await redis.setJson(`session:${sessionId}`, {
        userId: user.id,
        isActive: true,
        createdAt: Date.now(),
      }, 7 * 24 * 60 * 60);

      // Generate tokens
      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId,
      });

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, sessionId, 'login', request.ip, request.headers['user-agent']]
      );

      logger.info('User logged in', { userId: user.id });

      return reply.send({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            username: user.username,
            status: user.status,
            emailVerified: user.email_verified,
            phoneVerified: user.phone_verified,
            tierLevel: user.tier_level,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });

    } catch (error) {
      logger.error('Login error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Login failed' },
      });
    }
  });

  // ===============================
  // CHECK PASSWORD STATUS
  // ===============================
  app.get('/check-password', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      const result = await db.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      return reply.send({
        success: true,
        data: {
          hasPassword: !!result.rows[0]?.password_hash,
        },
      });
    } catch (error) {
      logger.error('Check password error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check password status' },
      });
    }
  });

  // ===============================
  // CHANGE PASSWORD
  // ===============================
  app.post('/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { oldPassword, newPassword } = request.body as { oldPassword?: string; newPassword: string };

      // Get user
      const userResult = await db.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0];

      // If user has password, verify old password
      if (user?.password_hash) {
        if (!oldPassword) {
          return reply.status(400).send({
            success: false,
            error: { code: 'OLD_PASSWORD_REQUIRED', message: 'Current password is required' },
          });
        }

        const isValidOld = await bcrypt.compare(oldPassword, user.password_hash);
        if (!isValidOld) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_OLD_PASSWORD', message: 'Current password is incorrect' },
          });
        }

        // Check if new password is same as old
        const isSameAsOld = await bcrypt.compare(newPassword, user.password_hash);
        if (isSameAsOld) {
          return reply.status(400).send({
            success: false,
            error: { code: 'SAME_PASSWORD', message: 'New password must be different from current password' },
          });
        }
      }

      // Validate new password requirements
      if (newPassword.length < 8 || newPassword.length > 30) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Password must be 8-30 characters long' },
        });
      }

      if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WEAK_PASSWORD', message: 'Password must contain uppercase, lowercase, and number' },
        });
      }

      // Check password history (last 5 passwords)
      const historyResult = await db.query<{ password_hash: string; changed_at: Date }>(
        `SELECT password_hash, changed_at FROM password_history 
         WHERE user_id = $1 ORDER BY changed_at DESC LIMIT 5`,
        [userId]
      );

      for (const history of historyResult.rows) {
        const wasUsedBefore = await bcrypt.compare(newPassword, history.password_hash);
        if (wasUsedBefore) {
          const timeDiff = Date.now() - new Date(history.changed_at).getTime();
          const daysAgo = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
          
          let timeAgoStr = '';
          if (daysAgo === 0) {
            timeAgoStr = 'today';
          } else if (daysAgo === 1) {
            timeAgoStr = 'yesterday';
          } else if (daysAgo < 30) {
            timeAgoStr = `${daysAgo} days ago`;
          } else if (daysAgo < 365) {
            const months = Math.floor(daysAgo / 30);
            timeAgoStr = `${months} month${months > 1 ? 's' : ''} ago`;
          } else {
            const years = Math.floor(daysAgo / 365);
            timeAgoStr = `${years} year${years > 1 ? 's' : ''} ago`;
          }

          return reply.status(400).send({
            success: false,
            error: { 
              code: 'PASSWORD_REUSED', 
              message: `This password was used ${timeAgoStr}. Please choose a different password.` 
            },
          });
        }
      }

      // Hash new password
      const newHash = await bcrypt.hash(newPassword, 12);

      // Save old password to history if it exists
      if (user?.password_hash) {
        await db.query(
          `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
          [userId, user.password_hash]
        );
      }

      // Update user password
      await db.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newHash, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'password_change', request.ip, request.headers['user-agent'], JSON.stringify({ method: 'change' })]
      );

      logger.info('Password changed', { userId });

      return reply.send({
        success: true,
        data: { message: 'Password changed successfully' },
      });

    } catch (error) {
      logger.error('Change password error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to change password' },
      });
    }
  });

  // ===============================
  // SEND SECURITY OTP (for authenticated users)
  // ===============================
  app.post('/send-security-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { type, phone, purpose } = request.body as { type: 'email' | 'phone'; phone?: string; purpose?: string };

      // Get user data
      const userResult = await db.query<{ email: string; phone: string | null }>(
        `SELECT email, phone FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;
      let identifier: string;

      if (type === 'email') {
        identifier = user.email;
      } else if (type === 'phone') {
        // For phone, we can use existing phone or the new phone being set up
        identifier = phone || user.phone || '';
        if (!identifier) {
          return reply.status(400).send({
            success: false,
            error: { code: 'NO_PHONE', message: 'Phone number required' },
          });
        }
      } else {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TYPE', message: 'Invalid OTP type' },
        });
      }

      // Rate limit check
      const rateLimit = await otpService.checkRateLimit(identifier);
      if (!rateLimit.allowed) {
        return reply.status(429).send({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many OTP requests. Please try again in ${rateLimit.retryAfter} seconds.`,
          },
        });
      }

      // Create OTP
      const { otp, expiresAt } = await otpService.createOTP(identifier, type);

      // Send OTP
      let sent = false;
      if (type === 'email') {
        sent = await otpService.sendEmailOTP(identifier, otp);
      } else {
        sent = await otpService.sendSMSOTP(identifier, otp);
      }

      if (!sent) {
        logger.warn('Failed to send security OTP', { type, identifier, userId });
        // Still return success in dev mode
      }

      // Store purpose in Redis for verification
      await redis.set(`security_otp_purpose:${identifier}`, purpose || 'general', 600);

      logger.info('Security OTP sent', { type, userId, purpose });

      return reply.send({
        success: true,
        data: {
          message: `Verification code sent to your ${type}`,
          expiresAt,
        },
      });

    } catch (error) {
      logger.error('Send security OTP error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to send verification code' },
      });
    }
  });

  // ===============================
  // VERIFY SECURITY OTP
  // ===============================
  app.post('/verify-security-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { type, otp, purpose } = request.body as { type: 'email' | 'phone'; otp: string; purpose?: string };

      // Get user data
      const userResult = await db.query<{ email: string; phone: string | null }>(
        `SELECT email, phone FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;
      const identifier = type === 'email' ? user.email : (user.phone || '');

      if (type === 'phone' && !identifier) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_PHONE', message: 'No phone number registered' },
        });
      }

      // Verify OTP
      const result = await otpService.verifyOTP(identifier, type, otp);
      if (!result.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: result.message },
        });
      }

      // Mark as verified for this purpose
      await redis.set(`security_verified:${userId}:${purpose || 'general'}`, 'true', 600); // 10 minutes

      logger.info('Security OTP verified', { type, userId, purpose });

      return reply.send({
        success: true,
        data: { message: 'Verification successful' },
      });

    } catch (error) {
      logger.error('Verify security OTP error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify OTP' },
      });
    }
  });

  // ===============================
  // VERIFY PHONE SETUP (final step)
  // ===============================
  app.post('/verify-phone-setup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { phone, otp } = request.body as { phone: string; otp: string };

      if (!phone || !otp) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_DATA', message: 'Phone and OTP are required' },
        });
      }

      // Normalize phone number
      const cleanPhone = normalizePhoneNumber(phone);

      // Verify OTP
      const result = await otpService.verifyOTP(cleanPhone, 'phone', otp);
      if (!result.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: result.message },
        });
      }

      // Check if phone is already used by another user
      const existingPhone = await db.query(
        `SELECT id FROM users WHERE phone = $1 AND id != $2 AND deleted_at IS NULL`,
        [cleanPhone, userId]
      );

      if (existingPhone.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PHONE_IN_USE', message: 'This phone number is already registered' },
        });
      }

      // Update user's phone
      await db.query(
        `UPDATE users SET phone = $1, phone_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [cleanPhone, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'phone_setup', request.ip, request.headers['user-agent'], JSON.stringify({ phone: cleanPhone })]
      );

      logger.info('Phone setup completed', { userId, phone: cleanPhone });

      return reply.send({
        success: true,
        data: { message: 'Phone number verified and saved successfully' },
      });

    } catch (error) {
      logger.error('Phone setup error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to setup phone' },
      });
    }
  });

  // ===============================
  // GET USER PROFILE (with phone and 2FA status)
  // ===============================
  app.get('/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      const result = await db.query<{
        id: string;
        email: string;
        phone: string | null;
        phone_verified: boolean;
        first_name: string | null;
        last_name: string | null;
        totp_enabled: boolean;
        created_at: Date;
      }>(
        `SELECT id, email, phone, phone_verified, first_name, last_name, 
                COALESCE(totp_enabled, FALSE) as totp_enabled, created_at 
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      return reply.send({
        success: true,
        data: { user: result.rows[0] },
      });

    } catch (error) {
      logger.error('Get profile error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get profile' },
      });
    }
  });

  // ===============================
  // GOOGLE 2FA SETUP - Generate Secret
  // ===============================
  app.post('/2fa/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      // Get user email
      const userResult = await db.query<{ email: string; totp_enabled: boolean }>(
        `SELECT email, COALESCE(totp_enabled, FALSE) as totp_enabled FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      if (user.totp_enabled) {
        return reply.status(400).send({
          success: false,
          error: { code: '2FA_ALREADY_ENABLED', message: '2FA is already enabled' },
        });
      }

      // Generate TOTP secret
      const OTPAuth = await import('otpauth');
      const QRCode = await import('qrcode');

      // Generate a cryptographically secure random secret
      const totpSecret = new OTPAuth.Secret({ size: 20 });

      const totp = new OTPAuth.TOTP({
        issuer: 'Methereum',
        label: user.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: totpSecret,
      });

      const secret = totpSecret.base32;
      const otpauthUrl = totp.toString();

      // Generate QR code as data URL
      const qrCode = await QRCode.toDataURL(otpauthUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      // Store secret temporarily in Redis (valid for 10 minutes)
      await redis.set(`2fa_setup:${userId}`, secret, 600);

      logger.info('2FA setup initiated', { userId });

      return reply.send({
        success: true,
        data: {
          secret,
          qrCode,
          otpauthUrl,
        },
      });

    } catch (error) {
      logger.error('2FA setup error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to setup 2FA' },
      });
    }
  });

  // ===============================
  // GOOGLE 2FA ENABLE - Verify and Enable
  // ===============================
  app.post('/2fa/enable', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { code, secret } = request.body as { code: string; secret: string };

      if (!code || !secret) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_DATA', message: 'Code and secret are required' },
        });
      }

      // Verify the code matches the secret
      const OTPAuth = await import('otpauth');
      
      const totp = new OTPAuth.TOTP({
        issuer: 'Methereum',
        label: 'user',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secret),
      });

      const delta = totp.validate({ token: code, window: 1 });
      
      if (delta === null) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CODE', message: 'Invalid verification code. Please try again.' },
        });
      }

      // Encrypt and store the secret
      const crypto = await import('crypto');
      const encryptionKey = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-encryption-key';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv);
      let encryptedSecret = cipher.update(secret, 'utf8', 'hex');
      encryptedSecret += cipher.final('hex');
      const encryptedData = iv.toString('hex') + ':' + encryptedSecret;

      // Update user with TOTP secret
      await db.query(
        `UPDATE users SET totp_secret = $1, totp_enabled = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [encryptedData, userId]
      );

      // Clear Redis temporary secret
      await redis.del(`2fa_setup:${userId}`);

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, '2fa_enable', request.ip, request.headers['user-agent'], JSON.stringify({ method: 'google_authenticator' })]
      );

      logger.info('2FA enabled', { userId });

      return reply.send({
        success: true,
        data: { message: '2FA enabled successfully' },
      });

    } catch (error) {
      logger.error('2FA enable error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to enable 2FA' },
      });
    }
  });

  // ===============================
  // GOOGLE 2FA VERIFY (for login/sensitive operations)
  // ===============================
  app.post('/2fa/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { code } = request.body as { code: string };

      if (!code) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_CODE', message: 'Verification code is required' },
        });
      }

      // Get user's encrypted TOTP secret
      const userResult = await db.query<{ totp_secret: string; totp_enabled: boolean }>(
        `SELECT totp_secret, COALESCE(totp_enabled, FALSE) as totp_enabled FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      if (!user.totp_enabled || !user.totp_secret) {
        return reply.status(400).send({
          success: false,
          error: { code: '2FA_NOT_ENABLED', message: '2FA is not enabled' },
        });
      }

      // Decrypt secret
      const crypto = await import('crypto');
      const encryptionKey = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-encryption-key';
      const [ivHex, encryptedSecret] = user.totp_secret.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv);
      let decryptedSecret = decipher.update(encryptedSecret, 'hex', 'utf8');
      decryptedSecret += decipher.final('utf8');

      // Verify code
      const OTPAuth = await import('otpauth');
      const totp = new OTPAuth.TOTP({
        issuer: 'Methereum',
        label: 'user',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(decryptedSecret),
      });

      const delta = totp.validate({ token: code, window: 1 });

      if (delta === null) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CODE', message: 'Invalid verification code' },
        });
      }

      logger.info('2FA verified', { userId });

      return reply.send({
        success: true,
        data: { message: '2FA verification successful' },
      });

    } catch (error) {
      logger.error('2FA verify error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify 2FA' },
      });
    }
  });

  // ===============================
  // GOOGLE 2FA DISABLE
  // ===============================
  app.post('/2fa/disable', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { password, code } = request.body as { password: string; code: string };

      if (!password || !code) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_DATA', message: 'Password and 2FA code are required' },
        });
      }

      // Get user's data
      const userResult = await db.query<{ 
        password_hash: string | null; 
        totp_secret: string; 
        totp_enabled: boolean 
      }>(
        `SELECT password_hash, totp_secret, COALESCE(totp_enabled, FALSE) as totp_enabled 
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      if (!user.totp_enabled || !user.totp_secret) {
        return reply.status(400).send({
          success: false,
          error: { code: '2FA_NOT_ENABLED', message: '2FA is not enabled' },
        });
      }

      // Verify password
      if (user.password_hash) {
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_PASSWORD', message: 'Invalid password' },
          });
        }
      }

      // Decrypt TOTP secret
      const crypto = await import('crypto');
      const encryptionKey = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-encryption-key';
      const [ivHex, encryptedSecret] = user.totp_secret.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv);
      let decryptedSecret = decipher.update(encryptedSecret, 'hex', 'utf8');
      decryptedSecret += decipher.final('utf8');

      // Verify 2FA code
      const OTPAuth = await import('otpauth');
      const totp = new OTPAuth.TOTP({
        issuer: 'Methereum',
        label: 'user',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(decryptedSecret),
      });

      const delta = totp.validate({ token: code, window: 1 });

      if (delta === null) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CODE', message: 'Invalid 2FA code' },
        });
      }

      // Disable 2FA
      await db.query(
        `UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, '2fa_disable', request.ip, request.headers['user-agent'], JSON.stringify({ method: 'google_authenticator' })]
      );

      logger.info('2FA disabled', { userId });

      return reply.send({
        success: true,
        data: { message: '2FA disabled successfully' },
      });

    } catch (error) {
      logger.error('2FA disable error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to disable 2FA' },
      });
    }
  });

  // ===============================
  // PASSKEYS - List all passkeys
  // ===============================
  app.get('/passkeys', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
        last_used_at: Date | null;
      }>(
        `SELECT id, name, created_at, last_used_at 
         FROM user_passkeys 
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [userId]
      );

      return reply.send({
        success: true,
        data: { passkeys: result.rows },
      });

    } catch (error) {
      logger.error('Get passkeys error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get passkeys' },
      });
    }
  });

  // ===============================
  // PASSKEYS - Get challenge for registration
  // ===============================
  app.post('/passkeys/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      // Get user info
      const userResult = await db.query<{ email: string; first_name: string | null; last_name: string | null }>(
        `SELECT email, first_name, last_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;
      const crypto = await import('crypto');

      // Generate challenge
      const challenge = crypto.randomBytes(32);
      const challengeBase64 = challenge.toString('base64');

      // Store challenge in Redis (valid for 5 minutes)
      await redis.set(`passkey_challenge:${userId}`, challengeBase64, 300);

      // Encode user ID for WebAuthn
      const userIdBuffer = Buffer.from(userId, 'utf8');
      const userIdBase64 = userIdBuffer.toString('base64');

      const displayName = user.first_name && user.last_name
        ? `${user.first_name} ${user.last_name}`
        : user.email;

      // Get hostname for RP ID
      const rpId = process.env.WEBAUTHN_RP_ID || 'localhost';
      const rpName = process.env.WEBAUTHN_RP_NAME || 'Methereum';

      return reply.send({
        success: true,
        data: {
          challenge: challengeBase64,
          userId: userIdBase64,
          userName: user.email,
          userDisplayName: displayName,
          rpId,
          rpName,
        },
      });

    } catch (error) {
      logger.error('Passkey challenge error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate challenge' },
      });
    }
  });

  // ===============================
  // PASSKEYS - Register new passkey
  // ===============================
  app.post('/passkeys/register', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { credentialId, clientDataJSON, attestationObject, name } = request.body as {
        credentialId: string;
        clientDataJSON: string;
        attestationObject: string;
        name: string;
      };

      if (!credentialId || !clientDataJSON || !attestationObject) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_DATA', message: 'Missing credential data' },
        });
      }

      // Verify challenge exists
      const storedChallenge = await redis.get(`passkey_challenge:${userId}`);
      if (!storedChallenge) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CHALLENGE', message: 'Challenge expired or invalid' },
        });
      }

      // Parse and verify clientDataJSON (handle URL-safe base64)
      const urlSafeToStandard = (str: string) => str.replace(/-/g, '+').replace(/_/g, '/');
      const standardToUrlSafe = (str: string) => str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      
      const clientDataBuffer = Buffer.from(urlSafeToStandard(clientDataJSON), 'base64');
      const clientData = JSON.parse(clientDataBuffer.toString('utf8'));
      
      // Verify challenge matches (clientData.challenge is URL-safe base64, storedChallenge is standard base64)
      const clientChallenge = clientData.challenge;
      const storedChallengeUrlSafe = standardToUrlSafe(storedChallenge);
      
      if (clientChallenge !== storedChallengeUrlSafe && clientChallenge !== storedChallenge) {
        logger.warn('Challenge mismatch', { clientChallenge, storedChallenge, storedChallengeUrlSafe });
        return reply.status(400).send({
          success: false,
          error: { code: 'CHALLENGE_MISMATCH', message: 'Challenge does not match' },
        });
      }

      // Verify type is webauthn.create
      if (clientData.type !== 'webauthn.create') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TYPE', message: 'Invalid credential type' },
        });
      }

      // Check if credential already exists
      const existingCred = await db.query(
        `SELECT id FROM user_passkeys WHERE credential_id = $1 AND deleted_at IS NULL`,
        [credentialId]
      );

      if (existingCred.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CREDENTIAL_EXISTS', message: 'This passkey is already registered' },
        });
      }

      // Store passkey in database
      const result = await db.query<{ id: string }>(
        `INSERT INTO user_passkeys (user_id, credential_id, public_key, name, attestation_object, client_data_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [userId, credentialId, attestationObject, name || 'Passkey', attestationObject, clientDataJSON]
      );

      // Clear challenge
      await redis.del(`passkey_challenge:${userId}`);

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'passkey_add', request.ip, request.headers['user-agent'], JSON.stringify({ name })]
      );

      logger.info('Passkey registered', { userId, passkeyId: result.rows[0]?.id });

      return reply.send({
        success: true,
        data: { message: 'Passkey registered successfully', id: result.rows[0]?.id },
      });

    } catch (error) {
      logger.error('Passkey register error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to register passkey' },
      });
    }
  });

  // ===============================
  // PASSKEYS - Rename passkey
  // ===============================
  app.patch('/passkeys/:id/rename', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: string };

      if (!name || name.trim().length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_NAME', message: 'Name is required' },
        });
      }

      if (name.length > 50) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NAME_TOO_LONG', message: 'Name must be 50 characters or less' },
        });
      }

      const result = await db.query(
        `UPDATE user_passkeys SET name = $1 
         WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL`,
        [name.trim(), id, userId]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Passkey not found' },
        });
      }

      logger.info('Passkey renamed', { userId, passkeyId: id, newName: name.trim() });

      return reply.send({
        success: true,
        data: { message: 'Passkey renamed successfully' },
      });

    } catch (error) {
      logger.error('Passkey rename error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to rename passkey' },
      });
    }
  });

  // ===============================
  // PASSKEYS - Delete passkey
  // ===============================
  app.delete('/passkeys/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { id } = request.params as { id: string };

      // Soft delete passkey
      const result = await db.query(
        `UPDATE user_passkeys SET deleted_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, userId]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Passkey not found' },
        });
      }

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'passkey_remove', request.ip, request.headers['user-agent'], JSON.stringify({ passkeyId: id })]
      );

      logger.info('Passkey deleted', { userId, passkeyId: id });

      return reply.send({
        success: true,
        data: { message: 'Passkey deleted successfully' },
      });

    } catch (error) {
      logger.error('Passkey delete error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete passkey' },
      });
    }
  });

  // ===============================
  // FUND PASSWORD - Get Status
  // ===============================
  app.get('/fund-password/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      const result = await db.query<{ fund_password_hash: string | null }>(
        `SELECT fund_password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      return reply.send({
        success: true,
        data: { hasFundPassword: !!result.rows[0]?.fund_password_hash },
      });

    } catch (error) {
      logger.error('Fund password status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get fund password status' },
      });
    }
  });

  // ===============================
  // FUND PASSWORD - Check if same as login password
  // ===============================
  app.post('/fund-password/check-same', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { password } = request.body as { password: string };

      if (!password) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_PASSWORD', message: 'Password is required' },
        });
      }

      // Get user's login password hash
      const result = await db.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = result.rows[0]!;

      // If user doesn't have a login password (e.g., OAuth only), allow any fund password
      if (!user.password_hash) {
        return reply.send({
          success: true,
          data: { isSame: false },
        });
      }

      // Check if fund password matches login password
      const isSame = await bcrypt.compare(password, user.password_hash);

      return reply.send({
        success: true,
        data: { isSame },
      });

    } catch (error) {
      logger.error('Fund password check-same error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check password' },
      });
    }
  });

  // ===============================
  // FUND PASSWORD - Set/Update
  // ===============================
  app.post('/fund-password/set', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { password } = request.body as { password: string };

      if (!password) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_PASSWORD', message: 'Password is required' },
        });
      }

      // Validate password
      if (password.length < 8 || password.length > 30) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Password must be 8-30 characters' },
        });
      }

      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WEAK_PASSWORD', message: 'Password must contain uppercase, lowercase, and number' },
        });
      }

      // Check if same as login password
      const userResult = await db.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      if (user.password_hash) {
        const isSame = await bcrypt.compare(password, user.password_hash);
        if (isSame) {
          return reply.status(400).send({
            success: false,
            error: { code: 'SAME_AS_LOGIN', message: 'Fund password must be different from login password' },
          });
        }
      }

      // Hash and store fund password
      const fundPasswordHash = await bcrypt.hash(password, 12);
      
      await db.query(
        `UPDATE users SET fund_password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [fundPasswordHash, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'fund_password_set', request.ip, request.headers['user-agent'], JSON.stringify({})]
      );

      logger.info('Fund password set', { userId });

      return reply.send({
        success: true,
        data: { message: 'Fund password set successfully' },
      });

    } catch (error) {
      logger.error('Fund password set error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to set fund password' },
      });
    }
  });
}

// Helper function to generate referral code
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
