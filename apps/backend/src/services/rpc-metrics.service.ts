/**
 * RPC Metrics Tracking Service
 *
 * Tracks RPC call success/failure rates using Redis counters with 5-minute sliding windows.
 * Publishes the failure percentage to `safety_metrics:rpc_failure_percentage` for the
 * safety-trigger-worker to consume.
 */

import { redis } from '../lib/redis.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';

const WINDOW_SECONDS = 300; // 5 minute window
const REDIS_PREFIX = 'rpc_metrics:';
const SAFETY_METRIC_KEY = 'safety_metrics:rpc_failure_percentage';

export async function recordRpcCall(chain: string, success: boolean, failureReason?: string): Promise<void> {
  try {
    const totalKey = `${REDIS_PREFIX}${chain}:total`;
    const failKey = `${REDIS_PREFIX}${chain}:failed`;

    await redis.incr(totalKey);
    if (!success) {
      await redis.incr(failKey);
    }

    // Ensure keys expire after the window
    await redis.expire(totalKey, WINDOW_SECONDS);
    await redis.expire(failKey, WINDOW_SECONDS);

    // Update the aggregated failure percentage for safety trigger worker
    await updateAggregateFailureRate();

    // Persist to DB periodically (best-effort, only on failures)
    if (!success) {
      try {
        await db.query(
          `INSERT INTO rpc_metrics (chain, total_requests, failed_requests, last_failure_reason, window_start, window_end)
           VALUES ($1, 1, 1, $2, NOW(), NOW() + INTERVAL '5 minutes')
           ON CONFLICT DO NOTHING`,
          [chain, failureReason || 'unknown']
        );
      } catch { /* best-effort DB persist */ }
    }
  } catch (e) {
    logger.warn('recordRpcCall failed', { chain, success, error: e instanceof Error ? e.message : String(e) });
  }
}

async function updateAggregateFailureRate(): Promise<void> {
  try {
    const chains = ['ethereum', 'bsc', 'polygon', 'tron', 'solana', 'bitcoin'];
    let totalAll = 0;
    let failedAll = 0;

    for (const chain of chains) {
      const total = parseInt(await redis.get(`${REDIS_PREFIX}${chain}:total`) || '0', 10);
      const failed = parseInt(await redis.get(`${REDIS_PREFIX}${chain}:failed`) || '0', 10);
      totalAll += total;
      failedAll += failed;
    }

    const failureRate = totalAll > 0 ? (failedAll / totalAll) * 100 : 0;
    await redis.set(SAFETY_METRIC_KEY, String(Math.round(failureRate * 100) / 100), WINDOW_SECONDS);
  } catch { /* best-effort */ }
}

export async function getRpcMetrics(): Promise<{
  chains: Array<{ chain: string; total: number; failed: number; failureRate: number }>;
  aggregateFailureRate: number;
}> {
  const chains = ['ethereum', 'bsc', 'polygon', 'tron', 'solana', 'bitcoin'];
  const result: Array<{ chain: string; total: number; failed: number; failureRate: number }> = [];
  let totalAll = 0;
  let failedAll = 0;

  for (const chain of chains) {
    try {
      const total = parseInt(await redis.get(`${REDIS_PREFIX}${chain}:total`) || '0', 10);
      const failed = parseInt(await redis.get(`${REDIS_PREFIX}${chain}:failed`) || '0', 10);
      const rate = total > 0 ? (failed / total) * 100 : 0;
      result.push({ chain, total, failed, failureRate: Math.round(rate * 100) / 100 });
      totalAll += total;
      failedAll += failed;
    } catch {
      result.push({ chain, total: 0, failed: 0, failureRate: 0 });
    }
  }

  return {
    chains: result,
    aggregateFailureRate: totalAll > 0 ? Math.round((failedAll / totalAll) * 10000) / 100 : 0,
  };
}
