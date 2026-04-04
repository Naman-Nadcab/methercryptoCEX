/**
 * Spot trading integrity check: verifies balance_ledger sums match user_balances (trading account).
 * Runs periodically. Trips the circuit ONLY for large mismatches exceeding the threshold.
 * Small precision drift (from accumulated settlement rounding) is logged but does not halt trading.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { triggerCircuitIfViolation } from './settlement/settlement-circuit.js';
import { CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';

const ACCOUNT_TYPE = 'trading';

const CIRCUIT_TRIP_ABS_THRESHOLD = new Decimal(process.env.INTEGRITY_CIRCUIT_ABS_THRESHOLD || '1000');

export async function runSpotIntegrityCheck(): Promise<{ ok: boolean; mismatches: number }> {
  const client = await db.getSettlementClient();
  let mismatches = 0;
  let criticalMismatches = 0;
  try {
    const diffRows = await client.query<{
      user_id: string;
      currency_id: string;
      avail_bal: string;
      lock_bal: string;
      ledger_avail: string;
      ledger_lock: string;
    }>(
      `WITH ledger_sums AS (
         SELECT user_id, currency_id,
           COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS avail_sum,
           COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS lock_sum
         FROM balance_ledger
         WHERE description LIKE '%account_type=trading%'
         GROUP BY user_id, currency_id
       )
       SELECT ub.user_id, ub.currency_id,
         COALESCE(ub.available_balance, 0)::text AS avail_bal,
         COALESCE(ub.locked_balance, 0)::text AS lock_bal,
         COALESCE(ls.avail_sum, '0') AS ledger_avail,
         COALESCE(ls.lock_sum, '0') AS ledger_lock
       FROM user_balances ub
       LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
       WHERE ub.account_type = $1 AND COALESCE(ub.chain_id, '') = $2`,
      [ACCOUNT_TYPE, CHAIN_ID_GLOBAL]
    );

    for (const row of diffRows.rows) {
      const availBal = new Decimal(row.avail_bal ?? '0');
      const lockBal = new Decimal(row.lock_bal ?? '0');
      const availLedger = new Decimal(row.ledger_avail ?? '0');
      const lockLedger = new Decimal(row.ledger_lock ?? '0');

      const availMatch = availLedger.toFixed(8) === availBal.toFixed(8);
      const lockMatch = lockLedger.toFixed(8) === lockBal.toFixed(8);

      if (!availMatch || !lockMatch) {
        mismatches++;
        const availDrift = availBal.minus(availLedger).abs();
        const lockDrift = lockBal.minus(lockLedger).abs();
        const maxDrift = Decimal.max(availDrift, lockDrift);

        if (maxDrift.gte(CIRCUIT_TRIP_ABS_THRESHOLD)) {
          criticalMismatches++;
          triggerCircuitIfViolation('GLOBAL_BALANCE_INVARIANT_VIOLATION');
          logger.error('SPOT_INTEGRITY_CHECK_CRITICAL', {
            message: 'Large balance/ledger mismatch exceeds circuit threshold',
            user_id: row.user_id,
            currency_id: row.currency_id,
            user_balances_available: availBal.toString(),
            ledger_available_sum: availLedger.toString(),
            drift_available: availDrift.toString(),
            drift_locked: lockDrift.toString(),
            threshold: CIRCUIT_TRIP_ABS_THRESHOLD.toString(),
          });
        } else {
          logger.warn('SPOT_INTEGRITY_CHECK_DRIFT', {
            message: 'Small balance/ledger drift (below circuit threshold)',
            user_id: row.user_id,
            currency_id: row.currency_id,
            drift_available: availDrift.toString(),
            drift_locked: lockDrift.toString(),
            threshold: CIRCUIT_TRIP_ABS_THRESHOLD.toString(),
          });
        }
      }
    }
    return { ok: criticalMismatches === 0, mismatches };
  } finally {
    client.release();
  }
}
