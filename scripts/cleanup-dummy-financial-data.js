/**
 * Clean up ALL dummy/seed financial data while preserving ONE real user.
 * Protected user: nmnsingh02@gmail.com (DO NOT TOUCH their data).
 *
 * Run from repo root: node scripts/cleanup-dummy-financial-data.js
 * Requires: DATABASE_URL in .env
 *
 * EXACT SQL USED (all with real_user_id = id of nmnsingh02@gmail.com):
 *
 *   -- 1) Resolve protected user
 *   SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM('nmnsingh02@gmail.com')) LIMIT 1;
 *
 *   -- 2) Deletes (in order; real_user_id excluded in every WHERE)
 *   DELETE FROM withdrawal_signing_queue
 *     WHERE withdrawal_id IN (SELECT id FROM withdrawals WHERE user_id != $1);
 *   DELETE FROM withdrawals WHERE user_id != $1;
 *   DELETE FROM deposits WHERE user_id != $1;
 *   DELETE FROM deposit_sweeps ds
 *     WHERE EXISTS (SELECT 1 FROM wallets w WHERE w.chain_id = ds.chain_id
 *       AND LOWER(TRIM(w.address)) = LOWER(TRIM(ds.from_address)) AND w.user_id != $1);
 *   DELETE FROM user_balances WHERE user_id != $1;
 *   DELETE FROM balances WHERE user_id != $1;
 *   DELETE FROM audit_logs WHERE user_id IS NOT NULL AND user_id != $1;
 *   DELETE FROM withdrawal_addresses WHERE user_id != $1;
 *   DELETE FROM internal_transfers WHERE from_user_id != $1 OR to_user_id != $1;
 *
 * Does NOT delete from: users. Protected user's deposits, balances, wallets, history are unchanged.
 */

require('dotenv').config();
const { Pool } = require('pg');

const PROTECTED_EMAIL = 'nmnsingh02@gmail.com';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    // 1) Resolve protected user_id by email (case-insensitive)
    const userRow = await client.query(
      `SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
      [PROTECTED_EMAIL]
    );
    if (userRow.rows.length === 0) {
      console.error(`Protected user not found: ${PROTECTED_EMAIL}. Aborting. No data was deleted.`);
      process.exit(1);
    }
    const realUserId = userRow.rows[0].id;
    console.log(`Protected user: ${PROTECTED_EMAIL} -> user_id = ${realUserId}`);

    // Counts for real user (before) – for confirmation
    const before = {};
    for (const table of ['user_balances', 'deposits', 'withdrawals']) {
      try {
        const r = await client.query(
          `SELECT COUNT(*)::int AS c FROM ${table} WHERE user_id = $1`,
          [realUserId]
        );
        before[table] = r.rows[0]?.c ?? 0;
      } catch {
        before[table] = null;
      }
    }

    const counts = {};
    const runDelete = async (name, sql, params) => {
      try {
        const r = await client.query(sql, params);
        return r.rowCount;
      } catch (e) {
        if (e.code === '42P01') return 0; // undefined_table
        console.warn(`  Warning: ${name} failed: ${e.message}`);
        return 0;
      }
    };

    // 2a) withdrawal_signing_queue – delete rows for withdrawals of other users
    counts.withdrawal_signing_queue = await runDelete('withdrawal_signing_queue', `
      DELETE FROM withdrawal_signing_queue
      WHERE withdrawal_id IN (SELECT id FROM withdrawals WHERE user_id != $1)
    `, [realUserId]);

    // 2b) withdrawals
    counts.withdrawals = await runDelete('withdrawals', `DELETE FROM withdrawals WHERE user_id != $1`, [realUserId]);

    // 2c) deposits
    counts.deposits = await runDelete('deposits', `DELETE FROM deposits WHERE user_id != $1`, [realUserId]);

    // 2d) deposit_sweeps – only where from_address belongs to a wallet of another user
    counts.deposit_sweeps = await runDelete('deposit_sweeps', `
      DELETE FROM deposit_sweeps ds
      WHERE EXISTS (
        SELECT 1 FROM wallets w
        WHERE w.chain_id = ds.chain_id
          AND LOWER(TRIM(w.address)) = LOWER(TRIM(ds.from_address))
          AND w.user_id != $1
      )
    `, [realUserId]);

    // 2e) user_balances
    counts.user_balances = await runDelete('user_balances', `DELETE FROM user_balances WHERE user_id != $1`, [realUserId]);

    // 2f) balances (tokens schema, if exists)
    counts.balances = await runDelete('balances', `DELETE FROM balances WHERE user_id != $1`, [realUserId]);

    // 2g) audit_logs – non-real user only
    counts.audit_logs = await runDelete('audit_logs', `DELETE FROM audit_logs WHERE user_id IS NOT NULL AND user_id != $1`, [realUserId]);

    // 2h) withdrawal_addresses
    counts.withdrawal_addresses = await runDelete('withdrawal_addresses', `DELETE FROM withdrawal_addresses WHERE user_id != $1`, [realUserId]);

    // 2i) internal_transfers – any transfer involving a non-real user
    counts.internal_transfers = await runDelete('internal_transfers', `DELETE FROM internal_transfers WHERE from_user_id != $1 OR to_user_id != $1`, [realUserId]);

    // 3) Confirm protected user data unchanged
    const after = {};
    for (const table of ['user_balances', 'deposits', 'withdrawals']) {
      try {
        const r = await client.query(
          `SELECT COUNT(*)::int AS c FROM ${table} WHERE user_id = $1`,
          [realUserId]
        );
        after[table] = r.rows[0]?.c ?? 0;
      } catch {
        after[table] = null;
      }
    }

    console.log('\n--- Rows deleted per table ---');
    Object.entries(counts).forEach(([table, n]) => console.log(`  ${table}: ${n}`));
    console.log('\n--- Protected user row counts (must be unchanged) ---');
    ['user_balances', 'deposits', 'withdrawals'].forEach((t) => {
      const b = before[t];
      const a = after[t];
      const ok = b === a ? 'OK' : 'MISMATCH';
      console.log(`  ${t}: before=${b} after=${a} ${ok}`);
    });
    const preserved =
      before.user_balances === after.user_balances &&
      before.deposits === after.deposits &&
      before.withdrawals === after.withdrawals;
    console.log(preserved ? '\nReal user data preserved.' : '\nWARNING: Real user counts changed.');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
