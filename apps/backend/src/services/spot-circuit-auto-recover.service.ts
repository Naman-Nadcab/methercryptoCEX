/**
 * Spot per-symbol circuit breaker — auto-recovery sweeper.
 *
 * When /spot/order repeatedly fails for a symbol, recordCircuitBreaker() in
 * spot.fastify.ts increments a Redis counter and, once the threshold is crossed,
 * flips spot_markets.status to 'maintenance'. Historically that was terminal: an
 * admin had to call /admin/spot/markets/:symbol/circuit-reset.
 *
 * This sweeper reopens markets that were tripped by the breaker once they have
 * been "quiet" (no new failures) for RECOVERY_WINDOW_MS. Manually-paused markets
 * are left alone — we only touch markets that carry the "tripped" marker key that
 * the breaker sets, never plain admin pauses.
 */
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { invalidateMarketsCache } from './spot-markets-cache.service.js';

const CIRCUIT_COUNTER_PREFIX = 'spot:circuit:';
const CIRCUIT_TRIPPED_SUFFIX = ':tripped'; // marker key, written only by the breaker
const SWEEP_INTERVAL_MS = 60_000;
const RECOVERY_WINDOW_MS = 10 * 60_000; // 10 minutes
const TRIPPED_TTL_SECONDS = 24 * 60 * 60; // keep marker for a day so admin can audit

let sweeperTimer: NodeJS.Timeout | null = null;

/**
 * Called from recordCircuitBreaker() at the moment it flips the market to
 * 'maintenance'. Records that this maintenance was auto-tripped (not admin-paused)
 * and stamps the trip time, so the sweeper knows it is allowed to recover.
 */
export async function markCircuitTripped(symbol: string): Promise<void> {
  const trippedKey = `${CIRCUIT_COUNTER_PREFIX}${symbol}${CIRCUIT_TRIPPED_SUFFIX}`;
  try {
    const payload = JSON.stringify({ symbol, trippedAt: Date.now() });
    const client = redis as unknown as {
      setex?: (k: string, ttl: number, v: string) => Promise<unknown>;
      set?: (k: string, v: string, ...args: unknown[]) => Promise<unknown>;
    };
    if (typeof client.setex === 'function') {
      await client.setex(trippedKey, TRIPPED_TTL_SECONDS, payload);
    } else if (typeof client.set === 'function') {
      await client.set(trippedKey, payload, 'EX', TRIPPED_TTL_SECONDS);
    }
  } catch (e) {
    logger.warn('markCircuitTripped failed', {
      symbol,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

async function runSweep(): Promise<void> {
  let markets: { symbol: string; updated_at: string }[] = [];
  try {
    const result = await db.query<{ symbol: string; updated_at: string }>(
      `SELECT symbol, updated_at::text AS updated_at
         FROM spot_markets
        WHERE status = 'maintenance'
          AND updated_at < NOW() - INTERVAL '10 minutes'`
    );
    markets = result.rows;
  } catch (e) {
    logger.warn('spot_circuit_auto_recover: db probe failed', {
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  if (markets.length === 0) return;

  const client = redis as unknown as {
    get?: (k: string) => Promise<string | null>;
    del?: (k: string) => Promise<unknown>;
    exists?: (k: string) => Promise<number>;
  };

  for (const { symbol } of markets) {
    const counterKey = `${CIRCUIT_COUNTER_PREFIX}${symbol}`;
    const trippedKey = `${counterKey}${CIRCUIT_TRIPPED_SUFFIX}`;

    try {
      // Only auto-recover if this maintenance was set by the breaker (tripped marker
      // exists). Manual admin pauses carry no marker and stay paused.
      const trippedRaw = typeof client.get === 'function' ? await client.get(trippedKey) : null;
      if (!trippedRaw) continue;

      let trippedAt = 0;
      try {
        trippedAt = Number((JSON.parse(trippedRaw) as { trippedAt?: number }).trippedAt) || 0;
      } catch {
        trippedAt = 0;
      }
      if (!trippedAt || Date.now() - trippedAt < RECOVERY_WINDOW_MS) continue;

      // The counter key has a short TTL (set by recordCircuitBreaker); when it has
      // fully expired the market has been quiet for at least that window.
      const counterExists =
        typeof client.exists === 'function' ? (await client.exists(counterKey)) > 0 : false;
      if (counterExists) continue;

      await db.query(
        `UPDATE spot_markets SET status = 'active', updated_at = NOW() WHERE symbol = $1 AND status = 'maintenance'`,
        [symbol]
      );
      try {
        if (typeof client.del === 'function') {
          await client.del(counterKey);
          await client.del(trippedKey);
        }
      } catch {
        // best effort
      }
      try {
        await invalidateMarketsCache();
      } catch {
        // best effort
      }
      logger.info('spot_circuit_auto_recover', {
        symbol,
        trippedAt: new Date(trippedAt).toISOString(),
        recoveredAt: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn('spot_circuit_auto_recover: per-symbol failed', {
        symbol,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export function startSpotCircuitAutoRecover(): void {
  if (sweeperTimer) return;
  logger.info('spot_circuit_auto_recover: sweeper started', {
    intervalMs: SWEEP_INTERVAL_MS,
    recoveryWindowMs: RECOVERY_WINDOW_MS,
  });
  sweeperTimer = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);
  if (typeof sweeperTimer.unref === 'function') sweeperTimer.unref();
}

export function stopSpotCircuitAutoRecover(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}
