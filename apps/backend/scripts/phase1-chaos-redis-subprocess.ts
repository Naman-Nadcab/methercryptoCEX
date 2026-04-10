/**
 * Redis degraded vs strict gating — mirrors redis-health.service.ts (no Redis/config import; no dotenv clobber).
 */
const mode = process.env.PHASE1_VERIFY_REDIS_MODE === 'strict' ? 'strict' : 'degraded';

let lastPingOk = true;

function chaosSetRedisHealthyForTest(ok: boolean): void {
  if (process.env.CHAOS_TEST_HOOKS !== 'true') return;
  lastPingOk = ok;
}

function redisBlocksUserWithdrawals(): boolean {
  return !lastPingOk;
}

function redisBlocksSpotOrderPlacement(): boolean {
  if (lastPingOk) return false;
  return mode === 'strict';
}

function main(): void {
  process.env.CHAOS_TEST_HOOKS = 'true';
  chaosSetRedisHealthyForTest(false);
  const blockSpot = redisBlocksSpotOrderPlacement();
  const blockWd = redisBlocksUserWithdrawals();
  if (!blockWd) process.exit(10);
  if (mode === 'degraded') {
    if (blockSpot) process.exit(11);
  } else {
    if (!blockSpot) process.exit(12);
  }
  chaosSetRedisHealthyForTest(true);
  if (redisBlocksUserWithdrawals()) process.exit(13);
  if (redisBlocksSpotOrderPlacement()) process.exit(14);
  process.stdout.write('1');
}

main();
