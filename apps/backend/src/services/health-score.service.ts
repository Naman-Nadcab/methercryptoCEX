/**
 * Exchange health score: compute overall score and per-metric 0–100 scores
 * for API latency, matching latency, RPC health, queue backlog.
 */

import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';

export interface HealthScoreResult {
  score: number;
  metrics: {
    api_latency: number;
    matching_latency: number;
    rpc_health: number;
    queue_backlog: number;
  };
}

/** Convert API latency ms to 0–100 score (100 = best). */
function apiLatencyScore(apiMs: number): number {
  if (apiMs <= 50) return 100;
  if (apiMs <= 100) return 95;
  if (apiMs <= 200) return 90;
  if (apiMs <= 500) return 70;
  if (apiMs <= 1000) return 50;
  return Math.max(0, 40 - Math.floor(apiMs / 500));
}

/** Convert matching engine latency ms to 0–100 score. */
function matchingLatencyScore(matchMs: number): number {
  if (matchMs <= 10) return 100;
  if (matchMs <= 50) return 95;
  if (matchMs <= 100) return 85;
  if (matchMs <= 200) return 70;
  return Math.max(0, 60 - Math.floor(matchMs / 100));
}

/** Queue backlog: 0 = 100, low backlog = high score. */
function queueBacklogScore(queues: number): number {
  if (queues <= 0) return 100;
  if (queues <= 50) return 95;
  if (queues <= 100) return 85;
  if (queues <= 500) return 70;
  if (queues <= 1000) return 50;
  return Math.max(0, 40 - Math.floor(queues / 500));
}

export async function computeHealthScore(): Promise<HealthScoreResult> {
  const [apiLatency, queues, rpcRows, tradingLatency] = await Promise.all([
    redis.get('monitoring:api_latency_ms').catch(() => null),
    (async () => {
      const [w, s, m] = await Promise.all([
        redis.get('monitoring:queue:withdrawal').catch(() => null),
        redis.get('monitoring:queue:settlement').catch(() => null),
        redis.get('monitoring:queue:matching').catch(() => null),
      ]);
      return (parseInt(w ?? '0', 10) || 0) + (parseInt(s ?? '0', 10) || 0) + (parseInt(m ?? '0', 10) || 0);
    })(),
    db.query<{ status: string }>('SELECT status FROM node_providers LIMIT 10').catch(() => ({ rows: [] })),
    redis.get('monitoring:matching_latency_ms').catch(() => null),
  ]);
  const apiMs = parseInt(apiLatency ?? '0', 10) || 0;
  const matchMs = parseInt(tradingLatency ?? '0', 10) || 0;
  const rpcHealthy = rpcRows.rows.filter((r) => r.status === 'active').length;
  const rpcTotal = Math.max(1, rpcRows.rows.length);
  const rpcHealth = Math.round((rpcHealthy / rpcTotal) * 100);

  const api_latency = apiLatencyScore(apiMs);
  const matching_latency = matchingLatencyScore(matchMs);
  const queue_backlog = queueBacklogScore(queues);

  let score = 100;
  if (apiMs > 500) score -= 25;
  else if (apiMs > 200) score -= 10;
  if (matchMs > 100) score -= 20;
  else if (matchMs > 50) score -= 5;
  if (queues > 1000) score -= 25;
  else if (queues > 100) score -= 10;
  if (rpcHealthy < rpcTotal) score -= Math.round((1 - rpcHealthy / rpcTotal) * 20);
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    metrics: {
      api_latency,
      matching_latency,
      rpc_health: rpcHealth,
      queue_backlog,
    },
  };
}
