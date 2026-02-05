/**
 * Remove seed/dummy user_balances so Admin Funds Summary shows only actual data.
 * Deletes balances for full-schema seed users (john@, alice@, bob@ example UUIDs).
 * Run from repo root: node scripts/clear-seed-balances.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const SEED_USER_IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(
      `DELETE FROM user_balances WHERE user_id = ANY($1::uuid[])`,
      [SEED_USER_IDS]
    );
    console.log(`Cleared ${res.rowCount} seed user_balance row(s). Funds Summary will now show only actual data.`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
