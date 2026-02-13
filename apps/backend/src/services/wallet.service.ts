import { Decimal } from '../lib/decimal.js';
import { ethers, HDNodeWallet } from 'ethers';
import crypto from 'crypto';
import { db, type Queryable } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { encryption } from '../lib/encryption.js';
import { logger, auditLog } from '../lib/logger.js';
import { config } from '../config/index.js';
import { ChainId, Wallet, Balance } from '../types/index.js';
import { PoolClient } from 'pg';
import { getCurrencyIdForToken, getTokenIdsByCurrencyId } from '../lib/currency-resolver.js';
import {
  ensureUserBalanceRow,
  assertUserBalanceUpdated,
  assertBalanceInvariant,
  assertNonNegative,
  assertValidDecimal,
  CHAIN_ID_GLOBAL,
} from '../lib/user-balance-helper.js';
import { insertBalanceLedger, type LedgerReferenceType } from '../lib/balance-ledger.js';
// Lazy-loaded to avoid tronweb ESM/crash at server startup
let multiChainAddress: typeof import('./multi-chain-address.js') | null = null;
async function getMultiChainAddress() {
  if (!multiChainAddress) {
    multiChainAddress = await import('./multi-chain-address.js');
  }
  return multiChainAddress;
}

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
  bitcoin: "m/84'/0'/0'/0",
  polkadot: "m/44'/354'/0'/0'",
};

class WalletService {
  private masterSeedCache: Map<string, Buffer> = new Map();

