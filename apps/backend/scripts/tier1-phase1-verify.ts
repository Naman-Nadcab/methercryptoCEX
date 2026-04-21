/**
 * Tier 1 Phase 1 gate: trading balance reconciliation + settlement ledger chain.
 * Exit 1 if trading_balance_mismatch_count != 0 or settlement chain breaks.
 *
 * Optional: TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT=true → fail if settlement_events pending > 0.
 *
 * Run: cd apps/backend && npm run tier1:phase1-verify
 */
import 'dotenv/config';
import { db } from '../src/lib/database.js';
import { assertZeroPendingSettlement } from './tier1-pending-settlement-gate.js';

async function main(): Promise<void> {
  const pool = db.getPool();

  const mismatch = await pool.query<{ n: string }>(
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
  const mc = mismatch.rows[0]?.n ?? '?';
  console.log('trading_balance_mismatch_count', mc);

  if (mc !== '0' && mc !== '?') {
    const sample = await pool.query<{
      user_id: string;
      currency_id: string;
      ub_avail: string;
      ub_lock: string;
      ledger_avail: string | null;
      ledger_lock: string | null;
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
         ub.available_balance::text AS ub_avail, ub.locked_balance::text AS ub_lock,
         ls.avail_sum::text AS ledger_avail, ls.lock_sum::text AS ledger_lock
       FROM user_balances ub
       LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
       WHERE ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND (
           COALESCE(ls.avail_sum, 0) != COALESCE(ub.available_balance, 0)::numeric
           OR COALESCE(ls.lock_sum, 0) != COALESCE(ub.locked_balance, 0)::numeric
         )
       LIMIT 25`
    );
    console.error('--- trading vs balance_ledger mismatch sample (up to 25 rows) ---');
    for (const r of sample.rows) {
      console.error(
        JSON.stringify({
          user_id: r.user_id,
          currency_id: r.currency_id,
          user_balances_available: r.ub_avail,
          user_balances_locked: r.ub_lock,
          ledger_available_sum: r.ledger_avail,
          ledger_locked_sum: r.ledger_lock,
        })
      );
    }
    console.error('--- fix: reconcile trading ledger vs user_balances (spot settlement / admin tools) ---');
  }

  const chain = await pool.query<{ broken: string }>(
    `WITH ordered AS (
       SELECT id, prev_hash, entry_hash,
         LAG(entry_hash) OVER (ORDER BY id) AS expected_prev
       FROM settlement_ledger_entries
     )
     SELECT COUNT(*)::text AS broken FROM ordered
     WHERE id > (SELECT MIN(id) FROM settlement_ledger_entries)
       AND (prev_hash IS DISTINCT FROM expected_prev)`
  );
  const br = chain.rows[0]?.broken ?? '?';
  console.log('settlement_ledger_chain_breaks', br);

  const pending = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM settlement_events WHERE LOWER(TRIM(status::text)) = 'pending'`
  );
  const pend = pending.rows[0]?.n ?? '?';
  console.log('settlement_events_pending', pend);

  await db.close();

  if (mc !== '0' || br !== '0') {
    console.error('TIER1_PHASE1_VERIFY_FAIL');
    process.exit(1);
  }
  assertZeroPendingSettlement(pend, '[phase1]');
  console.log('TIER1_PHASE1_VERIFY_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
