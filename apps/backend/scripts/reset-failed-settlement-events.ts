/**
 * Dev/ops: reset failed settlement_events so the worker can retry after fixing SQL/runtime issues.
 *
 * RESET_FAILED_SETTLEMENT_MODE=delete — DELETE failed rows (lose audit; poller must re-insert).
 * Default — UPDATE status to pending, clear last_error (recommended to resume without data loss).
 * SETTLEMENT_MAX_RETRY=10 — must match settlement-worker MAX_RETRIES for unstick threshold.
 *
 * Usage: npx tsx scripts/reset-failed-settlement-events.ts
 */
import { db } from '../src/lib/database.js';

const MAX_RETRY = Math.max(1, parseInt(process.env.SETTLEMENT_MAX_RETRY ?? '10', 10) || 10);

async function main(): Promise<void> {
  const mode = (process.env.RESET_FAILED_SETTLEMENT_MODE ?? 'retry').toLowerCase();

  const before = await db.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count FROM settlement_events GROUP BY status ORDER BY status`
  );
  console.log('Before:', before.rows.map((r) => `${r.status}=${r.count}`).join(', ') || '(empty)');

  if (mode === 'delete') {
    const del = await db.query(`DELETE FROM settlement_events WHERE status = 'failed'`);
    console.log(`Deleted failed rows: ${del.rowCount ?? 0}`);
  } else {
    const upd = await db.query(
      `UPDATE settlement_events SET status = 'pending', last_error = NULL, retry_count = 0 WHERE status = 'failed'`
    );
    console.log(`Reset failed → pending (retry_count=0): ${upd.rowCount ?? 0} row(s)`);
  }

  /* Unstick rows left pending with exhausted retries (worker uses retry_count < MAX_RETRIES). */
  const unstick = await db.query(
    `UPDATE settlement_events SET retry_count = 0, last_error = NULL WHERE status = 'pending' AND retry_count >= $1`,
    [MAX_RETRY]
  );
  if ((unstick.rowCount ?? 0) > 0) {
    console.log(`Zeroed retry_count for stuck pending (>=${MAX_RETRY}): ${unstick.rowCount} row(s)`);
  }

  if (process.env.SETTLEMENT_UNSTICK_ALL_PENDING === 'true') {
    const all = await db.query(
      `UPDATE settlement_events SET retry_count = 0, last_error = NULL WHERE status = 'pending'`
    );
    console.log(`SETTLEMENT_UNSTICK_ALL_PENDING: reset retry on all pending: ${all.rowCount ?? 0} row(s)`);
  }

  if (process.env.SETTLEMENT_DELETE_PENDING_DEV === 'true') {
    const delP = await db.query(`DELETE FROM settlement_events WHERE status = 'pending'`);
    console.log(`DEV: deleted pending settlement_events: ${delP.rowCount ?? 0}`);
  }

  const after = await db.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count FROM settlement_events GROUP BY status ORDER BY status`
  );
  console.log('After:', after.rows.map((r) => `${r.status}=${r.count}`).join(', ') || '(empty)');

  const trades = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM spot_trades`);
  console.log(`spot_trades count: ${trades.rows[0]?.n ?? '0'}`);

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