  /**
   * Get or create master seed for user
   */
  private async getMasterSeed(userId: string, client?: Queryable): Promise<Buffer> {
    const cached = this.masterSeedCache.get(userId);
    if (cached) {
      return cached;
    }

    const queryRunner = (client || db) as Queryable;

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
   * Get next HD index for user and chain (used only when creating a *new* wallet for that chain).
   */
  private async getNextHDIndex(userId: string, chainId: ChainId): Promise<number> {
    const result = await db.query<{ max_index: number | null }>(
      'SELECT MAX(hd_index) as max_index FROM wallets WHERE user_id = $1 AND chain_id = $2',
      [userId, chainId]
    );

    return (result.rows[0]?.max_index ?? -1) + 1;
  }

  /**
   * Create all wallets for a new user.
   * IMPORTANT: User deposit addresses are immutable. Once generated, they must never change
   * unless we explicitly change the code (e.g. new derivation path). We never UPDATE or
   * replace an existing wallet address — we only INSERT when no wallet exists for (user, chain).
   */
  async createWalletsForUser(userId: string, client?: PoolClient): Promise<Wallet[]> {
    const queryRunner = (client || db) as Queryable;
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
        const existing = await queryRunner.query<Wallet>(
          'SELECT id FROM wallets WHERE user_id = $1 AND chain_id = $2',
          [userId, chainId]
        );
        if (existing.rows.length > 0) continue;

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

      // Bitcoin first (bc1), then Solana, Polkadot, Tron last - so BTC works even if TronWeb fails
      const otherChains: ChainId[] = [ChainId.BITCOIN, ChainId.SOLANA, ChainId.POLKADOT, ChainId.TRON];
      const { deriveSolanaAddress, deriveTronAddress, deriveBitcoinBech32Address, derivePolkadotAddress } = await getMultiChainAddress();

      for (const chainId of otherChains) {
        const existing = await queryRunner.query<Wallet>(
          'SELECT id FROM wallets WHERE user_id = $1 AND chain_id = $2',
          [userId, chainId]
        );
        if (existing.rows.length > 0) continue;

        const index = await this.getNextHDIndex(userId, chainId);
        const hdPath = `${HD_PATHS[chainId] ?? "m/44'/0'/0'/0"}/${index}`;

        let address: string;
        let privateKeyHex: string;
        try {
          if (chainId === ChainId.SOLANA) {
            const derived = deriveSolanaAddress(seed, chainId, index);
            address = derived.address;
            privateKeyHex = derived.privateKeyHex;
          } else if (chainId === ChainId.TRON) {
            const derived = deriveTronAddress(seed, chainId, index);
            address = derived.address;
            privateKeyHex = derived.privateKeyHex;
          } else if (chainId === ChainId.BITCOIN) {
            const derived = deriveBitcoinBech32Address(seed, chainId, index);
            address = derived.address;
            privateKeyHex = derived.privateKeyHex;
          } else if (chainId === ChainId.POLKADOT) {
            const derived = derivePolkadotAddress(seed, chainId, index);
            address = derived.address;
            privateKeyHex = derived.privateKeyHex;
          } else {
            continue;
          }
        } catch (err) {
          logger.error('Multi-chain address derivation failed', {
            chainId,
            userId,
            error: err instanceof Error ? err.message : 'Unknown',
          });
          continue;
        }

        const encryptedKey = encryption.encryptPrivateKey(privateKeyHex, userId);

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
   * Initialize zero user_balances rows for all active tokens (single source of truth).
   * Does NOT touch the deprecated balances table.
   */
  private async initializeBalances(userId: string, client: Queryable): Promise<void> {
    const queryRunner = client as Queryable;
    const tokens = await queryRunner.query<{ id: string }>('SELECT id FROM tokens WHERE is_active = TRUE', []);
    const poolClient = client && typeof (client as PoolClient).release === 'function' ? (client as PoolClient) : undefined;
    for (const row of tokens.rows) {
      const currencyId = await getCurrencyIdForToken(row.id);
      if (currencyId) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', poolClient);
      }
    }
  }

  /**
   * Get user's wallet for a specific chain
   */
  async getWallet(userId: string, chainId: ChainId): Promise<Wallet | null> {
    const cacheKey = `wallet:${userId}:${chainId}`;
    try {
      const cached = await redis.getJson<Wallet>(cacheKey);
      if (cached) return cached;
    } catch {
      // Redis down or error: fall back to DB
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
    try {
      await redis.setJson(cacheKey, wallet, 3600);
    } catch {
      // Cache write optional
    }
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
   * Get user balances from user_balances only (single source of truth).
   * Aggregates available_balance + locked_balance per currency.
   */
  async getBalances(userId: string): Promise<Balance[]> {
    const result = await db.query<{
      currency_id: string;
      symbol: string;
      name: string;
      available: string;
      locked: string;
      updated_at: string;
    }>(
      `SELECT ub.currency_id, c.symbol, c.name,
              COALESCE(SUM(ub.available_balance), 0)::text AS available,
              COALESCE(SUM(ub.locked_balance), 0)::text AS locked,
              MAX(ub.updated_at)::text AS updated_at
       FROM user_balances ub
       JOIN currencies c ON c.id = ub.currency_id
       WHERE ub.user_id = $1
       GROUP BY ub.currency_id, c.symbol, c.name
       ORDER BY c.symbol`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: '',
      userId,
      tokenId: row.currency_id,
      available: row.available,
      locked: row.locked,
      total: new Decimal(row.available).plus(row.locked).toString(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    }));
  }

  /**
   * Get balance for specific token from user_balances only (single source of truth).
   */
  async getBalance(userId: string, tokenId: string): Promise<Balance | null> {
    const cacheKey = `balance:${userId}:${tokenId}`;
    const cached = await redis.getJson<Balance>(cacheKey);
    if (cached) return cached;

    const currencyId = await getCurrencyIdForToken(tokenId);
    if (!currencyId) return null;

    const result = await db.query<{ available: string; locked: string; updated_at: string }>(
      `SELECT COALESCE(SUM(available_balance), 0)::text AS available,
              COALESCE(SUM(locked_balance), 0)::text AS locked,
              MAX(updated_at)::text AS updated_at
       FROM user_balances
       WHERE user_id = $1 AND currency_id = $2
       GROUP BY user_id, currency_id`,
      [userId, currencyId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0]!;
    const available = row.available;
    const locked = row.locked;
    const total = new Decimal(available).plus(locked).toString();
    const bal: Balance = {
      id: '',
      userId,
      tokenId,
      available,
      locked,
      total,
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
    await redis.setJson(cacheKey, bal, 30);
    return bal;
  }

  /**
   * Lock balance for trading/withdrawal. Uses user_balances (single source of truth).
   * Tries chain-specific row first; if 0 rows updated, falls back to CHAIN_ID_GLOBAL, then throws if still 0.
   */
  async lockBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient,
    ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
  ): Promise<boolean> {
    assertValidDecimal('lockAmount', amount);
    assertNonNegative('lockAmount', amount);
    const refType = ledgerRef?.referenceType ?? 'adjustment';
    const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
    const run = async (q: PoolClient) => {
      const currencyId = await getCurrencyIdForToken(tokenId);
      if (!currencyId) {
        logger.warn('lockBalance: no currency_id for token', { tokenId });
        return false;
      }
      const chainResult = await q.query<{ chain_id: string }>(
        'SELECT COALESCE(chain_id, \'\') AS chain_id FROM tokens WHERE id = $1',
        [tokenId]
      );
      let chainId = chainResult.rows[0]?.chain_id ?? CHAIN_ID_GLOBAL;
      await ensureUserBalanceRow(userId, currencyId, chainId, 'funding', q);
      let lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND available_balance >= $4
         FOR UPDATE`,
        [userId, currencyId, chainId, amount]
      );
      if (lockSel.rows.length === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
          `SELECT available_balance::text, locked_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND available_balance >= $4
           FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      if (lockSel.rows.length === 0) return false;
      const selRow = lockSel.rows[0]!;
      const balanceBeforeAvail = selRow.available_balance ?? '0';
      const balanceBeforeLocked = selRow.locked_balance ?? '0';
      let result = await q.query(
        `UPDATE user_balances
         SET available_balance = available_balance - $4, locked_balance = locked_balance + $4, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND available_balance >= $4
         RETURNING *`,
        [userId, currencyId, chainId, amount]
      );
      if (result.rowCount === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        result = await q.query(
          `UPDATE user_balances
           SET available_balance = available_balance - $4, locked_balance = locked_balance + $4, updated_at = NOW()
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND available_balance >= $4
           RETURNING *`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      assertUserBalanceUpdated('lockBalance', result, userId, currencyId, 'funding', chainId);
      assertBalanceInvariant(result.rows[0]);
      const row = result.rows[0]!;
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType: 'funding',
        debit: amount,
        credit: '0',
        balanceBefore: balanceBeforeAvail,
        balanceAfter: String(row.available_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'available',
      });
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType: 'funding',
        debit: '0',
        credit: amount,
        balanceBefore: balanceBeforeLocked,
        balanceAfter: String(row.locked_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'locked',
      });
      return true;
    };
    if (client) {
      const ok = await run(client);
      if (ok) await redis.del(`balance:${userId}:${tokenId}`);
      return ok;
    }
    const ok = await db.transaction(run);
    if (ok) await redis.del(`balance:${userId}:${tokenId}`);
    return ok;
  }

  /**
   * Unlock balance (user_balances only). Tries chain-specific row first; if 0 rows, fallback to CHAIN_ID_GLOBAL.
   */
  async unlockBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient,
    ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
  ): Promise<boolean> {
    assertValidDecimal('unlockAmount', amount);
    assertNonNegative('unlockAmount', amount);
    const refType = ledgerRef?.referenceType ?? 'adjustment';
    const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
    const run = async (q: PoolClient) => {
      const currencyId = await getCurrencyIdForToken(tokenId);
      if (!currencyId) {
        logger.warn('unlockBalance: no currency_id for token', { tokenId });
        return false;
      }
      const chainResult = await q.query<{ chain_id: string }>(
        'SELECT COALESCE(chain_id, \'\') AS chain_id FROM tokens WHERE id = $1',
        [tokenId]
      );
      let chainId = chainResult.rows[0]?.chain_id ?? CHAIN_ID_GLOBAL;
      await ensureUserBalanceRow(userId, currencyId, chainId, 'funding', q);
      let lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
         FOR UPDATE`,
        [userId, currencyId, chainId, amount]
      );
      if (lockSel.rows.length === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        lockSel = await q.query<{ available_balance: string; locked_balance: string }>(
          `SELECT available_balance::text, locked_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
           FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      if (lockSel.rows.length === 0) return false;
      const selRow = lockSel.rows[0]!;
      let result = await q.query(
        `UPDATE user_balances
         SET available_balance = available_balance + $4, locked_balance = locked_balance - $4, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
         RETURNING *`,
        [userId, currencyId, chainId, amount]
      );
      if (result.rowCount === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        result = await q.query(
          `UPDATE user_balances
           SET available_balance = available_balance + $4, locked_balance = locked_balance - $4, updated_at = NOW()
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
           RETURNING *`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      assertUserBalanceUpdated('unlockBalance', result, userId, currencyId, 'funding', chainId);
      assertBalanceInvariant(result.rows[0]);
      const row = result.rows[0]!;
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType: 'funding',
        debit: '0',
        credit: amount,
        balanceBefore: selRow.available_balance ?? '0',
        balanceAfter: String(row.available_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'available',
      });
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType: 'funding',
        debit: amount,
        credit: '0',
        balanceBefore: selRow.locked_balance ?? '0',
        balanceAfter: String(row.locked_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'locked',
      });
      return true;
    };
    if (client) {
      const ok = await run(client);
      if (ok) await redis.del(`balance:${userId}:${tokenId}`);
      return ok;
    }
    const ok = await db.transaction(run);
    if (ok) await redis.del(`balance:${userId}:${tokenId}`);
    return ok;
  }

  /**
   * Credit balance (user_balances only; deposits, trade receipts). Tries chain-specific first, then CHAIN_ID_GLOBAL.
   */
  async creditBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient,
    ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
  ): Promise<void> {
    const refType = ledgerRef?.referenceType ?? 'adjustment';
    const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
    const run = async (q: PoolClient) => {
      const currencyId = await getCurrencyIdForToken(tokenId);
      if (!currencyId) {
        logger.warn('creditBalance: no currency_id for token', { tokenId });
        throw new Error(`creditBalance: no currency_id for token ${tokenId}`);
      }
      const chainResult = await q.query<{ chain_id: string }>(
        'SELECT COALESCE(chain_id, \'\') AS chain_id FROM tokens WHERE id = $1',
        [tokenId]
      );
      let chainId = chainResult.rows[0]?.chain_id ?? CHAIN_ID_GLOBAL;
      await ensureUserBalanceRow(userId, currencyId, chainId, 'funding', q);
      let lockSel = await q.query<{ available_balance: string }>(
        `SELECT available_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
         FOR UPDATE`,
        [userId, currencyId, chainId]
      );
      if (lockSel.rows.length === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        lockSel = await q.query<{ available_balance: string }>(
          `SELECT available_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
           FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      if (lockSel.rows.length === 0) throw new Error('creditBalance: no balance row');
      const selRow = lockSel.rows[0]!;
      const balanceBefore = selRow.available_balance ?? '0';
      let result = await q.query(
        `UPDATE user_balances
         SET available_balance = available_balance + $4, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
         RETURNING *`,
        [userId, currencyId, chainId, amount]
      );
      if (result.rowCount === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        result = await q.query(
          `UPDATE user_balances
           SET available_balance = available_balance + $4, updated_at = NOW()
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
           RETURNING *`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      assertUserBalanceUpdated('creditBalance', result, userId, currencyId, 'funding', chainId);
      assertBalanceInvariant(result.rows[0]);
      const row = result.rows[0]!;
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType: 'funding',
        debit: '0',
        credit: amount,
        balanceBefore,
        balanceAfter: String(row.available_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'available',
      });
    };
    if (client) {
      await run(client);
    } else {
      await db.transaction(run);
    }
    await redis.del(`balance:${userId}:${tokenId}`);
  }

  /**
   * Debit from locked balance (user_balances only; withdrawals, trade settlements). Tries chain-specific, then CHAIN_ID_GLOBAL.
   */
  async debitLockedBalance(
    userId: string,
    tokenId: string,
    amount: string,
    client?: PoolClient,
    ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
  ): Promise<boolean> {
    const refType = ledgerRef?.referenceType ?? 'adjustment';
    const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
    const run = async (q: PoolClient) => {
      const currencyId = await getCurrencyIdForToken(tokenId);
      if (!currencyId) {
        logger.warn('debitLockedBalance: no currency_id for token', { tokenId });
        return false;
      }
      const chainResult = await q.query<{ chain_id: string }>(
        'SELECT COALESCE(chain_id, \'\') AS chain_id FROM tokens WHERE id = $1',
        [tokenId]
      );
      let chainId = chainResult.rows[0]?.chain_id ?? CHAIN_ID_GLOBAL;
      await ensureUserBalanceRow(userId, currencyId, chainId, 'funding', q);
      let lockSel = await q.query<{ locked_balance: string }>(
        `SELECT locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
         FOR UPDATE`,
        [userId, currencyId, chainId, amount]
      );
      if (lockSel.rows.length === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        lockSel = await q.query<{ locked_balance: string }>(
          `SELECT locked_balance::text FROM user_balances
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
           FOR UPDATE`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      if (lockSel.rows.length === 0) return false;
      const balanceBefore = lockSel.rows[0]!.locked_balance ?? '0';
      let result = await q.query(
        `UPDATE user_balances
         SET locked_balance = locked_balance - $4, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
         RETURNING *`,
        [userId, currencyId, chainId, amount]
      );
      if (result.rowCount === 0 && chainId !== CHAIN_ID_GLOBAL) {
        await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', q);
        result = await q.query(
          `UPDATE user_balances
           SET locked_balance = locked_balance - $4, updated_at = NOW()
           WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND locked_balance >= $4
           RETURNING *`,
          [userId, currencyId, CHAIN_ID_GLOBAL, amount]
        );
        chainId = CHAIN_ID_GLOBAL;
      }
      assertUserBalanceUpdated('debitLockedBalance', result, userId, currencyId, 'funding', chainId);
      assertBalanceInvariant(result.rows[0]);
      const row = result.rows[0]!;
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType: 'funding',
        debit: amount,
        credit: '0',
        balanceBefore,
        balanceAfter: String(row.locked_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'locked',
      });
      return true;
    };
    if (client) {
      const ok = await run(client);
      if (ok) await redis.del(`balance:${userId}:${tokenId}`);
      return ok;
    }
    const ok = await db.transaction(run);
    if (ok) await redis.del(`balance:${userId}:${tokenId}`);
    return ok;
  }

  /**
   * Debit available balance for an account type (e.g. internal transfer from funding to trading). Uses CHAIN_ID_GLOBAL.
   * Call ensureUserBalanceRow before. Throws if 0 rows updated.
   */
  async debitAvailableBalance(
    userId: string,
    currencyId: string,
    accountType: string,
    amount: string,
    client?: PoolClient,
    ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
  ): Promise<void> {
    assertValidDecimal('debitAmount', amount);
    assertNonNegative('debitAmount', amount);
    const refType = ledgerRef?.referenceType ?? 'internal_transfer';
    const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
    const run = async (q: PoolClient) => {
      await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, accountType, q);
      const lockSel = await q.query<{ available_balance: string }>(
        `SELECT available_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 AND available_balance >= $5::numeric
         FOR UPDATE`,
        [userId, currencyId, CHAIN_ID_GLOBAL, accountType, amount]
      );
      if (lockSel.rows.length === 0) {
        throw new Error(`user_balances UPDATE affected 0 rows (operation=debitAvailableBalance, user_id=${userId}, currency_id=${currencyId})`);
      }
      const balanceBefore = lockSel.rows[0]!.available_balance ?? '0';
      const result = await q.query(
        `UPDATE user_balances
         SET available_balance = available_balance - $4::numeric, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5 AND available_balance >= $4::numeric
         RETURNING *`,
        [userId, currencyId, CHAIN_ID_GLOBAL, amount, accountType]
      );
      assertUserBalanceUpdated('debitAvailableBalance', result, userId, currencyId, accountType, CHAIN_ID_GLOBAL);
      assertBalanceInvariant(result.rows[0]);
      const row = result.rows[0]!;
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType,
        debit: amount,
        credit: '0',
        balanceBefore,
        balanceAfter: String(row.available_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'available',
      });
    };
    if (client) {
      await run(client);
    } else {
      await db.transaction(run);
    }
    const tokenIds = await getTokenIdsByCurrencyId(currencyId);
    for (const tid of tokenIds) {
      try { await redis.del(`balance:${userId}:${tid}`); } catch { /* best effort */ }
    }
  }

  /**
   * Credit available balance for an account type (e.g. internal transfer to trading). Uses CHAIN_ID_GLOBAL.
   * Call ensureUserBalanceRow before. Throws if 0 rows updated.
   */
  async creditBalanceForAccount(
    userId: string,
    currencyId: string,
    accountType: string,
    amount: string,
    client?: PoolClient,
    ledgerRef?: { referenceType: LedgerReferenceType; referenceId: string }
  ): Promise<void> {
    assertValidDecimal('creditAmount', amount);
    assertNonNegative('creditAmount', amount);
    const refType = ledgerRef?.referenceType ?? 'internal_transfer';
    const refId = ledgerRef?.referenceId ?? crypto.randomUUID();
    const run = async (q: PoolClient) => {
      await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, accountType, q);
      const lockSel = await q.query<{ available_balance: string }>(
        `SELECT available_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4
         FOR UPDATE`,
        [userId, currencyId, CHAIN_ID_GLOBAL, accountType]
      );
      if (lockSel.rows.length === 0) {
        throw new Error(`user_balances UPDATE affected 0 rows (operation=creditBalanceForAccount, user_id=${userId}, currency_id=${currencyId})`);
      }
      const balanceBefore = lockSel.rows[0]!.available_balance ?? '0';
      const result = await q.query(
        `UPDATE user_balances
         SET available_balance = available_balance + $4::numeric, updated_at = NOW()
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $5
         RETURNING *`,
        [userId, currencyId, CHAIN_ID_GLOBAL, amount, accountType]
      );
      assertUserBalanceUpdated('creditBalanceForAccount', result, userId, currencyId, accountType, CHAIN_ID_GLOBAL);
      assertBalanceInvariant(result.rows[0]);
      const row = result.rows[0]!;
      await insertBalanceLedger({
        client: q,
        userId,
        currencyId,
        accountType,
        debit: '0',
        credit: amount,
        balanceBefore,
        balanceAfter: String(row.available_balance ?? 0),
        referenceType: refType,
        referenceId: refId,
        balanceType: 'available',
      });
    };
    if (client) await run(client);
    else await db.transaction(run);
    const tokenIdsCred = await getTokenIdsByCurrencyId(currencyId);
    for (const tid of tokenIdsCred) {
      try { await redis.del(`balance:${userId}:${tid}`); } catch { /* best effort */ }
    }
  }

  /**
   * Get deposit address for user. Address is immutable once created — same user + chain
   * always returns the same address (derived from master seed + hd_index 0).
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
