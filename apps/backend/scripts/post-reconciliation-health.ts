/** Quick post-reconciliation checks (read-only). */
import 'dotenv/config';
import { db } from '../src/lib/database.js';
import { getSettlementCircuitOpen } from '../src/lib/trading-halt.js';
import { redis } from '../src/lib/redis.js';

async function main(): Promise<void> {
  const pool = db.getPool();
  const se = await pool.query(
    `SELECT status, count(*)::text AS n FROM settlement_events GROUP BY status ORDER BY status`
  );
  const trades = await pool.query(`SELECT count(*)::text AS n FROM spot_trades`);
  const circuit = await getSettlementCircuitOpen();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ settlement_events_by_status: se.rows, spot_trades_total: trades.rows[0]?.n, circuit_open: circuit }, null, 2));
  await db.close();
  await redis.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
