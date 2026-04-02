import { db } from '../src/lib/database.js';

async function main(): Promise<void> {
  const r = await db.query<{ id: string; retry_count: string; err: string | null }>(
    `SELECT id::text, retry_count::text, left(COALESCE(last_error,''), 400) AS err
     FROM settlement_events WHERE status = 'pending' ORDER BY id`
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
