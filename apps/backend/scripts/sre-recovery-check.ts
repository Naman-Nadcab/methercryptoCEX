/** SRE recovery snapshot — settlement_events + spot_trades. */
import 'dotenv/config';
import { db } from '../src/lib/database.js';

async function main(): Promise<void> {
  const pool = db.getPool();
  const se = await pool.query(
    `SELECT status, count(*)::text AS n FROM settlement_events GROUP BY status ORDER BY status`
  );
  const st = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM spot_trades`);
  const pending = await pool.query(
    `SELECT id, engine_event_id, status, retry_count, last_error,
            left(payload::text, 100) AS payload_snip, created_at
     FROM settlement_events WHERE status = 'pending' ORDER BY id`
  );
  // eslint-disable-next-line no-console
  console.log('settlement_events:', JSON.stringify(se.rows, null, 2));
  // eslint-disable-next-line no-console
  console.log('spot_trades_count:', st.rows[0]?.n);
  // eslint-disable-next-line no-console
  console.log('pending_detail:', JSON.stringify(pending.rows, null, 2));
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
