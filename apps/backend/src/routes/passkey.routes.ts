/**
 * WebAuthn/Passkey Routes - Production-Ready Implementation
 * 
 * SECURITY REQUIREMENTS FOR CRYPTO EXCHANGE:
 * 1. userVerification = 'required' - Always require biometric/PIN
 * 2. Counter validation - Prevent replay attacks
 * 3. Platform authenticators only - No external security keys for consistency
 * 4. All verification server-side - Never trust client
 * 5. Secure challenge storage with TTL
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * RP_ID must match the effective domain of the website
 * - For localhost development: 'localhost'
 * - For production: 'yourdomain.com' (no protocol, no port)
 */
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Methereum Exchange';

/**
 * ORIGIN must include protocol and port
 * - For localhost: 'http://localhost:3000'
 * - For production: 'https://yourdomain.com'
 */
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

// Challenge TTL in seconds (5 minutes)
const CHALLENGE_TTL = 300;

// =============================================================================
// TYPES
// =============================================================================

interface PasskeyRecord {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_name: string;
  aaguid: string | null;
  created_at: Date;
  last_used_at: Date | null;
  backup_eligible: boolean;
  backup_state: boolean;
}

interface UserRecord {
  id: string;
  email: string;
  username: string | null;
  passkeys_enabled: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize phone number for consistent lookup
 */
function normalizePhoneNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Generate secure random challenge is handled by simplewebauthn
 * We just need to store it securely with TTL
 */

// =============================================================================
// ROUTE REGISTRATION
// =============================================================================

export async function passkeyRoutes(app: FastifyInstance) {
  
  // ===========================================================================
  // REGISTRATION FLOW
  // ===========================================================================

  /**
   * Step 1: Generate Registration Options
   * 
   * Security considerations:
   * - User must be authenticated (JWT verified)
   * - Challenge stored server-side with TTL
   * - Exclude existing credentials to prevent re-registration
   * - Force platform authenticator (Touch ID / Face ID)
   * - Require user verification (biometric)
   */
  app.post('/passkey/register/options', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Verify JWT - user must be logged in to register passkey
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

      // Get user info for WebAuthn user entity
      const userResult = await db.query<UserRecord>(
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

      // Get existing passkeys to exclude (prevent duplicate registration)
      const existingPasskeys = await db.query<{ credential_id: string; transports: string | null }>(
        `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      // Build excludeCredentials list
      // WHY: Prevents user from registering the same authenticator twice
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

      // Generate registration options
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        // userID must be a Uint8Array - use user's UUID encoded
        userID: new TextEncoder().encode(userId),
        userName: user.email,
        userDisplayName: user.username || user.email,
        
        // WHY 'none': We don't need attestation for most use cases
        // For hardware security key verification, use 'direct' or 'enterprise'
        attestationType: 'none',
        
        excludeCredentials,
        
        authenticatorSelection: {
          // WHY 'required': For a crypto exchange, we want discoverable credentials
          // This allows passwordless login without entering email first
          residentKey: 'required',
          
          // WHY 'required': CRITICAL for financial apps
          // Ensures biometric/PIN verification always happens
          // 'preferred' would allow authentication without verification!
          userVerification: 'required',
          
          // WHY 'platform': Only allow built-in authenticators
          // Touch ID, Face ID, Windows Hello, Android Biometric
          // No external security keys for consistency
          authenticatorAttachment: 'platform',
        },
        
        // Supported algorithms in preference order
        // -7 = ES256 (most common), -257 = RS256
        supportedAlgorithmIDs: [-7, -257],
        
        // Timeout in milliseconds (2 minutes)
        timeout: 120000,
      });

      // Store challenge in Redis with TTL
      // WHY: Challenge must be verified server-side to prevent replay attacks
      // TTL ensures challenge expires if not used
      await redis.set(
        `passkey_reg_challenge:${userId}`,
        JSON.stringify({
          challenge: options.challenge,
          timestamp: Date.now(),
        }),
        CHALLENGE_TTL
      );

      logger.info('Passkey registration options generated', { 
        userId,
        rpId: RP_ID,
        origin: ORIGIN,
      });

      return reply.send({
        success: true,
        data: options,
      });

    } catch (error) {
      logger.error('Passkey registration options error', { 
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate passkey options' },
      });
    }
  });

  /**
   * Step 2: Verify Registration Response
   * 
   * Security considerations:
   * - Verify challenge matches what we stored
   * - Verify origin matches expected origin
   * - Verify RP ID matches expected RP ID
   * - Store credential public key securely
   * - Initialize counter for replay protection
   * - Store transports for authentication hints
   */
  app.post('/passkey/register/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
      const { credential, deviceName } = request.body as { 
        credential: RegistrationResponseJSON; 
        deviceName?: string;
      };

      if (!credential) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Credential data required' },
        });
      }

      // Retrieve stored challenge
      const storedData = await redis.get(`passkey_reg_challenge:${userId}`);
      if (!storedData) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CHALLENGE_EXPIRED', message: 'Registration session expired. Please try again.' },
        });
      }

      const { challenge: expectedChallenge } = JSON.parse(storedData);

      // Verify the registration response
      // WHY: All cryptographic verification MUST be server-side
      let verification: VerifiedRegistrationResponse;
      try {
        verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          // WHY 'required': Must match what we requested during options generation
          requireUserVerification: true,
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
          error: { code: 'VERIFICATION_FAILED', message: 'Invalid credential data received' },
        });
      }

      // Store as base64url (cred.id is already Base64URLString; publicKey is Uint8Array)
      const credentialIdB64 = cred.id;
      const publicKeyB64 = isoBase64URL.fromBuffer(cred.publicKey);

      // Get transports from the response for future authentication hints
      const transports = credential.response.transports || [];

      // Check if credential already exists (shouldn't happen with excludeCredentials, but safety check)
      const existingCred = await db.query(
        `SELECT id FROM user_passkeys WHERE credential_id = $1`,
        [credentialIdB64]
      );

      if (existingCred.rows.length > 0) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CREDENTIAL_EXISTS', message: 'This passkey is already registered' },
        });
      }

      // Store the passkey in database
      await db.query(
        `INSERT INTO user_passkeys (
          user_id, 
          credential_id, 
          public_key, 
          counter, 
          transports,
          device_name,
          aaguid,
          backup_eligible,
          backup_state,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
        [
          userId,
          credentialIdB64,
          publicKeyB64,
          cred.counter,
          JSON.stringify(transports),
          deviceName || 'Unknown Device',
          registrationInfo.aaguid || null,
          // WHY track backup state: Synced passkeys (iCloud Keychain, Google Password Manager)
          // have different security properties than device-bound passkeys
          credentialDeviceType === 'multiDevice',
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

      // Log the registration for audit
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId, 
          'passkey_registered', 
          request.ip, 
          request.headers['user-agent'],
          JSON.stringify({ 
            deviceName: deviceName || 'Unknown Device',
            credentialType: credentialDeviceType,
            backedUp: credentialBackedUp,
          }),
        ]
      );

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
      logger.error('Passkey registration verify error', { 
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify passkey registration' },
      });
    }
  });

  // ===========================================================================
  // AUTHENTICATION FLOW
  // ===========================================================================

  /**
   * Step 1: Generate Authentication Options
   * 
   * Security considerations:
   * - Challenge must be cryptographically random (handled by library)
   * - Challenge stored server-side with TTL
   * - allowCredentials limits which credentials can respond
   * - hints: ['client-device'] tells browser to prefer platform authenticator
   */
  app.post('/passkey/authenticate/options', async (request: FastifyRequest, reply: FastifyReply) => {
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

      // Get user and verify passkeys are enabled
      const userResult = await db.query<{ id: string; passkeys_enabled: boolean }>(
        `SELECT id, COALESCE(passkeys_enabled, FALSE) as passkeys_enabled 
         FROM users WHERE ${type} = $1 AND deleted_at IS NULL`,
        [identifier]
      );

      if (userResult.rows.length === 0) {
        // Don't reveal if user exists - return generic error
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

      // Get user's registered passkeys
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

      // Build allowCredentials with transports
      // WHY transports: Helps browser show the right UI and connect to the right authenticator
      const allowCredentials = passkeysResult.rows.map(row => {
        const transports = row.transports 
          ? JSON.parse(row.transports) as AuthenticatorTransportFuture[]
          : ['internal' as AuthenticatorTransportFuture]; // Default to internal for platform auth

        return {
          id: row.credential_id,
          type: 'public-key' as const,
          transports,
        };
      });

      // Generate authentication options
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        
        // WHY 'required': CRITICAL - must match registration
        // Ensures biometric verification happens
        userVerification: 'required',
        
        allowCredentials,
        
        // Timeout in milliseconds (2 minutes)
        timeout: 120000,
      });

      // Store challenge with user context
      // WHY store userId: Need to look up credential after authentication
      await redis.set(
        `passkey_auth_challenge:${options.challenge}`,
        JSON.stringify({
          userId,
          identifier,
          timestamp: Date.now(),
        }),
        CHALLENGE_TTL
      );

      logger.info('Passkey authentication options generated', { identifier });

      return reply.send({
        success: true,
        data: options,
      });

    } catch (error) {
      logger.error('Passkey auth options error', { 
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to generate authentication options' },
      });
    }
  });

  /**
   * Step 2: Verify Authentication Response
   * 
   * Security considerations:
   * - Verify challenge matches stored challenge
   * - Verify signature with stored public key
   * - Validate counter increment (CRITICAL for replay protection)
   * - Clear challenge after use (one-time use)
   */
  app.post('/passkey/authenticate/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { credential, challenge } = request.body as { 
        credential: AuthenticationResponseJSON; 
        challenge: string;
      };

      if (!credential || !challenge) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Credential and challenge required' },
        });
      }

      // Retrieve stored challenge data
      const storedData = await redis.get(`passkey_auth_challenge:${challenge}`);
      if (!storedData) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CHALLENGE_EXPIRED', message: 'Authentication session expired. Please try again.' },
        });
      }

      const { userId } = JSON.parse(storedData);

      // credential.id is the base64url-encoded credential ID from the response
      const credentialId = credential.id;

      // Get the passkey from database
      const passkeyResult = await db.query<PasskeyRecord>(
        `SELECT id, public_key, counter, backup_state 
         FROM user_passkeys 
         WHERE user_id = $1 AND credential_id = $2 AND deleted_at IS NULL`,
        [userId, credentialId]
      );

      if (passkeyResult.rows.length === 0) {
        logger.warn('Passkey authentication failed - credential not found', { 
          userId, 
          credentialId: credentialId.substring(0, 20) + '...',
        });
        return reply.status(400).send({
          success: false,
          error: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found or has been removed' },
        });
      }

      const passkey = passkeyResult.rows[0]!;

      // Decode public key from base64url to Uint8Array
      const publicKeyBytes = isoBase64URL.toBuffer(passkey.public_key);

      // Verify the authentication response
      let verification: VerifiedAuthenticationResponse;
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
          // WHY 'required': Must match what we requested in options
          requireUserVerification: true,
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

      // CRITICAL: Validate counter increment
      // WHY: Prevents replay attacks. Counter must always increase.
      // If newCounter <= oldCounter, the response might be replayed.
      // Exception: Counter of 0 is allowed for synced passkeys that don't track counter
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
            message: 'Security validation failed. This passkey has been disabled for your protection. Please contact support.',
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

      // Generate JWT tokens
      const accessToken = request.server.jwt.sign(
        { userId: user.id, email: user.email, type: 'access' },
        { expiresIn: config.jwt.expiresIn }
      );

      const refreshToken = request.server.jwt.sign(
        { userId: user.id, email: user.email, type: 'refresh' },
        { expiresIn: '7d' }
      );

      // Store refresh token in Redis
      await redis.set(`refresh_token:${user.id}`, refreshToken, 7 * 24 * 60 * 60);

      // Log successful authentication
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.id, 
          'passkey_login', 
          request.ip, 
          request.headers['user-agent'],
          JSON.stringify({ method: 'passkey', credentialId: credentialId.substring(0, 20) + '...' }),
        ]
      );

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
      logger.error('Passkey auth verify error', { 
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify passkey authentication' },
      });
    }
  });

  // ===========================================================================
  // PASSKEY MANAGEMENT
  // ===========================================================================

  /**
   * List user's registered passkeys
   */
  app.get('/passkeys', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };

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
        data: result.rows.map(row => ({
          id: row.id,
          deviceName: row.device_name,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
          isSynced: row.backup_eligible,
          isBackedUp: row.backup_state,
        })),
      });

    } catch (error) {
      logger.error('List passkeys error', { 
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list passkeys' },
      });
    }
  });

  /**
   * Delete a passkey
   */
  app.delete('/passkeys/:passkeyId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const { userId } = request.user as { userId: string };
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

      // Check remaining passkeys
      const remainingPasskeys = await db.query(
        `SELECT COUNT(*) as count FROM user_passkeys WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId]
      );

      // Disable passkeys for user if none remaining
      if (parseInt(remainingPasskeys.rows[0]?.count || '0') === 0) {
        await db.query(
          `UPDATE users SET passkeys_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [userId]
        );
      }

      // Log the deletion
      await db.query(
        `INSERT INTO user_activity_logs (user_id, activity_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'passkey_deleted', request.ip, request.headers['user-agent'], JSON.stringify({ passkeyId })]
      );

      logger.info('Passkey deleted', { userId, passkeyId });

      return reply.send({
        success: true,
        data: { message: 'Passkey deleted successfully' },
      });

    } catch (error) {
      logger.error('Delete passkey error', { 
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to delete passkey' },
      });
    }
  });
}
