/**
 * One-time repair: credit completed deposits into user_balances (funding) for a user.
 * Use when balance_applied_at was set but user_balances stayed 0 (e.g. UPDATE matched 0 rows).
 * Run: cd apps/backend && npx tsx scripts/repair-deposit-balance.ts nmnsingh02@gmail.com
 */

import { db } from '../src/lib/database.js';
import { ensureUserBalanceRow, CHAIN_ID_GLOBAL } from '../src/lib/user-balance-helper.js';

const email = process.argv[2] || 'nmnsingh02@gmail.com';

async function main() {
  console.log('\n=== Re-credit deposits to user_balances for', email, '===\n');

  const userRes = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
    [email]
  );
  if (userRes.rows.length === 0) {
    console.log('User not found.');
    process.exit(1);
  }
  const userId = userRes.rows[0].id;

  const deposits = await db.query<{ id: string; currency_id: string; amount: string }>(
    `SELECT id, currency_id, amount::text as amount FROM deposits
     WHERE user_id = $1 AND status = 'completed' AND credited_at IS NOT NULL AND (amount IS NULL OR amount::numeric > 0)`,
    [userId]
  );
  if (deposits.rows.length === 0) {
    console.log('No completed deposits to apply.');
    process.exit(0);
  }

  const currencyIds = [...new Set(deposits.rows.map((r) => r.currency_id))];
  const curCheck = await db.query<{ id: string }>(`SELECT id FROM currencies WHERE id = ANY($1::uuid[])`, [currencyIds]);
  const validIds = new Set(curCheck.rows.map((r) => r.id));
  const toApply = deposits.rows.filter((r) => validIds.has(r.currency_id));

  const byCurrency = new Map<string, { total: number; ids: string[] }>();
  for (const row of toApply) {
    const amt = parseFloat(row.amount || '0');
    const cur = byCurrency.get(row.currency_id) ?? { total: 0, ids: [] };
    cur.total += amt;
    cur.ids.push(row.id);
    byCurrency.set(row.currency_id, cur);
  }

  await db.transaction(async (client) => {
    for (const [currencyId, { total, ids }] of byCurrency) {
      if (total <= 0) continue;
      await ensureUserBalanceRow(userId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
      const upd = await client.query(
        `UPDATE user_balances SET available_balance = available_balance + $1::numeric, total_deposited = COALESCE(total_deposited, 0) + $1::numeric, updated_at = NOW()
         WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'`,
        [total.toString(), userId, currencyId, CHAIN_ID_GLOBAL]
      );
      if ((upd.rowCount ?? 0) < 1) {
        console.warn('UPDATE user_balances affected 0 rows for currency_id', currencyId, '- skipping balance_applied_at');
      } else {
        await client.query(`UPDATE deposits SET balance_applied_at = NOW() WHERE id = ANY($1::uuid[])`, [ids]);
        console.log('Credited', total, 'for currency', currencyId, 'deposit ids', ids.length);
      }
    }
  });

  console.log('Done. User funding balance should now show the deposited amounts.');
  await db.getPool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
