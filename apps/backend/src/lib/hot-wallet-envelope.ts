/**
 * Envelope encryption for hot wallet private keys.
 * - KMS encrypts/decrypts DEK only.
 * - DEK encrypts private key; stored as encrypted_private_key.
 * - At runtime: KMS decrypt DEK -> DEK decrypts private key in memory only.
 * - No private key or DEK ever returned to API or logs.
 */

import { getKeyManagementService } from './kms.js';
import { encryptWithDEK, decryptWithDEK, zeroizeBuffer } from './kms.js';
import { config } from '../config/index.js';

const DEFAULT_KEY_VERSION = config.kms.keyVersion;

export interface EnvelopeEncryptedPayload {
  encryptedPrivateKey: string;
  encryptedDEK: string;
  keyVersion: string;
}

/**
 * Encrypt a hot wallet private key using envelope encryption.
 * Returns payload to store in DB (encrypted_private_key, encrypted_dek, key_version).
 */
export async function encryptPrivateKeyEnvelope(privateKey: string): Promise<EnvelopeEncryptedPayload> {
  const kms = getKeyManagementService();
  const keyVersion = DEFAULT_KEY_VERSION;
  const { plaintextDEK, encryptedDEK } = await kms.generateDataKey(keyVersion);
  try {
    const encryptedPrivateKey = encryptWithDEK(Buffer.from(privateKey, 'utf8'), plaintextDEK);
    return {
      encryptedPrivateKey,
      encryptedDEK,
      keyVersion,
    };
  } finally {
    zeroizeBuffer(plaintextDEK);
  }
}

/**
 * Decrypt a hot wallet private key from envelope payload.
 * DEK is decrypted via KMS, then used to decrypt private key. Both zeroized after use.
 */
export async function decryptPrivateKeyEnvelope(
  encryptedPrivateKey: string,
  encryptedDEK: string,
  keyVersion: string
): Promise<string> {
  const kms = getKeyManagementService();
  const dek = await kms.decryptDEK(encryptedDEK, keyVersion);
  try {
    const decrypted = decryptWithDEK(encryptedPrivateKey, dek);
    const privateKey = decrypted.toString('utf8');
    zeroizeBuffer(decrypted);
    return privateKey;
  } finally {
    zeroizeBuffer(dek);
  }
}

/**
 * Key rotation: re-encrypt the DEK with the current key version without changing the private key.
 * Call when rotating KMS master key. Reads encrypted DEK, decrypts with old context, re-encrypts with new.
 * For local KMS this means re-encrypting DEK with new key version and updating DB.
 */
export async function rotateEnvelopeDEK(
  encryptedPrivateKey: string,
  encryptedDEK: string,
  oldKeyVersion: string
): Promise<EnvelopeEncryptedPayload> {
  const privateKey = await decryptPrivateKeyEnvelope(encryptedPrivateKey, encryptedDEK, oldKeyVersion);
  try {
    return await encryptPrivateKeyEnvelope(privateKey);
  } finally {
    try {
      (privateKey as unknown as { length: number }).length = 0;
    } catch {
      // best-effort zeroize
    }
  }
}
