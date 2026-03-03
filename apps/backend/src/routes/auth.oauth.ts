import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { getClientIp } from '../lib/client-ip.js';

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

interface AppleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
}

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
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

// Helper function to generate referral code
function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create or get user from OAuth
async function findOrCreateOAuthUser(
  app: FastifyInstance,
  provider: 'google' | 'apple' | 'telegram',
  providerId: string,
  email: string | null,
  firstName: string | null,
  lastName: string | null,
  avatarUrl: string | null,
  request: FastifyRequest
) {
  // Check if user exists with this OAuth provider
  const existingOAuth = await db.query<{
    user_id: string;
  }>(
    `SELECT user_id FROM auth_providers WHERE provider = $1 AND provider_user_id = $2`,
    [provider, providerId]
  );

  let userId: string;
  let isNewUser = false;

  if (existingOAuth.rows.length > 0) {
    // User already linked with this OAuth provider
    userId = existingOAuth.rows[0]!.user_id;
  } else if (email) {
    // Check if user exists with this email
    const existingUser = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      // Link OAuth to existing user
      userId = existingUser.rows[0]!.id;
      await db.query(
        `INSERT INTO auth_providers (user_id, provider, provider_user_id)
         VALUES ($1, $2, $3) ON CONFLICT (provider, provider_user_id) DO NOTHING`,
        [userId, provider, providerId]
      );
    } else {
      // Create new user
      isNewUser = true;
      const salt = await bcrypt.genSalt(12);
      const tempPassword = uuidv4();
      const passwordHash = await bcrypt.hash(tempPassword, salt);
      const referralCode = generateReferralCode();

      const newUser = await db.query<{ id: string }>(
        `INSERT INTO users (
          email, email_verified, password_hash, salt, status, tier_level,
          first_name, last_name, avatar_url
        ) VALUES ($1, TRUE, $2, $3, 'active', 0, $4, $5, $6)
        RETURNING id`,
        [email.toLowerCase(), passwordHash, salt.substring(0, 64), firstName, lastName, avatarUrl]
      );

      userId = newUser.rows[0]!.id;

      // Link OAuth provider
      await db.query(
        `INSERT INTO auth_providers (user_id, provider, provider_user_id)
         VALUES ($1, $2, $3)`,
        [userId, provider, providerId]
      );

      // Create referral code
      await db.query(
        `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
        [userId, referralCode]
      );

      // Initialize P2P merchant stats
      await db.query(
        `INSERT INTO p2p_merchant_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [userId]
      );

      logger.info('New OAuth user created', { userId, provider });
    }
  } else {
    // No email from provider (e.g., Telegram without email)
    isNewUser = true;
    const salt = await bcrypt.genSalt(12);
    const tempPassword = uuidv4();
    const passwordHash = await bcrypt.hash(tempPassword, salt);
    const referralCode = generateReferralCode();
    const placeholderEmail = `${provider}_${providerId}@oauth.local`;

    const newUser = await db.query<{ id: string }>(
      `INSERT INTO users (
        email, password_hash, salt, status, tier_level,
        first_name, last_name, avatar_url
      ) VALUES ($1, $2, $3, 'active', 0, $4, $5, $6)
      RETURNING id`,
      [placeholderEmail, passwordHash, salt.substring(0, 64), firstName, lastName, avatarUrl]
    );

    userId = newUser.rows[0]!.id;

    // Link OAuth provider
    await db.query(
      `INSERT INTO auth_providers (user_id, provider, provider_user_id)
       VALUES ($1, $2, $3)`,
      [userId, provider, providerId]
    );

    // Create referral code
    await db.query(
      `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
      [userId, referralCode]
    );

    // Initialize P2P merchant stats
    await db.query(
      `INSERT INTO p2p_merchant_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );

    logger.info('New OAuth user created (no email)', { userId, provider });
  }

  // Get user data
  const user = await db.query<{
    id: string;
    email: string;
    phone: string | null;
    username: string | null;
    status: string;
    email_verified: boolean;
    phone_verified: boolean;
    tier_level: number;
  }>(
    `SELECT id, email, phone, username, status, email_verified, phone_verified, tier_level
     FROM users WHERE id = $1`,
    [userId]
  );

  // Create session
  const sessionId = uuidv4();
  const sessionToken = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const clientIp = getClientIp(request);
  await db.query(
    `INSERT INTO user_sessions (id, user_id, session_token, device_type, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5::inet, $6, $7)`,
    [sessionId, userId, sessionToken, 'web', clientIp, request.headers['user-agent'], expiresAt]
  );

  // Store session in Redis
  await redis.setJson(`session:${sessionId}`, {
    userId,
    isActive: true,
    createdAt: Date.now(),
  }, 7 * 24 * 60 * 60);

  // Generate tokens
  const userData = user.rows[0]!;
  const tokens = generateTokens(app, {
    userId,
    email: userData.email || undefined,
    phone: userData.phone || undefined,
    role: 'user',
    sessionId,
  });

  // Log activity
  await db.query(
    `INSERT INTO user_activity_logs (user_id, session_id, activity_type, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, sessionId, 'oauth_login', clientIp, request.headers['user-agent'], JSON.stringify({ provider })]
  );

  logger.info('OAuth login successful', { userId, provider, isNewUser });

  return {
    user: {
      id: userData.id,
      email: userData.email,
      phone: userData.phone,
      username: userData.username,
      status: userData.status,
      emailVerified: userData.email_verified,
      phoneVerified: userData.phone_verified,
      tierLevel: userData.tier_level,
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    isNewUser,
  };
}

// Helper to get OAuth settings from database or env
async function getOAuthSettings(provider: 'google' | 'apple' | 'telegram'): Promise<{
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  botToken?: string;
  additionalConfig?: Record<string, any>;
} | null> {
  try {
    // First try to get from database
    const result = await db.query<{
      api_key: string;
      api_secret: string;
      api_url: string | null;
      additional_config: Record<string, any>;
      is_active: boolean;
    }>(
      'SELECT api_key, api_secret, api_url, additional_config, is_active FROM api_settings WHERE category = $1 AND provider = $2',
      ['social_login', provider]
    );

    if (result.rows.length > 0 && result.rows[0]!.is_active) {
      const setting = result.rows[0]!;
      return {
        clientId: setting.api_key || undefined,
        clientSecret: setting.api_secret || undefined,
        callbackUrl: setting.additional_config?.callback_url || undefined,
        botToken: provider === 'telegram' ? setting.api_key : undefined,
        additionalConfig: setting.additional_config,
      };
    }

    // Fall back to env vars
    if (provider === 'google' && config.oauth.google.clientId) {
      return {
        clientId: config.oauth.google.clientId,
        clientSecret: config.oauth.google.clientSecret,
        callbackUrl: config.oauth.google.callbackUrl,
      };
    }
    if (provider === 'apple' && config.oauth.apple.clientId) {
      return {
        clientId: config.oauth.apple.clientId,
        clientSecret: config.oauth.apple.keyId,
        additionalConfig: {
          teamId: config.oauth.apple.teamId,
          privateKey: config.oauth.apple.privateKey,
        },
        callbackUrl: config.oauth.apple.callbackUrl,
      };
    }
    if (provider === 'telegram' && config.oauth.telegram.botToken) {
      return {
        botToken: config.oauth.telegram.botToken,
      };
    }

    return null;
  } catch (error) {
    logger.error('Error fetching OAuth settings', { provider, error });
    return null;
  }
}

export default async function oauthRoutes(app: FastifyInstance) {
  
  /**
   * GET /auth/oauth/google/url
   * Get Google OAuth URL
   */
  app.get('/oauth/google/url', async (request, reply) => {
    const { redirect_uri } = request.query as { redirect_uri?: string };
    
    const settings = await getOAuthSettings('google');
    
    if (!settings?.clientId) {
      return reply.status(501).send({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'Google OAuth is not configured' },
      });
    }

    const state = uuidv4();
    await redis.set(`oauth:state:${state}`, 'google', 300); // 5 min expiry

    const redirectUri = redirect_uri || settings.callbackUrl || `${config.frontendUrl}/auth/callback/google`;
    
    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return reply.send({
      success: true,
      data: {
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        state,
      },
    });
  });

  /**
   * POST /auth/oauth/google/callback
   * Handle Google OAuth callback
   */
  app.post<{
    Body: { code: string; state: string; redirect_uri?: string };
  }>('/oauth/google/callback', async (request, reply) => {
    try {
      const { code, state, redirect_uri } = request.body;

      const settings = await getOAuthSettings('google');
      
      if (!settings?.clientId || !settings?.clientSecret) {
        return reply.status(501).send({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'Google OAuth is not configured' },
        });
      }

      // Verify state
      const storedState = await redis.get(`oauth:state:${state}`);
      if (!storedState || storedState !== 'google') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Invalid OAuth state' },
        });
      }
      await redis.del(`oauth:state:${state}`);

      const redirectUri = redirect_uri || settings.callbackUrl || `${config.frontendUrl}/auth/callback/google`;

      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        logger.error('Google token exchange failed', { error: errorText });
        return reply.status(400).send({
          success: false,
          error: { code: 'TOKEN_EXCHANGE_FAILED', message: 'Failed to authenticate with Google' },
        });
      }

      const tokens = await tokenResponse.json() as GoogleTokenResponse;

      // Get user info
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userInfoResponse.ok) {
        return reply.status(400).send({
          success: false,
          error: { code: 'USER_INFO_FAILED', message: 'Failed to get user info from Google' },
        });
      }

      const googleUser = await userInfoResponse.json() as GoogleUserInfo;

      // Find or create user
      const result = await findOrCreateOAuthUser(
        app,
        'google',
        googleUser.id,
        googleUser.email,
        googleUser.given_name || googleUser.name?.split(' ')[0] || null,
        googleUser.family_name || googleUser.name?.split(' ').slice(1).join(' ') || null,
        googleUser.picture || null,
        request
      );

      return reply.send({
        success: true,
        data: result,
      });

    } catch (error) {
      logger.error('Google OAuth error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'OAUTH_FAILED', message: 'OAuth authentication failed' },
      });
    }
  });

  /**
   * GET /auth/oauth/apple/url
   * Get Apple OAuth URL
   */
  app.get('/oauth/apple/url', async (request, reply) => {
    const { redirect_uri } = request.query as { redirect_uri?: string };
    
    const settings = await getOAuthSettings('apple');
    
    if (!settings?.clientId) {
      return reply.status(501).send({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'Apple OAuth is not configured' },
      });
    }

    const state = uuidv4();
    await redis.set(`oauth:state:${state}`, 'apple', 300);

    const redirectUri = redirect_uri || settings.callbackUrl || `${config.frontendUrl}/auth/callback/apple`;
    
    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: redirectUri,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });

    return reply.send({
      success: true,
      data: {
        url: `https://appleid.apple.com/auth/authorize?${params.toString()}`,
        state,
      },
    });
  });

  /**
   * POST /auth/oauth/apple/callback
   * Handle Apple OAuth callback
   */
  app.post<{
    Body: { code: string; id_token?: string; state: string; user?: string };
  }>('/oauth/apple/callback', async (request, reply) => {
    try {
      const { code, id_token, state, user } = request.body;

      const settings = await getOAuthSettings('apple');
      
      if (!settings?.clientId) {
        return reply.status(501).send({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'Apple OAuth is not configured' },
        });
      }

      // Verify state
      const storedState = await redis.get(`oauth:state:${state}`);
      if (!storedState || storedState !== 'apple') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Invalid OAuth state' },
        });
      }
      await redis.del(`oauth:state:${state}`);

      // Decode the ID token to get user info
      let appleUserId: string;
      let email: string | null = null;
      let firstName: string | null = null;
      let lastName: string | null = null;

      if (id_token) {
        // Decode JWT (without verification for now - in production, verify with Apple's public keys)
        const parts = id_token.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1]!, 'base64').toString());
          appleUserId = payload.sub;
          email = payload.email || null;
        } else {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_TOKEN', message: 'Invalid Apple ID token' },
          });
        }
      } else {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_TOKEN', message: 'Apple ID token is required' },
        });
      }

      // Parse user info if provided (only on first sign-in)
      if (user) {
        try {
          const userInfo = JSON.parse(user);
          firstName = userInfo.name?.firstName || null;
          lastName = userInfo.name?.lastName || null;
        } catch {
          // User info parsing failed, continue without name
        }
      }

      // Find or create user
      const result = await findOrCreateOAuthUser(
        app,
        'apple',
        appleUserId,
        email,
        firstName,
        lastName,
        null,
        request
      );

      return reply.send({
        success: true,
        data: result,
      });

    } catch (error) {
      logger.error('Apple OAuth error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'OAUTH_FAILED', message: 'OAuth authentication failed' },
      });
    }
  });

  /**
   * POST /auth/oauth/telegram
   * Handle Telegram login widget data
   */
  app.post<{
    Body: TelegramAuthData;
  }>('/oauth/telegram', async (request, reply) => {
    try {
      const telegramData = request.body;

      const settings = await getOAuthSettings('telegram');
      const botToken = settings?.botToken;

      // Verify the hash using Telegram bot token
      if (botToken) {
        const isValid = verifyTelegramHash(telegramData, botToken);
        if (!isValid) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_HASH', message: 'Invalid Telegram authentication data' },
          });
        }
      } else {
        return reply.status(501).send({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'Telegram OAuth is not configured' },
        });
      }
      
      // Check auth_date is not too old (24 hours)
      const authDate = telegramData.auth_date * 1000;
      const now = Date.now();
      if (now - authDate > 24 * 60 * 60 * 1000) {
        return reply.status(400).send({
          success: false,
          error: { code: 'AUTH_EXPIRED', message: 'Telegram authentication has expired' },
        });
      }

      // Find or create user
      const result = await findOrCreateOAuthUser(
        app,
        'telegram',
        telegramData.id.toString(),
        null, // Telegram doesn't provide email
        telegramData.first_name,
        telegramData.last_name || null,
        telegramData.photo_url || null,
        request
      );

      return reply.send({
        success: true,
        data: result,
      });

    } catch (error) {
      logger.error('Telegram OAuth error', { error: error instanceof Error ? error.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'OAUTH_FAILED', message: 'OAuth authentication failed' },
      });
    }
  });
}

// Verify Telegram login widget hash
function verifyTelegramHash(data: TelegramAuthData, botToken: string): boolean {
  const { hash, ...dataWithoutHash } = data;
  
  // Create data-check-string
  const dataCheckArr = Object.entries(dataWithoutHash)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const dataCheckString = dataCheckArr.join('\n');
  
  // Create secret key from bot token
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  
  // Calculate HMAC
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  return hmac === hash;
}
