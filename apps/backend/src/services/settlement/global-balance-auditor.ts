/**
 * Periodic global balance auditor (corruption detection only).
 * Recomputes expected totals from settlement_ledger_entries and compares with user_balances (trading).
 * Does NOT auto-repair; logs CRITICAL with diagnostic metadata on mismatch.
 */
import { Decimal } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { triggerCircuitIfViolation } from './settlement-circuit.js';
import { recordSettlementEvent } from '../exchange-monitoring.service.js';
import { CHAIN_ID_GLOBAL } from '../../lib/user-balance-helper.js';

const SETTLEMENT_ACCOUNT_TYPE = 'trading';

export async function runGlobalBalanceAudit(): Promise<{ ok: boolean; mismatches: number }> {
  const client = await db.getSettlementClient();
  let mismatches = 0;
  try {
    const ledgerRows = await client.query<{ user_id: string; asset: string; sum: string }>(
      `SELECT user_id, asset, COALESCE(SUM(delta), 0)::text AS sum
       FROM settlement_ledger_entries GROUP BY user_id, asset`
    );
    const assetToCurrency = new Map<string, string>();
    for (const row of ledgerRows.rows) {
      if (!assetToCurrency.has(row.asset)) {
        const curr = await client.query<{ id: string }>(
          `SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM($1)) LIMIT 1`,
          [row.asset]
        );
        assetToCurrency.set(row.asset, curr.rows[0]?.id ?? '');
      }
    }
    for (const row of ledgerRows.rows) {
      const currencyId = assetToCurrency.get(row.asset);
      if (!currencyId) continue;
      const ledgerTotal = new Decimal(row.sum ?? '0');
      const balResult = await client.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4`,
        [row.user_id, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
      );
      const available = new Decimal(balResult.rows[0]?.available_balance ?? '0');
      const locked = new Decimal(balResult.rows[0]?.locked_balance ?? '0');
      const balanceTotal = available.plus(locked);
      if (!ledgerTotal.eq(balanceTotal)) {
        mismatches++;
        triggerCircuitIfViolation('GLOBAL_BALANCE_INVARIANT_VIOLATION');
        recordSettlementEvent({
          type: 'balance_ledger_divergence',
          userId: row.user_id,
          asset: row.asset,
          balancesTotal: balanceTotal.toString(),
          ledgerSum: ledgerTotal.toString(),
        });
        logger.error('GLOBAL_BALANCE_AUDIT_CRITICAL', {
          message: 'user_balances does not match settlement ledger authority (corruption detection)',
          user_id: row.user_id,
          asset: row.asset,
          currency_id: currencyId,
          user_balances_available: available.toString(),
          user_balances_locked: locked.toString(),
          user_balances_total: balanceTotal.toString(),
          ledger_sum: ledgerTotal.toString(),
          diagnostic: 'Do NOT auto-repair; investigate ledger and balance history.',
        });
      }
    }
    return { ok: mismatches === 0, mismatches };
  } finally {
    client.release();
  }
}
