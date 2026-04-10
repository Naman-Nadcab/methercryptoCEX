/**
 * Hot wallet below min threshold → alert (cold refill is manual / ops).
 */
import { db } from '../../lib/database.js';
import { logger, securityLog } from '../../lib/logger.js';
import { logTreasuryAudit } from './treasury-audit.service.js';

export async function runTreasuryHotWalletMonitorOnce(): Promise<{ low: number }> {
  const rows = await db.query<{
    chain_id: string;
    address: string;
    balance_cache: string;
    min_hot_balance: string;
  }>(
    `SELECT chain_id, address, balance_cache::text,
            COALESCE(min_hot_balance::text, '0') AS min_hot_balance
     FROM hot_wallets WHERE is_active = TRUE`
  );
  let low = 0;
  for (const r of rows.rows) {
    try {
      const bal = BigInt(r.balance_cache.split('.')[0] || '0');
      const min = BigInt(r.min_hot_balance.split('.')[0] || '0');
      if (min > 0n && bal < min) {
        low++;
        securityLog('treasury_hot_below_min', 'high', { chain_id: r.chain_id, balance_wei: bal.toString(), min_wei: min.toString() });
        await logTreasuryAudit({
          action: 'treasury_hot_below_min_threshold',
          resourceType: 'hot_wallet',
          resourceId: r.chain_id,
          details: { chain_id: r.chain_id, balance_wei: bal.toString(), min_wei: min.toString() },
        });
      }
    } catch {
      /* ignore row */
    }
  }
  if (low > 0) {
    logger.warn('treasury_hot_monitor: wallets below configured min', { count: low });
  }
  return { low };
}

export function startTreasuryHotWalletMonitorJob(intervalMs: number): NodeJS.Timeout {
  void runTreasuryHotWalletMonitorOnce().catch((e) =>
    logger.error('treasury_hot_monitor: run failed', { error: e instanceof Error ? e.message : String(e) })
  );
  return setInterval(() => {
    void runTreasuryHotWalletMonitorOnce().catch((e) =>
      logger.error('treasury_hot_monitor: run failed', { error: e instanceof Error ? e.message : String(e) })
    );
  }, intervalMs);
}
