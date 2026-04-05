import crypto from 'node:crypto';
import { db } from '../lib/database.js';
import { encryption } from '../lib/encryption.js';
import { logger } from '../lib/logger.js';

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';
const BACKUP_CODE_COUNT = 10;

function base32Encode(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateHOTP(secret: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac(TOTP_ALGORITHM, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

function generateTOTP(secret: Buffer, timeStep: number = TOTP_PERIOD): string {
  const counter = BigInt(Math.floor(Date.now() / 1000 / timeStep));
  return generateHOTP(secret, counter);
}

function verifyTOTP(secret: Buffer, token: string, window: number = 1): boolean {
  const counter = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD));
  for (let i = -window; i <= window; i++) {
    if (generateHOTP(secret, counter + BigInt(i)) === token) return true;
  }
  return false;
}

class Admin2FAService {
  generateSecret(): { secret: string; base32: string } {
    const raw = crypto.randomBytes(20);
    const base32 = base32Encode(raw);
    return { secret: raw.toString('hex'), base32 };
  }

  generateQRUrl(email: string, base32Secret: string, issuer = 'CryptoExchange'): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedEmail = encodeURIComponent(email);
    return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${base32Secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
  }

  verifyToken(base32Secret: string, token: string): boolean {
    const secretBuf = base32Decode(base32Secret);
    return verifyTOTP(secretBuf, token);
  }

  generateCurrentToken(base32Secret: string): string {
    const secretBuf = base32Decode(base32Secret);
    return generateTOTP(secretBuf);
  }

  generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  async setup2FA(adminId: string, adminEmail: string): Promise<{
    secret: string;
    qrUrl: string;
    backupCodes: string[];
  }> {
    const { base32 } = this.generateSecret();
    const backupCodes = this.generateBackupCodes();
    const encryptedSecret = encryption.encrypt(base32);
    const hashedCodes = backupCodes.map((c) => encryption.hash(c));

    await db.query(
      `UPDATE admin_users SET two_factor_secret = $1, two_factor_backup_codes = $2 WHERE id = $3`,
      [encryptedSecret, hashedCodes, adminId]
    );

    const qrUrl = this.generateQRUrl(adminEmail, base32);
    logger.info('2FA setup initiated for admin', { adminId });
    return { secret: base32, qrUrl, backupCodes };
  }

  async verify2FASetup(adminId: string, token: string): Promise<boolean> {
    const result = await db.query<{ two_factor_secret: string | null }>(
      'SELECT two_factor_secret FROM admin_users WHERE id = $1',
      [adminId]
    );
    if (!result.rows[0]?.two_factor_secret) return false;

    const base32 = encryption.decrypt(result.rows[0].two_factor_secret);
    if (!this.verifyToken(base32, token)) return false;

    await db.query(
      'UPDATE admin_users SET two_factor_enabled = TRUE WHERE id = $1',
      [adminId]
    );
    logger.info('2FA enabled for admin', { adminId });
    return true;
  }

  async disable2FA(adminId: string, token: string): Promise<boolean> {
    const result = await db.query<{
      two_factor_secret: string | null;
      two_factor_enabled: boolean;
    }>(
      'SELECT two_factor_secret, two_factor_enabled FROM admin_users WHERE id = $1',
      [adminId]
    );
    const row = result.rows[0];
    if (!row?.two_factor_enabled || !row.two_factor_secret) return false;

    const base32 = encryption.decrypt(row.two_factor_secret);
    if (!this.verifyToken(base32, token)) return false;

    await db.query(
      `UPDATE admin_users SET two_factor_enabled = FALSE, two_factor_secret = NULL, two_factor_backup_codes = NULL WHERE id = $1`,
      [adminId]
    );
    logger.info('2FA disabled for admin', { adminId });
    return true;
  }

  async get2FAStatus(adminId: string): Promise<{ enabled: boolean }> {
    const result = await db.query<{ two_factor_enabled: boolean }>(
      'SELECT two_factor_enabled FROM admin_users WHERE id = $1',
      [adminId]
    );
    return { enabled: result.rows[0]?.two_factor_enabled ?? false };
  }

  async verifyTokenForLogin(adminId: string, token: string): Promise<boolean> {
    const result = await db.query<{
      two_factor_secret: string | null;
      two_factor_enabled: boolean;
      two_factor_backup_codes: string[] | null;
    }>(
      'SELECT two_factor_secret, two_factor_enabled, two_factor_backup_codes FROM admin_users WHERE id = $1',
      [adminId]
    );
    const row = result.rows[0];
    if (!row?.two_factor_enabled || !row.two_factor_secret) return true;

    const base32 = encryption.decrypt(row.two_factor_secret);
    if (this.verifyToken(base32, token)) return true;

    if (row.two_factor_backup_codes?.length) {
      const tokenHash = encryption.hash(token.toUpperCase());
      const idx = row.two_factor_backup_codes.indexOf(tokenHash);
      if (idx !== -1) {
        const remaining = [...row.two_factor_backup_codes];
        remaining.splice(idx, 1);
        await db.query(
          'UPDATE admin_users SET two_factor_backup_codes = $1 WHERE id = $2',
          [remaining, adminId]
        );
        logger.warn('Admin used backup code for 2FA', { adminId, remainingCodes: remaining.length });
        return true;
      }
    }

    return false;
  }
}

export const admin2FAService = new Admin2FAService();
