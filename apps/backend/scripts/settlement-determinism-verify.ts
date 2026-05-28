import 'dotenv/config';
import { db } from '../src/lib/database.js';
import { redis } from '../src/lib/redis.js';
import { runGlobalBalanceAudit } from '../src/services/settlement/global-balance-auditor.js';

async function main(): Promise<void> {
  const audit = await runGlobalBalanceAudit();

  const pending = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM settlement_events WHERE LOWER(TRIM(status::text)) = 'pending'`
  );
  const orphan = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM settlement_ledger_entries sle
     LEFT JOIN settlement_events se ON se.id = sle.settlement_event_id
     WHERE se.id IS NULL`
  );
  const duplicate = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM (
       SELECT match_engine_id, engine_event_id, COUNT(*) n
       FROM settlement_events
       GROUP BY match_engine_id, engine_event_id
       HAVING COUNT(*) > 1
     ) x`
  );
  const nonFourLedgerRows = await db.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c
     FROM settlement_events se
     LEFT JOIN (
       SELECT settlement_event_id, COUNT(*)::int AS c
       FROM settlement_ledger_entries
       GROUP BY settlement_event_id
     ) le ON le.settlement_event_id = se.id
     WHERE LOWER(TRIM(se.status::text)) = 'processed'
       AND COALESCE(le.c, 0) <> 4`
  );

  const result = {
    global_audit_ok: audit.ok,
    global_audit_mismatches: audit.mismatches,
    pending_settlement_events: Number(pending.rows[0]?.c ?? '0'),
    orphan_ledger_rows: Number(orphan.rows[0]?.c ?? '0'),
    duplicate_match_engine_event_groups: Number(duplicate.rows[0]?.c ?? '0'),
    processed_events_with_non_4_ledger_rows: Number(nonFourLedgerRows.rows[0]?.c ?? '0'),
  };

  console.log('SETTLEMENT_DETERMINISM', JSON.stringify(result));

  const ok =
    result.global_audit_ok &&
    result.global_audit_mismatches === 0 &&
    result.pending_settlement_events === 0 &&
    result.orphan_ledger_rows === 0 &&
    result.duplicate_match_engine_event_groups === 0 &&
    result.processed_events_with_non_4_ledger_rows === 0;

  await db.close();
  await redis.close().catch(() => {});
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  try {
    await db.close();
  } catch {
    // ignore
  }
  try {
    await redis.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
