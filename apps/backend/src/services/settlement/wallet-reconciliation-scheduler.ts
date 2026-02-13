/**
 * CRITICAL HARDENING: Deterministic, crash-safe wallet reconciliation scheduling.
 * PHASE-16: balance_cache is NOT authoritative. We use live RPC balance for drift detection; on RPC failure we skip (fail closed).
 * - Scheduled automatically; multi-instance safe (Redis lock).
 * - Fail closed on RPC/Redis/DB errors; no financial mutation; does not block settlement loop.
 */
import { Decimal } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { getLiveBalanceReadOnly } from '../hot-wallet.service.js';
import { recordWalletCacheDivergence } from '../exchange-monitoring.service.js';
import {
  runWalletReconciliation,
  defaultWalletOutflowDebitProvider,
  type WalletBalanceProvider,
} from './wallet-reconciliation.service.js';

const LOCK_KEY = 'wallet_reconciliation:run';
const LOCK_TTL_MS = 4 * 60 * 1000; // 4 min; runner must finish before this
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000; // 5 min

let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * One reconciliation cycle: acquire lock, load hot wallets + chain symbols, run reconciliation per chain, release lock.
 * No financial mutation; runWalletReconciliation only inserts snapshots and may trigger circuit (no balance/ledger write).
 * On any error: log, release lock, return (fail closed).
 */
async function runReconciliationCycle(): Promise<void> {
  const lockValue = await redis.acquireLock(LOCK_KEY, LOCK_TTL_MS, 1, 0);
  if (lockValue == null) {
    return; // another instance holds the lock
  }
  try {
    const hasChains = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chains'`
    );
    const hasHotWallets = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hot_wallets'`
    );
    if (hasChains.rows.length === 0 || hasHotWallets.rows.length === 0) {
      return;
    }
    const hasNativeCurrency = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chains' AND column_name = 'native_currency'`
    );
    const chainRows = await db.query<{ id: string; native_currency: string }>(
      hasNativeCurrency.rows.length > 0
        ? `SELECT id, native_currency FROM chains WHERE is_active = TRUE`
        : `SELECT id, id AS native_currency FROM chains WHERE is_active = TRUE`
    );
    const chainToAsset = new Map<string, string>(
      (chainRows.rows || []).map((r) => [r.id, (r as { native_currency?: string }).native_currency ?? r.id])
    );
    const hotRows = await db.query<{ chain_id: string; balance_cache: string | null }>(
      `SELECT chain_id, balance_cache::text AS balance_cache FROM hot_wallets WHERE is_active = TRUE`
    );
    for (const h of hotRows.rows || []) {
      const chainId = h.chain_id;
      const asset = chainToAsset.get(chainId) ?? chainId;
      const balanceCacheStr = (h.balance_cache != null && String(h.balance_cache).trim() !== ''
        ? String(h.balance_cache).trim()
        : '0');
      const live = await getLiveBalanceReadOnly(chainId);
      if (live == null) {
        logger.warn('Wallet reconciliation skip: live RPC balance unavailable (fail closed)', { chain_id: chainId, asset });
        continue;
      }
      const liveBalanceWei = live.balanceWei;
      const cacheDec = new Decimal(balanceCacheStr);
      const liveDec = new Decimal(liveBalanceWei);
      if (!cacheDec.eq(liveDec)) {
        recordWalletCacheDivergence({
          chainId,
          asset,
          cacheBalance: balanceCacheStr,
          liveBalance: liveBalanceWei,
        });
        logger.warn('Wallet cache divergence: RPC balance differs from balance_cache', {
          chain_id: chainId,
          asset,
          cache: balanceCacheStr,
          live: liveBalanceWei,
        });
      }
      const onchainBalance = liveDec;
      const getOnchainBalance: WalletBalanceProvider = async (a: string, wt: string) =>
        a === asset && wt === 'hot' ? onchainBalance : new Decimal(0);
      try {
        await runWalletReconciliation({
          asset,
          wallet_type: 'hot',
          chainIdForSweeps: chainId,
          getOnchainBalance,
          getWalletOutflowDebit: defaultWalletOutflowDebitProvider,
        });
      } catch (err) {
        logger.error('Wallet reconciliation run failed (fail closed)', {
          asset,
          chain_id: chainId,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
  } catch (err) {
    logger.error('Wallet reconciliation cycle failed (fail closed)', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    try {
      await redis.releaseLock(LOCK_KEY, lockValue);
    } catch (e) {
      logger.warn('Wallet reconciliation lock release failed (lock will expire by TTL)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export function startWalletReconciliationScheduler(): void {
  if (schedulerIntervalId != null) return;
  schedulerIntervalId = setInterval(() => {
    runReconciliationCycle().catch((err) => {
      logger.error('Wallet reconciliation scheduler error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, RECONCILIATION_INTERVAL_MS);
  logger.info('Wallet reconciliation scheduler started', { intervalMs: RECONCILIATION_INTERVAL_MS });
}

export function stopWalletReconciliationScheduler(): void {
  if (schedulerIntervalId != null) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    logger.info('Wallet reconciliation scheduler stopped');
  }
}
