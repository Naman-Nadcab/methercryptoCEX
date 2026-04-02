/**
 * Read-only: trading balance_ledger vs user_balances + settlement_ledger_entries prev_hash continuity.
 * Run: cd apps/backend && npx tsx scripts/verify-settlement-ledger-chain.ts
 */
import 'dotenv/config';
import { db } from '../src/lib/database.js';

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
  console.log('trading_balance_mismatch_count', mismatch.rows[0]?.n ?? '?');

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
  const brokenCount = chain.rows[0]?.broken ?? '?';
  console.log('settlement_ledger_chain_breaks', brokenCount);

  if (brokenCount !== '0') {
    const detail = await pool.query<{
      id: string;
      settlement_event_id: string;
      prev_hash: string | null;
      expected_prev: string | null;
      entry_hash: string | null;
    }>(
      `WITH ordered AS (
         SELECT id, settlement_event_id, prev_hash, entry_hash,
           LAG(entry_hash) OVER (ORDER BY id) AS expected_prev
         FROM settlement_ledger_entries
       )
       SELECT id::text, settlement_event_id::text, prev_hash, expected_prev, entry_hash
       FROM ordered
       WHERE id > (SELECT MIN(id) FROM settlement_ledger_entries)
         AND (prev_hash IS DISTINCT FROM expected_prev)
       ORDER BY id`
    );
    console.log('settlement_ledger_chain_break_rows', JSON.stringify(detail.rows, null, 2));
  }

  const first = await pool.query<{ id: string; prev_hash: string | null; entry_hash: string | null }>(
    'SELECT id::text, prev_hash, entry_hash FROM settlement_ledger_entries ORDER BY id ASC LIMIT 1'
  );
  console.log('settlement_ledger_first_row', first.rows[0] ?? null);

  const nullHash = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM settlement_ledger_entries WHERE entry_hash IS NULL OR entry_hash = ''`
  );
  console.log('settlement_ledger_null_or_empty_entry_hash', nullHash.rows[0]?.n ?? '?');

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
