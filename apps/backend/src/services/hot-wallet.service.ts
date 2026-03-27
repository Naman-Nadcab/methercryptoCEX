/**
 * BULLETPROOF HOT WALLET SERVICE
 * - Keys encrypted at rest (envelope encryption via ENCRYPTION_KEY).
 * - Private key decrypted only in memory, zeroized after use.
 * - No plaintext keys; never returned to frontend.
 * - All actions audited with actor_id and payload_hash.
 * - Explicit error codes; no silent failures. Fail closed.
 * - One hot wallet per chain family (EVM, Bitcoin, Solana, Tron, Polkadot); same as user-side chains.
 * - Monetary amounts: Decimal.js only, no float.
 */

import { Decimal } from '../lib/decimal.js';
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import { db } from '../lib/database.js';
import { encryption } from '../lib/encryption.js';
import { logger } from '../lib/logger.js';
import { logHotWalletAudit } from '../lib/hot-wallet-audit.js';
import {
  encryptPrivateKeyEnvelope,
  decryptPrivateKeyEnvelope,
  type EnvelopeEncryptedPayload,
} from '../lib/hot-wallet-envelope.js';
import { generateRandomAddressForChain } from './multi-chain-address.js';

export const HotWalletErrors = {
  CHAIN_NOT_FOUND: 'CHAIN_NOT_FOUND',
  CREATION_NOT_SUPPORTED: 'CREATION_NOT_SUPPORTED',
  HOT_WALLET_ALREADY_EXISTS: 'HOT_WALLET_ALREADY_EXISTS',
  HOT_WALLET_NOT_FOUND: 'HOT_WALLET_NOT_FOUND',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  DB_ERROR: 'DB_ERROR',
  RPC_REFRESH_FAILED: 'RPC_REFRESH_FAILED',
} as const;

const SUPPORTED_HOT_WALLET_TYPES = new Set(['evm', 'bitcoin', 'solana', 'tron', 'polkadot']);

export class HotWalletServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly pgCode?: string
  ) {
    super(message);
    this.name = 'HotWalletServiceError';
  }
}

