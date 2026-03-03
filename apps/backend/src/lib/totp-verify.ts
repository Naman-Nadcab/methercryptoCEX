/**
 * TOTP verification for withdrawal and other sensitive operations.
 * Validates user's 2FA code against stored secret (totp_secret or two_factor_secret).
 */

import crypto from 'crypto';
import { db } from './database.js';

export async function verifyUser2FA(userId: string, code: string): Promise<boolean> {
  if (!code || code.length !== 6) return false;
  const result = await db.query<{ secret: string }>(
    `SELECT COALESCE(totp_secret, two_factor_secret) as secret FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  const secretEnc = result.rows[0]?.secret;
  if (!secretEnc) return false;
  try {
    const { config } = await import('../config/index.js');
    const encryptionKey = config.security.totpEncryptionKey;
    if (!encryptionKey || encryptionKey.length < 32) {
      return false; // Require TOTP_ENCRYPTION_KEY (min 32 chars); no fallback to ENCRYPTION_KEY or JWT_SECRET
    }
    const parts = secretEnc.split(':');
    if (parts.length !== 2) return false;
    const [ivHex, encryptedSecret] = parts;
    const iv = Buffer.from(ivHex!, 'hex');
    const key = crypto.scryptSync(encryptionKey, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decryptedSecret = decipher.update(encryptedSecret!, 'hex', 'utf8');
    decryptedSecret += decipher.final('utf8');
    const OTPAuth = await import('otpauth');
    const totp = new OTPAuth.TOTP({
      issuer: 'Exchange',
      label: 'user',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(decryptedSecret),
    });
    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

/** Check if user has 2FA enabled (totp_enabled or two_factor_enabled). */
export async function userHas2FA(userId: string): Promise<boolean> {
  const result = await db.query<{ enabled: boolean }>(
    `SELECT COALESCE(totp_enabled, two_factor_enabled, FALSE) as enabled 
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0]?.enabled ?? false;
}

/** Check if user has fund password set. */
export async function userHasFundPassword(userId: string): Promise<boolean> {
  const result = await db.query<{ fund_password_hash: string | null }>(
    `SELECT fund_password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  return !!(result.rows[0]?.fund_password_hash ?? null);
}

/** Verify fund password for withdrawal / sensitive actions. */
export async function verifyFundPassword(userId: string, password: string): Promise<boolean> {
  if (!password || typeof password !== 'string') return false;
  const result = await db.query<{ fund_password_hash: string }>(
    `SELECT fund_password_hash FROM users WHERE id = $1 AND deleted_at IS NULL AND fund_password_hash IS NOT NULL`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(password, result.rows[0]!.fund_password_hash);
}
