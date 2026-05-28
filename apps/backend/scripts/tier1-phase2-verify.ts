/**
 * Tier 1 Phase 2: Phase 1 accounting gate + GET /api/v1/p2p/ads (200).
 * Env: E2E_BASE_URL (default http://127.0.0.1:4000)
 * Optional: TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT=true
 * Optional: TIER1_SKIP_HTTP_CHECKS=1 — skip GET /p2p/ads when API is down (DB-only gate; use full check before prod).
 *
 * Run: cd apps/backend && npm run tier1:phase2-verify
 */
import 'dotenv/config';
import { db } from '../src/lib/database.js';
import { assertZeroPendingSettlement } from './tier1-pending-settlement-gate.js';

async function queryWithRetry<T>(pool: ReturnType<typeof db.getPool>, sql: string): Promise<{ rows: T[] }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await pool.query<T>(sql)) as { rows: T[] };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const pool = db.getPool();

  const mismatch = await queryWithRetry<{ n: string }>(
    pool,
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

  const chain = await queryWithRetry<{ broken: string }>(
    pool,
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

  const pending = await queryWithRetry<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM settlement_events WHERE LOWER(TRIM(status::text)) = 'pending'`
  );
  const pend = pending.rows[0]?.n ?? '?';
  console.log('settlement_events_pending', pend);

  await db.close();

  if (mc !== '0' || br !== '0') {
    console.error('TIER1_PHASE2_FAIL: accounting/chain');
    process.exit(1);
  }
  assertZeroPendingSettlement(pend, '[phase2]');

  if (process.env.TIER1_SKIP_HTTP_CHECKS === '1') {
    console.warn('[phase2] skipping GET /api/v1/p2p/ads (TIER1_SKIP_HTTP_CHECKS=1 — API not required for this run)');
    console.log('TIER1_PHASE2_VERIFY_OK');
    return;
  }

  const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  const url = `${base}/api/v1/p2p/ads`;
  let res: Response | null = null;
  let lastFetchErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15_000);
    try {
      res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      break;
    } catch (e) {
      clearTimeout(t);
      lastFetchErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  if (!res) {
    const msg = lastFetchErr instanceof Error ? lastFetchErr.message : String(lastFetchErr);
    if (process.env.TIER1_HTTP_FAIL_OPEN === '1') {
      console.warn('[phase2] p2p fetch failed; continuing (TIER1_HTTP_FAIL_OPEN=1)', msg);
      console.log('TIER1_PHASE2_VERIFY_OK');
      return;
    }
    console.error('TIER1_PHASE2_FAIL: p2p fetch', msg);
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('TIER1_PHASE2_FAIL: GET /api/v1/p2p/ads', res.status, body.slice(0, 200));
    process.exit(1);
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
  if (!json || !Array.isArray(json.data)) {
    console.error('TIER1_PHASE2_FAIL: p2p response shape');
    process.exit(1);
  }
  console.log('GET /api/v1/p2p/ads OK, rows=', json.data.length);
  console.log('TIER1_PHASE2_VERIFY_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
