import 'dotenv/config';
import { db } from '../src/lib/database.js';

async function main(): Promise<void> {
  const p = db.getPool();
  const r = await p.query(
    `WITH ledger_sums AS (
       SELECT user_id, currency_id,
         COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0) AS avail_sum,
         COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0) AS lock_sum
       FROM balance_ledger
       WHERE description LIKE '%account_type=trading%'
       GROUP BY user_id, currency_id
     )
     SELECT ub.user_id::text, ub.currency_id::text,
       ub.available_balance::text, ub.locked_balance::text,
       COALESCE(ls.avail_sum::text,'0') AS ledger_avail, COALESCE(ls.lock_sum::text,'0') AS ledger_locked
     FROM user_balances ub
     LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
     WHERE ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
       AND (COALESCE(ls.avail_sum, 0) != COALESCE(ub.available_balance, 0)::numeric
         OR COALESCE(ls.lock_sum, 0) != COALESCE(ub.locked_balance, 0)::numeric)
     ORDER BY ub.user_id, ub.currency_id`
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