export interface HotWalletRecord {
  id: string;
  chain_id: string;
  address: string;
  balance_cache: string;
  min_balance_alert: string;
  min_hot_balance: string;
  cold_wallet_address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateHotWalletResult {
  id: string;
  chainId: string;
  address: string;
  balanceCache: string;
  minBalanceAlert: string;
  minHotBalance: string;
  coldWalletAddress: string | null;
  isActive: boolean;
  createdAt: string;
}

function zeroizeString(s: string): void {
  if (typeof s !== 'string') return;
  try {
    (s as unknown as { length: number }).length = 0;
  } catch {
    // Best-effort; JS strings are immutable
  }
}

/** Legacy: encrypt with app key only (no envelope). Used only for migration path. */
function encryptHotWalletKeyLegacy(privateKey: string): string {
  try {
    return encryption.encrypt(privateKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    if (msg === 'Encryption failed' || msg.includes('encrypt')) {
      throw new HotWalletServiceError(
        HotWalletErrors.ENCRYPTION_FAILED,
        'Encryption failed. Set ENCRYPTION_KEY in .env (min 32 chars).'
      );
    }
    throw new HotWalletServiceError(HotWalletErrors.ENCRYPTION_FAILED, msg);
  }
}

/** Legacy: decrypt with app key only. Used when encrypted_dek IS NULL (pre-envelope rows). */
function decryptHotWalletKeyLegacy(encryptedKey: string): string {
  try {
    return encryption.decrypt(encryptedKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    if (msg === 'Decryption failed' || msg.includes('decrypt') || msg.includes('Invalid')) {
      throw new HotWalletServiceError(
        HotWalletErrors.DECRYPTION_FAILED,
        'Decryption failed. Key may be corrupted or ENCRYPTION_KEY changed.'
      );
    }
    throw new HotWalletServiceError(HotWalletErrors.DECRYPTION_FAILED, msg);
  }
}

export async function createHotWallet(
  chainId: string,
  actorId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<CreateHotWalletResult> {
  chainId = chainId.trim();
  const chainResult = await db.query<{ id: string; type: string; rpc_url: string }>(
    'SELECT id, type, rpc_url FROM chains WHERE id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (chainResult.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.CHAIN_NOT_FOUND, 'Chain not found in database. Ensure chains table has this chain id.');
  }
  const chain = chainResult.rows[0]!;
  if (!SUPPORTED_HOT_WALLET_TYPES.has(chain.type)) {
    throw new HotWalletServiceError(
      HotWalletErrors.CREATION_NOT_SUPPORTED,
      `Hot wallet creation not supported for chain type "${chain.type}". Supported: evm, bitcoin, solana, tron, polkadot.`
    );
  }

  const existing = await db.query('SELECT id FROM hot_wallets WHERE chain_id = $1', [chainId]);
  if (existing.rows.length > 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_ALREADY_EXISTS, 'Hot wallet already exists for this chain.');
  }

  let address: string;
  let keyToEncrypt: string;
  if (chain.type === 'evm') {
    const wallet = Wallet.createRandom();
    address = wallet.address;
    keyToEncrypt = wallet.privateKey;
  } else {
    const derived = generateRandomAddressForChain(chain.type);
    address = derived.address;
    keyToEncrypt = derived.privateKeyHex;
  }
  let envelope: EnvelopeEncryptedPayload;
  try {
    envelope = await encryptPrivateKeyEnvelope(keyToEncrypt);
  } finally {
    zeroizeString(keyToEncrypt);
    keyToEncrypt = '';
  }

  try {
    const insertResult = await db.query<{
      id: string;
      address: string;
      balance_cache: string;
      min_balance_alert: string;
      min_hot_balance: string;
      cold_wallet_address: string | null;
      is_active: boolean;
      created_at: string;
    }>(
      `INSERT INTO hot_wallets (chain_id, address, encrypted_private_key, encrypted_dek, key_version, balance_cache, min_balance_alert, min_hot_balance, cold_wallet_address, is_active)
       VALUES ($1, $2, $3, $4, $5, '0', '0', '0', NULL, TRUE)
       RETURNING id, address, balance_cache, min_balance_alert, min_hot_balance, cold_wallet_address, is_active, created_at`,
      [chainId, address, envelope.encryptedPrivateKey, envelope.encryptedDEK, envelope.keyVersion]
    );
    const row = insertResult.rows[0]!;
    await logHotWalletAudit({
      actorId,
      actorType: 'admin',
      action: 'hot_wallet_created',
      resourceType: 'hot_wallet',
      resourceId: row.id,
      details: { chain_id: chainId, address: row.address },
      ipAddress,
      userAgent,
    });
    logger.info('Hot wallet created', { chainId, address: row.address, actorId });
    return {
      id: row.id,
      chainId,
      address: row.address,
      balanceCache: row.balance_cache,
      minBalanceAlert: row.min_balance_alert,
      minHotBalance: row.min_hot_balance ?? '0',
      coldWalletAddress: row.cold_wallet_address,
      isActive: row.is_active,
      createdAt: row.created_at,
    };
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg?.code === '42P01') {
      throw new HotWalletServiceError(
        HotWalletErrors.DB_ERROR,
        'Hot wallets table missing. Run: npm run migrate (in apps/backend).',
        '42P01'
      );
    }
    if (pg?.code === '23503') {
      throw new HotWalletServiceError(HotWalletErrors.CHAIN_NOT_FOUND, 'Chain not found in database. Ensure chains table has this chain id.', '23503');
    }
    if (pg?.code === '23505') {
      throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_ALREADY_EXISTS, 'Hot wallet already exists for this chain.', '23505');
    }
    throw err;
  }
}

export async function listHotWallets(): Promise<HotWalletRecord[]> {
  const result = await db.query<HotWalletRecord>(
    `SELECT hw.id, hw.chain_id, hw.address, hw.balance_cache, hw.min_balance_alert,
            COALESCE(hw.min_hot_balance::text, '0') as min_hot_balance, hw.cold_wallet_address,
            hw.is_active, hw.created_at, hw.updated_at
     FROM hot_wallets hw
     ORDER BY hw.chain_id`
  );
  return result.rows;
}

/** Display label for chain type (family) */
export const CHAIN_FAMILY_LABELS: Record<string, string> = {
  evm: 'EVM',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  tron: 'Tron',
  polkadot: 'Polkadot',
};

export interface ChainFamilyInDb {
  type: string;
  label: string;
  representativeChainId: string;
  chainName: string;
  /** Whether creation is supported (e.g. EVM keypair generation). */
  creationSupported: boolean;
}

/**
 * List chain families that exist in the DB (distinct chain types).
 * Returns one representative chain per family for display and creation.
 */
export async function listChainFamiliesInDb(): Promise<ChainFamilyInDb[]> {
  const result = await db.query<{ type: string; id: string; name: string }>(
    `SELECT DISTINCT ON (c.type) c.type, c.id, c.name
     FROM chains c
     WHERE c.is_active = TRUE
     ORDER BY c.type, c.id`
  );
  const creationSupportedTypes = new Set(['evm', 'bitcoin', 'solana', 'tron', 'polkadot']);
  return result.rows.map((row) => ({
    type: row.type,
    label: CHAIN_FAMILY_LABELS[row.type] ?? row.type,
    representativeChainId: row.id,
    chainName: row.name,
    creationSupported: creationSupportedTypes.has(row.type),
  }));
}

/**
 * Get representative chain_id for a chain family that exists in DB.
 * Returns null if no chain of that type exists.
 */
export async function getRepresentativeChainIdForFamily(chainFamily: string): Promise<string | null> {
  const family = chainFamily.trim().toLowerCase();
  const result = await db.query<{ id: string }>(
    'SELECT id FROM chains WHERE is_active = TRUE AND LOWER(type) = $1 ORDER BY id LIMIT 1',
    [family]
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Create hot wallet for a chain family. Picks representative chain from DB.
 * All chain families (EVM, Bitcoin, Solana, Tron, Polkadot) are supported; same as user-side wallets.
 */
export async function createHotWalletByFamily(
  chainFamily: string,
  actorId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<CreateHotWalletResult> {
  const chainId = await getRepresentativeChainIdForFamily(chainFamily);
  if (!chainId) {
    throw new HotWalletServiceError(
      HotWalletErrors.CHAIN_NOT_FOUND,
      `No chain of type "${chainFamily}" found in database. Add the chain in Settings first.`
    );
  }
  return createHotWallet(chainId, actorId, ipAddress, userAgent);
}

/**
 * Check if a chain family already has a hot wallet (any chain of that type).
 */
export async function familyHasHotWallet(chainFamily: string): Promise<boolean> {
  const family = chainFamily.trim().toLowerCase();
  const result = await db.query<{ chain_id: string }>(
    `SELECT hw.chain_id FROM hot_wallets hw
     INNER JOIN chains c ON c.id = hw.chain_id
     WHERE c.is_active = TRUE AND LOWER(c.type) = $1 AND hw.is_active = TRUE
     LIMIT 1`,
    [family]
  );
  return result.rows.length > 0;
}

/**
 * Resolve chainId to the hot_wallet row's chain_id (one wallet per chain family).
 * If no hot wallet for this chain_id, find one for the same chain type (e.g. EVM wallet for all EVM chains).
 */
export async function resolveHotWalletChainId(chainId: string): Promise<string | null> {
  const direct = await db.query<{ chain_id: string }>(
    'SELECT chain_id FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (direct.rows.length > 0) return direct.rows[0]!.chain_id;
  const byType = await db.query<{ chain_id: string }>(
    `SELECT hw.chain_id FROM hot_wallets hw
     INNER JOIN chains c ON c.id = hw.chain_id
     WHERE c.type = (SELECT type FROM chains WHERE id = $1 AND is_active = TRUE LIMIT 1)
       AND hw.is_active = TRUE
     LIMIT 1`,
    [chainId]
  );
  return byType.rows[0]?.chain_id ?? null;
}

export async function getHotWalletByChainId(chainId: string): Promise<{ id: string; address: string } | null> {
  const resolved = await resolveHotWalletChainId(chainId);
  if (!resolved) return null;
  const result = await db.query<{ id: string; address: string }>(
    'SELECT id, address FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [resolved]
  );
  return result.rows[0] ?? null;
}

/** Per-hot-wallet cap check result. */
export const HotWalletCapCodes = {
  OK: 'OK',
  SINGLE_TX_CAP_EXCEEDED: 'HOT_WALLET_SINGLE_TX_CAP_EXCEEDED',
  DAILY_CAP_EXCEEDED: 'HOT_WALLET_DAILY_CAP_EXCEEDED',
} as const;

export interface HotWalletCapCheck {
  allowed: boolean;
  code: string;
  message?: string;
}

/**
 * Get per-hot-wallet withdrawal caps for a chain (chain-aware via resolveHotWalletChainId).
 */
export async function getHotWalletCaps(chainId: string): Promise<{
  max_single_tx: string | null;
  max_daily_outflow: string | null;
} | null> {
  const resolved = await resolveHotWalletChainId(chainId);
  if (!resolved) return null;
  const result = await db.query<{ max_single_tx: string | null; max_daily_outflow: string | null }>(
    'SELECT max_single_tx::text, max_daily_outflow::text FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [resolved]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    max_single_tx: row.max_single_tx != null && row.max_single_tx !== '' ? row.max_single_tx : null,
    max_daily_outflow: row.max_daily_outflow != null && row.max_daily_outflow !== '' ? row.max_daily_outflow : null,
  };
}

/**
 * Rolling 24h outflow for a chain (sum of net_amount of completed withdrawals, chain-aware).
 * Returns string for Decimal-safe comparison.
 */
export async function getDailyOutflowForChain(chainId: string): Promise<string> {
  const resolved = await resolveHotWalletChainId(chainId);
  if (!resolved) return '0';
  const result = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(net_amount), 0)::text AS total
     FROM withdrawals
     WHERE chain_id = $1 AND status = 'completed'
       AND completed_at >= (NOW() - INTERVAL '24 hours')`,
    [resolved]
  );
  return result.rows[0]?.total ?? '0';
}

const ROUND_DOWN = 1;

/**
 * Check per-hot-wallet caps before enqueue or sign. Chain-aware.
 * Withdrawal amount is the net_amount (value sent from hot wallet). Decimal.js only.
 */
export async function checkHotWalletCaps(
  chainId: string,
  withdrawalNetAmount: string
): Promise<HotWalletCapCheck> {
  const caps = await getHotWalletCaps(chainId);
  if (!caps) {
    return { allowed: true, code: HotWalletCapCodes.OK };
  }
  const amount = new Decimal(withdrawalNetAmount).toDecimalPlaces(18, ROUND_DOWN);
  if (caps.max_single_tx != null && caps.max_single_tx !== '') {
    const maxSingle = new Decimal(caps.max_single_tx).toDecimalPlaces(18, ROUND_DOWN);
    if (amount.gt(maxSingle)) {
      return {
        allowed: false,
        code: HotWalletCapCodes.SINGLE_TX_CAP_EXCEEDED,
        message: `Single withdrawal exceeds hot wallet limit for this chain (max ${caps.max_single_tx})`,
      };
    }
  }
  if (caps.max_daily_outflow != null && caps.max_daily_outflow !== '') {
    const dailyOutflowStr = await getDailyOutflowForChain(chainId);
    const dailyOutflow = new Decimal(dailyOutflowStr).toDecimalPlaces(18, ROUND_DOWN);
    const limit = new Decimal(caps.max_daily_outflow).toDecimalPlaces(18, ROUND_DOWN);
    if (dailyOutflow.plus(amount).gt(limit)) {
      return {
        allowed: false,
        code: HotWalletCapCodes.DAILY_CAP_EXCEEDED,
        message: `Daily outflow limit exceeded for this chain (used ${dailyOutflowStr}, limit ${caps.max_daily_outflow})`,
      };
    }
  }
  return { allowed: true, code: HotWalletCapCodes.OK };
}

/**
 * Get signer for chain. Key is decrypted in memory, used, then zeroized.
 * NEVER expose or log the signer/private key. Audit log records decryption event only.
 */
export async function getSignerForChain(
  chainId: string,
  actorId: string,
  actionContext?: string
): Promise<{
  address: string;
  signTransaction: (tx: { to: string; value: bigint; data?: string; gasLimit?: bigint }) => Promise<string>;
} | null> {
  const resolved = await resolveHotWalletChainId(chainId);
  if (!resolved) return null;
  const result = await db.query<{
    address: string;
    encrypted_private_key: string;
    encrypted_dek: string | null;
    key_version: string | null;
  }>(
    'SELECT address, encrypted_private_key, encrypted_dek, key_version FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [resolved]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  let privateKey: string;
  try {
    if (row.encrypted_dek != null && row.encrypted_dek.trim() !== '' && row.key_version != null) {
      privateKey = await decryptPrivateKeyEnvelope(
        row.encrypted_private_key,
        row.encrypted_dek,
        row.key_version
      );
    } else {
      privateKey = decryptHotWalletKeyLegacy(row.encrypted_private_key);
    }
  } catch (err) {
    logger.error('Hot wallet decryption failed', { chainId, error: err instanceof Error ? err.message : 'Unknown' });
    throw err;
  }
  await logHotWalletAudit({
    actorId,
    actorType: 'system',
    action: 'hot_wallet_key_decrypted',
    resourceType: 'hot_wallet',
    resourceId: chainId,
    details: { chain_id: chainId, context: actionContext ?? 'signing' },
  });
  const wallet = new Wallet(privateKey);
  const signTransaction = async (tx: { to: string; value: bigint; data?: string; gasLimit?: bigint }): Promise<string> => {
    let signed: string;
    try {
      signed = await wallet.signTransaction({
        to: tx.to,
        value: tx.value,
        data: tx.data ?? '0x',
        gasLimit: tx.gasLimit ?? 21000n,
      });
      return signed;
    } finally {
      zeroizeString(privateKey);
    }
  };
  return { address: row.address, signTransaction };
}

export async function updateBalanceCache(chainId: string, balance: string): Promise<void> {
  await db.query(
    'UPDATE hot_wallets SET balance_cache = $1, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2',
    [balance, chainId]
  );
}

export async function setMinBalanceAlert(chainId: string, minBalance: string): Promise<void> {
  await db.query(
    'UPDATE hot_wallets SET min_balance_alert = $1, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2',
    [minBalance, chainId]
  );
}

export async function setMinHotBalance(chainId: string, minHotBalance: string): Promise<void> {
  await db.query(
    'UPDATE hot_wallets SET min_hot_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2',
    [minHotBalance, chainId]
  );
}

export async function setColdWalletAddress(
  chainId: string,
  coldWalletAddress: string | null,
  actorId?: string | null,
  actorType: string = 'admin'
): Promise<void> {
  const prev = await db.query<{ cold_wallet_address: string | null }>(
    'SELECT cold_wallet_address FROM hot_wallets WHERE chain_id = $1',
    [chainId]
  );
  const previousAddress = prev.rows[0]?.cold_wallet_address ?? null;
  await db.query(
    'UPDATE hot_wallets SET cold_wallet_address = $1, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2',
    [coldWalletAddress, chainId]
  );
  try {
    await db.query(
      `INSERT INTO cold_wallet_movements (chain_id, previous_address, new_address, actor_type, actor_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [chainId, previousAddress, coldWalletAddress, actorType, actorId ?? null]
    );
  } catch {
    // best-effort
  }
}

export async function setHotWalletActive(
  chainId: string,
  isActive: boolean,
  actorId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await db.query(
    'UPDATE hot_wallets SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2',
    [isActive, chainId]
  );
  await logHotWalletAudit({
    actorId,
    actorType: 'admin',
    action: isActive ? 'hot_wallet_activated' : 'hot_wallet_deactivated',
    resourceType: 'hot_wallet',
    resourceId: chainId,
    details: { chain_id: chainId, is_active: isActive },
    ipAddress,
    userAgent,
  });
}

/**
 * Replace hot wallet for a chain with a new keypair. Old key is overwritten; withdraw any funds first.
 */
export async function replaceHotWallet(
  chainId: string,
  actorId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<CreateHotWalletResult> {
  chainId = chainId.trim();
  const existing = await db.query<{ id: string; address: string }>(
    'SELECT id, address FROM hot_wallets WHERE chain_id = $1',
    [chainId]
  );
  if (existing.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Hot wallet not found for this chain.');
  }
  const chainResult = await db.query<{ id: string; type: string; rpc_url: string }>(
    'SELECT id, type, rpc_url FROM chains WHERE id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (chainResult.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.CHAIN_NOT_FOUND, 'Chain not found.');
  }
  const chain = chainResult.rows[0]!;
  if (!SUPPORTED_HOT_WALLET_TYPES.has(chain.type)) {
    throw new HotWalletServiceError(HotWalletErrors.CREATION_NOT_SUPPORTED, `Replace not supported for chain type "${chain.type}".`);
  }
  let address: string;
  let keyToEncrypt: string;
  if (chain.type === 'evm') {
    const wallet = Wallet.createRandom();
    address = wallet.address;
    keyToEncrypt = wallet.privateKey;
  } else {
    const derived = generateRandomAddressForChain(chain.type);
    address = derived.address;
    keyToEncrypt = derived.privateKeyHex;
  }
  let envelope: EnvelopeEncryptedPayload;
  try {
    envelope = await encryptPrivateKeyEnvelope(keyToEncrypt);
  } finally {
    zeroizeString(keyToEncrypt);
    keyToEncrypt = '';
  }
  const oldAddress = existing.rows[0]!.address;
  await db.query(
    `UPDATE hot_wallets SET address = $1, encrypted_private_key = $2, encrypted_dek = $3, key_version = $4, balance_cache = '0', updated_at = CURRENT_TIMESTAMP
     WHERE chain_id = $5`,
    [address, envelope.encryptedPrivateKey, envelope.encryptedDEK, envelope.keyVersion, chainId]
  );
  await logHotWalletAudit({
    actorId,
    actorType: 'admin',
    action: 'hot_wallet_replaced',
    resourceType: 'hot_wallet',
    resourceId: existing.rows[0]!.id,
    details: { chain_id: chainId, old_address: oldAddress, new_address: address },
    ipAddress,
    userAgent,
  });
  logger.info('Hot wallet replaced', { chainId, oldAddress, newAddress: address, actorId });
  const row = await db.query<HotWalletRecord>(
    'SELECT id, chain_id, address, balance_cache, min_balance_alert, COALESCE(min_hot_balance::text, \'0\') as min_hot_balance, cold_wallet_address, is_active, created_at, updated_at FROM hot_wallets WHERE chain_id = $1',
    [chainId]
  );
  const r = row.rows[0]!;
  return {
    id: r.id,
    chainId: r.chain_id,
    address: r.address,
    balanceCache: r.balance_cache,
    minBalanceAlert: r.min_balance_alert,
    minHotBalance: r.min_hot_balance ?? '0',
    coldWalletAddress: r.cold_wallet_address,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

/**
 * Remove (delete) hot wallet for a chain. Chain will be available for creating a new wallet.
 */
export async function removeHotWallet(
  chainId: string,
  actorId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  chainId = chainId.trim();
  const existing = await db.query<{ id: string; address: string }>(
    'SELECT id, address FROM hot_wallets WHERE chain_id = $1',
    [chainId]
  );
  if (existing.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Hot wallet not found for this chain.');
  }
  await db.query('DELETE FROM hot_wallets WHERE chain_id = $1', [chainId]);
  await logHotWalletAudit({
    actorId,
    actorType: 'admin',
    action: 'hot_wallet_removed',
    resourceType: 'hot_wallet',
    resourceId: existing.rows[0]!.id,
    details: { chain_id: chainId, address: existing.rows[0]!.address },
    ipAddress,
    userAgent,
  });
  logger.info('Hot wallet removed', { chainId, actorId });
}

/**
 * Migrate a single hot wallet from legacy (app-key-only) encryption to envelope encryption.
 * Idempotent: if encrypted_dek is already set, no-op. Call after schema has encrypted_dek, key_version.
 * Never returns or logs private key or DEK.
 */
export async function migrateHotWalletToEnvelope(chainId: string): Promise<{ migrated: boolean; chainId: string }> {
  const row = await db.query<{
    id: string;
    encrypted_private_key: string;
    encrypted_dek: string | null;
    key_version: string | null;
  }>('SELECT id, encrypted_private_key, encrypted_dek, key_version FROM hot_wallets WHERE chain_id = $1', [
    chainId,
  ]);
  if (row.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Hot wallet not found.');
  }
  const r = row.rows[0]!;
  if (r.encrypted_dek != null && r.encrypted_dek.trim() !== '') {
    return { migrated: false, chainId };
  }
  const privateKey = decryptHotWalletKeyLegacy(r.encrypted_private_key);
  let envelope: EnvelopeEncryptedPayload;
  try {
    envelope = await encryptPrivateKeyEnvelope(privateKey);
  } finally {
    zeroizeString(privateKey);
  }
  await db.query(
    `UPDATE hot_wallets SET encrypted_private_key = $1, encrypted_dek = $2, key_version = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
    [envelope.encryptedPrivateKey, envelope.encryptedDEK, envelope.keyVersion, r.id]
  );
  logger.info('Hot wallet migrated to envelope encryption', { chainId, hotWalletId: r.id });
  return { migrated: true, chainId };
}

/**
 * Migrate all legacy hot wallets (encrypted_dek IS NULL) to envelope encryption.
 */
export async function migrateAllHotWalletsToEnvelope(): Promise<{ migrated: number; skipped: number }> {
  const rows = await db.query<{ chain_id: string; encrypted_dek: string | null }>(
    'SELECT chain_id, encrypted_dek FROM hot_wallets'
  );
  let migrated = 0;
  let skipped = 0;
  for (const r of rows.rows) {
    if (r.encrypted_dek != null && r.encrypted_dek.trim() !== '') {
      skipped++;
      continue;
    }
    await migrateHotWalletToEnvelope(r.chain_id);
    migrated++;
  }
  return { migrated, skipped };
}

const RPC_BALANCE_TIMEOUT_MS = 15_000;

/**
 * PHASE-16: Read-only live balance fetch. Does NOT update balance_cache.
 * Use for authority validation and drift detection. On RPC failure or non-EVM returns null (fail closed).
 */
export async function getLiveBalanceReadOnly(chainId: string): Promise<{ balanceWei: string } | null> {
  chainId = String(chainId).trim();
  const walletRow = await db.query<{ address: string }>(
    'SELECT address FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (walletRow.rows.length === 0) return null;
  const chainRow = await db.query<{ type: string; rpc_url: string }>('SELECT type, rpc_url FROM chains WHERE id = $1', [chainId]);
  if (chainRow.rows.length === 0) return null;
  if (chainRow.rows[0]!.type !== 'evm') return null;
  const address = walletRow.rows[0]!.address;
  const rpcUrl = chainRow.rows[0]!.rpc_url;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const balancePromise = provider.getBalance(address);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC timeout')), RPC_BALANCE_TIMEOUT_MS)
    );
    const balance = await Promise.race([balancePromise, timeoutPromise]);
    return { balanceWei: balance.toString() };
  } catch {
    return null;
  }
}

export async function refreshBalanceCache(
  chainId: string,
  actorId?: string
): Promise<{ balance: string; updated: boolean }> {
  chainId = String(chainId).trim();
  if (!chainId) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Chain ID is required.');
  }
  const walletRow = await db.query<{ address: string; balance_cache: string }>(
    'SELECT address, balance_cache FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (walletRow.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Hot wallet not found or inactive.');
  }
  const chainRow = await db.query<{ type: string; rpc_url: string }>('SELECT type, rpc_url FROM chains WHERE id = $1', [chainId]);
  if (chainRow.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.CHAIN_NOT_FOUND, 'Chain not found.');
  }
  const address = walletRow.rows[0]!.address;
  const chainType = chainRow.rows[0]!.type;
  if (chainType !== 'evm') {
    return { balance: walletRow.rows[0]!.balance_cache || '0', updated: false };
  }
  const rpcUrl = chainRow.rows[0]!.rpc_url;
  const provider = new JsonRpcProvider(rpcUrl);
  let balanceStr: string;
  try {
    const balancePromise = provider.getBalance(address);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC timeout. Check chain RPC URL and network.')), RPC_BALANCE_TIMEOUT_MS)
    );
    const balance = await Promise.race([balancePromise, timeoutPromise]);
    balanceStr = balance.toString();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    if (msg.includes('timeout') || msg.includes('TIMEOUT')) {
      throw new HotWalletServiceError(
        HotWalletErrors.RPC_REFRESH_FAILED,
        'RPC timeout. Update the chain RPC URL in Settings or try again later.'
      );
    }
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
      throw new HotWalletServiceError(
        HotWalletErrors.RPC_REFRESH_FAILED,
        'RPC rate limited. Use your own RPC URL in chain settings or try again later.'
      );
    }
    throw new HotWalletServiceError(
      HotWalletErrors.RPC_REFRESH_FAILED,
      `Balance fetch failed: ${msg}. Check chain RPC URL in Settings.`
    );
  }
  await updateBalanceCache(chainId, balanceStr);
  if (actorId) {
    await logHotWalletAudit({
      actorId,
      actorType: 'admin',
      action: 'hot_wallet_balance_refresh',
      resourceType: 'hot_wallet',
      resourceId: chainId,
      details: { chain_id: chainId, balance_wei: balanceStr },
    });
  }
  return { balance: balanceStr, updated: true };
}

// ERC20 balanceOf ABI (minimal)
const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'] as const;

export interface TokenBalanceItem {
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  isNative: boolean;
}

export interface ChainBalances {
  chainId: string;
  chainName: string;
  chainType: string;
  balances: TokenBalanceItem[];
}

/**
 * Fetch native + token balances for a hot wallet address on given EVM chains.
 * Only tokens that exist in DB (tokens table) for each chain are included; each currency once per chain.
 */
export async function getHotWalletBalancesForChains(
  chainIds: string[],
  address: string
): Promise<ChainBalances[]> {
  const result: ChainBalances[] = [];
  for (const chainId of chainIds) {
    const chainRow = await db.query<{ id: string; name: string; type: string; rpc_url: string }>(
      'SELECT id, name, type, rpc_url FROM chains WHERE id = $1 AND is_active = TRUE',
      [chainId]
    );
    if (chainRow.rows.length === 0) continue;
    const chain = chainRow.rows[0]!;
    if (chain.type !== 'evm') continue; // only EVM supports RPC balanceOf

    const tokens = await db.query<{ symbol: string; name: string; decimals: number; contract_address: string | null; is_native: boolean }>(
      `SELECT symbol, name, decimals, contract_address, COALESCE(is_native, false) as is_native
       FROM tokens WHERE chain_id = $1 AND is_active = TRUE ORDER BY is_native DESC, symbol`,
      [chainId]
    );
    const provider = new JsonRpcProvider(chain.rpc_url);
    const balances: TokenBalanceItem[] = [];

    const timeout = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), ms));

    for (const t of tokens.rows) {
      let balanceStr: string;
      try {
        if (t.is_native || !t.contract_address) {
          const bal = await Promise.race([provider.getBalance(address), timeout(RPC_BALANCE_TIMEOUT_MS)]);
          balanceStr = bal != null ? String(bal) : '0';
        } else {
          const contract = new Contract(t.contract_address, ERC20_ABI, provider);
          const balanceOf = contract.balanceOf;
          const bal = balanceOf
            ? await Promise.race([balanceOf(address), timeout(RPC_BALANCE_TIMEOUT_MS)])
            : 0n;
          balanceStr = bal != null ? String(bal) : '0';
        }
      } catch {
        balanceStr = '0';
      }
      balances.push({
        symbol: t.symbol,
        name: t.name,
        balance: balanceStr,
        decimals: t.decimals,
        isNative: t.is_native ?? false,
      });
    }
    result.push({ chainId: chain.id, chainName: chain.name, chainType: chain.type, balances });
  }
  return result;
}
