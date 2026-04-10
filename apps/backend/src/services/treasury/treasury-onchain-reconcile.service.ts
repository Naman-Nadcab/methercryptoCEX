/**
 * Compare native hot-wallet on-chain balance vs balance_cache; on drift set pause flag + metric.
 */
import { db } from '../../lib/database.js';
import { logger, securityLog } from '../../lib/logger.js';
import { treasuryOnchainMismatchTotal } from '../../lib/prometheus-metrics.js';
import { evmNativeBalanceQuorum } from '../../lib/evm-quorum-rpc.js';
import { logTreasuryAudit } from './treasury-audit.service.js';
import { sendOpsAlert } from '../ops-alert.service.js';

const TOLERANCE_WEI = 10n ** 15n;

export async function runTreasuryHotWalletOnchainReconcileOnce(): Promise<{ checked: number; mismatches: number }> {
  const rows = await db.query<{
    chain_id: string;
    address: string;
    balance_cache: string;
    rpc_url: string;
    rpc_secondary: string | null;
  }>(
    `SELECT hw.chain_id, hw.address, hw.balance_cache::text,
            COALESCE(c.rpc_url, '') AS rpc_url,
            NULLIF(TRIM(COALESCE(c.rpc_url_secondary, '')), '') AS rpc_secondary
     FROM hot_wallets hw
     LEFT JOIN chains c ON c.id = hw.chain_id
     WHERE hw.is_active = TRUE AND COALESCE(c.rpc_url, '') <> ''`
  );
  let mismatches = 0;
  for (const row of rows.rows) {
    try {
      const rpcUrls = [row.rpc_url, row.rpc_secondary ?? ''].map((u) => u.trim()).filter(Boolean);
      const minAgree = rpcUrls.length >= 2 ? 2 : 1;
      const onchain = await evmNativeBalanceQuorum(row.address, rpcUrls, minAgree);
      const cached = BigInt(row.balance_cache.split('.')[0] || row.balance_cache || '0');
      const diff = onchain > cached ? onchain - cached : cached - onchain;
      if (diff > TOLERANCE_WEI) {
        mismatches++;
        treasuryOnchainMismatchTotal.inc({ chain_id: row.chain_id });
        securityLog('treasury_hot_onchain_mismatch', 'critical', {
          chain_id: row.chain_id,
          address: row.address,
          onchain_wei: onchain.toString(),
          cache_wei: cached.toString(),
        });
        await logTreasuryAudit({
          action: 'treasury_onchain_mismatch',
          resourceType: 'hot_wallet',
          resourceId: row.chain_id,
          details: {
            chain_id: row.chain_id,
            diff_wei: diff.toString(),
          },
        });
        await db.query(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ('treasury_onchain_mismatch_pause', to_jsonb(true), NOW())
           ON CONFLICT (key) DO UPDATE SET value = to_jsonb(true), updated_at = NOW()`
        );
        void sendOpsAlert({
          severity: 'critical',
          alertType: 'treasury',
          title: 'Treasury native on-chain mismatch',
          body: `chain=${row.chain_id} diff_wei=${diff.toString()}`,
          dedupeKey: `native-rec:${row.chain_id}:${row.address}`,
          context: { chain_id: row.chain_id, address: row.address },
        });
      }
    } catch (e) {
      logger.warn('treasury_onchain_reconcile: chain failed', {
        chain_id: row.chain_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { checked: rows.rows.length, mismatches };
}

export function startTreasuryOnchainReconcileJob(intervalMs: number): NodeJS.Timeout {
  void runTreasuryHotWalletOnchainReconcileOnce().catch((e) =>
    logger.error('treasury_onchain_reconcile: run failed', { error: e instanceof Error ? e.message : String(e) })
  );
  return setInterval(() => {
    void runTreasuryHotWalletOnchainReconcileOnce().catch((e) =>
      logger.error('treasury_onchain_reconcile: run failed', { error: e instanceof Error ? e.message : String(e) })
    );
  }, intervalMs);
}
