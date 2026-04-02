/**
 * Metrics-driven MM circuit: trip on toxic / OFI / external divergence; hysteresis clear thresholds + streak-based recovery.
 */
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import {
  getMmCircuitState,
  setMmCircuitState,
  clearMmCircuitIfAutoManaged,
} from './mm-circuit-breaker.service.js';
import { computeMmHealthSnapshot, getLastMmHealthSnapshot } from './mm-health.service.js';
import { getOrderFlowImbalance } from './mm-order-flow.service.js';
import { getToxicFlowMetrics } from './mm-toxic-flow.service.js';

const OK_STREAK_KEY = 'mm_circuit:auto_ok_streak';

function sanitizeClearTrip(clear: number, trip: number, defaultRatio = 0.72): { clear: number; trip: number } {
  const t = Math.max(trip, 1e-6);
  let c = clear;
  if (!(c < t)) c = t * defaultRatio;
  return { clear: c, trip: t };
}

export async function runMmAutoCircuitEvaluation(): Promise<void> {
  const em = config.eliteMm;
  if (!em.autoCircuitEnabled) return;
  if (!config.liquidityBot.enabled) return;

  const symbols = config.liquidityBot.symbols;
  if (symbols.length === 0) return;

  await computeMmHealthSnapshot();
  const snap = getLastMmHealthSnapshot();

  let maxToxic = 0;
  let maxOfiAbs = 0;
  for (const sym of symbols) {
    const t = await getToxicFlowMetrics(sym);
    maxToxic = Math.max(maxToxic, t.toxicScore);
    const f = await getOrderFlowImbalance(sym);
    maxOfiAbs = Math.max(maxOfiAbs, Math.abs(f.ofi));
  }

  const extDiv = snap?.externalMaxDivergenceBps ?? null;

  const tox = sanitizeClearTrip(em.autoCircuitToxicClearThreshold, em.autoCircuitToxicScoreThreshold);
  const ofi = sanitizeClearTrip(em.autoCircuitOfiClearThreshold, em.autoCircuitOfiAbsThreshold);
  const extTrip = em.autoCircuitExtDivergenceBps;
  let extClear = em.autoCircuitExtDivergenceClearBps;
  if (extClear >= extTrip) extClear = Math.max(5, Math.floor(extTrip * 0.72));

  const shouldTrip =
    maxToxic >= tox.trip || maxOfiAbs >= ofi.trip || (extDiv != null && extDiv >= extTrip);

  const inClearZone =
    maxToxic < tox.clear &&
    maxOfiAbs < ofi.clear &&
    (extDiv == null || extDiv < extClear);

  const state = await getMmCircuitState();

  if (!state.tradingPaused) {
    try {
      await redis.del(OK_STREAK_KEY);
    } catch {
      /* ignore */
    }
    if (shouldTrip) {
      await setMmCircuitState({ tradingPaused: true, orderPlacementBlocked: true }, { source: 'auto' });
      logger.warn('MM auto-circuit tripped', {
        maxToxic,
        maxOfiAbs,
        extDiv,
        thresholds: { toxic: tox.trip, ofi: ofi.trip, ext: extTrip },
      });
    }
    return;
  }

  if (state.autoManaged && state.tradingPaused) {
    if (!inClearZone) {
      try {
        await redis.del(OK_STREAK_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const streak = await redis.incr(OK_STREAK_KEY);
      await redis.expire(OK_STREAK_KEY, 600);
      if (streak >= em.autoCircuitOkStreak) {
        await clearMmCircuitIfAutoManaged();
        await redis.del(OK_STREAK_KEY);
        logger.warn('MM auto-circuit cleared (hysteresis OK zone + streak)', {
          streak,
          maxToxic,
          maxOfiAbs,
          extDiv,
          clear: { toxic: tox.clear, ofi: ofi.clear, ext: extClear },
        });
      }
    } catch (e) {
      logger.warn('MM auto-circuit streak update failed', { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  try {
    await redis.del(OK_STREAK_KEY);
  } catch {
    /* ignore */
  }
}
