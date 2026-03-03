import { Decimal } from '../lib/decimal.js';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { otpService } from '../services/otp.service.js';
import { authService } from '../services/auth.service.js';
import {
  createSession,
  revokeSession,
  revokeAllExceptCurrent,
  getAccountLockUntil,
  recordFailedLogin,
  clearFailedLoginAttempts,
} from '../services/session.service.js';
import {
  logUserActivity,
  getDeviceIdFromRequest,
} from '../services/activity-monitor.service.js';
import { rateLimitByIp } from '../lib/rate-limit-fastify.js';
import { getClientIp } from '../lib/client-ip.js';
import { config } from '../config/index.js';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

// WebAuthn configuration
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Methereum Exchange';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
const CHALLENGE_TTL = 300; // 5 minutes

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

/** Normalize request.user so request.user.id always exists (from userId or id). Returns false if already replied 401. */
function normalizeUserPayload(request: FastifyRequest, reply: FastifyReply): boolean {
  const u = request.user as { id?: string; userId?: string } | undefined;
  if (!u) return true;
  const id = u.id ?? u.userId;
  if (!id || typeof id !== 'string') {
    reply.status(401).send({ success: false, error: { code: 'INVALID_JWT_PAYLOAD', message: 'Invalid token payload' } });
    return false;
  }
  (request.user as { id: string }).id = id;
  return true;
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
  const accessToken = app.jwt.sign(payload, { expiresIn: config.jwt.expiresIn });
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
   * FIX #4: Rate limit 3/min per IP via preHandler (before handler/DB).
   */
  app.post<{ Body: SendOTPBody }>('/send-otp', {
    preHandler: [rateLimitByIp('auth:send-otp', 3, 60)],
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

      // Generate and send OTP
      let otp: string;
      let expiresAt: Date;
      
      try {
        const result = await otpService.createOTP(cleanIdentifier, type);
        otp = result.otp;
        expiresAt = result.expiresAt;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown';
        const errStack = error instanceof Error ? error.stack : undefined;
        logger.error('Failed to create OTP', { error: errMsg, stack: errStack });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'OTP_CREATE_FAILED',
            message: config.env === 'development' ? `Failed to create OTP: ${errMsg}` : 'Failed to create OTP. Please try again.',
          },
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
        return reply.status(503).send({
          success: false,
          error: { code: 'OTP_DELIVERY_UNAVAILABLE', message: 'OTP delivery is temporarily unavailable. Please try again later.' },
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
      const errMsg = error instanceof Error ? error.message : 'Unknown';
      const isInvalid = errMsg.includes('identifier') || errMsg.includes('invalid');
      logger.error('Send OTP error', { error: errMsg });
      if (isInvalid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: errMsg },
        });
      }
      return reply.status(500).send({
        success: false,
        error: { code: 'OTP_SEND_FAILED', message: 'Could not send verification code. Please try again.' },
      });
    }
  });

  /**
   * POST /auth/verify-otp
   * Verify OTP and login/register
   * FIX #4: Rate limit 5/min per IP via preHandler.
   */
  app.post<{ Body: VerifyOTPBody }>('/verify-otp', {
    preHandler: [rateLimitByIp('auth:verify-otp', 5, 60)],
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
        const userByIdentifier = await db.query<{ id: string }>(
          `SELECT id FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
          [cleanIdentifier]
        );
        if (userByIdentifier.rows.length > 0) {
          const failedUserId = userByIdentifier.rows[0]!.id;
          await recordFailedLogin(failedUserId);
          await logUserActivity({
            userId: failedUserId,
            action: 'login_failed',
            ipAddress: getClientIp(request),
            userAgent: request.headers['user-agent'],
            deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
            metadata: { reason: 'invalid_otp' },
          });
        }
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // For signup purpose, just verify and set flag - don't create user yet
      if (purpose === 'signup') {
        // Set a flag in Redis (fallback: DB has verified_at from verifyOTP above)
        try {
          await redis.set(`otp:verified:${cleanIdentifier}`, 'true', 600); // 10 minutes validity
        } catch {
          // Redis down: signup will fall back to DB check (verified_at in otp_verifications)
        }

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

      // Account lock check (existing users only)
      if (!isNewUser) {
        const lockedUntil = await getAccountLockUntil(user.id);
        if (lockedUntil) {
          await logUserActivity({
            userId: user.id,
            action: 'login_failed',
            ipAddress: getClientIp(request),
            userAgent: request.headers['user-agent'],
            deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
            metadata: { reason: 'account_locked', lockedUntil: lockedUntil.toISOString() },
          });
          return reply.status(403).send({
            success: false,
            error: {
              code: 'ACCOUNT_LOCKED',
              message: `Account temporarily locked. Try again after ${lockedUntil.toISOString()}`,
            },
          });
        }
      }

      const deviceId = getDeviceIdFromRequest(request.headers as Record<string, string | undefined>);
      const { sessionId, expiresAt } = await createSession({
        userId: user.id,
        deviceId,
        deviceType: 'web',
        ipAddress: getClientIp(request),
        userAgent: request.headers['user-agent'],
        ttlSeconds: 7 * 24 * 60 * 60,
      });

      await clearFailedLoginAttempts(user.id);

      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId,
      });

      await logUserActivity({
        userId: user.id,
        action: 'login_success',
        sessionId,
        ipAddress: getClientIp(request),
        userAgent: request.headers['user-agent'],
        deviceId,
      });

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

      // Rotate refresh token: create new session, revoke old one, issue tokens for new session (prevents replay).
      const newSession = await createSession({
        userId: user.id,
        ipAddress: getClientIp(request) || undefined,
        userAgent: request.headers['user-agent'] ?? undefined,
        deviceType: 'web',
      });
      await revokeSession(decoded.sessionId);

      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId: newSession.sessionId,
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

      await revokeSession(sessionId);
      await logUserActivity({
        userId,
        action: 'logout',
        sessionId,
        ipAddress: getClientIp(request),
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
      });

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
   * POST /auth/logout-all-other
   * Revoke all sessions except the current one
   */
  app.post('/logout-all-other', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { sessionId, id: userId } = request.user!;
      const revoked = await revokeAllExceptCurrent(userId, sessionId);
      await logUserActivity({
        userId,
        action: 'sessions_revoked_all',
        sessionId,
        ipAddress: getClientIp(request),
        userAgent: request.headers['user-agent'],
        deviceId: getDeviceIdFromRequest(request.headers as Record<string, string | undefined>),
        metadata: { revokedCount: revoked },
      });
      return reply.send({
        success: true,
        data: { message: 'All other sessions have been logged out', revokedCount: revoked },
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'LOGOUT_ALL_FAILED', message: 'Failed to revoke other sessions' },
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

      const authFlags = (request as unknown as { authDecision?: { auth_flags: number } }).authDecision?.auth_flags ?? 0;
      return reply.send({
        success: true,
        data: {
          ...user,
          referralCode: referralResult.rows[0]?.code,
          auth_flags: authFlags,
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
    preHandler: [rateLimitByIp('auth:signup', 10, 3600)],
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

      // Check if OTP was recently verified (Redis or DB fallback when Redis down)
      let otpVerified = false;
      try {
        const cached = await redis.get(`otp:verified:${cleanIdentifier}`);
        otpVerified = cached === 'true';
      } catch {
        // Redis down, fall back to DB
      }
      if (!otpVerified) {
        const dbCheck = await db.query(
          `SELECT 1 FROM otp_verifications 
           WHERE identifier = $1 AND type = $2 AND verified_at IS NOT NULL 
           AND verified_at > NOW() - INTERVAL '10 minutes' LIMIT 1`,
          [cleanIdentifier, type]
        );
        otpVerified = dbCheck.rows.length > 0;
      }
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
        const codeRow = await db.query(
          `SELECT id, user_id, referrer_commission_rate, referee_discount_rate FROM referral_codes WHERE code = $1 AND is_active = TRUE`,
          [referralCode.toUpperCase().trim()]
        );
        if (codeRow.rows.length > 0) {
          const row = codeRow.rows[0]!;
          const { id: referral_code_id, user_id: referrer_id, referrer_commission_rate, referee_discount_rate } = row;
          await db.query(
            `INSERT INTO referral_relationships (referrer_id, referee_id, referral_code_id, locked_referrer_commission, locked_referee_discount)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (referrer_id, referee_id) DO NOTHING`,
            [referrer_id, user.id, referral_code_id, referrer_commission_rate, referee_discount_rate]
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
        [sessionId, user.id, sessionToken, 'web', getClientIp(request), request.headers['user-agent'], expiresAt]
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

      // Set initial last_login_at and log activity
      await db.query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id]
      );

      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, sessionId, 'signup', getClientIp(request), request.headers['user-agent']]
      );

      // Clear the verified OTP flag (best effort)
      try {
        await redis.del(`otp:verified:${cleanIdentifier}`);
      } catch { /* Redis down */ }

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
   * Multi-step login with security verification
   * Step 1: Verify initial OTP (email/phone)
   * Step 2+: Additional verification based on user settings (SMS, 2FA)
   * P0: Rate limit 5/min per IP.
   */
  app.post<{
    Body: {
      email?: string;
      phone?: string;
      otp: string;
    };
  }>('/login', {
    preHandler: [rateLimitByIp('auth:login', 5, 60)],
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

      const loginMethod = email ? 'email' : 'phone';
      let cleanIdentifier: string;
      
      if (loginMethod === 'email') {
        cleanIdentifier = email!.trim().toLowerCase();
      } else {
        cleanIdentifier = normalizePhoneNumber(phone!);
      }

      // Verify OTP
      const verification = await otpService.verifyOTP(cleanIdentifier, loginMethod, otp);

      if (!verification.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // Get user with security settings (email lookup case-insensitive)
      const userWhereClause = loginMethod === 'email'
        ? 'LOWER(email) = LOWER($1) AND deleted_at IS NULL'
        : 'phone = $1 AND deleted_at IS NULL';
      let userResult = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
        tier_level: number;
        sms_auth_enabled: boolean;
        email_auth_enabled: boolean;
        totp_enabled: boolean;
        totp_secret: string | null;
        passkeys_enabled: boolean;
      }>(
        `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level,
                COALESCE(sms_auth_enabled, FALSE) as sms_auth_enabled,
                COALESCE(email_auth_enabled, TRUE) as email_auth_enabled,
                COALESCE(totp_enabled, FALSE) as totp_enabled,
                totp_secret,
                COALESCE(passkeys_enabled, FALSE) as passkeys_enabled
         FROM users WHERE ${userWhereClause}`,
        [cleanIdentifier]
      );

      // Fallback for phone search
      if (userResult.rows.length === 0 && loginMethod === 'phone') {
        const phoneDigits = phone!.replace(/\D/g, '');
        userResult = await db.query(
          `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level,
                  COALESCE(sms_auth_enabled, FALSE) as sms_auth_enabled,
                  COALESCE(email_auth_enabled, TRUE) as email_auth_enabled,
                  COALESCE(totp_enabled, FALSE) as totp_enabled,
                  totp_secret,
                  COALESCE(passkeys_enabled, FALSE) as passkeys_enabled
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

      // Build required verification steps based on user settings
      const stepsRequired: string[] = [];
      
      // If logged in with email and SMS auth is enabled, require SMS verification
      if (loginMethod === 'email' && user.sms_auth_enabled && user.phone) {
        stepsRequired.push('sms');
      }
      
      // If logged in with phone and email auth is enabled, require email verification
      if (loginMethod === 'phone' && user.email_auth_enabled && user.email) {
        stepsRequired.push('email');
      }
      
      // If 2FA is enabled, require 2FA verification
      if (user.totp_enabled && user.totp_secret) {
        stepsRequired.push('2fa');
      }

      // If additional verification steps are required
      if (stepsRequired.length > 0) {
        // Create verification token
        const verificationToken = uuidv4();
        const tokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await db.query(
          `INSERT INTO login_verification_tokens (id, user_id, token, login_method, steps_required, ip_address, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [uuidv4(), user.id, verificationToken, loginMethod, JSON.stringify(stepsRequired), getClientIp(request), request.headers['user-agent'], tokenExpiry]
        );

        // Send OTP for first required step
        const firstStep = stepsRequired[0];
        if (firstStep === 'sms' && user.phone) {
          const { otp } = await otpService.createOTP(user.phone, 'phone');
          await otpService.sendSMSOTP(user.phone, otp);
        } else if (firstStep === 'email' && user.email) {
          const { otp } = await otpService.createOTP(user.email, 'email');
          await otpService.sendEmailOTP(user.email, otp);
        }

        logger.info('Multi-step login initiated', { userId: user.id, steps: stepsRequired });

        return reply.send({
          success: true,
          data: {
            requiresVerification: true,
            verificationToken,
            stepsRequired,
            currentStep: 0,
            nextStep: firstStep,
            maskedPhone: user.phone ? `+${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : null,
            maskedEmail: user.email ? `${user.email.slice(0, 3)}***@${user.email.split('@')[1]}` : null,
          },
        });
      }

      // No additional verification required - complete login
      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO user_sessions (id, user_id, session_token, device_type, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, user.id, sessionToken, 'web', getClientIp(request) ?? null, request.headers['user-agent'] ?? null, expiresAt]
      );

      try {
        await redis.setJson(`session:${sessionId}`, {
          userId: user.id,
          isActive: true,
          createdAt: Date.now(),
        }, 7 * 24 * 60 * 60);
      } catch (redisErr) {
        logger.warn('Session cache (Redis) write failed, login continues', { error: redisErr instanceof Error ? redisErr.message : 'Unknown' });
      }

      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId,
      });

      // Update last_login_at and log activity
      await db.query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id]
      );

      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, sessionId, 'login', getClientIp(request), request.headers['user-agent']]
      );

      logger.info('User logged in (no additional verification)', { userId: user.id });

      return reply.send({
        success: true,
        data: {
          requiresVerification: false,
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
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Login error', {
        message: err.message,
        stack: err.stack,
      });
      const isDev = process.env.NODE_ENV !== 'production';
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: isDev ? `Login failed: ${err.message}` : 'Login failed. Please try again.',
        },
      });
    }
  });

  /**
   * POST /auth/login/verify-step
   * Verify a step in multi-step login
   * P0: Rate limit 10/min per IP.
   */
  app.post<{
    Body: {
      verificationToken: string;
      step: 'sms' | 'email' | '2fa';
      code: string;
    };
  }>('/login/verify-step', {
    preHandler: [rateLimitByIp('auth:login-verify-step', 10, 60)],
    schema: {
      body: {
        type: 'object',
        required: ['verificationToken', 'step', 'code'],
        properties: {
          verificationToken: { type: 'string' },
          step: { type: 'string', enum: ['sms', 'email', '2fa'] },
          code: { type: 'string', minLength: 6, maxLength: 6 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { verificationToken, step, code } = request.body;

      // Get verification token
      const tokenResult = await db.query<{
        id: string;
        user_id: string;
        steps_completed: string[];
        steps_required: string[];
        current_step: number;
        expires_at: Date;
      }>(
        `SELECT id, user_id, steps_completed, steps_required, current_step, expires_at
         FROM login_verification_tokens
         WHERE token = $1 AND completed_at IS NULL`,
        [verificationToken]
      );

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid or expired verification token' },
        });
      }

      const verificationRecord = tokenResult.rows[0]!;

      if (new Date() > verificationRecord.expires_at) {
        return reply.status(400).send({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'Verification token has expired. Please login again.' },
        });
      }

      // Get user
      const userResult = await db.query<{
        id: string;
        email: string | null;
        phone: string | null;
        username: string | null;
        status: string;
        email_verified: boolean;
        phone_verified: boolean;
        tier_level: number;
        totp_secret: string | null;
      }>(
        `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level, totp_secret
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [verificationRecord.user_id]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      // Verify the step
      let isValid = false;
      
      if (step === 'sms' && user.phone) {
        const verification = await otpService.verifyOTP(user.phone, 'phone', code);
        isValid = verification.valid;
      } else if (step === 'email' && user.email) {
        const verification = await otpService.verifyOTP(user.email, 'email', code);
        isValid = verification.valid;
      } else if (step === '2fa' && user.totp_secret) {
        // Decrypt and verify TOTP (TOTP_ENCRYPTION_KEY required; no JWT fallback)
        try {
          const crypto = await import('crypto');
          const { config } = await import('../config/index.js');
          const encryptionKey = config.security.totpEncryptionKey;
          if (!encryptionKey || encryptionKey.length < 32) {
            isValid = false;
            throw new Error('TOTP_ENCRYPTION_KEY required (min 32 chars). Do not use JWT_SECRET.');
          }
          const [ivHex, encryptedSecret] = user.totp_secret.split(':');
          if (!ivHex || !encryptedSecret) throw new Error('Invalid TOTP secret format');
          const iv = Buffer.from(ivHex, 'hex');
          const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv);
          let decryptedSecret: string = decipher.update(encryptedSecret, 'hex', 'utf8');
          decryptedSecret += decipher.final('utf8');

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
          isValid = delta !== null;
        } catch (e) {
          logger.error('2FA verification error', { error: e instanceof Error ? e.message : 'Unknown' });
          isValid = false;
        }
      }

      if (!isValid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CODE', message: 'Invalid verification code' },
        });
      }

      // Mark step as completed
      const stepsCompleted = [...(verificationRecord.steps_completed || []), step];
      const currentStep = verificationRecord.current_step + 1;

      await db.query(
        `UPDATE login_verification_tokens
         SET steps_completed = $1, current_step = $2
         WHERE id = $3`,
        [JSON.stringify(stepsCompleted), currentStep, verificationRecord.id]
      );

      // Check if all steps are completed
      const allStepsCompleted = verificationRecord.steps_required.every(s => stepsCompleted.includes(s));

      if (!allStepsCompleted) {
        // Send OTP for next step
        const nextStep = verificationRecord.steps_required.find(s => !stepsCompleted.includes(s));
        
        if (nextStep === 'sms' && user.phone) {
          const { otp } = await otpService.createOTP(user.phone, 'phone');
          await otpService.sendSMSOTP(user.phone, otp);
        } else if (nextStep === 'email' && user.email) {
          const { otp } = await otpService.createOTP(user.email, 'email');
          await otpService.sendEmailOTP(user.email, otp);
        }

        return reply.send({
          success: true,
          data: {
            stepCompleted: step,
            allStepsCompleted: false,
            nextStep,
            stepsRemaining: verificationRecord.steps_required.filter(s => !stepsCompleted.includes(s)),
          },
        });
      }

      // All steps completed - complete login
      await db.query(
        `UPDATE login_verification_tokens SET completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [verificationRecord.id]
      );

      const sessionId = uuidv4();
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.query(
        `INSERT INTO user_sessions (id, user_id, session_token, device_type, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, user.id, sessionToken, 'web', getClientIp(request), request.headers['user-agent'], expiresAt]
      );

      await redis.setJson(`session:${sessionId}`, {
        userId: user.id,
        isActive: true,
        createdAt: Date.now(),
      }, 7 * 24 * 60 * 60);

      const tokens = generateTokens(app, {
        userId: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        role: 'user',
        sessionId,
      });

      // Update last_login_at and log activity
      await db.query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id]
      );

      await db.query(
        `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, sessionId, 'login', getClientIp(request), request.headers['user-agent']]
      );

      logger.info('Multi-step login completed', { userId: user.id });

      return reply.send({
        success: true,
        data: {
          stepCompleted: step,
          allStepsCompleted: true,
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
      logger.error('Login verification step error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Verification failed' },
      });
    }
  });

  /**
   * POST /auth/login/resend-otp
   * Resend OTP for current verification step
   * P0: Rate limit 5/min per IP.
   */
  app.post<{
    Body: {
      verificationToken: string;
      step: 'sms' | 'email';
    };
  }>('/login/resend-otp', {
    preHandler: [rateLimitByIp('auth:login-resend-otp', 5, 60)],
    schema: {
      body: {
        type: 'object',
        required: ['verificationToken', 'step'],
        properties: {
          verificationToken: { type: 'string' },
          step: { type: 'string', enum: ['sms', 'email'] },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { verificationToken, step } = request.body;

      // Get verification token
      const tokenResult = await db.query<{
        user_id: string;
        expires_at: Date;
      }>(
        `SELECT user_id, expires_at
         FROM login_verification_tokens
         WHERE token = $1 AND completed_at IS NULL`,
        [verificationToken]
      );

      if (tokenResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid verification token' },
        });
      }

      const record = tokenResult.rows[0]!;

      if (new Date() > record.expires_at) {
        return reply.status(400).send({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'Verification token has expired' },
        });
      }

      // Get user
      const userResult = await db.query<{ email: string | null; phone: string | null }>(
        `SELECT email, phone FROM users WHERE id = $1`,
        [record.user_id]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      // Send OTP
      if (step === 'sms' && user.phone) {
        const { otp } = await otpService.createOTP(user.phone, 'phone');
        await otpService.sendSMSOTP(user.phone, otp);
      } else if (step === 'email' && user.email) {
        const { otp } = await otpService.createOTP(user.email, 'email');
        await otpService.sendEmailOTP(user.email, otp);
      } else {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STEP', message: 'Cannot send OTP for this step' },
        });
      }

      return reply.send({
        success: true,
        message: 'OTP sent successfully',
      });

    } catch (error) {
      logger.error('Resend OTP error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to resend OTP' },
      });
    }
  });

  /**
   * GET /auth/login/check-passkeys
   * Check if user has passkeys enabled for login
   */
  app.post<{
    Body: {
      email?: string;
      phone?: string;
    };
  }>('/login/check-passkeys', {
    preHandler: [rateLimitByIp('auth:check-passkeys', 10, 60)],
    schema: {
      body: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          phone: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { email, phone } = request.body;

      if (!email && !phone) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_IDENTIFIER', message: 'Email or phone required' },
        });
      }

      const type = email ? 'email' : 'phone';
      const identifier = email || phone;

      const normalizedIdentifier = type === 'email' ? identifier!.trim().toLowerCase() : normalizePhoneNumber(identifier!);
      
      const result = await db.query<{ id: string; passkeys_enabled: boolean }>(
        `SELECT id, COALESCE(passkeys_enabled, FALSE) as passkeys_enabled
         FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [normalizedIdentifier]
      );

      if (result.rows.length === 0) {
        return reply.send({
          success: true,
          data: { passkeysEnabled: false },
        });
      }

      const userId = result.rows[0]!.id;
      const passkeysEnabled = result.rows[0]!.passkeys_enabled;

      // Also check that actual passkeys exist (not just the flag)
      if (passkeysEnabled) {
        const passkeysCount = await db.query(
          `SELECT COUNT(*) as count FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
          [userId]
        );
        
        const actualCount = parseInt(passkeysCount.rows[0]?.count || '0');
        
        // If flag is enabled but no actual passkeys, fix the inconsistency
        if (actualCount === 0) {
          await db.query(
            `UPDATE users SET passkeys_enabled = FALSE WHERE id = $1`,
            [userId]
          );
          return reply.send({
            success: true,
            data: { passkeysEnabled: false },
          });
        }
      }

      return reply.send({
        success: true,
        data: { passkeysEnabled },
      });

    } catch (error) {
      logger.error('Check passkeys error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to check passkeys' },
      });
    }
  });

  // ===============================
  // PASSKEY REGISTRATION - Generate Options
  // ===============================
  app.post('/passkey/register/options', {
    preHandler: [rateLimitByIp('auth:passkey', 10, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      // Get user info
      const userResult = await db.query<{ id: string; email: string; username: string | null }>(
        `SELECT id, email, username FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      // Get existing passkeys for this user to exclude
      const existingPasskeys = await db.query<{ credential_id: string; transports: string | null }>(
        `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      const excludeCredentials = existingPasskeys.rows.map(row => {
        const transports = row.transports 
          ? JSON.parse(row.transports) as AuthenticatorTransportFuture[]
          : undefined;
        return {
          id: row.credential_id,
          type: 'public-key' as const,
          transports,
        };
      });

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: new TextEncoder().encode(userId),
        userName: user.email,
        userDisplayName: user.username || user.email,
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          // SECURITY: Required for discoverable credentials (passwordless)
          residentKey: 'required',
          // SECURITY: CRITICAL - Must be 'required' for financial apps
          // 'preferred' would allow auth without biometric!
          userVerification: 'required',
          // Force platform authenticator (Touch ID / Face ID)
          authenticatorAttachment: 'platform',
        },
        supportedAlgorithmIDs: [-7, -257], // ES256, RS256
        timeout: 120000, // 2 minutes
      });

      // Store challenge in Redis with TTL
      await redis.set(
        `passkey_reg_challenge:${userId}`, 
        JSON.stringify({ challenge: options.challenge, timestamp: Date.now() }), 
        CHALLENGE_TTL
      );

      logger.info('Passkey registration options generated', { userId, rpId: RP_ID });

      // Add WebAuthn Level 3 hints to prefer platform authenticator
      // This helps browsers like Safari/Chrome to show Touch ID instead of QR
      const optionsWithHints = {
        ...options,
        hints: ['client-device'], // Prefer this device's authenticator
      };

      return reply.send({
        success: true,
        data: optionsWithHints,
      });

    } catch (error) {
      logger.error('Passkey registration options error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate passkey options' },
      });
    }
  });

  // ===============================
  // PASSKEY REGISTRATION - Verify
  // ===============================
  app.post('/passkey/register/verify', {
    preHandler: [rateLimitByIp('auth:passkey', 10, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { credential, deviceName } = request.body as { credential: RegistrationResponseJSON; deviceName?: string };

      if (!credential) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Credential data required' },
        });
      }

      // Get stored challenge
      const storedData = await redis.get(`passkey_reg_challenge:${userId}`);
      if (!storedData) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CHALLENGE_EXPIRED', message: 'Registration session expired. Please try again.' },
        });
      }

      const { challenge: expectedChallenge } = JSON.parse(storedData);

      // Verify the registration response
      // SECURITY: All cryptographic verification MUST be server-side
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true, // CRITICAL: Require biometric verification
        });
      } catch (verifyError) {
        logger.error('Passkey verification cryptographic error', { 
          error: verifyError instanceof Error ? verifyError.message : 'Unknown',
          userId,
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFICATION_FAILED', message: 'Passkey verification failed. Invalid credential.' },
        });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFICATION_FAILED', message: 'Passkey registration verification failed' },
        });
      }

      const { registrationInfo } = verification;
      const { credential: cred, credentialDeviceType, credentialBackedUp } = registrationInfo;
      
      if (!cred) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFICATION_FAILED', message: 'Invalid credential data' },
        });
      }

      // Store as base64url strings (cred.id is already Base64URLString; publicKey is Uint8Array)
      const credentialIdB64 = cred.id;
      const publicKeyB64 = isoBase64URL.fromBuffer(cred.publicKey);

      // Get transports from the response for future authentication hints
      const transports = credential.response.transports || [];

      // Check for duplicate credential (only check active ones, not deleted)
      const existingCred = await db.query(
        `SELECT id FROM user_passkeys WHERE credential_id = $1 AND deleted_at IS NULL`,
        [credentialIdB64]
      );

      if (existingCred.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CREDENTIAL_EXISTS', message: 'This passkey is already registered' },
        });
      }
      
      // Delete any soft-deleted credentials with the same ID (cleanup)
      await db.query(
        `DELETE FROM user_passkeys WHERE credential_id = $1 AND deleted_at IS NOT NULL`,
        [credentialIdB64]
      );

      // Store the passkey in database
      await db.query(
        `INSERT INTO user_passkeys (
          user_id, credential_id, public_key, counter, transports, 
          device_name, aaguid, backup_eligible, backup_state, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
        [
          userId, 
          credentialIdB64, 
          publicKeyB64, 
          cred.counter, 
          JSON.stringify(transports),
          deviceName || 'Unknown Device',
          registrationInfo.aaguid || null,
          credentialDeviceType === 'multiDevice', // Synced passkey
          credentialBackedUp,
        ]
      );

      // Enable passkeys for the user
      await db.query(
        `UPDATE users SET passkeys_enabled = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, 
        [userId]
      );

      // Clear the challenge
      await redis.del(`passkey_reg_challenge:${userId}`);

      // Log for audit
      try {
        await db.query(
          `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, 'settings_change', getClientIp(request), request.headers['user-agent'], 
           JSON.stringify({ type: 'passkey_registered', deviceName: deviceName || 'Unknown Device' })]
        );
      } catch (logError) {
        logger.warn('Failed to log passkey registration', { error: logError });
      }

      logger.info('Passkey registered successfully', { 
        userId, 
        credentialType: credentialDeviceType,
        backedUp: credentialBackedUp,
      });

      return reply.send({
        success: true,
        data: { message: 'Passkey registered successfully' },
      });

    } catch (error) {
      logger.error('Passkey registration verify error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify passkey registration' },
      });
    }
  });

  // ===============================
  // PASSKEY AUTHENTICATION - Generate Options
  // ===============================
  app.post('/passkey/authenticate/options', {
    preHandler: [rateLimitByIp('auth:passkey', 10, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email, phone } = request.body as { email?: string; phone?: string };

      if (!email && !phone) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_IDENTIFIER', message: 'Email or phone required' },
        });
      }

      const type = email ? 'email' : 'phone';
      const identifier = email ? email.trim().toLowerCase() : normalizePhoneNumber(phone!);

      // Get user - don't reveal if user exists
      const userResult = await db.query<{ id: string; passkeys_enabled: boolean }>(
        `SELECT id, COALESCE(passkeys_enabled, FALSE) as passkeys_enabled 
         FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [identifier]
      );

      if (userResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PASSKEYS_NOT_AVAILABLE', message: 'Passkey login not available' },
        });
      }

      if (!userResult.rows[0]!.passkeys_enabled) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PASSKEYS_NOT_ENABLED', message: 'Passkeys not enabled for this account' },
        });
      }

      const userId = userResult.rows[0]!.id;

      // Get user's passkeys with transports
      const passkeysResult = await db.query<{ credential_id: string; transports: string | null }>(
        `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (passkeysResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_PASSKEYS', message: 'No passkeys registered for this account' },
        });
      }

      // Build allowCredentials with transports for better UX
      const allowCredentials = passkeysResult.rows.map(row => {
        const transports = row.transports 
          ? JSON.parse(row.transports) as AuthenticatorTransportFuture[]
          : ['internal' as AuthenticatorTransportFuture];
        
        return {
          id: row.credential_id,
          type: 'public-key' as const,
          transports,
        };
      });

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        // SECURITY: CRITICAL - Must be 'required' for financial apps
        userVerification: 'required',
        allowCredentials,
        timeout: 120000, // 2 minutes
      });

      // Store challenge with user info
      await redis.set(
        `passkey_auth_challenge:${options.challenge}`, 
        JSON.stringify({ userId, identifier, timestamp: Date.now() }), 
        CHALLENGE_TTL
      );

      logger.info('Passkey authentication options generated', { identifier });

      // Add WebAuthn Level 3 hints to prefer platform authenticator
      const optionsWithHints = {
        ...options,
        hints: ['client-device'], // Prefer this device's authenticator
      };

      return reply.send({
        success: true,
        data: optionsWithHints,
      });

    } catch (error) {
      logger.error('Passkey auth options error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate authentication options' },
      });
    }
  });

  // ===============================
  // PASSKEY AUTHENTICATION - Verify
  // ===============================
  app.post('/passkey/authenticate/verify', {
    preHandler: [rateLimitByIp('auth:passkey', 10, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { credential, challenge } = request.body as { credential: AuthenticationResponseJSON; challenge: string };

      if (!credential || !challenge) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Credential and challenge required' },
        });
      }

      // Get stored challenge data (use new key format)
      const challengeData = await redis.get(`passkey_auth_challenge:${challenge}`);
      if (!challengeData) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CHALLENGE_EXPIRED', message: 'Authentication session expired. Please try again.' },
        });
      }

      const { userId } = JSON.parse(challengeData);

      // credential.id from WebAuthn response is base64url encoded
      const credentialId = credential.id;
      
      // Get the passkey from database
      const passkeyResult = await db.query<{ id: string; public_key: string; counter: number; backup_state: boolean }>(
        `SELECT id, public_key, counter, COALESCE(backup_state, FALSE) as backup_state 
         FROM user_passkeys WHERE user_id = $1 AND credential_id = $2 AND deleted_at IS NULL`,
        [userId, credentialId]
      );

      if (passkeyResult.rows.length === 0) {
        logger.warn('Passkey authentication failed - credential not found', { 
          userId, 
          credentialIdPrefix: credentialId.substring(0, 20),
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found or has been removed' },
        });
      }

      const passkey = passkeyResult.rows[0]!;

      // Decode public key from base64url to Uint8Array using simplewebauthn helper
      const publicKeyBytes = isoBase64URL.toBuffer(passkey.public_key);

      // Verify the authentication response
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: credential,
          expectedChallenge: challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          credential: {
            id: credentialId,
            publicKey: publicKeyBytes,
            counter: passkey.counter,
          },
          requireUserVerification: true, // CRITICAL: Require biometric
        });
      } catch (verifyError) {
        logger.error('Passkey authentication cryptographic verification failed', { 
          error: verifyError instanceof Error ? verifyError.message : 'Unknown',
          userId,
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFICATION_FAILED', message: 'Passkey authentication failed. Invalid signature.' },
        });
      }

      if (!verification.verified) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFICATION_FAILED', message: 'Passkey authentication failed' },
        });
      }

      const { authenticationInfo } = verification;

      // CRITICAL: Validate counter increment to prevent replay attacks
      // Counter must always increase. If newCounter <= oldCounter, possible replay attack.
      // Exception: Counter of 0 is allowed for synced passkeys that may not track counter.
      if (passkey.counter > 0 && authenticationInfo.newCounter <= passkey.counter) {
        logger.error('Passkey counter validation failed - possible replay attack', {
          userId,
          storedCounter: passkey.counter,
          receivedCounter: authenticationInfo.newCounter,
        });
        
        // Disable the passkey for safety
        await db.query(
          `UPDATE user_passkeys SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [passkey.id]
        );

        return reply.status(400).send({
          success: false,
          error: { 
            code: 'COUNTER_MISMATCH', 
            message: 'Security validation failed. This passkey has been disabled for your protection.',
          },
        });
      }

      // Update counter and last used timestamp
      await db.query(
        `UPDATE user_passkeys 
         SET counter = $1, last_used_at = CURRENT_TIMESTAMP, backup_state = $3
         WHERE id = $2`,
        [authenticationInfo.newCounter, passkey.id, authenticationInfo.credentialBackedUp]
      );

      // Get user details for JWT
      const userResult = await db.query<{
        id: string;
        email: string;
        phone: string | null;
        username: string | null;
        status: string;
        tier_level: string;
      }>(`SELECT id, email, phone, username, status, tier_level FROM users WHERE id = $1`, [userId]);

      if (userResult.rows.length === 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = userResult.rows[0]!;

      // Check if account is active
      if (user.status !== 'active') {
        return reply.status(403).send({
          success: false,
          error: { code: 'ACCOUNT_INACTIVE', message: 'Account is not active' },
        });
      }

      // Generate tokens
      const accessToken = request.server.jwt.sign(
        { userId: user.id, email: user.email, type: 'access' },
        { expiresIn: config.jwt.expiresIn }
      );

      const refreshToken = request.server.jwt.sign(
        { userId: user.id, email: user.email, type: 'refresh' },
        { expiresIn: '7d' }
      );

      // Store refresh token
      await redis.set(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60);

      // Update last_login_at and log activity
      try {
        await db.query(
          `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
          [user.id]
        );
        await db.query(
          `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details) VALUES ($1, $2, $3, $4, $5)`,
          [user.id, 'passkey_login', getClientIp(request), request.headers['user-agent'], JSON.stringify({ method: 'passkey' })]
        );
      } catch (logError) {
        logger.warn('Failed to log passkey login', { error: logError });
      }

      // Clear the challenge (one-time use)
      await redis.del(`passkey_auth_challenge:${challenge}`);

      logger.info('Passkey authentication successful', { userId: user.id });

      return reply.send({
        success: true,
        data: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            phone: user.phone,
            username: user.username,
            tierLevel: user.tier_level,
          },
        },
      });

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown';
      logger.error('Passkey auth verify error', { error: errMsg });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify passkey authentication' },
      });
    }
  });

  // ===============================
  // GET USER PASSKEYS
  // ===============================
  app.get('/passkeys', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{ 
        id: string; 
        device_name: string; 
        created_at: Date; 
        last_used_at: Date | null;
        backup_eligible: boolean;
        backup_state: boolean;
      }>(
        `SELECT id, device_name, created_at, last_used_at, 
                COALESCE(backup_eligible, FALSE) as backup_eligible,
                COALESCE(backup_state, FALSE) as backup_state
         FROM user_passkeys 
         WHERE user_id = $1 AND deleted_at IS NULL 
         ORDER BY created_at DESC`,
        [userId]
      );

      return reply.send({
        success: true,
        data: { 
          passkeys: result.rows.map(row => ({
            id: row.id,
            device_name: row.device_name,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
            is_synced: row.backup_eligible,
            is_backed_up: row.backup_state,
          })),
        },
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
  // DELETE PASSKEY
  // ===============================
  app.delete('/passkeys/:passkeyId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { passkeyId } = request.params as { passkeyId: string };

      // Soft delete the passkey
      const result = await db.query(
        `UPDATE user_passkeys 
         SET deleted_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [passkeyId, userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' },
        });
      }

      // Check if user has any remaining passkeys
      const remainingPasskeys = await db.query(
        `SELECT COUNT(*) as count FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      // If no passkeys remaining, disable passkeys for user
      if (parseInt(remainingPasskeys.rows[0]?.count || '0') === 0) {
        await db.query(
          `UPDATE users SET passkeys_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [userId]
        );
      }

      // Log the deletion
      try {
        await db.query(
          `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, 'settings_change', getClientIp(request), request.headers['user-agent'], JSON.stringify({ type: 'passkey_deleted', passkeyId })]
        );
      } catch (logError) {
        logger.warn('Failed to log passkey deletion', { error: logError });
      }

      logger.info('Passkey deleted', { userId, passkeyId });

      return reply.send({
        success: true,
        data: { message: 'Passkey deleted successfully' },
      });

    } catch (error) {
      logger.error('Delete passkey error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete passkey' },
      });
    }
  });

  // ===============================
  // CHECK PASSWORD STATUS
  // ===============================
  app.get('/check-password', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

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
      const userId = (request.user?.userId ?? request.user?.id)!;
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
        [userId, 'password_change', getClientIp(request), request.headers['user-agent'], JSON.stringify({ method: 'change' })]
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
  // PASSWORD RESET (Forgot password)
  // ===============================
  app.post<{ Body: { identifier: string } }>('/password/reset/request', {
    preHandler: [rateLimitByIp('auth:password-reset-request', 3, 60)],
    schema: {
      body: {
        type: 'object',
        required: ['identifier'],
        properties: { identifier: { type: 'string', minLength: 5 } },
      },
    },
  }, async (request, reply) => {
    try {
      const { identifier } = request.body;
      let type: 'email' | 'phone';
      try {
        type = getIdentifierType(identifier.trim());
      } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IDENTIFIER', message: 'Please enter a valid email or phone number' },
        });
      }
      const cleanIdentifier = type === 'email' ? identifier.trim().toLowerCase() : normalizePhoneNumber(identifier.trim());
      const userResult = await db.query<{ id: string }>(`SELECT id FROM users WHERE ${type} = $1 AND deleted_at IS NULL`, [cleanIdentifier]);
      if (userResult.rows.length === 0) {
        return reply.send({ success: true, data: { message: 'If an account exists, you will receive an OTP shortly.' } });
      }
      const userId = userResult.rows[0]!.id;
      const { otp, expiresAt } = await otpService.createOTP(cleanIdentifier, 'password_reset', userId);
      const sent = type === 'email'
        ? await otpService.sendEmailOTP(cleanIdentifier, otp)
        : await otpService.sendSMSOTP(cleanIdentifier, otp);
      if (!sent) {
        return reply.status(500).send({
          success: false,
          error: { code: 'OTP_SEND_FAILED', message: 'Failed to send OTP. Please try again.' },
        });
      }
      return reply.send({ success: true, data: { message: 'OTP sent', expiresAt: expiresAt.toISOString() } });
    } catch (error) {
      logger.error('Password reset request error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Request failed. Please try again.' },
      });
    }
  });

  app.post<{ Body: { identifier: string; otp: string; newPassword: string } }>('/password/reset', {
    preHandler: [rateLimitByIp('auth:password-reset', 5, 60)],
    schema: {
      body: {
        type: 'object',
        required: ['identifier', 'otp', 'newPassword'],
        properties: {
          identifier: { type: 'string', minLength: 5 },
          otp: { type: 'string', minLength: 6, maxLength: 6 },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { identifier, otp, newPassword } = request.body;
      if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters with uppercase, lowercase, and number' },
        });
      }
      let normId: string;
      try {
        const type = getIdentifierType(identifier.trim());
        normId = type === 'email' ? identifier.trim().toLowerCase() : normalizePhoneNumber(identifier.trim());
      } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_IDENTIFIER', message: 'Please enter a valid email or phone number' },
        });
      }
      await authService.resetPassword(normId, otp, newPassword);
      return reply.send({ success: true, data: { message: 'Password reset successfully' } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      return reply.status(400).send({
        success: false,
        error: { code: 'PASSWORD_RESET_FAILED', message: msg },
      });
    }
  });

  // ===============================
  // CHANGE EMAIL
  // ===============================
  app.post('/change-email', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { newEmail, otp } = request.body as { newEmail: string; otp: string };

      if (!newEmail || !otp) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_DATA', message: 'New email and OTP are required' },
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_EMAIL', message: 'Invalid email format' },
        });
      }

      // Check if email is already in use
      const existingUser = await db.query(
        `SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL`,
        [newEmail.toLowerCase(), userId]
      );

      if (existingUser.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'EMAIL_IN_USE', message: 'This email is already in use' },
        });
      }

      // Verify OTP
      const verification = await otpService.verifyOTP(newEmail, 'email', otp);
      if (!verification.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // Update email
      await db.query(
        `UPDATE users SET email = $1, email_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newEmail.toLowerCase(), userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'email_change', getClientIp(request), request.headers['user-agent'], JSON.stringify({ newEmail })]
      );

      logger.info('Email changed', { userId, newEmail });

      return reply.send({
        success: true,
        data: { message: 'Email changed successfully' },
      });

    } catch (error) {
      logger.error('Change email error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to change email' },
      });
    }
  });

  // ===============================
  // CHANGE PHONE
  // ===============================
  app.post('/change-phone', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { newPhone, otp } = request.body as { newPhone: string; otp: string };

      if (!newPhone || !otp) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_DATA', message: 'New phone and OTP are required' },
        });
      }

      // Clean phone number
      const cleanPhone = newPhone.replace(/\s/g, '');

      // Check if phone is already in use
      const existingUser = await db.query(
        `SELECT id FROM users WHERE phone = $1 AND id != $2 AND deleted_at IS NULL`,
        [cleanPhone, userId]
      );

      if (existingUser.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PHONE_IN_USE', message: 'This phone number is already in use' },
        });
      }

      // Verify OTP
      const verification = await otpService.verifyOTP(cleanPhone, 'phone', otp);
      if (!verification.valid) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_OTP', message: verification.message },
        });
      }

      // Update phone
      await db.query(
        `UPDATE users SET phone = $1, phone_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [cleanPhone, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'phone_change', getClientIp(request), request.headers['user-agent'], JSON.stringify({ newPhone: cleanPhone })]
      );

      logger.info('Phone changed', { userId, newPhone: cleanPhone });

      return reply.send({
        success: true,
        data: { message: 'Phone number changed successfully' },
      });

    } catch (error) {
      logger.error('Change phone error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to change phone' },
      });
    }
  });

  // ===============================
  // SEND SECURITY OTP (for authenticated users)
  // ===============================
  app.post('/send-security-otp', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
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
      const userId = (request.user?.userId ?? request.user?.id)!;
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
      const userId = (request.user?.userId ?? request.user?.id)!;
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
        [userId, 'phone_setup', getClientIp(request), request.headers['user-agent'], JSON.stringify({ phone: cleanPhone })]
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
      if (!normalizeUserPayload(request, reply)) return;
      const userId = (request.user as { id: string }).id;

      // Get comprehensive user profile
      const result = await db.query<{
        id: string;
        email: string;
        phone: string | null;
        phone_verified: boolean;
        first_name: string | null;
        last_name: string | null;
        totp_enabled: boolean;
        sms_auth_enabled: boolean;
        passkeys_enabled: boolean;
        has_fund_password: boolean;
        anti_phishing_code: string | null;
        withdrawal_whitelist_enabled: boolean;
        address_book_enabled: boolean;
        vip_level: number;
        tier_level: number;
        last_login_at: Date | null;
        created_at: Date;
        avatar_url: string | null;
      }>(
        `SELECT id, email, phone, phone_verified, first_name, last_name, avatar_url,
                COALESCE(totp_enabled, FALSE) as totp_enabled,
                COALESCE(sms_auth_enabled, FALSE) as sms_auth_enabled,
                COALESCE(passkeys_enabled, FALSE) as passkeys_enabled,
                (fund_password_hash IS NOT NULL) as has_fund_password,
                anti_phishing_code,
                COALESCE(withdrawal_whitelist_enabled, FALSE) as withdrawal_whitelist_enabled,
                COALESCE(address_book_enabled, FALSE) as address_book_enabled,
                COALESCE(vip_level, 0) as vip_level,
                COALESCE(tier_level, 0) as tier_level,
                last_login_at,
                created_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const userData = result.rows[0]!;

      // Get KYC status
      const kycResult = await db.query<{ status: string; kyc_level: number }>(
        `SELECT status, kyc_level FROM kyc_applications 
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      const kycStatus = kycResult.rows[0]?.status || 'not_submitted';
      const kycLevel = kycResult.rows[0]?.kyc_level || 0;

      // Get passkeys count
      const passkeysResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );
      const passkeysCount = parseInt(passkeysResult.rows[0]?.count || '0');

      // Get referral code (do not throw if table or row missing)
      let referralCode: string | null = null;
      try {
        const referralResult = await db.query<{ code: string }>(
          `SELECT code FROM referral_codes WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
          [userId]
        );
        referralCode = referralResult.rows[0]?.code ?? null;
        if (!referralCode && userData.email) {
          const newCode = userData.email.split('@')[0]?.toUpperCase().slice(0, 6) + 
                          Math.random().toString(36).substring(2, 6).toUpperCase();
          await db.query(
            `INSERT INTO referral_codes (user_id, code, is_active, created_at, updated_at)
             VALUES ($1, $2, TRUE, NOW(), NOW())
             ON CONFLICT (code) DO NOTHING`,
            [userId, newCode]
          );
          const again = await db.query<{ code: string }>(`SELECT code FROM referral_codes WHERE user_id = $1 LIMIT 1`, [userId]);
          referralCode = again.rows[0]?.code ?? newCode;
        }
      } catch {
        referralCode = null;
      }

      // Get active sessions/devices count (from unique user agents in last 30 days)
      const devicesResult = await db.query<{ count: string }>(
        `SELECT COUNT(DISTINCT user_agent) as count FROM user_activity_logs 
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [userId]
      );
      const activeDevices = Math.max(1, parseInt(devicesResult.rows[0]?.count || '1'));

      return reply.send({
        success: true,
        data: { 
          user: {
            ...userData,
            kycStatus,
            kycLevel,
            passkeysCount,
            referralCode,
            activeDevices,
          }
        },
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
  // 2FA STATUS (for address-book and other UIs that need only enabled flag)
  // ===============================
  app.get('/2fa/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const row = await db.query<{ totp_enabled: boolean }>(
        `SELECT COALESCE(totp_enabled, FALSE) as totp_enabled FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );
      const enabled = row.rows[0]?.totp_enabled ?? false;
      return reply.send({ success: true, data: { enabled } });
    } catch (error) {
      logger.error('2FA status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get 2FA status' },
      });
    }
  });

  // ===============================
  // GOOGLE 2FA SETUP - Generate Secret
  // ===============================
  app.post('/2fa/setup', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

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
      const userId = (request.user?.userId ?? request.user?.id)!;
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

      // Encrypt and store the secret (TOTP_ENCRYPTION_KEY required; no JWT fallback)
      const crypto = await import('crypto');
      const { config } = await import('../config/index.js');
      const encryptionKey = config.security.totpEncryptionKey;
      if (!encryptionKey || encryptionKey.length < 32) {
        return reply.status(503).send({
          success: false,
          error: { code: '2FA_CONFIG_ERROR', message: '2FA is not configured. Set TOTP_ENCRYPTION_KEY in .env (min 32 chars).' },
        });
      }
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
        [userId, '2fa_enable', getClientIp(request), request.headers['user-agent'], JSON.stringify({ method: 'google_authenticator' })]
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
      const userId = (request.user?.userId ?? request.user?.id)!;
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

      // Decrypt secret (TOTP_ENCRYPTION_KEY required; no JWT fallback)
      const crypto = await import('crypto');
      const { config } = await import('../config/index.js');
      const encryptionKey = config.security.totpEncryptionKey;
      if (!encryptionKey || encryptionKey.length < 32) {
        return reply.status(503).send({
          success: false,
          error: { code: '2FA_CONFIG_ERROR', message: '2FA is not configured. Set TOTP_ENCRYPTION_KEY in .env (min 32 chars).' },
        });
      }
          const [ivHex, encryptedSecret] = user.totp_secret.split(':');
          if (!ivHex || !encryptedSecret) throw new Error('Invalid TOTP secret format');
          const iv = Buffer.from(ivHex, 'hex');
          const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv);
          let decryptedSecret: string = decipher.update(encryptedSecret, 'hex', 'utf8');
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
      const userId = (request.user?.userId ?? request.user?.id)!;
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

      // Decrypt TOTP secret (TOTP_ENCRYPTION_KEY required; no JWT fallback)
      const crypto = await import('crypto');
      const { config } = await import('../config/index.js');
      const encryptionKey = config.security.totpEncryptionKey;
      if (!encryptionKey || encryptionKey.length < 32) {
        return reply.status(503).send({
          success: false,
          error: { code: '2FA_CONFIG_ERROR', message: '2FA is not configured. Set TOTP_ENCRYPTION_KEY in .env (min 32 chars).' },
        });
      }
      const [ivHex, encryptedSecret] = user.totp_secret.split(':');
      if (!ivHex || !encryptedSecret) throw new Error('Invalid TOTP secret format');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv);
      let decryptedSecret: string = decipher.update(encryptedSecret, 'hex', 'utf8');
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
        [userId, '2fa_disable', getClientIp(request), request.headers['user-agent'], JSON.stringify({ method: 'google_authenticator' })]
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
  // FUND PASSWORD - Get Status
  // ===============================
  app.get('/fund-password/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

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
      const userId = (request.user?.userId ?? request.user?.id)!;
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
      const userId = (request.user?.userId ?? request.user?.id)!;
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
        [userId, 'fund_password_set', getClientIp(request), request.headers['user-agent'], JSON.stringify({})]
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

  // ===============================
  // ANTI-PHISHING CODE - Get Status
  // ===============================
  app.get('/anti-phishing/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{ anti_phishing_code: string | null }>(
        `SELECT anti_phishing_code FROM users WHERE id = $1 AND deleted_at IS NULL`,
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
        data: { code: result.rows[0]?.anti_phishing_code || '' },
      });

    } catch (error) {
      logger.error('Anti-phishing status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get anti-phishing status' },
      });
    }
  });

  // ===============================
  // ANTI-PHISHING CODE - Set/Update
  // ===============================
  app.post('/anti-phishing/set', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { code, oldCode } = request.body as { code: string; oldCode?: string };

      if (!code) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_CODE', message: 'Anti-phishing code is required' },
        });
      }

      // Validate code (4-20 chars, letters, numbers, underscores only)
      if (code.length < 4 || code.length > 20) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_LENGTH', message: 'Code must be 4-20 characters' },
        });
      }

      if (!/^[a-zA-Z0-9_]+$/.test(code)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_CHARS', message: 'Code can only contain letters, numbers, and underscores' },
        });
      }

      // Get current anti-phishing code
      const userResult = await db.query<{ anti_phishing_code: string | null }>(
        `SELECT anti_phishing_code FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const currentCode = userResult.rows[0]?.anti_phishing_code;

      // If user already has a code, verify old code
      if (currentCode) {
        if (!oldCode) {
          return reply.status(400).send({
            success: false,
            error: { code: 'OLD_CODE_REQUIRED', message: 'Old anti-phishing code is required' },
          });
        }
        if (oldCode !== currentCode) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_OLD_CODE', message: 'Old anti-phishing code is incorrect' },
          });
        }
      }

      // Update anti-phishing code
      await db.query(
        `UPDATE users SET anti_phishing_code = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [code, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'anti_phishing_set', getClientIp(request), request.headers['user-agent'], JSON.stringify({ code })]
      );

      logger.info('Anti-phishing code set', { userId });

      return reply.send({
        success: true,
        data: { message: 'Anti-phishing code set successfully' },
      });

    } catch (error) {
      logger.error('Anti-phishing set error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to set anti-phishing code' },
      });
    }
  });
  // ===============================
  // API KEYS - List
  // ===============================
  app.get('/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query(
        `SELECT id, name, key_type, api_key_usage, api_key, api_secret, permission, 
                ip_restriction, ip_addresses, permissions, created_at, expires_at
         FROM user_api_keys 
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [userId]
      );

      const apiKeys = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        keyType: row.key_type,
        apiKeyUsage: row.api_key_usage,
        apiKey: row.api_key,
        apiSecret: row.api_secret,
        permission: row.permission,
        ipRestriction: row.ip_restriction,
        ipAddresses: row.ip_addresses || [],
        permissions: row.permissions || {},
        createdAt: row.created_at,
        expiresAt: row.expires_at
      }));

      return reply.send({
        success: true,
        data: apiKeys,
      });

    } catch (error) {
      logger.error('Get API keys error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get API keys' },
      });
    }
  });

  // ===============================
  // API KEYS - Create
  // ===============================
  app.post('/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const {
        keyType,
        apiKeyUsage,
        publicKey,
        name,
        permission,
        ipRestriction,
        ipAddresses,
        permissions
      } = request.body as {
        keyType: 'system' | 'self';
        apiKeyUsage: 'transaction' | 'third_party';
        publicKey?: string;
        name: string;
        permission: 'read_write' | 'read_only';
        ipRestriction: 'ip_only' | 'no_restriction';
        ipAddresses: string[];
        permissions: Record<string, boolean>;
      };

      // Check key limit (max 20)
      const countResult = await db.query(
        `SELECT COUNT(*) as count FROM user_api_keys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );
      
      if (parseInt(countResult.rows[0]?.count || '0') >= 20) {
        return reply.status(400).send({
          success: false,
          error: { code: 'KEY_LIMIT_REACHED', message: 'Maximum 20 API keys allowed per account' },
        });
      }

      // Generate API key and secret
      const crypto = await import('crypto');
      const apiKey = crypto.randomBytes(16).toString('hex');
      const apiSecret = keyType === 'system' ? crypto.randomBytes(32).toString('hex') : null;

      // Calculate expiration (3 months if no IP restriction, null if IP bound)
      const expiresAt = ipRestriction === 'no_restriction' 
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() 
        : null;

      await db.query(
        `INSERT INTO user_api_keys (
          user_id, name, key_type, api_key_usage, api_key, api_secret, public_key,
          permission, ip_restriction, ip_addresses, permissions, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          userId, name, keyType, apiKeyUsage, apiKey, apiSecret, publicKey || null,
          permission, ipRestriction, ipAddresses, JSON.stringify(permissions), expiresAt
        ]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'api_key_created', getClientIp(request), request.headers['user-agent'], 
         JSON.stringify({ name, keyType })]
      );

      logger.info('API key created', { userId, keyType, name });

      return reply.send({
        success: true,
        data: {
          apiKey,
          apiSecret: keyType === 'system' ? apiSecret : undefined,
          message: 'API key created successfully'
        },
      });

    } catch (error) {
      logger.error('Create API key error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create API key' },
      });
    }
  });

  // ===============================
  // API KEYS - Delete
  // ===============================
  app.delete('/api-keys/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { id } = request.params as { id: string };

      const result = await db.query(
        `UPDATE user_api_keys SET deleted_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'API key not found' },
        });
      }

      logger.info('API key deleted', { userId, keyId: id });

      return reply.send({
        success: true,
        data: { message: 'API key deleted successfully' },
      });

    } catch (error) {
      logger.error('Delete API key error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete API key' },
      });
    }
  });

  // ===============================
  // USER PREFERENCES - Get
  // ===============================
  app.get('/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query(
        `SELECT preferences FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const preferences = result.rows[0]?.preferences || {};

      return reply.send({
        success: true,
        data: preferences,
      });

    } catch (error) {
      logger.error('Get preferences error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get preferences' },
      });
    }
  });

  // ===============================
  // USER PREFERENCES - Update
  // ===============================
  app.post('/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const updates = request.body as Record<string, any>;

      // Get current preferences
      const currentResult = await db.query(
        `SELECT preferences FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (currentResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const currentPreferences = currentResult.rows[0]?.preferences || {};
      const newPreferences = { ...currentPreferences, ...updates };

      // Update preferences
      await db.query(
        `UPDATE users SET preferences = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [JSON.stringify(newPreferences), userId]
      );

      logger.info('User preferences updated', { userId });

      return reply.send({
        success: true,
        data: { message: 'Preferences updated successfully' },
      });

    } catch (error) {
      logger.error('Update preferences error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update preferences' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL LIMITS - Get
  // ===============================
  app.get('/withdrawal-limits', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query(
        `SELECT daily_withdrawal_limit, monthly_withdrawal_limit, 
                COALESCE(daily_withdrawal_used, 0) as daily_withdrawal_used,
                COALESCE(monthly_withdrawal_used, 0) as monthly_withdrawal_used
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const user = result.rows[0];

      const ROUND_DOWN = 1;
      const PREC = 8;
      return reply.send({
        success: true,
        data: {
          dailyLimit: new Decimal(user?.daily_withdrawal_limit ?? '20000').toDecimalPlaces(PREC, ROUND_DOWN).toString(),
          monthlyLimit: new Decimal(user?.monthly_withdrawal_limit ?? '100000').toDecimalPlaces(PREC, ROUND_DOWN).toString(),
          dailyUsed: new Decimal(user?.daily_withdrawal_used ?? '0').toDecimalPlaces(PREC, ROUND_DOWN).toString(),
          monthlyUsed: new Decimal(user?.monthly_withdrawal_used ?? '0').toDecimalPlaces(PREC, ROUND_DOWN).toString(),
          maxDailyLimit: '20000',
          maxMonthlyLimit: '100000'
        },
      });

    } catch (error) {
      logger.error('Get withdrawal limits error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get withdrawal limits' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL LIMITS - Update
  // ===============================
  app.post('/withdrawal-limits', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { dailyLimit, monthlyLimit } = request.body as {
        dailyLimit: number;
        monthlyLimit: number;
      };

      // Validate limits
      const maxDaily = 20000;
      const maxMonthly = 100000;

      if (dailyLimit < 0 || dailyLimit > maxDaily) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_LIMIT', message: `Daily limit must be between 0 and ${maxDaily}` },
        });
      }

      if (monthlyLimit < 0 || monthlyLimit > maxMonthly) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_LIMIT', message: `Monthly limit must be between 0 and ${maxMonthly}` },
        });
      }

      // Update limits
      await db.query(
        `UPDATE users SET 
          daily_withdrawal_limit = $1, 
          monthly_withdrawal_limit = $2,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [dailyLimit, monthlyLimit, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'withdrawal_limit_change', getClientIp(request), request.headers['user-agent'], 
         JSON.stringify({ dailyLimit, monthlyLimit })]
      );

      logger.info('Withdrawal limits updated', { userId, dailyLimit, monthlyLimit });

      return reply.send({
        success: true,
        data: { message: 'Withdrawal limits updated successfully' },
      });

    } catch (error) {
      logger.error('Update withdrawal limits error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update withdrawal limits' },
      });
    }
  });

  // ===============================
  // NEW ADDRESS LOCK - Get Status
  // ===============================
  app.get('/new-address-lock/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{ new_address_lock_enabled: boolean }>(
        `SELECT COALESCE(new_address_lock_enabled, FALSE) as new_address_lock_enabled 
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      return reply.send({
        success: true,
        data: { enabled: result.rows[0]?.new_address_lock_enabled || false },
      });

    } catch (error) {
      logger.error('New address lock status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get status' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL ADDRESSES - List
  // ===============================
  app.get('/withdrawal-addresses', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query(
        `SELECT id, asset, network, note, address, memo, is_whitelisted, 
                created_at as last_updated
         FROM withdrawal_addresses 
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [userId]
      );

      return reply.send({
        success: true,
        data: { addresses: result.rows },
      });

    } catch (error) {
      logger.error('Get withdrawal addresses error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get addresses' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL ADDRESSES - Add
  // ===============================
  app.post('/withdrawal-addresses', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { 
        asset, 
        network, 
        address, 
        note, 
        memo,
        type,
        walletType,
        saveAsUniversal,
        noVerificationNeeded,
        recipientAccount,
        recipientType
      } = request.body as {
        asset?: string;
        network?: string;
        address?: string;
        note?: string;
        memo?: string;
        type?: string;
        walletType?: string;
        saveAsUniversal?: boolean;
        noVerificationNeeded?: boolean;
        recipientAccount?: string;
        recipientType?: string;
      };

      const addressType = type || 'onchain';

      if (addressType === 'onchain') {
        if (!asset || !address) {
          return reply.status(400).send({
            success: false,
            error: { code: 'MISSING_FIELDS', message: 'Asset and address are required' },
          });
        }
      } else if (addressType === 'internal') {
        if (!recipientAccount) {
          return reply.status(400).send({
            success: false,
            error: { code: 'MISSING_FIELDS', message: 'Recipient account is required' },
          });
        }
      }

      // Check if address already exists for this user (for on-chain)
      if (addressType === 'onchain' && address) {
        const existing = await db.query(
          `SELECT id FROM withdrawal_addresses 
           WHERE user_id = $1 AND address = $2 AND deleted_at IS NULL`,
          [userId, address]
        );

        if (existing.rows.length > 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'ADDRESS_EXISTS', message: 'This address already exists' },
          });
        }
      }

      const result = await db.query(
        `INSERT INTO withdrawal_addresses (
          user_id, asset, network, address, note, memo, 
          address_type, wallet_type, save_as_universal, no_verification_needed,
          recipient_account, recipient_type
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          userId, 
          asset || null, 
          network || null, 
          address || null, 
          note || null, 
          memo || null,
          addressType,
          walletType || 'regular',
          saveAsUniversal || false,
          noVerificationNeeded || false,
          recipientAccount || null,
          recipientType || null
        ]
      );

      logger.info('Withdrawal address added', { userId, asset, addressType });

      return reply.send({
        success: true,
        data: { id: result.rows[0]!.id, message: 'Address added successfully' },
      });

    } catch (error) {
      logger.error('Add withdrawal address error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to add address' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL ADDRESSES - Delete
  // ===============================
  app.delete('/withdrawal-addresses/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { id } = request.params as { id: string };

      const result = await db.query(
        `UPDATE withdrawal_addresses SET deleted_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [id, userId]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Address not found' },
        });
      }

      logger.info('Withdrawal address deleted', { userId, addressId: id });

      return reply.send({
        success: true,
        data: { message: 'Address deleted successfully' },
      });

    } catch (error) {
      logger.error('Delete withdrawal address error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete address' },
      });
    }
  });

  // ===============================
  // ADDRESS BOOK - Get Status
  // ===============================
  app.get('/address-book/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{ address_book_enabled: boolean }>(
        `SELECT COALESCE(address_book_enabled, FALSE) as address_book_enabled 
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
        data: { enabled: result.rows[0]?.address_book_enabled || false },
      });

    } catch (error) {
      logger.error('Address book status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get address book status' },
      });
    }
  });

  // ===============================
  // SMS AUTH - Toggle
  // ===============================
  app.post('/sms-auth/toggle', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { enabled } = request.body as { enabled: boolean };

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_VALUE', message: 'Enabled must be a boolean' },
        });
      }

      // Check if user has a phone number
      const userResult = await db.query<{ phone: string | null }>(
        `SELECT phone FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      if (enabled && !userResult.rows[0]?.phone) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_PHONE', message: 'Please add a phone number first' },
        });
      }

      // Update SMS auth setting
      await db.query(
        `UPDATE users SET sms_auth_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [enabled, userId]
      );

      // Log activity (use try-catch to not fail the main operation)
      try {
        await db.query(
          `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, 'settings_change', getClientIp(request), request.headers['user-agent'], JSON.stringify({ type: 'sms_auth', enabled })]
        );
      } catch (logError) {
        logger.warn('Failed to log SMS auth toggle activity', { error: logError instanceof Error ? logError.message : 'Unknown' });
      }

      logger.info('SMS auth toggled', { userId, enabled });

      return reply.send({
        success: true,
        data: { 
          enabled,
          message: `SMS authentication ${enabled ? 'enabled' : 'disabled'} successfully` 
        },
      });

    } catch (error) {
      logger.error('SMS auth toggle error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle SMS authentication' },
      });
    }
  });

  // ===============================
  // SMS AUTH - Get Status
  // ===============================
  app.get('/sms-auth/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{ sms_auth_enabled: boolean; phone: string | null }>(
        `SELECT COALESCE(sms_auth_enabled, FALSE) as sms_auth_enabled, phone FROM users WHERE id = $1 AND deleted_at IS NULL`,
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
          enabled: result.rows[0]!.sms_auth_enabled,
          hasPhone: !!result.rows[0]!.phone,
        },
      });

    } catch (error) {
      logger.error('SMS auth status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get SMS auth status' },
      });
    }
  });

  // ===============================
  // SECURITY SETTINGS - Get All
  // ===============================
  app.get('/security/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{
        sms_auth_enabled: boolean;
        email_auth_enabled: boolean;
        totp_enabled: boolean;
        passkeys_enabled: boolean;
        phone: string | null;
        email: string | null;
      }>(
        `SELECT 
          COALESCE(sms_auth_enabled, FALSE) as sms_auth_enabled,
          COALESCE(email_auth_enabled, TRUE) as email_auth_enabled,
          COALESCE(totp_enabled, FALSE) as totp_enabled,
          COALESCE(passkeys_enabled, FALSE) as passkeys_enabled,
          phone,
          email
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

      return reply.send({
        success: true,
        data: {
          smsAuthEnabled: user.sms_auth_enabled,
          emailAuthEnabled: user.email_auth_enabled,
          twoFactorEnabled: user.totp_enabled,
          passkeysEnabled: user.passkeys_enabled,
          hasPhone: !!user.phone,
          hasEmail: !!user.email,
        },
      });

    } catch (error) {
      logger.error('Security settings error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get security settings' },
      });
    }
  });

  // ===============================
  // ADDRESS BOOK - Toggle
  // ===============================
  app.post('/address-book/toggle', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { enabled } = request.body as { enabled: boolean };

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_VALUE', message: 'Enabled must be a boolean' },
        });
      }

      // Update address book setting
      await db.query(
        `UPDATE users SET address_book_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [enabled, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'address_book_toggle', getClientIp(request), request.headers['user-agent'], JSON.stringify({ enabled })]
      );

      logger.info('Address book toggled', { userId, enabled });

      return reply.send({
        success: true,
        data: { message: `Address book ${enabled ? 'enabled' : 'disabled'} successfully` },
      });

    } catch (error) {
      logger.error('Address book toggle error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle address book' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL WHITELIST - Get Status
  // ===============================
  app.get('/withdrawal-whitelist/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      const result = await db.query<{ withdrawal_whitelist_enabled: boolean }>(
        `SELECT COALESCE(withdrawal_whitelist_enabled, FALSE) as withdrawal_whitelist_enabled 
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
        data: { enabled: result.rows[0]?.withdrawal_whitelist_enabled || false },
      });

    } catch (error) {
      logger.error('Withdrawal whitelist status error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get whitelist status' },
      });
    }
  });

  // ===============================
  // WITHDRAWAL WHITELIST - Toggle
  // ===============================
  app.post('/withdrawal-whitelist/toggle', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { enabled } = request.body as { enabled: boolean };

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_VALUE', message: 'Enabled must be a boolean' },
        });
      }

      // Update whitelist setting
      await db.query(
        `UPDATE users SET withdrawal_whitelist_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [enabled, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'whitelist_toggle', getClientIp(request), request.headers['user-agent'], JSON.stringify({ enabled })]
      );

      logger.info('Withdrawal whitelist toggled', { userId, enabled });

      return reply.send({
        success: true,
        data: { message: `Withdrawal whitelist ${enabled ? 'enabled' : 'disabled'} successfully` },
      });

    } catch (error) {
      logger.error('Withdrawal whitelist toggle error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle whitelist' },
      });
    }
  });

  // ===============================
  // FEE RATES - Get User Fee Rates
  // ===============================
  app.get('/fee-rates', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;

      // Get user's fee data
      const userResult = await db.query<{
        vip_level: number;
        mnt_discount_enabled: boolean;
        trading_volume_30d: string;
        total_equity: string;
        avg_equity_30d: string;
      }>(
        `SELECT 
          COALESCE(vip_level, 0) as vip_level,
          COALESCE(mnt_discount_enabled, false) as mnt_discount_enabled,
          COALESCE(trading_volume_30d, 0) as trading_volume_30d,
          COALESCE(total_equity, 0) as total_equity,
          COALESCE(avg_equity_30d, 0) as avg_equity_30d
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        });
      }

      const userData = userResult.rows[0];

      // Get fee rates based on VIP level from system settings or use defaults
      const feeResult = await db.query<{
        spot_maker_fee: string;
        spot_taker_fee: string;
        fiat_maker_fee: string;
        fiat_taker_fee: string;
      }>(
        `SELECT 
          COALESCE(
            (SELECT value::jsonb->>'spot_maker_fee' FROM system_settings WHERE key = 'fee_rates_vip_' || $1),
            '0.1'
          ) as spot_maker_fee,
          COALESCE(
            (SELECT value::jsonb->>'spot_taker_fee' FROM system_settings WHERE key = 'fee_rates_vip_' || $1),
            '0.1'
          ) as spot_taker_fee,
          COALESCE(
            (SELECT value::jsonb->>'fiat_maker_fee' FROM system_settings WHERE key = 'fee_rates_vip_' || $1),
            '0.15'
          ) as fiat_maker_fee,
          COALESCE(
            (SELECT value::jsonb->>'fiat_taker_fee' FROM system_settings WHERE key = 'fee_rates_vip_' || $1),
            '0.2'
          ) as fiat_taker_fee`,
        [userData?.vip_level ?? 0]
      );

      // VIP level names
      const vipLevelNames: { [key: number]: string } = {
        0: 'Regular User',
        1: 'VIP 1',
        2: 'VIP 2',
        3: 'VIP 3',
        4: 'VIP 4',
        5: 'VIP 5',
      };

      // Default fee rates per VIP level
      const defaultFeeRates: { [key: number]: { maker: number; taker: number; fiatMaker: number; fiatTaker: number } } = {
        0: { maker: 0.1, taker: 0.1, fiatMaker: 0.15, fiatTaker: 0.2 },
        1: { maker: 0.08, taker: 0.09, fiatMaker: 0.12, fiatTaker: 0.16 },
        2: { maker: 0.06, taker: 0.07, fiatMaker: 0.09, fiatTaker: 0.12 },
        3: { maker: 0.04, taker: 0.05, fiatMaker: 0.06, fiatTaker: 0.08 },
        4: { maker: 0.02, taker: 0.03, fiatMaker: 0.03, fiatTaker: 0.04 },
        5: { maker: 0.01, taker: 0.02, fiatMaker: 0.015, fiatTaker: 0.02 },
      };

      const vipLevel = userData?.vip_level ?? 0;
      const defaultFees = defaultFeeRates[vipLevel] ?? defaultFeeRates[0]!;

      return reply.send({
        success: true,
        data: {
          vipLevel: vipLevel,
          vipLevelName: vipLevelNames[vipLevel] || 'Regular User',
          spotFees: {
            maker: feeResult.rows[0] ? new Decimal(feeResult.rows[0]!.spot_maker_fee).toString() : String(defaultFees.maker),
            taker: feeResult.rows[0] ? new Decimal(feeResult.rows[0]!.spot_taker_fee).toString() : String(defaultFees.taker),
            fiatMaker: feeResult.rows[0] ? new Decimal(feeResult.rows[0]!.fiat_maker_fee).toString() : String(defaultFees.fiatMaker),
            fiatTaker: feeResult.rows[0] ? new Decimal(feeResult.rows[0]!.fiat_taker_fee).toString() : String(defaultFees.fiatTaker),
          },
          mntDiscount: userData?.mnt_discount_enabled ?? false,
          tradingVolume30d: new Decimal(userData?.trading_volume_30d ?? '0').toString(),
          totalEquity: new Decimal(userData?.total_equity ?? '0').toString(),
          avgEquity30d: new Decimal(userData?.avg_equity_30d ?? '0').toString(),
        },
      });

    } catch (error) {
      logger.error('Fee rates fetch error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch fee rates' },
      });
    }
  });

  // ===============================
  // FEE RATES - Toggle MNT Discount
  // ===============================
  app.post('/fee-rates/mnt-discount', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userId = (request.user?.userId ?? request.user?.id)!;
      const { enabled } = request.body as { enabled: boolean };

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_VALUE', message: 'Enabled must be a boolean' },
        });
      }

      // Update MNT discount setting
      await db.query(
        `UPDATE users SET mnt_discount_enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [enabled, userId]
      );

      // Log activity
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'mnt_discount_toggle', getClientIp(request), request.headers['user-agent'], JSON.stringify({ enabled })]
      );

      logger.info('MNT discount toggled', { userId, enabled });

      return reply.send({
        success: true,
        data: { message: `MNT discount ${enabled ? 'enabled' : 'disabled'} successfully` },
      });

    } catch (error) {
      logger.error('MNT discount toggle error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle MNT discount' },
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
