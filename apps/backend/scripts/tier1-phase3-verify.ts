/**
 * Tier 1 Phase 3 gate:
 * - Same DB checks as Phase 1 (trading ledger vs balances + settlement hash chain)
 * - GET /health → HTTP 200 and status === 'healthy' (set TIER1_ALLOW_HEALTH_NON_200=true to only warn on non-200)
 * - GET /api/v1/p2p/ads (same as Phase 2)
 * - npm run test:security (from monorepo root; needs API up). Set TIER1_PHASE3_SKIP_SECURITY=true to skip.
 *
 * Env: E2E_BASE_URL (default http://127.0.0.1:4000)
 * Optional: TIER1_SKIP_HTTP_CHECKS=1 — skip /health, /p2p/ads, security after DB checks (DB-only gate).
 * Optional: TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT=true
 *
 * Run: cd apps/backend && npm run tier1:phase3-verify
 */
import 'dotenv/config';
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../src/lib/database.js';
import { assertZeroPendingSettlement } from './tier1-pending-settlement-gate.js';

const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function resolveNpmBin(): string {
  const envBin = (process.env.NPM_BIN || '').trim();
  if (envBin && fs.existsSync(envBin)) return envBin;
  const fromNode = process.execPath.endsWith('/node') ? process.execPath.slice(0, -5) + '/npm' : '';
  if (fromNode && fs.existsSync(fromNode)) return fromNode;
  const home = process.env.HOME || '';
  const nvmRoot = home ? path.join(home, '.nvm', 'versions', 'node') : '';
  if (nvmRoot && fs.existsSync(nvmRoot)) {
    const versions = fs
      .readdirSync(nvmRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      const candidate = path.join(nvmRoot, versions[i]!, 'bin', 'npm');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'npm';
}

function runNpm(scriptName: string): void {
  const npmBin = resolveNpmBin();
  execFileSync(npmBin, ['run', scriptName], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, E2E_BASE_URL: base },
  });
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ res: Response; json: unknown }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const json = await res.json().catch(() => null);
    return { res, json };
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  const pool = db.getPool();
  const queryWithRetry = async <T>(text: string): Promise<{ rows: T[] }> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return (await pool.query<T>(text)) as { rows: T[] };
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  };

  const mismatch = await queryWithRetry<{ n: string }>(
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
  console.log('[phase3] trading_balance_mismatch_count', mc);

  const chain = await queryWithRetry<{ broken: string }>(
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
  console.log('[phase3] settlement_ledger_chain_breaks', br);

  const pending = await queryWithRetry<{ n: string }>(
    `SELECT count(*)::text AS n FROM settlement_events WHERE LOWER(TRIM(status::text)) = 'pending'`
  );
  const pend = pending.rows[0]?.n ?? '?';
  console.log('[phase3] settlement_events_pending', pend);

  await db.close();

  if (mc !== '0' || br !== '0') {
    console.error('TIER1_PHASE3_FAIL: accounting / settlement chain');
    process.exit(1);
  }
  assertZeroPendingSettlement(pend, '[phase3]');

  if (process.env.TIER1_SKIP_HTTP_CHECKS === '1') {
    console.warn('[phase3] skipping HTTP + security (TIER1_SKIP_HTTP_CHECKS=1)');
    console.log('TIER1_PHASE3_VERIFY_OK');
    return;
  }

  const healthUrl = `${base}/health`;
  const { res: hres, json: hjson } = await fetchJson(healthUrl, 15_000);
  const hbody = hjson as { status?: string } | null;
  if (!hres.ok && process.env.TIER1_ALLOW_HEALTH_NON_200 !== 'true') {
    console.error('TIER1_PHASE3_FAIL: /health HTTP', hres.status);
    process.exit(1);
  }
  if (process.env.TIER1_ALLOW_HEALTH_NON_200 === 'true' && !hres.ok) {
    console.warn('[phase3] /health non-200 allowed by env', hres.status);
  } else if (hbody?.status !== 'healthy') {
    console.error('TIER1_PHASE3_FAIL: /health status not healthy', hbody?.status);
    process.exit(1);
  }
  console.log('[phase3] GET /health OK', hbody?.status);

  const p2pUrl = `${base}/api/v1/p2p/ads`;
  const { res: pres, json: pjson } = await fetchJson(p2pUrl, 15_000);
  const pbody = pjson as { data?: unknown } | null;
  if (!pres.ok || !pbody || !Array.isArray(pbody.data)) {
    console.error('TIER1_PHASE3_FAIL: GET /api/v1/p2p/ads', pres.status);
    process.exit(1);
  }
  console.log('[phase3] GET /api/v1/p2p/ads OK, rows=', pbody.data.length);

  if (process.env.TIER1_PHASE3_SKIP_SECURITY === 'true') {
    console.warn('[phase3] test:security skipped (TIER1_PHASE3_SKIP_SECURITY=true)');
  } else {
    console.log('[phase3] running npm run test:security ...');
    runNpm('test:security');
  }

  if (process.env.TIER1_PHASE3_INCLUDE_E2E === 'true') {
    console.log('[phase3] running npm run test:e2e ...');
    runNpm('test:e2e');
  }

  console.log('TIER1_PHASE3_VERIFY_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
