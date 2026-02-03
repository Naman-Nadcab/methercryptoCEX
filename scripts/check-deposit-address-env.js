#!/usr/bin/env node
/**
 * Run from repo root: node scripts/check-deposit-address-env.js
 * Checks that DB tables and env needed for deposit address exist.
 * Requires .env with DATABASE_URL and REDIS_URL.
 */
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set in .env');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl });
  const checks = [];

  try {
    // Tables that must exist
    const tables = ['users', 'chains', 'tokens', 'wallets', 'user_master_keys', 'balances'];
    for (const table of tables) {
      const r = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
        [table]
      );
      const exists = r.rows[0]?.exists;
      checks.push({ name: `table ${table}`, ok: !!exists });
    }

    // KYC: at least one of these
    let kycOk = false;
    for (const t of ['kyc_applications', 'kyc_records']) {
      const r = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
        [t]
      );
      if (r.rows[0]?.exists) {
        kycOk = true;
        break;
      }
    }
    checks.push({ name: 'KYC table (kyc_applications or kyc_records)', ok: kycOk });

    // Chains with data
    const chains = await pool.query("SELECT id, name, type FROM chains WHERE is_active = TRUE LIMIT 10");
    checks.push({ name: `chains populated (${chains.rows.length} active)`, ok: chains.rows.length > 0 });

    // Tokens (needed for initializeBalances)
    const tokens = await pool.query('SELECT id FROM tokens WHERE is_active = TRUE LIMIT 1');
    checks.push({ name: 'tokens populated', ok: tokens.rows.length > 0 });

    // Env
    checks.push({ name: 'ENCRYPTION_KEY set', ok: !!process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 32 });
    checks.push({ name: 'REDIS_URL set', ok: !!process.env.REDIS_URL });

    console.log('\n--- Deposit address environment check ---\n');
    for (const c of checks) {
      console.log(c.ok ? '✓' : '✗', c.name);
    }
    const failed = checks.filter(c => !c.ok);
    if (failed.length > 0) {
      console.log('\n❌ Fix the items above and re-run migrations if needed.');
      process.exit(1);
    }
    console.log('\n✓ All checks passed. If deposit address still fails, check backend logs for CHAIN_LOOKUP_FAILED or WALLET_CREATE_FAILED detail.\n');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
