/**
 * Redis liveness for HA / degraded-mode gating.
 */
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

let lastPingOk = true;
let lastPingAt = 0;
let consecutiveFailures = 0;

export async function refreshRedisHealth(): Promise<void> {
  try {
    await redis.ping();
    lastPingOk = true;
    consecutiveFailures = 0;
  } catch {
    lastPingOk = false;
    consecutiveFailures = Math.min(consecutiveFailures + 1, 1_000_000);
    logger.warn('Redis health ping failed', { consecutiveFailures });
  }
  lastPingAt = Date.now();
}

export function isRedisHealthy(): boolean {
  return lastPingOk;
}

export function getRedisHealthSnapshot(): { ok: boolean; lastPingAt: number; consecutiveFailures: number; mode: string } {
  return {
    ok: lastPingOk,
    lastPingAt,
    consecutiveFailures,
    mode: config.redis.failoverMode,
  };
}

/** High-risk actions require Redis when strict, or when degraded and Redis is down. */
export function redisBlocksHighRiskActions(): boolean {
  return !lastPingOk;
}

/** User withdrawals: blocked whenever Redis is unhealthy (strict or degraded). */
export function redisBlocksUserWithdrawals(): boolean {
  return !lastPingOk;
}

/** Spot order placement: strict → fail-closed when Redis down; degraded → allow limited trading path. */
export function redisBlocksSpotOrderPlacement(): boolean {
  if (lastPingOk) return false;
  return config.redis.failoverMode === 'strict';
}

export function startRedisHealthMonitor(intervalMs = 3000): NodeJS.Timeout {
  void refreshRedisHealth();
  return setInterval(() => {
    void refreshRedisHealth();
  }, intervalMs);
}

/**
 * Chaos / verify scripts only: flip liveness without touching Redis.
 * Gated by CHAOS_TEST_HOOKS=true (never enable in production).
 */
export function chaosSetRedisHealthyForTest(ok: boolean): void {
  if (process.env.CHAOS_TEST_HOOKS !== 'true') return;
  lastPingOk = ok;
  lastPingAt = Date.now();
}
