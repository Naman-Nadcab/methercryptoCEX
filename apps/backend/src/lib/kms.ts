/**
 * KMS / HSM-style abstraction for envelope encryption.
 * - Master key in KMS (or local derivation for dev).
 * - Data Encryption Keys (DEK) encrypt hot wallet private keys; only DEK is encrypted by KMS.
 * - No private key or DEK ever returned to API or logs.
 */

import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32;

export interface GenerateDataKeyResult {
  plaintextDEK: Buffer;
  encryptedDEK: string;
}

export interface IKeyManagementService {
  /** Generate a new DEK and return plaintext + ciphertext (encrypted with master/key version). */
  generateDataKey(keyVersion: string): Promise<GenerateDataKeyResult>;
  /** Decrypt an encrypted DEK. Used at runtime to get DEK, then decrypt private key in memory only. */
  decryptDEK(encryptedDEK: string, keyVersion: string): Promise<Buffer>;
}

function deriveMasterKey(keyVersion: string): Buffer {
  const keyString = config.encryption.key;
  return crypto.createHash('sha256').update(keyString + ':' + keyVersion).digest();
}

function encodeCiphertext(iv: Buffer, authTag: Buffer, ciphertext: Buffer): string {
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decodeCiphertext(encoded: string): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid KMS ciphertext format');
  return {
    iv: Buffer.from(parts[0]!, 'base64'),
    authTag: Buffer.from(parts[1]!, 'base64'),
    ciphertext: Buffer.from(parts[2]!, 'base64'),
  };
}

/**
 * Local KMS: master key derived from ENCRYPTION_KEY + keyVersion.
 * DEK is encrypted with AES-256-GCM. Suitable for dev/single-node; use real KMS in production.
 */
class LocalKMS implements IKeyManagementService {
  async generateDataKey(keyVersion: string): Promise<GenerateDataKeyResult> {
    const masterKey = deriveMasterKey(keyVersion);
    const plaintextDEK = crypto.randomBytes(DEK_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintextDEK),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const encryptedDEK = encodeCiphertext(iv, authTag, encrypted);
    return { plaintextDEK, encryptedDEK };
  }

  async decryptDEK(encryptedDEK: string, keyVersion: string): Promise<Buffer> {
    const masterKey = deriveMasterKey(keyVersion);
    const { iv, authTag, ciphertext } = decodeCiphertext(encryptedDEK);
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

/**
 * AWS KMS. Requires @aws-sdk/client-kms when KMS_TYPE=aws and AWS_KMS_KEY_ID + AWS_REGION set.
 * Falls back to local key derivation when not configured.
 */
class AwsKMS implements IKeyManagementService {
  async generateDataKey(_keyVersion: string): Promise<GenerateDataKeyResult> {
    const keyId = config.kms.aws.keyId;
    const region = config.kms.aws.region;
    if (!keyId || !region) {
      throw new Error(
        'KMS_TYPE=aws requires AWS_KMS_KEY_ID and AWS_REGION. Refusing silent LocalKMS fallback (prevents accidental prod downgrades).'
      );
    }
    try {
      const { KMSClient, GenerateDataKeyCommand } = await import('@aws-sdk/client-kms');
      const client = new KMSClient({ region });
      const response = await client.send(
        new GenerateDataKeyCommand({
          KeyId: keyId,
          KeySpec: 'AES_256',
        })
      );
      if (!response.Plaintext || !response.CiphertextBlob) {
        throw new Error('AWS KMS GenerateDataKey missing Plaintext or CiphertextBlob');
      }
      const plaintextDEK = Buffer.from(response.Plaintext);
      const encryptedDEK = Buffer.from(response.CiphertextBlob).toString('base64');
      return { plaintextDEK, encryptedDEK };
    } catch (err) {
      logger.error('AWS KMS GenerateDataKey failed', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }

  async decryptDEK(encryptedDEK: string, keyVersion: string): Promise<Buffer> {
    const keyId = config.kms.aws.keyId;
    const region = config.kms.aws.region;
    if (!keyId || !region) {
      throw new Error(
        'KMS_TYPE=aws requires AWS_KMS_KEY_ID and AWS_REGION. Refusing silent LocalKMS fallback on decrypt.'
      );
    }
    try {
      const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
      const client = new KMSClient({ region });
      const response = await client.send(
        new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedDEK, 'base64') })
      );
      if (!response.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
      return Buffer.from(response.Plaintext);
    } catch (err) {
      logger.error('AWS KMS Decrypt failed', { error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }
}

const localKMS = new LocalKMS();

function getKMS(): IKeyManagementService {
  return config.kms.type === 'aws' ? new AwsKMS() : localKMS;
}

let kmsInstance: IKeyManagementService | null = null;

export function getKeyManagementService(): IKeyManagementService {
  if (!kmsInstance) kmsInstance = getKMS();
  return kmsInstance;
}

/**
 * Encrypt a buffer with a DEK (AES-256-GCM). Format: iv:authTag:ciphertext (base64).
 */
export function encryptWithDEK(plaintext: Buffer, dek: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return encodeCiphertext(iv, authTag, encrypted);
}

/**
 * Decrypt ciphertext (format iv:authTag:ciphertext) with DEK.
 */
export function decryptWithDEK(encoded: string, dek: Buffer): Buffer {
  const { iv, authTag, ciphertext } = decodeCiphertext(encoded);
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Zeroize a buffer in place (best-effort).
 */
export function zeroizeBuffer(b: Buffer): void {
  try {
    b.fill(0);
  } catch {
    // ignore
  }
}
