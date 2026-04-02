/**
 * In-process health snapshots for each matching-engine instance (/health).
 * Placement can skip unhealthy engines; pollers still attempt all instances so matches are not missed.
 */
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import {
  listMatchingEngineInstances,
  type MatchingEngineInstance,
} from './matching-engine-registry.js';

type HealthEntry = { ok: boolean; checkedAt: number; latencyMs?: number; reportedEngineId?: string };

const cache = new Map<string, HealthEntry>();

export async function probeMatchingEngineInstanceHealth(inst: MatchingEngineInstance): Promise<HealthEntry> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 2500);
  const t0 = Date.now();
  try {
    const r = await fetch(`${inst.baseUrl}/health`, { signal: ac.signal });
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return { ok: false, checkedAt: Date.now(), latencyMs };
    }
    const j = (await r.json()) as { ok?: boolean; engine_id?: string };
    const reportedEngineId = typeof j.engine_id === 'string' ? j.engine_id : undefined;
    if (reportedEngineId && reportedEngineId !== inst.id) {
      logger.warn('matching-engine /health engine_id differs from configured instance id', {
        configuredId: inst.id,
        reportedEngineId,
        baseUrl: inst.baseUrl,
      });
    }
    return { ok: j.ok !== false, checkedAt: Date.now(), latencyMs, reportedEngineId };
  } catch {
    return { ok: false, checkedAt: Date.now(), latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(to);
  }
}

export async function refreshAllMatchingEngineHealth(): Promise<void> {
  const list = listMatchingEngineInstances();
  await Promise.all(
    list.map(async (inst) => {
      const h = await probeMatchingEngineInstanceHealth(inst);
      cache.set(inst.id, h);
    })
  );
}

/** Unknown / not yet probed → treated healthy so cold start does not block traffic. */
export function isMatchingEngineInstanceHealthy(id: string): boolean {
  const e = cache.get(id);
  if (!e) return true;
  return e.ok;
}

export class MatchingEngineUnhealthyError extends Error {
  override readonly name = 'MatchingEngineUnhealthyError';
  constructor(public readonly engineId: string) {
    super(`Matching engine instance unhealthy: ${engineId}`);
  }
}

export function assertEngineHealthyForPlace(engineId: string): void {
  if (!config.rustMatchingEngine.enabled) return;
  if (!config.rustMatchingEngine.skipUnhealthyForPlace) return;
  if (!isMatchingEngineInstanceHealthy(engineId)) {
    throw new MatchingEngineUnhealthyError(engineId);
  }
}
