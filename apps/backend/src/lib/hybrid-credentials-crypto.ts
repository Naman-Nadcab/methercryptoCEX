/**
 * AES-256-GCM envelope for external liquidity provider API secrets at rest.
 * Uses ENCRYPTION_KEY (same source as app encryption config); never log plaintext.
 */
import crypto from 'node:crypto';
import { config } from '../config/index.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

function keyBuf(): Buffer {
  const k = config.encryption?.key;
  if (!k || k.length < 32) {
    throw new Error('ENCRYPTION_KEY (min 32 chars) required for hybrid provider secret encryption');
  }
  return crypto.createHash('sha256').update(k, 'utf8').digest();
}

/** Returns base64(iv || ciphertext+tag) for DB storage. */
export function encryptProviderSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, keyBuf(), iv, { authTagLength: AUTH_TAG_LEN });
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

export function decryptProviderSecret(ciphertextB64: string): string {
  const raw = Buffer.from(ciphertextB64, 'base64');
  if (raw.length < IV_LEN + AUTH_TAG_LEN + 1) {
    throw new Error('Invalid ciphertext');
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - AUTH_TAG_LEN);
  const data = raw.subarray(IV_LEN, raw.length - AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, keyBuf(), iv, { authTagLength: AUTH_TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function maskSecret(s: string, visible = 4): string {
  if (!s || s.length <= visible * 2) return '****';
  return `${s.slice(0, visible)}…${s.slice(-visible)}`;
}
