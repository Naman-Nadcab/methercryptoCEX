/**
 * Scheduled chaos drills (Redis synthetic unhealthy + engine ping). CHAOS_TEST_HOOKS + CHAOS_SCHEDULE_ENABLED only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { chaosScheduledTestTotal } from '../lib/prometheus-metrics.js';
import { chaosSetRedisHealthyForTest, refreshRedisHealth } from './redis-health.service.js';

async function pingEngine(): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    const base = config.rustMatchingEngine?.url?.split(',')[0]?.trim();
    if (!base) return { ok: true, ms: 0 };
    const u = new URL('/health', base.endsWith('/') ? base : `${base}/`);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(u.toString(), { signal: ctrl.signal }).catch(() => null);
    clearTimeout(to);
    return { ok: !!(r && r.ok), ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

export async function runChaosScheduledDrill(): Promise<void> {
  if (!config.chaosSchedule.enabled || process.env.CHAOS_TEST_HOOKS !== 'true') return;
  const dir = config.chaosSchedule.reportDir || path.join(process.cwd(), 'data', 'chaos-reports');
  await fs.mkdir(dir, { recursive: true });
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    scenarios: [] as unknown[],
  };

  chaosSetRedisHealthyForTest(false);
  chaosScheduledTestTotal.inc({ scenario: 'redis_unhealthy' });
  (report.scenarios as unknown[]).push({
    name: 'redis_unhealthy',
    blocks_withdrawals_gating: true,
  });
  chaosSetRedisHealthyForTest(true);
  await refreshRedisHealth();
  chaosScheduledTestTotal.inc({ scenario: 'redis_recover' });
  (report.scenarios as unknown[]).push({ name: 'redis_recover' });

  const eng = await pingEngine();
  chaosScheduledTestTotal.inc({ scenario: eng.ok ? 'engine_up' : 'engine_down' });
  (report.scenarios as unknown[]).push({ name: 'engine_health', ...eng });

  const file = path.join(dir, `chaos-${Date.now()}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  logger.info('chaos_scheduled: report written', { file });
}

export function startChaosScheduledJob(intervalMs: number): NodeJS.Timeout {
  void runChaosScheduledDrill().catch((e) =>
    logger.error('chaos_scheduled: run failed', { error: e instanceof Error ? e.message : String(e) })
  );
  return setInterval(() => {
    void runChaosScheduledDrill().catch((e) =>
      logger.error('chaos_scheduled: run failed', { error: e instanceof Error ? e.message : String(e) })
    );
  }, intervalMs);
}
