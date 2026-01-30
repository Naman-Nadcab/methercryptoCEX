import { ethers, HDNodeWallet } from 'ethers';
import crypto from 'crypto';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { encryption } from '../lib/encryption.js';
import { logger, auditLog } from '../lib/logger.js';
import { config } from '../config/index.js';
import { ChainId, Wallet, Balance } from '../types/index.js';
import { PoolClient } from 'pg';

// HD Wallet paths (BIP44)
const HD_PATHS: Record<string, string> = {
  ethereum: "m/44'/60'/0'/0",
  bsc: "m/44'/60'/0'/0",
  polygon: "m/44'/60'/0'/0",
  arbitrum: "m/44'/60'/0'/0",
  optimism: "m/44'/60'/0'/0",
  base: "m/44'/60'/0'/0",
  solana: "m/44'/501'/0'/0'",
  tron: "m/44'/195'/0'/0",
  bitcoin: "m/44'/0'/0'/0",
};

class WalletService {
  private masterSeedCache: Map<string, Buffer> = new Map();

  /**
   * Get or create master seed for user
   */
  private async getMasterSeed(userId: string, client?: PoolClient | typeof db): Promise<Buffer> {
    const cached = this.masterSeedCache.get(userId);
    if (cached) {
      return cached;
    }

    const queryRunner = client || db;

    const result = await queryRunner.query<{ encrypted_seed: string }>(
      'SELECT encrypted_seed FROM user_master_keys WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length > 0) {
      const decryptedSeed = encryption.decryptPrivateKey(
        result.rows[0]!.encrypted_seed,
        userId
      );
      const seedBuffer = Buffer.from(decryptedSeed, 'hex');
      this.masterSeedCache.set(userId, seedBuffer);
      return seedBuffer;
    }

    // Generate new seed for user (256 bits = 32 bytes)
    const seed = crypto.randomBytes(64);
    const seedBuffer = Buffer.from(seed);

    const encryptedSeed = encryption.encryptPrivateKey(
      seedBuffer.toString('hex'),
      userId
    );

    await queryRunner.query(
      'INSERT INTO user_master_keys (user_id, encrypted_seed) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [userId, encryptedSeed]
    );

    this.masterSeedCache.set(userId, seedBuffer);
    logger.info('Generated new master seed for user', { userId });

    return seedBuffer;
  }

  /**
   * Get next HD index for user and chain
   */
  private async getNextHDIndex(userId: string, chainId: ChainId): Promise<number> {
    const result = await db.query<{ max_index: number | null }>(
      'SELECT MAX(hd_index) as max_index FROM wallets WHERE user_id = $1 AND chain_id = $2',
      [userId, chainId]
    );

    return (result.rows[0]?.max_index ?? -1) + 1;
  }

