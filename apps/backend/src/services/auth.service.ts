import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { encryption } from '../lib/encryption.js';
import { logger, auditLog, securityLog } from '../lib/logger.js';
import { config } from '../config/index.js';
import { 
  generateTokens, 
  verifyRefreshToken, 
  blacklistToken 
} from '../middleware/auth.js';
import { walletService } from './wallet.service.js';
import { 
  User, 
  UserRole, 
  UserStatus, 
  AuthProvider, 
  AuditAction 
} from '../types/index.js';

interface SignupData {
  email: string;
  password?: string;
  phone?: string;
  referralCode?: string;
  provider: AuthProvider;
  providerUserId?: string;
  ip?: string;
}

interface LoginData {
  email: string;
  password: string;
  ip: string;
  userAgent?: string;
}

interface OAuthLoginData {
  provider: AuthProvider;
  providerUserId: string;
  email: string;
  ip: string;
  userAgent?: string;
}

interface AuthResult {
  user: Omit<User, 'passwordHash'>;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

interface OTPData {
  identifier: string;
  type: 'email' | 'phone' | 'password_reset' | 'two_factor';
  userId?: string;
}

class AuthService {
  /**
   * Hash password using bcrypt
   */
  private async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(password, salt);
  }

  /**
   * Verify password
   */
  private async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  /**
   * Create new session
   */
  private async createSession(
    userId: string,
    ip: string,
    userAgent?: string
  ): Promise<{ sessionId: string; refreshTokenHash: string }> {
    const sessionId = uuidv4();
    const refreshToken = encryption.generateRandomHex(64);
    const refreshTokenHash = encryption.hash(refreshToken);

    // Calculate expiry based on config
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await db.query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, userId, refreshTokenHash, ip, userAgent, expiresAt]
    );

    // Store session in Redis for quick access
    await redis.setJson(`session:${sessionId}`, {
      userId,
      isActive: true,
      createdAt: Date.now(),
    }, 86400 * 7); // 7 days

    return { sessionId, refreshTokenHash };
  }

  /**
   * Sign up new user with email/password
   */
  async signup(data: SignupData): Promise<AuthResult> {
    const { email, password, phone, referralCode, provider, providerUserId, ip = '127.0.0.1' } = data;

    // Check if email exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('Email already registered');
    }

    // Validate referral code if provided
    let referrerId: string | null = null;
    if (referralCode) {
      const referrer = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE referral_code = $1 AND deleted_at IS NULL',
        [referralCode.toUpperCase()]
      );
      
      if (referrer.rows.length === 0) {
        throw new Error('Invalid referral code');
      }
      referrerId = referrer.rows[0]!.id;
    }

    // Generate unique referral code for new user
    const newReferralCode = encryption.generateReferralCode();

    // Hash password if provided
    let passwordHash: string | null = null;
    if (password) {
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      passwordHash = await this.hashPassword(password);
    }

    // Create user in transaction
    const result = await db.transaction(async (client) => {
      // Insert user
      const userResult = await client.query<User>(
        `INSERT INTO users (
          email, phone, password_hash, role, status, referral_code, referred_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          email.toLowerCase(),
          phone,
          passwordHash,
          UserRole.USER,
          UserStatus.PENDING,
          newReferralCode,
          referrerId,
        ]
      );

      const user = userResult.rows[0]!;

      // Insert auth provider
      await client.query(
        `INSERT INTO auth_providers (user_id, provider, provider_user_id)
         VALUES ($1, $2, $3)`,
        [user.id, provider, providerUserId]
      );

      // Create KYC record
      await client.query(
        `INSERT INTO kyc_records (user_id, status, level) VALUES ($1, 'not_started', 0)`,
        [user.id]
      );

      // Create wallets for all chains
      await walletService.createWalletsForUser(user.id, client);

      return user;
    });

    // Generate tokens
    const session = await this.createSession(result.id, ip);
    const tokens = generateTokens(
      result.id,
      result.email,
      result.role as UserRole,
      session.sessionId
    );

    logger.info('User signed up', { userId: result.id, provider });
    auditLog(AuditAction.LOGIN, result.id, { provider, method: 'signup' }, ip);

    return {
      user: {
        id: result.id,
        email: result.email,
        phone: result.phone || undefined,
        role: result.role as UserRole,
        status: result.status as UserStatus,
        emailVerified: result.emailVerified,
        phoneVerified: result.phoneVerified,
        twoFactorEnabled: result.twoFactorEnabled,
        referralCode: result.referralCode,
        referredBy: result.referredBy || undefined,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: session.sessionId,
    };
  }

  /**
   * Login with email/password
   */
  async login(data: LoginData): Promise<AuthResult> {
    const { email, password, ip, userAgent } = data;

    // Get user
    const result = await db.query<User & { password_hash: string; locked_until: string | Date | null; failed_login_attempts: number }>(
      `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      securityLog('login_failed_no_user', 'low', { email, ip });
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0]!;

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      securityLog('login_attempt_locked_account', 'medium', { userId: user.id, ip });
      throw new Error('Account is temporarily locked. Please try again later.');
    }

    // Check if user has password (might be OAuth only)
    if (!user.password_hash) {
      throw new Error('Please login with your social account');
    }

    // Verify password
    const isValid = await this.verifyPassword(user.password_hash, password);

    if (!isValid) {
      // Increment failed attempts
      const failedAttempts = (user.failed_login_attempts || 0) + 1;
      const lockUntil = failedAttempts >= 5
        ? new Date(Date.now() + 30 * 60 * 1000) // Lock for 30 minutes
        : null;

      await db.query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [failedAttempts, lockUntil, user.id]
      );

      securityLog('login_failed_wrong_password', 'medium', {
        userId: user.id,
        ip,
        failedAttempts,
      });

      auditLog(AuditAction.LOGIN_FAILED, user.id, { reason: 'wrong_password' }, ip);

      throw new Error('Invalid email or password');
    }

    // Check account status
    if (user.status === UserStatus.BANNED) {
      throw new Error('Account has been banned');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new Error('Account is suspended');
    }

    // Reset failed attempts and update login info
    await db.query(
      `UPDATE users 
       SET failed_login_attempts = 0, locked_until = NULL, 
           last_login_at = NOW(), last_login_ip = $2
       WHERE id = $1`,
      [user.id, ip]
    );

    // Create session
    const session = await this.createSession(user.id, ip, userAgent);
    const tokens = generateTokens(
      user.id,
      user.email,
      user.role as UserRole,
      session.sessionId
    );

    // Clear user cache
    await redis.del(`user:${user.id}:status`);

    logger.info('User logged in', { userId: user.id });
    auditLog(AuditAction.LOGIN, user.id, { method: 'email' }, ip);

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || undefined,
        role: user.role as UserRole,
        status: user.status as UserStatus,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        referralCode: user.referralCode,
        referredBy: user.referredBy || undefined,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: session.sessionId,
    };
  }

  /**
   * OAuth login/signup
   */
  async oauthLogin(data: OAuthLoginData): Promise<AuthResult> {
    const { provider, providerUserId, email, ip, userAgent } = data;

    // Check for existing auth provider link
    const existingProvider = await db.query<{ user_id: string }>(
      `SELECT user_id FROM auth_providers 
       WHERE provider = $1 AND provider_user_id = $2`,
      [provider, providerUserId]
    );

    let userId: string;

    if (existingProvider.rows.length > 0) {
      // Existing user
      userId = existingProvider.rows[0]!.user_id;
    } else {
      // Check if email exists
      const existingUser = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
        [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
        // Link provider to existing account
        userId = existingUser.rows[0]!.id;
        await db.query(
          `INSERT INTO auth_providers (user_id, provider, provider_user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, provider) DO UPDATE SET provider_user_id = $3`,
          [userId, provider, providerUserId]
        );
      } else {
        // Create new user
        const signupResult = await this.signup({
          email,
          provider,
          providerUserId,
          ip,
        });
        return signupResult;
      }
    }

    // Get user details
    const userResult = await db.query<User>(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0]!;

    // Check account status
    if (user.status === UserStatus.BANNED || user.status === UserStatus.SUSPENDED) {
      throw new Error('Account is not active');
    }

    // Update login info
    await db.query(
      `UPDATE users SET last_login_at = NOW(), last_login_ip = $2 WHERE id = $1`,
      [userId, ip]
    );

    // Create session
    const session = await this.createSession(userId, ip, userAgent);
    const tokens = generateTokens(
      userId,
      user.email,
      user.role as UserRole,
      session.sessionId
    );

    logger.info('OAuth login', { userId, provider });
    auditLog(AuditAction.LOGIN, userId, { method: 'oauth', provider }, ip);

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || undefined,
        role: user.role as UserRole,
        status: user.status as UserStatus,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        referralCode: user.referralCode,
        referredBy: user.referredBy || undefined,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: session.sessionId,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    refreshToken: string,
    ip: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = verifyRefreshToken(refreshToken);

    if (!payload) {
      throw new Error('Invalid refresh token');
    }

    // Check session
    const sessionData = await redis.getJson<{ userId: string; isActive: boolean }>(
      `session:${payload.sessionId}`
    );

    if (!sessionData || !sessionData.isActive) {
      throw new Error('Session expired');
    }

    // Get user
    const userResult = await db.query<User>(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [payload.userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0]!;

    // Generate new tokens
    const tokens = generateTokens(
      user.id,
      user.email,
      user.role as UserRole,
      payload.sessionId
    );

    return tokens;
  }

  /**
   * Logout
   */
  async logout(sessionId: string, accessToken: string): Promise<void> {
    // Invalidate session in Redis
    await redis.del(`session:${sessionId}`);

    // Mark session as inactive in database
    await db.query(
      'UPDATE sessions SET is_active = FALSE WHERE id = $1',
      [sessionId]
    );

    // Blacklist the access token
    await blacklistToken(accessToken);

    logger.info('User logged out', { sessionId });
  }

  /**
   * Logout all sessions
   */
  async logoutAll(userId: string): Promise<void> {
    // Get all active sessions
    const sessions = await db.query<{ id: string }>(
      'SELECT id FROM sessions WHERE user_id = $1 AND is_active = TRUE',
      [userId]
    );

    // Invalidate all sessions
    for (const session of sessions.rows) {
      await redis.del(`session:${session.id}`);
    }

    // Mark all as inactive
    await db.query(
      'UPDATE sessions SET is_active = FALSE WHERE user_id = $1',
      [userId]
    );

    logger.info('Logged out all sessions', { userId });
    auditLog(AuditAction.LOGOUT, userId, { allSessions: true }, undefined);
  }

  /**
   * Generate and send OTP
   */
  async generateOTP(data: OTPData): Promise<{ expiresAt: Date }> {
    const { identifier, type, userId } = data;

    // Rate limiting check
    const rateLimitKey = `otp:ratelimit:${identifier}:${type}`;
    const rateLimitResult = await redis.incrementWithLimit(rateLimitKey, 3, 60);

    if (!rateLimitResult.success) {
      throw new Error('Too many OTP requests. Please try again later.');
    }

    // Generate OTP
    const otp = encryption.generateOtp(6);
    const salt = encryption.generateSalt();
    const otpHash = encryption.hashOtp(otp, salt);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing OTPs
    await db.query(
      `DELETE FROM otp_verifications 
       WHERE identifier = $1 AND type = $2 AND verified_at IS NULL`,
      [identifier, type]
    );

    // Store OTP
    await db.query(
      `INSERT INTO otp_verifications (user_id, identifier, type, otp_hash, salt, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, identifier, type, otpHash, salt, expiresAt]
    );

    // In production, send OTP via email/SMS
    // For now, log it in development
    if (config.isDevelopment) {
      logger.info('OTP generated (dev only)', { identifier, otp, type });
    }

    // TODO: Integrate with email/SMS service
    // if (type === 'email') {
    //   await emailService.sendOTP(identifier, otp);
    // } else if (type === 'phone') {
    //   await smsService.sendOTP(identifier, otp);
    // }

    return { expiresAt };
  }

  /**
   * Verify OTP
   */
  async verifyOTP(
    identifier: string,
    type: 'email' | 'phone' | 'password_reset' | 'two_factor',
    otp: string
  ): Promise<{ userId?: string; verified: boolean }> {
    const result = await db.query<{
      id: string;
      user_id: string | null;
      otp_hash: string;
      salt: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date;
    }>(
      `SELECT * FROM otp_verifications 
       WHERE identifier = $1 AND type = $2 AND verified_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [identifier, type]
    );

    if (result.rows.length === 0) {
      throw new Error('OTP not found or expired');
    }

    const otpRecord = result.rows[0]!;

    // Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      throw new Error('OTP has expired');
    }

    // Check attempts
    if (otpRecord.attempts >= otpRecord.max_attempts) {
      throw new Error('Maximum attempts exceeded');
    }

    // Verify OTP
    const isValid = encryption.verifyOtp(otp, otpRecord.salt, otpRecord.otp_hash);

    if (!isValid) {
      // Increment attempts
      await db.query(
        'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1',
        [otpRecord.id]
      );
      throw new Error('Invalid OTP');
    }

    // Mark as verified
    await db.query(
      'UPDATE otp_verifications SET verified_at = NOW() WHERE id = $1',
      [otpRecord.id]
    );

    // Update user verification status
    if (otpRecord.user_id) {
      if (type === 'email') {
        await db.query(
          'UPDATE users SET email_verified = TRUE, status = $2 WHERE id = $1',
          [otpRecord.user_id, UserStatus.ACTIVE]
        );
        await redis.del(`user:${otpRecord.user_id}:email_verified`);
        await redis.del(`user:${otpRecord.user_id}:status`);
      } else if (type === 'phone') {
        await db.query(
          'UPDATE users SET phone_verified = TRUE WHERE id = $1',
          [otpRecord.user_id]
        );
      }
    }

    return {
      userId: otpRecord.user_id || undefined,
      verified: true,
    };
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string
  ): Promise<void> {
    // Get current password hash
    const result = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0]!.password_hash) {
      throw new Error('Password change not available');
    }

    // Verify current password
    const isValid = await this.verifyPassword(result.rows[0]!.password_hash, currentPassword);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    // Hash and update
    const newHash = await this.hashPassword(newPassword);
    await db.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1',
      [userId, newHash]
    );

    // Logout all other sessions
    await this.logoutAll(userId);

    auditLog(AuditAction.PASSWORD_CHANGE, userId, {}, ip);
  }

  /**
   * Reset password with token
   */
  async resetPassword(
    identifier: string,
    otp: string,
    newPassword: string
  ): Promise<void> {
    // Verify OTP
    const verification = await this.verifyOTP(identifier, 'password_reset', otp);

    if (!verification.userId) {
      throw new Error('Invalid reset request');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Hash and update
    const newHash = await this.hashPassword(newPassword);
    await db.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1',
      [verification.userId, newHash]
    );

    // Logout all sessions
    await this.logoutAll(verification.userId);

    auditLog(AuditAction.PASSWORD_CHANGE, verification.userId, { method: 'reset' }, undefined);
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const result = await db.query<User>(
      `SELECT id, email, phone, role, status, email_verified, phone_verified,
              two_factor_enabled, referral_code, referred_by, created_at, updated_at,
              last_login_at, last_login_ip
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    return result.rows[0] || null;
  }
}

export const authService = new AuthService();
