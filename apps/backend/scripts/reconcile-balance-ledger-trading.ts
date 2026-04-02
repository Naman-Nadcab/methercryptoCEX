/**
 * One-shot: align balance_ledger sums (trading, chain_id='') to user_balances via INSERT only.
 * Uses reference_type = adjustment; does not UPDATE user_balances or DELETE ledger rows.
 *
 * Run: cd apps/backend && npx tsx scripts/reconcile-balance-ledger-trading.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/database.js';
import { Decimal } from '../src/lib/decimal.js';
import { logger } from '../src/lib/logger.js';

const BATCH = 'reconciliation=tier1_phase1_20260401';
const DESC = `account_type=trading;${BATCH}`;

async function main(): Promise<void> {
  const client = await db.getSettlementClient();
  const fixes: string[] = [];
  try {
    await client.query('BEGIN');

    const { rows: mismatches } = await client.query<{
      user_id: string;
      currency_id: string;
      avail_bal: string;
      lock_bal: string;
      ledger_avail: string;
      ledger_lock: string;
    }>(
      `WITH ledger_sums AS (
         SELECT user_id, currency_id,
           COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0) AS avail_sum,
           COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0) AS lock_sum
         FROM balance_ledger
         WHERE description LIKE '%account_type=trading%'
         GROUP BY user_id, currency_id
       )
       SELECT ub.user_id::text, ub.currency_id::text,
         COALESCE(ub.available_balance, 0)::text AS avail_bal,
         COALESCE(ub.locked_balance, 0)::text AS lock_bal,
         COALESCE(ls.avail_sum::text, '0') AS ledger_avail,
         COALESCE(ls.lock_sum::text, '0') AS ledger_lock
       FROM user_balances ub
       LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
       WHERE ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND (
           COALESCE(ls.avail_sum, 0) != COALESCE(ub.available_balance, 0)::numeric
           OR COALESCE(ls.lock_sum, 0) != COALESCE(ub.locked_balance, 0)::numeric
         )`
    );

    logger.info('reconcile_balance_ledger_trading: mismatches', { count: mismatches.length });

    for (const row of mismatches) {
      const deltaAvail = new Decimal(row.avail_bal).minus(row.ledger_avail);
      const deltaLock = new Decimal(row.lock_bal).minus(row.ledger_lock);

      const insertAdj = async (
        balanceType: 'available' | 'locked',
        delta: InstanceType<typeof Decimal>,
        ledgerSumBefore: string
      ): Promise<void> => {
        if (delta.isZero()) return;
        const before = new Decimal(ledgerSumBefore);
        const after = before.plus(delta);
        const credit = delta.gt(0) ? delta.toString() : '0';
        const debit = delta.lt(0) ? delta.neg().toString() : '0';
        const refId = randomUUID();

        await client.query(
          `INSERT INTO balance_ledger (
             user_id, currency_id, reference_type, reference_id,
             debit, credit, balance_before, balance_after, balance_type, description, created_at
           ) VALUES (
             $1::uuid, $2::uuid, 'adjustment'::ledger_reference_type, $3::uuid,
             $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::balance_type, $9, NOW()
           )`,
          [
            row.user_id,
            row.currency_id,
            refId,
            debit,
            credit,
            before.toString(),
            after.toString(),
            balanceType,
            DESC,
          ]
        );
        fixes.push(
          `${row.user_id}/${row.currency_id} ${balanceType} delta=${delta.toString()} before=${before.toString()} after=${after.toString()} debit=${debit} credit=${credit} ref=${refId}`
        );
      };

      await insertAdj('available', deltaAvail, row.ledger_avail);
      await insertAdj('locked', deltaLock, row.ledger_lock);
    }

    const { rows: verify } = await client.query<{ n: string }>(
      `WITH ledger_sums AS (
         SELECT user_id, currency_id,
           COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0) AS avail_sum,
           COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0) AS lock_sum
         FROM balance_ledger
         WHERE description LIKE '%account_type=trading%'
         GROUP BY user_id, currency_id
       )
       SELECT COUNT(*)::text AS n
       FROM user_balances ub
       LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
       WHERE ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND (
           COALESCE(ls.avail_sum, 0) != COALESCE(ub.available_balance, 0)::numeric
           OR COALESCE(ls.lock_sum, 0) != COALESCE(ub.locked_balance, 0)::numeric
         )`
    );

    if (!verify?.[0] || verify[0]!.n !== '0') {
      logger.error('reconcile_balance_ledger_trading: still mismatched after fix', {
        remaining: verify?.[0]?.n,
      });
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query('COMMIT');
    logger.info('reconcile_balance_ledger_trading: committed', { fixes: fixes.length });
    for (const f of fixes) logger.info('  fix', { line: f });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('reconcile_balance_ledger_trading failed', {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    throw e;
  } finally {
    client.release();
    await db.close();
  }
}

main().catch(() => process.exit(1));
