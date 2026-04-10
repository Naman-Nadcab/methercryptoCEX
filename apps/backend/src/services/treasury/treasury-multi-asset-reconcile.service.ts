/**
 * Per-token (ERC-20) hot wallet balance vs cached row; chain-specific RPC + contract balanceOf.
 */
import { db } from '../../lib/database.js';
import { logger, securityLog } from '../../lib/logger.js';
import { treasuryTokenMismatchTotal } from '../../lib/prometheus-metrics.js';
import { erc20BalanceQuorum } from '../../lib/evm-quorum-rpc.js';
import { sendOpsAlert } from '../ops-alert.service.js';
import { logTreasuryAudit } from './treasury-audit.service.js';

const TOLERANCE_UNITS = 1n; // 1 base unit slack

export async function runTreasuryTokenReconcileOnce(): Promise<{ checked: number; mismatches: number }> {
  const rows = await db.query<{
    hot_wallet_id: string;
    chain_id: string;
    address: string;
    rpc_url: string;
    rpc_secondary: string | null;
    token_id: string;
    symbol: string;
    contract_address: string;
    decimals: number;
    balance_raw: string | null;
  }>(
    `SELECT hw.id AS hot_wallet_id, hw.chain_id, hw.address,
            COALESCE(c.rpc_url, '') AS rpc_url,
            NULLIF(TRIM(COALESCE(c.rpc_url_secondary, '')), '') AS rpc_secondary,
            t.id AS token_id, t.symbol, t.contract_address, t.decimals,
            htb.balance_raw::text AS balance_raw
     FROM hot_wallets hw
     JOIN chains c ON c.id = hw.chain_id AND c.type = 'evm'
     JOIN tokens t ON t.chain_id = hw.chain_id AND t.is_active = TRUE AND t.is_native = FALSE
       AND t.contract_address IS NOT NULL AND TRIM(t.contract_address) <> ''
     LEFT JOIN hot_wallet_token_balances htb ON htb.hot_wallet_id = hw.id AND htb.token_id = t.id
     WHERE hw.is_active = TRUE AND COALESCE(c.rpc_url, '') <> ''`
  );

  let mismatches = 0;

  for (const row of rows.rows) {
    try {
      const rpcUrls = [row.rpc_url, row.rpc_secondary ?? ''].map((u) => u.trim()).filter(Boolean);
      const minAgree = rpcUrls.length >= 2 ? 2 : 1;
      const onchain = await erc20BalanceQuorum(row.contract_address, row.address, rpcUrls, minAgree);
      const cached = row.balance_raw != null && row.balance_raw !== '' ? BigInt(row.balance_raw.split('.')[0] || '0') : null;

      if (cached === null) {
        await db.query(
          `INSERT INTO hot_wallet_token_balances (hot_wallet_id, token_id, balance_raw, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::numeric, NOW())
           ON CONFLICT (hot_wallet_id, token_id) DO UPDATE SET balance_raw = EXCLUDED.balance_raw, updated_at = NOW()`,
          [row.hot_wallet_id, row.token_id, onchain.toString()]
        );
        continue;
      }

      const diff = onchain > cached ? onchain - cached : cached - onchain;
      if (diff > TOLERANCE_UNITS) {
        mismatches++;
        treasuryTokenMismatchTotal.inc({ chain_id: row.chain_id, symbol: row.symbol });
        securityLog('treasury_token_onchain_mismatch', 'critical', {
          chain_id: row.chain_id,
          symbol: row.symbol,
          token_id: row.token_id,
          address: row.address,
          onchain: onchain.toString(),
          cached: cached.toString(),
        });
        void sendOpsAlert({
          severity: 'critical',
          alertType: 'treasury',
          title: 'Treasury token reconcile mismatch',
          body: `${row.symbol} on ${row.chain_id}: on-chain ${onchain} vs cache ${cached}`,
          dedupeKey: `tok-rec:${row.hot_wallet_id}:${row.token_id}`,
          context: { chain_id: row.chain_id, symbol: row.symbol, token_id: row.token_id },
        });
        await logTreasuryAudit({
          action: 'treasury_token_onchain_mismatch',
          resourceType: 'hot_wallet_token',
          resourceId: row.token_id,
          details: {
            chain_id: row.chain_id,
            diff: diff.toString(),
            symbol: row.symbol,
          },
        });
      } else {
        await db.query(
          `INSERT INTO hot_wallet_token_balances (hot_wallet_id, token_id, balance_raw, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::numeric, NOW())
           ON CONFLICT (hot_wallet_id, token_id) DO UPDATE SET balance_raw = EXCLUDED.balance_raw, updated_at = NOW()`,
          [row.hot_wallet_id, row.token_id, onchain.toString()]
        );
      }
    } catch (e) {
      logger.warn('treasury_token_reconcile: row failed', {
        token: row.symbol,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { checked: rows.rows.length, mismatches };
}

export function startTreasuryTokenReconcileJob(intervalMs: number): NodeJS.Timeout {
  void runTreasuryTokenReconcileOnce().catch((e) =>
    logger.error('treasury_token_reconcile: run failed', { error: e instanceof Error ? e.message : String(e) })
  );
  return setInterval(() => {
    void runTreasuryTokenReconcileOnce().catch((e) =>
      logger.error('treasury_token_reconcile: run failed', { error: e instanceof Error ? e.message : String(e) })
    );
  }, intervalMs);
}
