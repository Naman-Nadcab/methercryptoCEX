import { db } from '../src/lib/database.js';

async function main(): Promise<void> {
  const s = await db.query<{ status: string; c: string }>(
    `SELECT status, count(*)::text AS c FROM settlement_events GROUP BY status ORDER BY status`
  );
  const t = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM spot_trades`);
  console.log('settlement_events:', s.rows.map((r) => `${r.status}=${r.c}`).join(', ') || '(none)');
  console.log('spot_trades:', t.rows[0]?.n ?? '?');
  const failed = await db.query<{ id: string; last_error: string | null }>(
    `SELECT id::text, left(COALESCE(last_error,''), 160) AS last_error FROM settlement_events WHERE status = 'failed' LIMIT 5`
  );
  if (failed.rows.length) {
    console.log('failed samples:', JSON.stringify(failed.rows, null, 2));
  }
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
