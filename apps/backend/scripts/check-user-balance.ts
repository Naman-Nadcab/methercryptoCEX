/**
 * Diagnose why balance is not showing for a user (e.g. nmnsingh02@gmail.com).
 * Run: cd apps/backend && npx tsx scripts/check-user-balance.ts nmnsingh02@gmail.com
 *
 * Explains:
 * - Two tables: "balances" (legacy, token_id) vs "user_balances" (current, currency_id). App uses ONLY user_balances.
 * - Whether user has deposits and if they were credited to user_balances.
 */

import { db } from '../src/lib/database.js';

const email = process.argv[2] || 'nmnsingh02@gmail.com';

async function main() {
  console.log('\n=== Balance diagnostic for', email, '===\n');

  const userRes = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
    [email]
  );
  if (userRes.rows.length === 0) {
    console.log('User not found.');
    process.exit(1);
  }
  const userId = userRes.rows[0].id;
  console.log('User id:', userId);

  console.log('\n--- 1) Two balance tables (architecture) ---');
  const tables = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('balances', 'user_balances') ORDER BY tablename`
  );
  console.log('Tables present:', tables.rows.map((r) => r.tablename).join(', '));
  console.log('→ App uses ONLY "user_balances" (currency_id, chain_id, account_type). Legacy "balances" table is dropped by migration.\n');

  console.log('--- 2) Deposits for this user ---');
  const deposits = await db.query<{
    id: string;
    currency_id: string;
    amount: string;
    status: string;
    credited_at: string | null;
    balance_applied_at: string | null;
    created_at: string;
  }>(
    `SELECT id, currency_id, amount::text as amount, status, credited_at::text, balance_applied_at::text, created_at::text
     FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [userId]
  );
  if (deposits.rows.length === 0) {
    console.log('No deposits found.');
  } else {
    console.log('Count:', deposits.rows.length);
    deposits.rows.forEach((d) => {
      console.log(
        `  ${d.id} | currency_id=${d.currency_id} | amount=${d.amount} | status=${d.status} | credited_at=${d.credited_at ?? 'NULL'} | balance_applied_at=${d.balance_applied_at ?? 'NULL'}`
      );
    });
  }

  console.log('\n--- 3) Currencies (do deposit currency_ids exist here?) ---');
  const currencyIds = [...new Set(deposits.rows.map((d) => d.currency_id))];
  if (currencyIds.length > 0) {
    const curRes = await db.query<{ id: string; symbol: string }>(
      `SELECT id, symbol FROM currencies WHERE id = ANY($1::uuid[])`,
      [currencyIds]
    );
    const inCurrencies = new Set(curRes.rows.map((r) => r.id));
    curRes.rows.forEach((r) => console.log(`  ${r.id} -> ${r.symbol}`));
    const missing = currencyIds.filter((id) => !inCurrencies.has(id));
    if (missing.length > 0) {
      console.log('  ⚠ Deposit currency_id NOT in currencies (balance cannot be credited):', missing);
    }
  }

  console.log('\n--- 4) user_balances for this user ---');
  const ub = await db.query<{
    currency_id: string;
    symbol: string;
    account_type: string;
    chain_id: string;
    available_balance: string;
    locked_balance: string;
  }>(
    `SELECT ub.currency_id, COALESCE(c.symbol, '') as symbol, ub.account_type::text, COALESCE(ub.chain_id, '') as chain_id,
            ub.available_balance::text, ub.locked_balance::text
     FROM user_balances ub
     LEFT JOIN currencies c ON c.id = ub.currency_id
     WHERE ub.user_id = $1 ORDER BY ub.currency_id`,
    [userId]
  );
  if (ub.rows.length === 0) {
    console.log('No user_balances rows. So balance will show as zero.');
  } else {
    ub.rows.forEach((r) => {
      const total = parseFloat(r.available_balance || '0') + parseFloat(r.locked_balance || '0');
      console.log(`  ${r.symbol || r.currency_id} | account_type=${r.account_type} | chain_id='${r.chain_id}' | available=${r.available_balance} locked=${r.locked_balance} total=${total}`);
    });
  }

  console.log('\n--- 4b) Funding balances (non-zero only) ---');
  const fundingNonZero = await db.query<{ symbol: string; available_balance: string; locked_balance: string }>(
    `SELECT COALESCE(c.symbol, ub.currency_id::text) as symbol, ub.available_balance::text, ub.locked_balance::text
     FROM user_balances ub LEFT JOIN currencies c ON c.id = ub.currency_id
     WHERE ub.user_id = $1 AND ub.account_type = 'funding' AND (ub.available_balance > 0 OR ub.locked_balance > 0)`,
    [userId]
  );
  if (fundingNonZero.rows.length === 0) {
    console.log('  (none)');
  } else {
    fundingNonZero.rows.forEach((r) => console.log(`  ${r.symbol} available=${r.available_balance} locked=${r.locked_balance}`));
  }

  console.log('\n--- 5) Summary & fix ---');
  const completedNotApplied = deposits.rows.filter(
    (d) => d.status === 'completed' && d.credited_at != null && d.balance_applied_at == null
  );
  if (completedNotApplied.length > 0) {
    console.log(`${completedNotApplied.length} deposit(s) are completed but not applied to user_balances.`);
    console.log('→ Fix: Open Funding page (GET /balances/funding) while logged in as this user; the route runs a repair that credits these to user_balances.');
  } else if (deposits.rows.length > 0 && ub.rows.length === 0) {
    console.log('Deposits exist but user_balances is empty. Possible causes:');
    console.log('  - deposit.currency_id is not in currencies table → indexer skips credit. Fix: ensure currencies has a row for that currency (symbol match).');
    console.log('  - Deposits still pending (status != completed). Wait for indexer to confirm.');
    console.log('  - Repair not run yet. Log in as this user and open Funding page once.');
  } else if (deposits.rows.length === 0) {
    console.log('No deposits. Balance will be zero until deposits exist and are credited.');
  } else {
    console.log('Deposits and user_balances both have data. If UI still shows zero, check GET /api/v1/wallet/balances/funding response and frontend.');
  }

  console.log('');
  await db.getPool().end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
