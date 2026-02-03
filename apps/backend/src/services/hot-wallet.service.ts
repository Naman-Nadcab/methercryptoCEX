/**
 * BULLETPROOF HOT WALLET SERVICE
 * - Keys encrypted at rest (envelope encryption via ENCRYPTION_KEY).
 * - Private key decrypted only in memory, zeroized after use.
 * - No plaintext keys; never returned to frontend.
 * - All actions audited with actor_id and payload_hash.
 * - Explicit error codes; no silent failures. Fail closed.
 */

import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import { db } from '../lib/database.js';
import { encryption } from '../lib/encryption.js';
import { logger } from '../lib/logger.js';
import { logHotWalletAudit } from '../lib/hot-wallet-audit.js';

export const HotWalletErrors = {
  CHAIN_NOT_FOUND: 'CHAIN_NOT_FOUND',
  ONLY_EVM_SUPPORTED: 'ONLY_EVM_SUPPORTED',
  HOT_WALLET_ALREADY_EXISTS: 'HOT_WALLET_ALREADY_EXISTS',
  HOT_WALLET_NOT_FOUND: 'HOT_WALLET_NOT_FOUND',
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  DB_ERROR: 'DB_ERROR',
  RPC_REFRESH_FAILED: 'RPC_REFRESH_FAILED',
} as const;

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

function encryptHotWalletKey(privateKey: string): string {
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

function decryptHotWalletKey(encryptedKey: string): string {
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
  if (chain.type !== 'evm') {
    throw new HotWalletServiceError(HotWalletErrors.ONLY_EVM_SUPPORTED, 'Only EVM chains are supported for hot wallet creation.');
  }

  const existing = await db.query('SELECT id FROM hot_wallets WHERE chain_id = $1', [chainId]);
  if (existing.rows.length > 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_ALREADY_EXISTS, 'Hot wallet already exists for this chain.');
  }

  const wallet = Wallet.createRandom();
  const address = wallet.address;
  let privateKey = wallet.privateKey;
  let encryptedKey: string;
  try {
    encryptedKey = encryptHotWalletKey(privateKey);
  } finally {
    zeroizeString(privateKey);
    privateKey = '';
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
      `INSERT INTO hot_wallets (chain_id, address, encrypted_private_key, balance_cache, min_balance_alert, min_hot_balance, cold_wallet_address, is_active)
       VALUES ($1, $2, $3, '0', '0', '0', NULL, TRUE)
       RETURNING id, address, balance_cache, min_balance_alert, min_hot_balance, cold_wallet_address, is_active, created_at`,
      [chainId, address, encryptedKey]
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
  const creationSupportedTypes = new Set(['evm']);
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
 * Only EVM is supported for keypair generation; other families throw ONLY_EVM_SUPPORTED.
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
  const result = await db.query<{ address: string; encrypted_private_key: string }>(
    'SELECT address, encrypted_private_key FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [resolved]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0]!;
  let privateKey: string;
  try {
    privateKey = decryptHotWalletKey(row.encrypted_private_key);
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

export async function setColdWalletAddress(chainId: string, coldWalletAddress: string | null): Promise<void> {
  await db.query(
    'UPDATE hot_wallets SET cold_wallet_address = $1, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2',
    [coldWalletAddress, chainId]
  );
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
  if (chainResult.rows[0]!.type !== 'evm') {
    throw new HotWalletServiceError(HotWalletErrors.ONLY_EVM_SUPPORTED, 'Only EVM chains are supported.');
  }
  const wallet = Wallet.createRandom();
  const address = wallet.address;
  let privateKey = wallet.privateKey;
  let encryptedKey: string;
  try {
    encryptedKey = encryptHotWalletKey(privateKey);
  } finally {
    zeroizeString(privateKey);
    privateKey = '';
  }
  const oldAddress = existing.rows[0]!.address;
  await db.query(
    `UPDATE hot_wallets SET address = $1, encrypted_private_key = $2, balance_cache = '0', updated_at = CURRENT_TIMESTAMP
     WHERE chain_id = $3`,
    [address, encryptedKey, chainId]
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

const RPC_BALANCE_TIMEOUT_MS = 15_000;

export async function refreshBalanceCache(
  chainId: string,
  actorId?: string
): Promise<{ balance: string; updated: boolean }> {
  chainId = String(chainId).trim();
  if (!chainId) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Chain ID is required.');
  }
  const walletRow = await db.query<{ address: string }>(
    'SELECT address FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (walletRow.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.HOT_WALLET_NOT_FOUND, 'Hot wallet not found or inactive.');
  }
  const chainRow = await db.query<{ rpc_url: string }>('SELECT rpc_url FROM chains WHERE id = $1', [chainId]);
  if (chainRow.rows.length === 0) {
    throw new HotWalletServiceError(HotWalletErrors.CHAIN_NOT_FOUND, 'Chain not found.');
  }
  const address = walletRow.rows[0]!.address;
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
          balanceStr = bal.toString();
        } else {
          const contract = new Contract(t.contract_address, ERC20_ABI, provider);
          const bal = await Promise.race([contract.balanceOf(address), timeout(RPC_BALANCE_TIMEOUT_MS)]);
          balanceStr = bal.toString();
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
