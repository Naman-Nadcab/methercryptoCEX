/** SRE: settlement status + final counts. Usage: npx tsx scripts/sre-sql-snapshot.ts */
import { db } from '../src/lib/database.js';

async function main(): Promise<void> {
  const st = await db.query<{ status: string; c: string }>(
    `SELECT status::text, count(*)::text AS c FROM settlement_events GROUP BY status ORDER BY status`
  );
  console.log('settlement_events by status:', JSON.stringify(st.rows));

  const spot = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM spot_trades`);
  console.log('spot_trades count:', spot.rows[0]?.n);

  const nonProc = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM settlement_events WHERE lower(status::text) != 'processed'`
  );
  console.log('settlement_events status != processed:', nonProc.rows[0]?.n);

  const neg = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM user_balances WHERE available_balance < 0 OR locked_balance < 0`
  );
  console.log('user_balances negative rows:', neg.rows[0]?.n);

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
