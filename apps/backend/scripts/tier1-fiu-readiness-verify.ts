/**
 * FIU-India (VDA reporting entity) readiness gate — technical checks only.
 * Legal registration, MLRO appointment, and GoAML filing are outside this repo.
 *
 * Verifies:
 * - Tier-1 accounting (trading ledger vs balances, settlement hash chain)
 * - AML tables: aml_alerts, aml_transaction_logs, aml_str_ctr_logs
 * - Immutable audit trail table
 * - At least one KYC storage table (kyc_applications or kyc_records)
 * - Production: KYC_DIGILOCKER_DEMO_AUTO_APPROVE must not be true
 * - Optional strict: TIER1_FIU_STRICT=true → production requires SANCTIONS_PROVIDER
 *
 * Run: npm run tier1:fiu-readiness --workspace=@exchange/backend
 * Optional: TIER1_REQUIRE_ZERO_PENDING_SETTLEMENT=true (same as phase1–3 gates)
 */
import 'dotenv/config';
import { db } from '../src/lib/database.js';
import { assertZeroPendingSettlement } from './tier1-pending-settlement-gate.js';

const REQUIRED_AML_TABLES = ['aml_alerts', 'aml_transaction_logs', 'aml_str_ctr_logs'] as const;
const AUDIT_TABLE = 'audit_logs_immutable';

async function main(): Promise<void> {
  const pool = db.getPool();
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const digiAuto = process.env.KYC_DIGILOCKER_DEMO_AUTO_APPROVE === 'true';
  const sanctionsProvider = (process.env.SANCTIONS_PROVIDER ?? '').trim();
  const strictFiu = process.env.TIER1_FIU_STRICT === 'true';

  let score = 100;
  const warnings: string[] = [];

  const tables = await pool.query<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [[...REQUIRED_AML_TABLES, AUDIT_TABLE, 'kyc_applications', 'kyc_records']]
  );
  const have = new Set((tables.rows ?? []).map((r) => r.t));

  for (const t of REQUIRED_AML_TABLES) {
    if (!have.has(t)) {
      console.error(`[fiu] FAIL: missing table ${t}`);
      await db.close();
      process.exit(1);
    }
  }
  console.log('[fiu] aml tables:', REQUIRED_AML_TABLES.join(', '));

  if (!have.has(AUDIT_TABLE)) {
    console.error(`[fiu] FAIL: missing table ${AUDIT_TABLE}`);
    await db.close();
    process.exit(1);
  }
  console.log('[fiu] audit:', AUDIT_TABLE);

  const kycOk = have.has('kyc_applications') || have.has('kyc_records');
  if (!kycOk) {
    console.error('[fiu] FAIL: neither kyc_applications nor kyc_records exists');
    await db.close();
    process.exit(1);
  }
  console.log(
    '[fiu] kyc:',
    have.has('kyc_applications') && have.has('kyc_records')
      ? 'kyc_applications + kyc_records'
      : have.has('kyc_applications')
        ? 'kyc_applications'
        : 'kyc_records'
  );

  if (isProd && digiAuto) {
    console.error('[fiu] FAIL: KYC_DIGILOCKER_DEMO_AUTO_APPROVE must be false in production (FIU / PMLA)');
    await db.close();
    process.exit(1);
  }
  if (digiAuto && !isProd) {
    warnings.push('KYC_DIGILOCKER_DEMO_AUTO_APPROVE=true (dev only)');
    score -= 5;
  }

  if (isProd && !sanctionsProvider) {
    const msg = 'SANCTIONS_PROVIDER unset — required for real screening before FIU-grade launch';
    if (strictFiu) {
      console.error(`[fiu] FAIL (TIER1_FIU_STRICT): ${msg}`);
      await db.close();
      process.exit(1);
    }
    warnings.push(msg);
    score -= 25;
  }

  const mismatch = await pool.query<{ n: string }>(
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
  console.log('[fiu] trading_balance_mismatch_count', mc);

  const chain = await pool.query<{ broken: string }>(
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
  console.log('[fiu] settlement_ledger_chain_breaks', br);

  const settlementPending = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM settlement_events WHERE LOWER(TRIM(status::text)) = 'pending'`
  );
  const settlePend = settlementPending.rows[0]?.n ?? '?';
  console.log('[fiu] settlement_events_pending', settlePend);

  const pendingStr = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aml_str_ctr_logs WHERE report_type = 'STR' AND status = 'pending'`
  );
  const pstr = pendingStr.rows[0]?.n ?? '0';
  console.log('[fiu] str_reports_pending', pstr);
  if (parseInt(pstr, 10) > 0) {
    warnings.push(`${pstr} STR report(s) pending manual FIU submission / mark-submitted`);
    score -= Math.min(15, 5 * parseInt(pstr, 10));
  }

  const openAlerts = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aml_alerts WHERE status IN ('open','reviewing')`
  );
  const oa = openAlerts.rows[0]?.n ?? '0';
  console.log('[fiu] aml_alerts_open_or_reviewing', oa);

  await db.close();

  if (mc !== '0' || br !== '0') {
    console.error('[fiu] FAIL: accounting / settlement chain');
    process.exit(1);
  }
  assertZeroPendingSettlement(settlePend, '[fiu]');

  score = Math.max(0, Math.min(100, score));
  for (const w of warnings) {
    console.warn('[fiu] WARN:', w);
  }
  console.log('[fiu] readiness_score', score, '/100 (technical only; not legal sign-off)');
  console.log('TIER1_FIU_READINESS_OK');
}

main().catch((e) => {
  console.error('[fiu] FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
