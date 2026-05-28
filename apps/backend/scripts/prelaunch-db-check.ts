/**
 * Read-only pre-launch DB checks: settlement counts, duplicate keys, orphan ledger hints.
 * Usage: npx tsx scripts/prelaunch-db-check.ts
 */
import { db } from '../src/lib/database.js';

async function queryWithRetry<T>(sql: string): Promise<{ rows: T[] }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (await db.query<T>(sql)) as { rows: T[] };
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
  const se = await queryWithRetry<{ status: string; c: string }>(
    `SELECT status::text, count(*)::text AS c FROM settlement_events GROUP BY status ORDER BY status`
  );
  console.log('settlement_events:', se.rows.map((r) => `${r.status}=${r.c}`).join(', ') || '(none)');

  const st = await queryWithRetry<{ c: string }>(`SELECT count(*)::text AS c FROM spot_trades`);
  console.log('spot_trades:', st.rows[0]?.c ?? '?');

  const dup = await queryWithRetry<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT match_engine_id, engine_event_id FROM settlement_events GROUP BY 1,2 HAVING count(*) > 1
     ) x`
  );
  console.log('duplicate (match_engine_id, engine_event_id) groups:', dup.rows[0]?.n ?? '?');

  const sle = await queryWithRetry<{ c: string }>(`SELECT count(*)::text AS c FROM settlement_ledger_entries`);
  console.log('settlement_ledger_entries rows:', sle.rows[0]?.c ?? '?');

  const orphan = await queryWithRetry<{ c: string }>(
    `SELECT count(*)::text AS c FROM settlement_ledger_entries sle
     WHERE NOT EXISTS (SELECT 1 FROM settlement_events se WHERE se.id = sle.settlement_event_id)`
  );
  console.log('settlement_ledger_entries with missing settlement_event:', orphan.rows[0]?.c ?? '?');

  const hasBl = await queryWithRetry<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'balance_ledger') AS e`
  );
  if (hasBl.rows[0]?.e) {
    const neg = await queryWithRetry<{ c: string }>(
      `SELECT count(*)::text AS c FROM user_balances WHERE available_balance < 0 OR locked_balance < 0`
    );
    console.log('user_balances negative rows:', neg.rows[0]?.c ?? '?');
    console.log('(balance_ledger reconciliation: run spot integrity / admin tooling if configured)');
  } else {
    console.log('balance_ledger: table not present — skipped');
  }

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
