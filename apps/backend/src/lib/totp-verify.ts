/**
 * TOTP verification for withdrawal and other sensitive operations.
 * Validates user's 2FA code against stored secret (totp_secret or two_factor_secret).
 */

import crypto from 'crypto';
import { db } from './database.js';

export async function verifyUser2FA(userId: string, code: string): Promise<boolean> {
  if (!code || code.length !== 6) return false;
  const result = await db.query<{ secret: string }>(
    `SELECT two_factor_secret as secret FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  const secretEnc = result.rows[0]?.secret;
  if (!secretEnc) return false;
  try {
    const encryptionKey = process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-encryption-key';
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
    `SELECT COALESCE(two_factor_enabled, FALSE) as enabled 
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0]?.enabled ?? false;
}
