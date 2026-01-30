import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * Enterprise-grade encryption service
 * Supports AES-256-GCM with optional HSM integration
 */
class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyBuffer: Buffer;
  private readonly ivLength: number;
  private readonly authTagLength = 16;

  constructor() {
    // Ensure key is exactly 32 bytes for AES-256
    const keyString = config.encryption.key;
    this.keyBuffer = crypto.createHash('sha256').update(keyString).digest();
    this.ivLength = config.encryption.ivLength;
  }

  /**
   * Encrypt plaintext data
   * Returns base64 encoded string: iv:authTag:ciphertext
   */
  encrypt(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, this.keyBuffer, iv);
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:ciphertext (all base64)
      return [
        iv.toString('base64'),
        authTag.toString('base64'),
        Buffer.from(encrypted, 'hex').toString('base64'),
      ].join(':');
    } catch (error) {
      logger.error('Encryption failed', { error: error instanceof Error ? error.message : 'Unknown' });
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt encrypted data
   * Input format: iv:authTag:ciphertext (base64)
   */
  decrypt(encryptedData: string): string {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(parts[0]!, 'base64');
      const authTag = Buffer.from(parts[1]!, 'base64');
      const ciphertext = Buffer.from(parts[2]!, 'base64').toString('hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.keyBuffer, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', { error: error instanceof Error ? error.message : 'Unknown' });
      throw new Error('Decryption failed');
    }
  }

  /**
   * Hash data using SHA-256
   */
  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Hash data using SHA-512
   */
  hashSha512(data: string): string {
    return crypto.createHash('sha512').update(data).digest('hex');
  }

  /**
   * Create HMAC signature
   */
  createHmac(data: string, secret: string = config.encryption.key): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Verify HMAC signature
   */
  verifyHmac(data: string, signature: string, secret: string = config.encryption.key): boolean {
    const expectedSignature = this.createHmac(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Generate secure random bytes
   */
  generateRandomBytes(length: number): Buffer {
    return crypto.randomBytes(length);
  }

  /**
   * Generate secure random string (hex)
   */
  generateRandomHex(length: number): string {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
  }

  /**
   * Generate OTP code
   */
  generateOtp(length: number = 6): string {
    const digits = '0123456789';
    let otp = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      otp += digits[randomBytes[i]! % 10];
    }
    return otp;
  }

  /**
   * Hash OTP for storage (with salt)
   */
  hashOtp(otp: string, salt: string): string {
    return crypto.pbkdf2Sync(otp, salt, 10000, 64, 'sha512').toString('hex');
  }

  /**
   * Verify OTP against hash
   */
  verifyOtp(otp: string, salt: string, hash: string): boolean {
    const computedHash = this.hashOtp(otp, salt);
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(hash, 'hex')
    );
  }

  /**
   * Generate salt for password hashing
   */
  generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Encrypt private key for wallet storage
   * Uses additional key derivation for extra security
   */
  encryptPrivateKey(privateKey: string, userId: string): string {
    // Derive a user-specific key using HKDF-like approach
    const derivedKey = crypto.createHmac('sha256', this.keyBuffer)
      .update(`wallet:${userId}`)
      .digest();

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv);

    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      Buffer.from(encrypted, 'hex').toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt private key from wallet storage
   */
  decryptPrivateKey(encryptedKey: string, userId: string): string {
    const parts = encryptedKey.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted key format');
    }

    // Derive the same user-specific key
    const derivedKey = crypto.createHmac('sha256', this.keyBuffer)
      .update(`wallet:${userId}`)
      .digest();

    const iv = Buffer.from(parts[0]!, 'base64');
    const authTag = Buffer.from(parts[1]!, 'base64');
    const ciphertext = Buffer.from(parts[2]!, 'base64').toString('hex');

    const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generate referral code
   */
  generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars
    let code = '';
    const randomBytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      code += chars[randomBytes[i]! % chars.length];
    }
    return code;
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}

// HSM-compatible abstraction layer
interface HSMProvider {
  encrypt(data: Buffer, keyId: string): Promise<Buffer>;
  decrypt(data: Buffer, keyId: string): Promise<Buffer>;
  sign(data: Buffer, keyId: string): Promise<Buffer>;
  verify(data: Buffer, signature: Buffer, keyId: string): Promise<boolean>;
}

/**
 * HSM Provider factory
 * In production, replace SoftwareHSM with actual HSM integration
 * (e.g., AWS CloudHSM, Azure Dedicated HSM, or PKCS#11)
 */
class SoftwareHSM implements HSMProvider {
  private keys: Map<string, Buffer> = new Map();

  constructor() {
    // In a real HSM, keys would be stored in secure hardware
    // This is a software simulation for development
  }

  async generateKey(keyId: string): Promise<void> {
    const key = crypto.randomBytes(32);
    this.keys.set(keyId, key);
  }

  async encrypt(data: Buffer, keyId: string): Promise<Buffer> {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
  }

  async decrypt(data: Buffer, keyId: string): Promise<Buffer> {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);

    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async sign(data: Buffer, keyId: string): Promise<Buffer> {
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Key ${keyId} not found`);

    return Buffer.from(
      crypto.createHmac('sha256', key).update(data).digest()
    );
  }

  async verify(data: Buffer, signature: Buffer, keyId: string): Promise<boolean> {
    const expectedSignature = await this.sign(data, keyId);
    return crypto.timingSafeEqual(signature, expectedSignature);
  }
}

// Export instances
export const encryption = new EncryptionService();
export const hsm: HSMProvider = config.hsm.enabled
  ? new SoftwareHSM() // Replace with real HSM in production
  : new SoftwareHSM();

export { EncryptionService, HSMProvider, SoftwareHSM };
