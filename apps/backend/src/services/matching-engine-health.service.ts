/**
 * HTTP reachability for Rust matching engine(s) (Tier-1 /health gate).
 * Probes GET /health on every configured instance; ok if at least one responds.
 */

import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { listMatchingEngineInstances } from './settlement/matching-engine-registry.js';
import {
  probeMatchingEngineInstanceHealth,
  refreshAllMatchingEngineHealth,
} from './settlement/matching-engine-runtime-health.service.js';

export async function probeMatchingEngineHttp(): Promise<{
  ok: boolean;
  latency_ms?: number;
  error?: string;
}> {
  if (!config.rustMatchingEngine.enabled) return { ok: true };
  const instances = listMatchingEngineInstances();
  let bestLatency = 0;
  let anyOk = false;
  let lastErr = '';
  for (const inst of instances) {
    const r = await probeMatchingEngineInstanceHealth(inst);
    if (r.latencyMs != null && r.latencyMs > bestLatency) bestLatency = r.latencyMs;
    if (r.ok) {
      anyOk = true;
    } else {
      lastErr = `down:${inst.id}`;
    }
  }
  if (anyOk) {
    return { ok: true, latency_ms: bestLatency };
  }
  return { ok: false, latency_ms: bestLatency, error: lastErr || 'all_instances_down' };
}

/** Block startup until at least one engine answers /health (strict Tier-1). */
export async function waitForMatchingEngineReady(maxWaitMs: number): Promise<boolean> {
  if (!config.rustMatchingEngine.enabled) return true;
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    const r = await probeMatchingEngineHttp();
    if (r.ok) {
      logger.info('✓ Matching engine(s) reachable', { latency_ms: r.latency_ms });
      await refreshAllMatchingEngineHealth();
      return true;
    }
    attempt++;
    const delay = Math.min(1500 * attempt, 8_000);
    logger.warn('Matching engine(s) not ready; retrying', {
      attempt,
      error: r.error,
      next_retry_ms: delay,
    });
    await new Promise((res) => setTimeout(res, delay));
  }
  logger.error('Matching engine(s) unreachable after wait window', { maxWaitMs });
  return false;
}
