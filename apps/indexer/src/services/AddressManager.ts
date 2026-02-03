import { ethers, HDNodeWallet } from 'ethers';
import { query } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// Encryption key for private keys (in production, use proper key management)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-32-character-encryption-key!';

export class AddressManager {
  private masterMnemonic: string;

  constructor() {
    // In production, load from secure storage
    this.masterMnemonic = process.env.MASTER_MNEMONIC || ethers.Mnemonic.entropyToPhrase(ethers.randomBytes(16));
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async generateAddressForUser(userId: string, chainId: string): Promise<{ address: string; created: boolean }> {
    try {
      // Check if user already has an address for this chain
      const existing = await query(`
        SELECT address FROM user_wallets WHERE user_id = $1 AND chain_id = $2
      `, [userId, chainId]);

      if (existing.rows.length > 0) {
        return { address: existing.rows[0].address, created: false };
      }

      // Get next derivation index for this user
      const indexResult = await query(`
        SELECT COALESCE(MAX(CAST(SPLIT_PART(derivation_path, '/', 6) AS INTEGER)), 0) + 1 as next_index
        FROM user_wallets WHERE user_id = $1
      `, [userId]);
      
      const index = indexResult.rows[0]?.next_index || 0;

      // Generate address using HD derivation
      // Path: m/44'/60'/0'/0/{index}
      const hdNode = HDNodeWallet.fromPhrase(this.masterMnemonic);
      const derivationPath = `m/44'/60'/0'/0/${index}`;
      const wallet = hdNode.derivePath(derivationPath);

      // Encrypt private key
      const encryptedPrivateKey = this.encrypt(wallet.privateKey);

      // Store in database
      await query(`
        INSERT INTO user_wallets (id, user_id, chain_id, address, private_key_encrypted, derivation_path, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
      `, [userId, chainId, wallet.address.toLowerCase(), encryptedPrivateKey, derivationPath]);

      logger.info(`Generated new address for user`, { userId, chainId, address: wallet.address });

      return { address: wallet.address.toLowerCase(), created: true };
    } catch (error) {
      logger.error(`Failed to generate address for user`, { userId, chainId, error });
      throw error;
    }
  }

  async generateAddressesForAllChains(userId: string): Promise<Record<string, string>> {
    const addresses: Record<string, string> = {};

    for (const chainId of Object.keys(CHAIN_CONFIGS)) {
      const result = await this.generateAddressForUser(userId, chainId);
      addresses[chainId] = result.address;
    }

    return addresses;
  }

  async getPrivateKey(userId: string, chainId: string): Promise<string | null> {
    try {
      const result = await query(`
        SELECT private_key_encrypted FROM user_wallets WHERE user_id = $1 AND chain_id = $2
      `, [userId, chainId]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.decrypt(result.rows[0].private_key_encrypted);
    } catch (error) {
      logger.error(`Failed to get private key`, { userId, chainId, error });
      return null;
    }
  }

  async getUserAddresses(userId: string): Promise<Record<string, string>> {
    try {
      const result = await query(`
        SELECT chain_id, address FROM user_wallets WHERE user_id = $1
      `, [userId]);

      const addresses: Record<string, string> = {};
      for (const row of result.rows) {
        addresses[row.chain_id] = row.address;
      }

      return addresses;
    } catch (error) {
      logger.error(`Failed to get user addresses`, { userId, error });
      return {};
    }
  }

  async getAllWatchedAddresses(): Promise<Map<string, Set<string>>> {
    try {
      const result = await query(`
        SELECT chain_id, LOWER(address) as address FROM user_wallets WHERE address IS NOT NULL
      `);

      const addressesByChain = new Map<string, Set<string>>();

      for (const row of result.rows) {
        if (!addressesByChain.has(row.chain_id)) {
          addressesByChain.set(row.chain_id, new Set());
        }
        addressesByChain.get(row.chain_id)!.add(row.address);
      }

      return addressesByChain;
    } catch (error) {
      logger.error(`Failed to get all watched addresses`, { error });
      return new Map();
    }
  }
}

export const addressManager = new AddressManager();