  /**
   * Create all wallets for a new user
   */
  async createWalletsForUser(userId: string, client?: PoolClient): Promise<Wallet[]> {
    const queryRunner = client || db;
    const wallets: Wallet[] = [];

    try {
      const seed = await this.getMasterSeed(userId, queryRunner);

      // EVM chains (all use same derivation)
      const evmChains: ChainId[] = [
        ChainId.ETHEREUM,
        ChainId.BSC,
        ChainId.POLYGON,
        ChainId.ARBITRUM,
        ChainId.OPTIMISM,
        ChainId.BASE,
      ];

      for (const chainId of evmChains) {
        const index = await this.getNextHDIndex(userId, chainId);
        const hdPath = `${HD_PATHS[chainId]}/${index}`;
        
        const hdNode = HDNodeWallet.fromSeed(seed);
        const wallet = hdNode.derivePath(hdPath);

        const encryptedKey = encryption.encryptPrivateKey(wallet.privateKey, userId);

        const result = await queryRunner.query<Wallet>(
          `INSERT INTO wallets (user_id, chain_id, address, encrypted_private_key, hd_path, hd_index)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, chain_id) DO NOTHING
           RETURNING *`,
          [userId, chainId, wallet.address, encryptedKey, hdPath, index]
        );

        if (result.rows[0]) {
          wallets.push(result.rows[0]);
        }
      }

      // For Solana, Tron, Bitcoin - generate placeholder addresses
      // In production, use proper libraries for each chain
      const otherChains: ChainId[] = [ChainId.SOLANA, ChainId.TRON, ChainId.BITCOIN];
      
      for (const chainId of otherChains) {
        const index = await this.getNextHDIndex(userId, chainId);
        const hdPath = `${HD_PATHS[chainId]}/${index}`;
        
        // Generate deterministic address from seed
        const chainSeed = crypto.createHmac('sha256', seed)
          .update(`${chainId}:${index}`)
          .digest();
        
        let address: string;
        if (chainId === ChainId.SOLANA) {
          address = `So${chainSeed.toString('hex').slice(0, 42)}`;
        } else if (chainId === ChainId.TRON) {
          address = `T${chainSeed.toString('hex').slice(0, 33)}`;
        } else {
          address = `bc1q${chainSeed.toString('hex').slice(0, 38)}`;
        }

        const encryptedKey = encryption.encryptPrivateKey(chainSeed.toString('hex'), userId);

        const result = await queryRunner.query<Wallet>(
          `INSERT INTO wallets (user_id, chain_id, address, encrypted_private_key, hd_path, hd_index)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, chain_id) DO NOTHING
           RETURNING *`,
          [userId, chainId, address, encryptedKey, hdPath, index]
        );

        if (result.rows[0]) {
          wallets.push(result.rows[0]);
        }
      }

      // Initialize balances for all active tokens
      await this.initializeBalances(userId, queryRunner);

      logger.info('Created wallets for user', { userId, count: wallets.length });

      return wallets;
    } catch (error) {
      logger.error('Failed to create wallets for user', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * Initialize zero balances for all active tokens
   */
  private async initializeBalances(userId: string, client: PoolClient | typeof db): Promise<void> {
    await client.query(`
      INSERT INTO balances (user_id, token_id, available, locked)
      SELECT $1, id, 0, 0 FROM tokens WHERE is_active = TRUE
      ON CONFLICT (user_id, token_id) DO NOTHING
    `, [userId]);
  }

  /**
   * Get user's wallet for a specific chain
   */
  async getWallet(userId: string, chainId: ChainId): Promise<Wallet | null> {
    const cacheKey = `wallet:${userId}:${chainId}`;
    
    const cached = await redis.getJson<Wallet>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await db.query<Wallet>(
      `SELECT id, user_id, chain_id, address, hd_path, hd_index, is_active, created_at
       FROM wallets WHERE user_id = $1 AND chain_id = $2`,
      [userId, chainId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const wallet = result.rows[0]!;
    await redis.setJson(cacheKey, wallet, 3600);

    return wallet;
  }

  /**
   * Get all wallets for a user
   */
  async getUserWallets(userId: string): Promise<Wallet[]> {
    const result = await db.query<Wallet>(
      `SELECT id, user_id, chain_id, address, hd_path, hd_index, is_active, created_at
       FROM wallets WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Get user balances
   */
  async getBalances(userId: string): Promise<Balance[]> {
    const result = await db.query<Balance & { symbol: string; name: string; chain_id: string }>(
      `SELECT b.*, t.symbol, t.name, t.chain_id
       FROM balances b
       JOIN tokens t ON b.token_id = t.id
       WHERE b.user_id = $1
       ORDER BY t.symbol`,
      [userId]
    );

    return result.rows;
  }

  /**
   * Get balance for specific token
   */
  async getBalance(userId: string, tokenId: string): Promise<Balance | null> {
    const cacheKey = `balance:${userId}:${tokenId}`;
    
    const cached = await redis.getJson<Balance>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await db.query<Balance>(
      'SELECT * FROM balances WHERE user_id = $1 AND token_id = $2',
      [userId, tokenId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    await redis.setJson(cacheKey, result.rows[0], 30);

    return result.rows[0]!;
  }

  /**
   * Lock balance for trading/withdrawal
   */
  async lockBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient
  ): Promise<boolean> {
    const queryRunner = client || db;

    const result = await queryRunner.query(
      `UPDATE balances 
       SET available = available - $3, locked = locked + $3, updated_at = NOW()
       WHERE user_id = $1 AND token_id = $2 AND available >= $3
       RETURNING *`,
      [userId, tokenId, amount]
    );

    if (result.rowCount === 0) {
      return false;
    }

    await redis.del(`balance:${userId}:${tokenId}`);
    return true;
  }

  /**
   * Unlock balance
   */
  async unlockBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient
  ): Promise<boolean> {
    const queryRunner = client || db;

    const result = await queryRunner.query(
      `UPDATE balances 
       SET available = available + $3, locked = locked - $3, updated_at = NOW()
       WHERE user_id = $1 AND token_id = $2 AND locked >= $3
       RETURNING *`,
      [userId, tokenId, amount]
    );

    if (result.rowCount === 0) {
      return false;
    }

    await redis.del(`balance:${userId}:${tokenId}`);
    return true;
  }

  /**
   * Credit balance (deposits, trade receipts)
   */
  async creditBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient
  ): Promise<void> {
    const queryRunner = client || db;

    await queryRunner.query(
      `INSERT INTO balances (user_id, token_id, available, locked)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, token_id) 
       DO UPDATE SET available = balances.available + $3, updated_at = NOW()`,
      [userId, tokenId, amount]
    );

    await redis.del(`balance:${userId}:${tokenId}`);
  }

  /**
   * Debit from locked balance (withdrawals, trade settlements)
   */
  async debitLockedBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient
  ): Promise<boolean> {
    const queryRunner = client || db;

    const result = await queryRunner.query(
      `UPDATE balances 
       SET locked = locked - $3, updated_at = NOW()
       WHERE user_id = $1 AND token_id = $2 AND locked >= $3
       RETURNING *`,
      [userId, tokenId, amount]
    );

    if (result.rowCount === 0) {
      return false;
    }

    await redis.del(`balance:${userId}:${tokenId}`);
    return true;
  }

  /**
   * Get deposit address for user
   */
  async getDepositAddress(userId: string, chainId: ChainId): Promise<string> {
    const wallet = await this.getWallet(userId, chainId);
    
    if (!wallet) {
      throw new Error(`No wallet found for chain ${chainId}`);
    }

    return wallet.address;
  }

  /**
   * Clear cached seed (for security, call on logout)
   */
  clearSeedCache(userId: string): void {
    this.masterSeedCache.delete(userId);
  }
}

export const walletService = new WalletService();
