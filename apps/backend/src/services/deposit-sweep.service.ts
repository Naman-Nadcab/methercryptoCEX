/**
 * Deposit consolidation: sweep from user deposit addresses (wallets) to hot wallet.
 * - Background job; idempotent (deposit_sweeps table prevents double sweep).
 * - EVM: simple transfer. Bitcoin/Solana: see chain-specific notes.
 * - Post-sweep: update hot_wallet.balance_cache, audit deposit_sweep_completed.
 */

import { JsonRpcProvider, Wallet } from 'ethers';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { encryption } from '../lib/encryption.js';
import { resolveHotWalletChainId } from './hot-wallet.service.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';

const ACTOR_SYSTEM = 'deposit-sweep';
const GAS_RESERVE_WEI = BigInt(21000 * 80);
const RPC_TIMEOUT_MS = 15_000;

export interface SweepableAddress {
  chain_id: string;
  from_address: string;
  to_address: string;
  user_id: string;
  encrypted_private_key: string;
  balance_wei: string;
}

/** Eligibility insight for admin visibility (why addresses are not swept). */
export interface EligibilityInsight {
  credited_deposit_addresses: number;
  min_wei: string;
  gas_reserve_wei: string;
  skip_reason_counts: Record<string, number>;
}

/**
 * List addresses that are sweepable: have balance above threshold, hot wallet active, not already swept.
 * Source: wallets table (user deposit addresses). Only EVM chains with type from chains table.
 * Only includes addresses with at least one credited deposit. Logs skip reasons and final list.
 */
/** Skip reason with optional on-chain balance for diagnostics. */
interface SkipReason {
  chainId: string;
  address: string;
  reason: string;
  balance_wei?: string;
}

const emptyInsight = (credited: number, minWei: string, gasReserve: string): EligibilityInsight => ({
  credited_deposit_addresses: credited,
  min_wei: minWei,
  gas_reserve_wei: gasReserve,
  skip_reason_counts: {},
});

