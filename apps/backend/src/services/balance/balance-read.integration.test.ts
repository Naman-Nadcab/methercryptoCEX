/**
 * Integration test: canonical balance read for new user with no balances.
 * - New user, no balance rows
 * - GET /balances/funding equivalent (readUserBalances for funding)
 * - All active currencies must be returned with '0' balances
 *
 * Run with: npx tsx src/services/balance/balance-read.integration.test.ts
 * Requires: DATABASE_URL, and DB with users, currencies, user_balances tables.
 */

import 'dotenv/config';
import { db } from '../../lib/database.js';
import { readUserBalances } from './readUserBalances.js';

async function run(): Promise<void> {
  let userId: string;

  // 1) Get count of active currencies
  const activeCurrencies = await db.query<{ id: string }>(
    `SELECT id FROM currencies WHERE is_active = TRUE ORDER BY symbol ASC`,
    []
  );
  const activeCount = activeCurrencies.rows.length;
  if (activeCount === 0) {
    console.log('SKIP: no active currencies in DB');
    process.exit(0);
  }

  // 2) Create a new user (no balance rows yet)
  const insertUser = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, salt)
     VALUES ($1, 'test-hash', 'test-salt')
     RETURNING id`,
    [`balance-test-${Date.now()}@test.local`]
  );
  userId = insertUser.rows[0].id;

  try {
    // 3) Call canonical read (ensures rows, then reads)
    const rows = await readUserBalances(userId, 'funding');

    // 4) Assert: same number of rows as active currencies; all balances '0'
    if (rows.length !== activeCount) {
      throw new Error(
        `Expected ${activeCount} balance rows (one per active currency), got ${rows.length}`
      );
    }
    for (const row of rows) {
      if (parseFloat(row.available_balance || '0') !== 0) {
        throw new Error(
          `Expected available_balance 0 for ${row.symbol}, got ${row.available_balance}`
        );
      }
      if (parseFloat(row.locked_balance || '0') !== 0) {
        throw new Error(
          `Expected locked_balance 0 for ${row.symbol}, got ${row.locked_balance}`
        );
      }
    }
    console.log(`PASS: readUserBalances returned ${rows.length} currencies, all with 0 balance`);
  } finally {
    await db.query(`DELETE FROM user_balances WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    console.error('FAIL:', err.message);
    process.exit(1);
  }
);
