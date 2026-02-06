/**
 * Verify that user_balances (funding) matches real funds only:
 *   expected = deposits (credited) + internal_transfers(in) - internal_transfers(out) - withdrawals(completed)
 * No dummy/seed balance should be counted; run clear-seed-balances.js if you had seed data.
 *
 * Run: cd apps/backend && npx tsx scripts/verify-real-balance.ts [email]
 *      If email omitted, verifies all users that have at least one of: deposit, internal_transfer, withdrawal, or user_balances row.
 */

import { db } from '../src/lib/database.js';

const email = process.argv[2]?.trim(); // optional: single user by email

interface Row {
  currency_id: string;
  symbol: string;
  expected: string;
  actual: string;
  match: boolean;
}

async function getCurrencyIdFromToken(tokenId: string): Promise<string | null> {
  const r = await db.query<{ currency_id: string }>(
    `SELECT c.id AS currency_id FROM tokens t JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol)) WHERE t.id = $1 LIMIT 1`,
    [tokenId]
  );
  return r.rows[0]?.currency_id ?? null;
}

async function verifyUser(userId: string, userEmail: string): Promise<{ ok: boolean; rows: Row[]; errors: string[] }> {
  const errors: string[] = [];
  const byCurrency: Record<string, { expected: number; symbol: string }> = {};

  // 1) Deposits credited (balance_applied_at set)
  const deposits = await db.query<{ currency_id: string; sum: string; symbol: string }>(
    `SELECT d.currency_id, COALESCE(SUM(d.amount::numeric), 0)::text AS sum, COALESCE(c.symbol, '') AS symbol
     FROM deposits d
     LEFT JOIN currencies c ON c.id = d.currency_id
     WHERE d.user_id = $1 AND d.status = 'completed' AND d.balance_applied_at IS NOT NULL
     GROUP BY d.currency_id, c.symbol`,
    [userId]
  );
  for (const r of deposits.rows) {
    const cur = r.currency_id;
    if (!byCurrency[cur]) byCurrency[cur] = { expected: 0, symbol: r.symbol || cur };
    byCurrency[cur].expected += parseFloat(r.sum || '0');
  }

  // 2) Internal transfers: in - out (only if table exists)
  try {
    const hasIt = await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'internal_transfers'`);
    if (hasIt.rows.length > 0) {
      const inRows = await db.query<{ currency_id: string; sum: string; symbol: string }>(
        `SELECT it.currency_id, COALESCE(SUM(it.amount::numeric), 0)::text AS sum, COALESCE(c.symbol, '') AS symbol
         FROM internal_transfers it
         LEFT JOIN currencies c ON c.id = it.currency_id
         WHERE it.to_user_id = $1 AND it.status = 'completed'
         GROUP BY it.currency_id, c.symbol`,
        [userId]
      );
      const outRows = await db.query<{ currency_id: string; sum: string }>(
        `SELECT it.currency_id, COALESCE(SUM(it.amount::numeric), 0)::text AS sum
         FROM internal_transfers it
         WHERE it.from_user_id = $1 AND it.status = 'completed'
         GROUP BY it.currency_id`,
        [userId]
      );
      for (const r of inRows.rows) {
        const cur = r.currency_id;
        if (!byCurrency[cur]) byCurrency[cur] = { expected: 0, symbol: r.symbol || cur };
        byCurrency[cur].expected += parseFloat(r.sum || '0');
      }
      for (const r of outRows.rows) {
        const cur = r.currency_id;
        if (!byCurrency[cur]) byCurrency[cur] = { expected: 0, symbol: cur };
        byCurrency[cur].expected -= parseFloat(r.sum || '0');
      }
    }
  } catch (e) {
    errors.push('internal_transfers: ' + (e instanceof Error ? e.message : String(e)));
  }

  // 3) Withdrawals completed (debited from user)
  const withdrawals = await db.query<{ token_id: string; currency_id: string | null; sum: string }>(
    `SELECT w.token_id, w.currency_id, COALESCE(SUM(w.amount::numeric), 0)::text AS sum
     FROM withdrawals w
     WHERE w.user_id = $1 AND w.status = 'completed'
     GROUP BY w.token_id, w.currency_id`,
    [userId]
  );
  for (const r of withdrawals.rows) {
    let currencyId = r.currency_id;
    if (!currencyId && r.token_id) currencyId = await getCurrencyIdFromToken(r.token_id);
    if (!currencyId) continue;
    if (!byCurrency[currencyId]) {
      const sym = await db.query<{ symbol: string }>(`SELECT symbol FROM currencies WHERE id = $1`, [currencyId]);
      byCurrency[currencyId] = { expected: 0, symbol: sym.rows[0]?.symbol || currencyId };
    }
    byCurrency[currencyId].expected -= parseFloat(r.sum || '0');
  }

  // 4) Actual funding balance from user_balances
  const actualRows = await db.query<{ currency_id: string; symbol: string; total: string }>(
    `SELECT ub.currency_id, COALESCE(c.symbol, '') AS symbol,
            (COALESCE(ub.available_balance, 0) + COALESCE(ub.locked_balance, 0))::text AS total
     FROM user_balances ub
     LEFT JOIN currencies c ON c.id = ub.currency_id
     WHERE ub.user_id = $1 AND COALESCE(ub.chain_id, '') = '' AND ub.account_type::text = 'funding'`,
    [userId]
  );

  const actualByCur: Record<string, number> = {};
  for (const r of actualRows.rows) {
    actualByCur[r.currency_id] = parseFloat(r.total || '0');
    if (!byCurrency[r.currency_id]) byCurrency[r.currency_id] = { expected: 0, symbol: r.symbol || r.currency_id };
  }

  const rows: Row[] = [];
  const tolerance = 1e-8;
  let ok = true;
  for (const [cur, { expected, symbol }] of Object.entries(byCurrency)) {
    const actual = actualByCur[cur] ?? 0;
    const match = Math.abs(expected - actual) <= tolerance;
    if (!match) ok = false;
    rows.push({
      currency_id: cur,
      symbol,
      expected: expected.toFixed(8),
      actual: actual.toFixed(8),
      match
    });
  }
  return { ok, rows, errors };
}

async function main() {
  console.log('\n=== Real balance verification (deposits + internal in - internal out - withdrawals) ===\n');

  let userIds: { id: string; email: string }[] = [];
  if (email) {
    const r = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [email]
    );
    if (r.rows.length === 0) {
      console.log('User not found:', email);
      process.exit(1);
    }
    userIds = r.rows;
  } else {
    const r = await db.query<{ id: string; email: string }>(
      `SELECT DISTINCT u.id, u.email FROM users u
       WHERE EXISTS (SELECT 1 FROM deposits d WHERE d.user_id = u.id)
          OR EXISTS (SELECT 1 FROM user_balances ub WHERE ub.user_id = u.id)
          OR EXISTS (SELECT 1 FROM withdrawals w WHERE w.user_id = u.id)
          OR (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'internal_transfers')
              AND EXISTS (SELECT 1 FROM internal_transfers it WHERE it.from_user_id = u.id OR it.to_user_id = u.id))
       ORDER BY u.email LIMIT 500`
    );
    userIds = r.rows;
  }

  let anyMismatch = false;
  for (const { id: userId, email: userEmail } of userIds) {
    const { ok, rows, errors } = await verifyUser(userId, userEmail);
    if (errors.length) console.log(userEmail, 'errors:', errors);
    const withBalance = rows.filter(r => parseFloat(r.expected) !== 0 || parseFloat(r.actual) !== 0);
    if (withBalance.length === 0 && rows.length === 0) continue;
    if (!ok) anyMismatch = true;
    console.log(`\n--- ${userEmail} (${userId}) ---`);
    if (withBalance.length === 0) {
      console.log('  No balance (expected and actual are zero).');
      continue;
    }
    for (const r of withBalance) {
      console.log(`  ${r.symbol}: expected=${r.expected} actual=${r.actual} ${r.match ? 'OK' : 'MISMATCH'}`);
    }
  }

  console.log('\n' + (anyMismatch ? 'Some users have mismatch: balance is not strictly from deposits + internal in - out - withdrawals (e.g. dummy/seed or missing credit).' : 'All checked users match real funds only.'));
  await db.getPool().end();
  process.exit(anyMismatch ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