export async function listSweepableAddresses(): Promise<{ sweepable: SweepableAddress[]; insight: EligibilityInsight }> {
  let sweepEnabled = config.depositSweep?.enabled !== false;
  let minWeiOverride: string | null = null;

  try {
    const settingsRes = await db.query<{ value: string }>(`SELECT value FROM system_settings WHERE key = 'treasury_settings' LIMIT 1`);
    if (settingsRes.rows.length > 0) {
      const ts = typeof settingsRes.rows[0]!.value === 'string' ? JSON.parse(settingsRes.rows[0]!.value) : settingsRes.rows[0]!.value;
      if (ts.auto_sweep_enabled === false) sweepEnabled = false;
      if (ts.min_sweep_amount && Number(ts.min_sweep_amount) > 0) {
        minWeiOverride = String(BigInt(Math.floor(Number(ts.min_sweep_amount) * 1e18)));
      }
    }
  } catch (_) { /* fallback to env config */ }

  const minWei = BigInt(minWeiOverride ?? config.depositSweep.minWei);
  const minWeiStr = minWei.toString();
  const gasReserveWei = GAS_RESERVE_WEI.toString();

  if (!sweepEnabled) {
    logger.info('Deposit sweep: disabled (config or treasury_settings), listSweepableAddresses returns []', {
      deposit_sweep_enabled: false,
      min_wei: minWeiStr,
      gas_reserve_wei: gasReserveWei,
    });
    return { sweepable: [], insight: emptyInsight(0, minWeiStr, gasReserveWei) };
  }

  let creditedAddresses = new Set<string>();
  let creditedCount = 0;
  try {
    const credited = await db.query<{ to_address: string }>(
      `SELECT DISTINCT LOWER(TRIM(to_address)) AS to_address FROM deposits WHERE credited_at IS NOT NULL AND status = 'completed'`
    );
    creditedAddresses = new Set(credited.rows.map((r) => r.to_address).filter(Boolean));
    creditedCount = creditedAddresses.size;
  } catch (e) {
    logger.warn('Deposit sweep: could not load credited deposits (table or schema)', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const hotRows = await db.query<{ chain_id: string; address: string }>(
    `SELECT chain_id, address FROM hot_wallets WHERE is_active = TRUE`
  );
  if (hotRows.rows.length === 0) {
    logger.info('Deposit sweep: listSweepableAddresses found no active hot wallets', {
      credited_deposit_addresses: creditedCount,
      min_wei: minWeiStr,
      gas_reserve_wei: gasReserveWei,
    });
    return { sweepable: [], insight: emptyInsight(creditedCount, minWeiStr, gasReserveWei) };
  }

  logger.info('Deposit sweep: eligibility check started', {
    credited_deposit_addresses: creditedCount,
    min_wei: minWeiStr,
    gas_reserve_wei: gasReserveWei,
    active_hot_wallets: hotRows.rows.length,
  });

  const out: SweepableAddress[] = [];
  const skipReasons: SkipReason[] = [];

  for (const hw of hotRows.rows) {
    const chainId = hw.chain_id;
    const chainRow = await db.query<{ type: string; rpc_url: string }>(
      'SELECT type, rpc_url FROM chains WHERE id = $1 AND is_active = TRUE',
      [chainId]
    );
    if (chainRow.rows.length === 0) continue;
    if (chainRow.rows[0]!.type !== 'evm') continue;

    const rpcUrl = chainRow.rows[0]!.rpc_url;
    let provider: JsonRpcProvider;
    try {
      provider = new JsonRpcProvider(rpcUrl);
    } catch {
      continue;
    }

    const walletRows = await db.query<{ address: string; user_id: string; encrypted_private_key: string }>(
      `SELECT address, user_id, encrypted_private_key FROM wallets WHERE chain_id = $1 AND is_active = TRUE AND encrypted_private_key IS NOT NULL AND encrypted_private_key != ''`,
      [chainId]
    );
    const completed = await db.query<{ from_address: string }>(
      `SELECT from_address FROM deposit_sweeps WHERE chain_id = $1 AND status = 'completed'`,
      [chainId]
    );
    const completedSet = new Set(completed.rows.map((r) => r.from_address.toLowerCase()));

    for (const w of walletRows.rows) {
      const addrLower = w.address.toLowerCase();
      if (completedSet.has(addrLower)) {
        skipReasons.push({ chainId, address: w.address, reason: 'already_swept' });
        continue;
      }
      if (creditedAddresses.size > 0 && !creditedAddresses.has(addrLower.trim())) {
        skipReasons.push({ chainId, address: w.address, reason: 'no_credited_deposit' });
        continue;
      }
      try {
        const balance = await Promise.race([
          provider.getBalance(w.address),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), RPC_TIMEOUT_MS)),
        ]);
        if (balance < minWei) {
          skipReasons.push({
            chainId,
            address: w.address,
            reason: 'balance_below_min_wei',
            balance_wei: balance.toString(),
          });
          continue;
        }
        const sweepAmount = balance - GAS_RESERVE_WEI;
        if (sweepAmount <= 0n) {
          skipReasons.push({
            chainId,
            address: w.address,
            reason: 'sweep_amount_zero_after_gas_reserve',
            balance_wei: balance.toString(),
          });
          continue;
        }
        out.push({
          chain_id: chainId,
          from_address: w.address,
          to_address: hw.address,
          user_id: w.user_id,
          encrypted_private_key: w.encrypted_private_key,
          balance_wei: sweepAmount.toString(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipReasons.push({ chainId, address: w.address, reason: `balance_check_error: ${msg}` });
        logger.warn('Deposit sweep: balance check failed', {
          chainId,
          address: w.address,
          error: msg,
        });
      }
    }
  }

  const reasonCounts: Record<string, number> = {};
  for (const s of skipReasons) {
    const r = s.reason.replace(/\(.*\)/, '').trim() || s.reason;
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }

  logger.info('Deposit sweep: listSweepableAddresses', {
    sweepable_count: out.length,
    sweepable: out.map((x) => ({ chain_id: x.chain_id, from_address: x.from_address, balance_wei: x.balance_wei })),
    skip_count: skipReasons.length,
    skip_reason_counts: reasonCounts,
    skip_reasons_sample: skipReasons.slice(0, 25).map((s) =>
      s.balance_wei != null ? { ...s, min_wei: minWeiStr, gas_reserve_wei: gasReserveWei } : s
    ),
  });

  if (out.length === 0 && skipReasons.length > 0) {
    logger.info('Deposit sweep: no eligible addresses (expected if balance < threshold or no gas reserve)', {
      credited_deposit_addresses: creditedCount,
      min_wei: minWeiStr,
      gas_reserve_wei: gasReserveWei,
    });
  }

  return {
    sweepable: out,
    insight: {
      credited_deposit_addresses: creditedCount,
      min_wei: minWeiStr,
      gas_reserve_wei: gasReserveWei,
      skip_reason_counts: reasonCounts,
    },
  };
}

export interface ExecuteSweepResult {
  success: boolean;
  error?: string;
}

/**
 * Execute one sweep. Idempotent: INSERT ON CONFLICT (chain_id, from_address) DO NOTHING if already exists.
 * Fail-closed: on any error mark as failed and return { success: false, error }.
 * Returns { success: true } only when sweep completed and balance_cache + audit log updated.
 */
const HOT_SWEEP_LOCK_TTL_MS = 120_000;

export async function executeOneSweep(item: SweepableAddress): Promise<ExecuteSweepResult> {
  const { chain_id, from_address, to_address, user_id, encrypted_private_key, balance_wei } = item;
  const sweepWei = BigInt(balance_wei);

  let lockValue: string | null = null;
  try {
    lockValue = await redis.acquireLock(`hot_sweep:${chain_id}`, HOT_SWEEP_LOCK_TTL_MS);
    if (!lockValue) return { success: false, error: 'sweep_locked' };
  } catch {
    return { success: false, error: 'sweep_locked' };
  }

  try {
    const existing = await db.query<{ status: string }>(
      `SELECT status FROM deposit_sweeps WHERE chain_id = $1 AND from_address = $2`,
      [chain_id, from_address]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0]!.status === 'completed') return { success: false, error: 'already_completed' };
      if (existing.rows[0]!.status === 'pending') {
        await db.query(
          `UPDATE deposit_sweeps SET status = 'failed', error_message = $1, completed_at = NOW() WHERE chain_id = $2 AND from_address = $3`,
          ['Retry: previous attempt left pending', chain_id, from_address]
        );
      }
    }

    await db.query(
      `INSERT INTO deposit_sweeps (chain_id, from_address, to_address, amount_raw, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (chain_id, from_address) DO UPDATE SET status = 'pending', error_message = NULL, completed_at = NULL, amount_raw = $4`,
      [chain_id, from_address, to_address, balance_wei]
    );

    let privateKey: string;
    try {
      privateKey = encryption.decryptPrivateKey(encrypted_private_key, user_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Deposit sweep: decrypt failed', { chain_id, from_address, error: msg });
      await db.query(
        `UPDATE deposit_sweeps SET status = 'failed', error_message = $1, completed_at = NOW() WHERE chain_id = $2 AND from_address = $3`,
        [msg, chain_id, from_address]
      );
      return { success: false, error: `decrypt: ${msg}` };
    }

    const chainRow = await db.query<{ rpc_url: string }>('SELECT rpc_url FROM chains WHERE id = $1', [chain_id]);
    if (chainRow.rows.length === 0) {
      await db.query(
        `UPDATE deposit_sweeps SET status = 'failed', error_message = 'Chain not found', completed_at = NOW() WHERE chain_id = $1 AND from_address = $2`,
        [chain_id, from_address]
      );
      return { success: false, error: 'Chain not found' };
    }

    const provider = new JsonRpcProvider(chainRow.rows[0]!.rpc_url);
    const signer = new Wallet(privateKey, provider);

    let txHash: string;
    try {
      const tx = await signer.sendTransaction({
        to: to_address,
        value: sweepWei,
        gasLimit: 21000n,
      });
      txHash = tx.hash;
      await tx.wait().catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Deposit sweep: send failed', { chain_id, from_address, error: msg });
      await db.query(
        `UPDATE deposit_sweeps SET status = 'failed', error_message = $1, completed_at = NOW() WHERE chain_id = $2 AND from_address = $3`,
        [msg.substring(0, 500), chain_id, from_address]
      );
      return { success: false, error: `send: ${msg}` };
    }

    await db.query(
      `UPDATE deposit_sweeps SET status = 'completed', tx_hash = $1, completed_at = NOW() WHERE chain_id = $2 AND from_address = $3`,
      [txHash, chain_id, from_address]
    );

    const resolved = await resolveHotWalletChainId(chain_id);
    if (resolved) {
      await db.query(
        `UPDATE hot_wallets SET balance_cache = balance_cache + $1::numeric, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2 AND is_active = TRUE`,
        [sweepWei.toString(), resolved]
      );
    }

    await logWithdrawalLifecycle('deposit_sweep_completed', {
      withdrawal_id: null,
      user_id,
      admin_id: null,
      token_id: null,
      chain_id,
      amount: sweepWei.toString(),
      ip: null,
      user_agent: null,
    });

    logger.info('Deposit sweep completed', { chain_id, from_address, txHash, sweepWei: sweepWei.toString() });
    return { success: true };
  } finally {
    if (lockValue) redis.releaseLock(`hot_sweep:${chain_id}`, lockValue).catch(() => {});
  }
}

export interface RunDepositSweepResult {
  sweptCount: number;
  errors: string[];
}

/**
 * Run deposit consolidation: list sweepable, then execute each.
 * Called by background worker or POST /admin/deposit-sweeps/run.
 * Returns swept_count and list of errors (one per failed item).
 */
export async function runDepositSweep(): Promise<RunDepositSweepResult> {
  const errors: string[] = [];
  let sweptCount = 0;

  let sweepEnabled = config.depositSweep?.enabled !== false;
  try {
    const settingsRes = await db.query<{ value: string }>(`SELECT value FROM system_settings WHERE key = 'treasury_settings' LIMIT 1`);
    if (settingsRes.rows.length > 0) {
      const ts = typeof settingsRes.rows[0]!.value === 'string' ? JSON.parse(settingsRes.rows[0]!.value) : settingsRes.rows[0]!.value;
      if (ts.auto_sweep_enabled === false) sweepEnabled = false;
    }
  } catch (_) { /* fallback to env config */ }

  if (!sweepEnabled) {
    logger.info('Deposit sweep run skipped: disabled via config or treasury_settings');
    return { sweptCount: 0, errors: [] };
  }

  logger.info('Deposit sweep run started');
  try {
    const { sweepable: list } = await listSweepableAddresses();
    if (list.length === 0) {
      logger.info('Deposit sweep run: no eligible addresses; returning empty (no error). Check listSweepableAddresses logs for eligibility reasons.', {
        sweptCount: 0,
        errors: [],
      });
      return { sweptCount: 0, errors: [] };
    }
    logger.info('Deposit sweep run: executing', { count: list.length });
    for (const item of list) {
      try {
        const result = await executeOneSweep(item);
        if (result.success) {
          sweptCount += 1;
        } else if (result.error) {
          errors.push(`${item.chain_id}:${item.from_address}: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.chain_id}:${item.from_address}: ${msg}`);
        logger.error('Deposit sweep iteration error', {
          chain_id: item.chain_id,
          from_address: item.from_address,
          error: msg,
        });
      }
    }
    logger.info('Deposit sweep run finished', { sweptCount, error_count: errors.length, errors: errors.slice(0, 10) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    logger.error('Deposit sweep run error', { error: msg });
  }
  return { sweptCount, errors };
}
