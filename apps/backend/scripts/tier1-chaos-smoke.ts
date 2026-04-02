/**
 * Manual chaos / smoke checklist for Tier-1 durability (run in staging).
 *
 * Scenarios to execute by hand or automate with k6/curl:
 * 1. Engine crash: kill matching-engine during burst; verify settlement_events has no gaps vs engine replay after restart.
 * 2. Postgres slow: throttle DB; spot place returns 503 MATCH_EVENT_PERSIST_UNAVAILABLE; verify retry inserts rows.
 * 3. Redis down: SPOT_ENGINE_WS_DEDUP_REDIS=true → dedup falls back local; expect possible duplicate WS on multi-instance only.
 * 4. Settlement worker stop: pending settlement_events grows; gauges settlement_pending_count / settlement_lag_seconds alert.
 * 5. P2P secure proof: set P2P_PAYMENT_PROOF_STORAGE=secure; upload proof; GET /p2p/orders/:id/payment-proof with buyer token returns image.
 *
 * Run: npx tsx apps/backend/scripts/tier1-chaos-smoke.ts
 */
import { redis } from '../src/lib/redis.js';
import { logger } from '../src/lib/logger.js';

async function main(): Promise<void> {
  await redis.connect().catch(() => {});
  const key = `tier1:chaos:${Date.now()}`;
  const ok = await redis.setNxEx(key, '1', 60);
  logger.info('tier1-chaos-smoke: redis SET NX', { ok, key });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
