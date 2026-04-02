/**
 * Drain pending settlement_events by running the same logic as the in-API settlement worker.
 * Requires DATABASE_URL + Redis (trading halt / circuit are read from Redis; fail-closed if Redis errors).
 *
 * Run: cd apps/backend && npm run tier1:drain-settlement
 * If the API is also running the worker, you may see SKIP LOCKED contention — retry, or stop API briefly.
 * Env: TIER1_DRAIN_MAX_ITERATIONS=500 (default)
 *
 * If count does not drop: clear circuit `npx tsx scripts/clear-settlement-circuit.ts`, check global trading halt,
 * or inspect `npx tsx scripts/sre-pending-detail.ts`.
 */
import 'dotenv/config';
import { db } from '../src/lib/database.js';
import { redis } from '../src/lib/redis.js';
import { getSettlementCircuitOpen, getTradingHalted } from '../src/lib/trading-halt.js';
import { runSettlementWorkerOnce } from '../src/services/settlement/settlement-worker.js';

async function pendingCount(): Promise<number> {
  const r = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM settlement_events WHERE LOWER(TRIM(status::text)) = 'pending'`
  );
  return parseInt(r.rows[0]?.n ?? '0', 10);
}

async function main(): Promise<void> {
  let n = await pendingCount();
  console.log('[drain] settlement_events_pending', n);
  if (n === 0) {
    console.log('[drain] TIER1_DRAIN_SETTLEMENT_OK (already empty)');
    await db.close();
    await redis.close();
    return;
  }

  const halted = await getTradingHalted();
  const circuit = await getSettlementCircuitOpen();
  if (halted) {
    console.warn('[drain] WARN: global trading halt is ON in Redis — worker will skip ticks. Clear halt before drain.');
  }
  if (circuit) {
    console.warn('[drain] WARN: settlement circuit OPEN — worker will skip. Run: npx tsx scripts/clear-settlement-circuit.ts');
  }

  const maxIter = Math.min(5000, Math.max(1, parseInt(process.env.TIER1_DRAIN_MAX_ITERATIONS ?? '500', 10)));
  let prev = n;
  let staleTicks = 0;

  for (let i = 0; i < maxIter; i++) {
    await runSettlementWorkerOnce();
    n = await pendingCount();
    if (n === 0) {
      console.log('[drain] TIER1_DRAIN_SETTLEMENT_OK after', i + 1, 'tick(s)');
      await db.close();
      await redis.close();
      return;
    }
    if (n === prev) {
      staleTicks += 1;
    } else {
      staleTicks = 0;
    }
    prev = n;
    if (staleTicks >= 5) {
      const h = await getTradingHalted();
      const c = await getSettlementCircuitOpen();
      console.error('[drain] no progress after 5 ticks; pending=', n, {
        globalTradingHalt: h,
        settlementCircuitOpen: c,
      });
      break;
    }
    if ((i + 1) % 25 === 0) {
      console.log('[drain] still pending', n, 'ticks', i + 1);
    }
  }

  n = await pendingCount();
  console.log('[drain] settlement_events_pending', n);
  if (n > 0) {
    console.error('[drain] TIER1_DRAIN_SETTLEMENT_INCOMPLETE — see sre-pending-detail.ts / circuit / halt');
    await db.close();
    await redis.close();
    process.exit(1);
  }
  await db.close();
  await redis.close();
}

main().catch(async (e) => {
  console.error('[drain] FAIL:', e instanceof Error ? e.message : e);
  try {
    await db.close();
  } catch {
    /* ignore */
  }
  try {
    await redis.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
