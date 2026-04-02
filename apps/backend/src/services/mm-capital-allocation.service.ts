/**
 * Rank MM symbols: PnL, volume, vol, predictive trend & flow; EMA-smoothed weights with caps.
 */
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { getMmSymbolProfitMetrics } from './mm-pnl-metrics.service.js';
import { getRealizedVolatilityBps } from './mm-volatility.service.js';
import { getOrderFlowImbalance } from './mm-order-flow.service.js';

const CACHE_KEY_PREFIX = 'mm:alloc:';
const EMA_KEY_PREFIX = 'mm:alloc_ema:v1:';
const CACHE_TTL_SEC = 45;
const EMA_TTL_SEC = 604_800;

function equalWeights(symbols: string[]): Record<string, number> {
  const n = symbols.length;
  const u = n > 0 ? 1 / n : 1;
  return Object.fromEntries(symbols.map((s) => [s, u]));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function rankScores(scores: number[], higherIsBetter: boolean): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const idx = scores.map((s, i) => ({ s, i })).sort((a, b) => (higherIsBetter ? b.s - a.s : a.s - b.s));
  const ranks = new Array(n).fill(0);
  for (let pos = 0; pos < n; pos++) {
    ranks[idx[pos]!.i] = (n - pos) / n;
  }
  return ranks;
}

function regimeToTrendScore(label: string): number {
  if (label === 'trending') return 1;
  if (label === 'mean_reverting') return 0.22;
  return 0.55;
}

async function applyEmaAndCaps(
  userId: string,
  symbols: string[],
  rawNormalized: Record<string, number>
): Promise<Record<string, number>> {
  const em = config.eliteMm;
  const alpha = em.capitalAllocEmaAlpha;
  let wMin = em.capitalAllocWeightMin;
  let wMax = em.capitalAllocWeightMax;
  if (wMax < wMin) [wMin, wMax] = [wMax, wMin];

  const emaRaw: Record<string, number> = {};
  for (const sym of symbols) {
    const key = `${EMA_KEY_PREFIX}${userId}:${sym}`;
    let prev = rawNormalized[sym] ?? 1 / symbols.length;
    try {
      const stored = await redis.getJson<number>(key);
      if (stored != null && Number.isFinite(stored)) prev = stored;
    } catch {
      /* use prev */
    }
    const next = alpha * (rawNormalized[sym] ?? 0) + (1 - alpha) * prev;
    emaRaw[sym] = next;
    try {
      await redis.setJson(key, next, EMA_TTL_SEC);
    } catch {
      /* ignore */
    }
  }

  const capped: Record<string, number> = {};
  let sum = 0;
  for (const sym of symbols) {
    const c = Math.min(wMax, Math.max(wMin, emaRaw[sym] ?? wMin));
    capped[sym] = c;
    sum += c;
  }
  if (sum <= 0) return rawNormalized;
  const out: Record<string, number> = {};
  for (const sym of symbols) {
    out[sym] = capped[sym]! / sum;
  }
  return out;
}

/** ε-exploration: w_i ← (w_i(1+U_i)) / Σ_j w_j(1+U_j), U_i ~ Triangular[-ε,ε]. */
function applyExploration(weights: Record<string, number>, symbols: string[]): Record<string, number> {
  const em = config.eliteMm;
  if (!em.capitalExplorationEnabled || symbols.length === 0) return weights;
  const eps = em.capitalExplorationEpsilon;
  if (eps <= 0) return weights;
  let sum = 0;
  const perturbed: Record<string, number> = {};
  for (const sym of symbols) {
    const u = Math.random() + Math.random() - 1;
    const v = Math.max(1e-9, (weights[sym] ?? 0) * (1 + u * eps));
    perturbed[sym] = v;
    sum += v;
  }
  if (sum <= 0) return weights;
  const out: Record<string, number> = {};
  for (const sym of symbols) {
    out[sym] = perturbed[sym]! / sum;
  }
  return out;
}

export async function computeCapitalAllocationWeights(
  symbols: string[],
  userId: string
): Promise<Record<string, number>> {
  const em = config.eliteMm;
  if (!em.capitalAllocEnabled || symbols.length === 0) return equalWeights(symbols);

  const pnls: number[] = [];
  const vols: number[] = [];
  const volBps: number[] = [];
  const trendScores: number[] = [];
  const flowScores: number[] = [];

  for (const sym of symbols) {
    const m = await getMmSymbolProfitMetrics(sym, userId);
    pnls.push(m.h24.pnlQuote);
    vols.push(m.h24.quoteVolume);
    const vb = await getRealizedVolatilityBps(sym);
    volBps.push(Number.isFinite(vb) ? vb : 0);
    trendScores.push(regimeToTrendScore(m.quant.regime));
    const flow = await getOrderFlowImbalance(sym);
    flowScores.push((flow.ofi + 1) / 2);
  }

  const pnlR = rankScores(pnls, true);
  const volR = rankScores(vols, true);
  const calmR = rankScores(volBps, false);
  const trendR = rankScores(trendScores, true);
  const flowR = rankScores(flowScores, true);

  const wSum =
    em.capitalWeightPnl +
    em.capitalWeightVolume +
    em.capitalWeightVolatility +
    em.capitalWeightTrend +
    em.capitalWeightFlow;
  const wP = wSum > 0 ? em.capitalWeightPnl / wSum : 0.2;
  const wV = wSum > 0 ? em.capitalWeightVolume / wSum : 0.2;
  const wS = wSum > 0 ? em.capitalWeightVolatility / wSum : 0.2;
  const wT = wSum > 0 ? em.capitalWeightTrend / wSum : 0.2;
  const wF = wSum > 0 ? em.capitalWeightFlow / wSum : 0.2;

  const raw: Record<string, number> = {};
  let sum = 0;
  symbols.forEach((sym, i) => {
    const score = clamp01(
      wP * pnlR[i]! +
        wV * volR[i]! +
        wS * calmR[i]! +
        wT * trendR[i]! +
        wF * flowR[i]!
    );
    raw[sym] = Math.max(0.05, score);
    sum += raw[sym]!;
  });
  if (sum <= 0) return equalWeights(symbols);
  const rawNormalized: Record<string, number> = {};
  for (const sym of symbols) {
    rawNormalized[sym] = raw[sym]! / sum;
  }

  const capped = await applyEmaAndCaps(userId, symbols, rawNormalized);
  return applyExploration(capped, symbols);
}

export async function getCapitalAllocationWeights(symbols: string[], userId: string): Promise<Record<string, number>> {
  if (!config.eliteMm.capitalAllocEnabled) return equalWeights(symbols);
  const key = `${CACHE_KEY_PREFIX}${userId}:${symbols.sort().join(',')}`;
  try {
    const hit = await redis.getJson<Record<string, number>>(key);
    if (hit && typeof hit === 'object') return hit;
    const w = await computeCapitalAllocationWeights(symbols, userId);
    await redis.setJson(key, w, CACHE_TTL_SEC);
    return w;
  } catch {
    return computeCapitalAllocationWeights(symbols, userId);
  }
}
