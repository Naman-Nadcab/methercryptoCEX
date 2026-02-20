/**
 * Auto-sweep: move excess hot wallet balance to cold wallet.
 * - Only when balance_cache > min_hot_balance and cold_wallet_address is set.
 * - Delayed by run interval (e.g. 60s); one sweep per chain per run.
 * - Logged and replay-safe (we refresh balance, then send one tx per chain).
 */

import { JsonRpcProvider } from 'ethers';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { logHotWalletAudit } from '../lib/hot-wallet-audit.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';
import { getSignerForChain, updateBalanceCache } from './hot-wallet.service.js';

const ACTOR_SYSTEM = 'hot-wallet-sweep';
const GAS_RESERVE_WEI = 21000n * 50n * 10n ** 9n;
const HOT_SWEEP_LOCK_TTL_MS = 300_000;

export async function runAutoSweep(): Promise<void> {
  const rows = await db.query<{
    chain_id: string;
    address: string;
    balance_cache: string;
    min_hot_balance: string;
    cold_wallet_address: string;
  }>(
    `SELECT chain_id, address, balance_cache::text as balance_cache,
            COALESCE(min_hot_balance::text, '0') as min_hot_balance, cold_wallet_address
     FROM hot_wallets
     WHERE is_active = TRUE AND cold_wallet_address IS NOT NULL AND cold_wallet_address != ''`
  );
  for (const hw of rows.rows) {
    let lockValue: string | null = null;
    try {
      lockValue = await redis.acquireLock(`hot_sweep:${hw.chain_id}`, HOT_SWEEP_LOCK_TTL_MS);
      if (!lockValue) continue;
      await sweepOneChain(hw.chain_id, hw.address, hw.balance_cache, hw.min_hot_balance, hw.cold_wallet_address);
    } catch (err) {
      logger.error('Sweep failed for chain', {
        chainId: hw.chain_id,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    } finally {
      if (lockValue) redis.releaseLock(`hot_sweep:${hw.chain_id}`, lockValue).catch(() => {});
    }
  }
}

async function sweepOneChain(
  chainId: string,
  _address: string,
  balanceCache: string,
  minHotBalance: string,
  coldWalletAddress: string
): Promise<void> {
  const chainRow = await db.query<{ rpc_url: string }>('SELECT rpc_url FROM chains WHERE id = $1', [chainId]);
  if (chainRow.rows.length === 0) return;
  const provider = new JsonRpcProvider(chainRow.rows[0]!.rpc_url);
  const walletRow = await db.query<{ address: string }>(
    'SELECT address FROM hot_wallets WHERE chain_id = $1 AND is_active = TRUE',
    [chainId]
  );
  if (walletRow.rows.length === 0) return;
  const currentBalance = await provider.getBalance(walletRow.rows[0]!.address);
  const minWei = BigInt(minHotBalance);
  const sweepAmount = currentBalance - minWei - GAS_RESERVE_WEI;
  if (sweepAmount <= 0n) return;

  const signer = await getSignerForChain(chainId, ACTOR_SYSTEM, 'sweep');
  if (!signer) return;

  let signedTx: string;
  try {
    signedTx = await signer.signTransaction({
      to: coldWalletAddress,
      value: sweepAmount,
      data: '0x',
      gasLimit: 21000n,
    });
  } catch (err) {
    logger.error('Sweep sign failed', { chainId, error: err instanceof Error ? err.message : 'Unknown' });
    return;
  }

  await logHotWalletAudit({
    actorId: ACTOR_SYSTEM,
    actorType: 'system',
    action: 'hot_wallet_sweep_scheduled',
    resourceType: 'hot_wallet',
    resourceId: chainId,
    details: { chain_id: chainId, sweep_wei: sweepAmount.toString(), to: coldWalletAddress },
  });

  let txHash: string;
  try {
    const tx = await provider.broadcastTransaction(signedTx);
    txHash = tx.hash;
  } catch (err) {
    logger.error('Sweep broadcast failed', { chainId, error: err instanceof Error ? err.message : 'Unknown' });
    await logHotWalletAudit({
      actorId: ACTOR_SYSTEM,
      actorType: 'system',
      action: 'withdrawal_signing_failed',
      resourceType: 'hot_wallet',
      resourceId: chainId,
      details: { chain_id: chainId, context: 'sweep', error: err instanceof Error ? err.message : 'Unknown' },
    });
    return;
  }

  await db.query(
    `UPDATE hot_wallets SET last_sweep_tx_hash = $1, last_sweep_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2`,
    [txHash, chainId]
  );
  const newBalance = currentBalance - sweepAmount;
  await updateBalanceCache(chainId, newBalance.toString());
  await logHotWalletAudit({
    actorId: ACTOR_SYSTEM,
    actorType: 'system',
    action: 'hot_wallet_sweep_completed',
    resourceType: 'hot_wallet',
    resourceId: chainId,
    details: { chain_id: chainId, tx_hash: txHash, sweep_wei: sweepAmount.toString() },
  });

  await logWithdrawalLifecycle('hot_wallet_sweep', {
    withdrawal_id: null,
    user_id: null,
    admin_id: null,
    token_id: null,
    chain_id: chainId,
    amount: sweepAmount.toString(),
    ip: null,
    user_agent: null,
  });

  logger.info('Hot wallet sweep completed', { chainId, txHash, sweepWei: sweepAmount.toString() });
}
