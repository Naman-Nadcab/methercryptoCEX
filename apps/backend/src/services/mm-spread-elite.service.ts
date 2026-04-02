/**
 * Extra half-spread from feed latency, toxic flow, and asymmetric OFI widening.
 */
import { config } from '../config/index.js';

export type EliteSpreadAdjustments = {
  symmetricAddBps: number;
  bidHalfExtraBps: number;
  askHalfExtraBps: number;
};

export function computeFeeAwareHalfSpreadAddBps(makerFeeBps: number, takerFeeBps: number): number {
  const em = config.eliteMm;
  if (!em.feeAwareSpreadEnabled) return 0;
  const m = Math.max(0, makerFeeBps);
  const t = Math.max(0, takerFeeBps);
  return Math.round(em.feeAwareMakerMult * m + em.feeAwareTakerTailMult * t);
}

import type { MarketRegimeLabel } from './mm-regime.service.js';

/**
 * Dynamic profit target: vol, liquidity, regime (trending vs mean-reverting).
 * T = T₀ + k_v·min(1,σ/σ_ref) − k_l·min(τ,√(V/V_ref)) + Δ_trend − Δ_MR
 */
export function computeDynamicProfitTargetBps(
  volBps: number,
  quoteVolume1h: number,
  regime: MarketRegimeLabel = 'neutral'
): number {
  const em = config.eliteMm;
  const base = em.profitEdgeTargetBps;
  const volNorm = Math.min(1, Math.max(0, volBps) / Math.max(1, em.profitTargetVolRefBps));
  const volUplift = em.profitTargetVolCoeff * volNorm;
  const liqRatio = Math.sqrt(Math.max(0, quoteVolume1h) / Math.max(1, em.profitTargetLiqRefQuote));
  const liqTighten = em.profitTargetLiqCoeff * Math.min(1.25, liqRatio);
  let t = base + volUplift - liqTighten;
  if (regime === 'trending') t += em.regimeTrendTargetAddBps;
  if (regime === 'mean_reverting') t -= em.regimeMrTargetSubtractBps;
  return t;
}

/** Widen when realized edge is below target; tighten when above. */
export function computeProfitabilitySpreadAdjustBps(realizedEdgeBps1h: number, targetEdgeBps: number): number {
  const em = config.eliteMm;
  if (!em.profitSpreadEnabled) return 0;
  const gap = targetEdgeBps - realizedEdgeBps1h;
  const raw = em.profitSpreadCoeff * gap;
  return Math.round(
    Math.max(-em.profitSpreadMaxTightenBps, Math.min(em.profitSpreadMaxWidenBps, raw))
  );
}

/** Add half-spread bps from measured post-trade adverse selection. */
export function computeAdverseSelectionSpreadAddBps(adverseCostBps: number): number {
  const em = config.eliteMm;
  if (!em.adverseSpreadEnabled) return 0;
  const x = Math.max(0, adverseCostBps);
  const raw = em.adverseSpreadCoeff * x;
  return Math.round(Math.min(em.adverseSpreadCapBps, raw));
}

export function computeEliteSpreadAdjustments(input: {
  avgSourceLatencyMs: number;
  /** 0..1 composite (includes slippage + adverse); scaled into spread to avoid double-counting components. */
  toxicScore: number;
  ofi: number;
  coreHalfSpreadBps: number;
}): EliteSpreadAdjustments {
  const em = config.eliteMm;
  const lat = Math.max(0, input.avgSourceLatencyMs);
  const latPart = Math.min(em.latencySpreadCapBps, em.latencySpreadBpsPerMs * lat);
  const toxPart = Math.min(em.spreadToxicCapBps, Math.max(0, input.toxicScore) * em.spreadToxicCapBps);
  const symmetricAddBps = Math.round(latPart + toxPart);

  const k = em.flowSpreadCoeff * Math.max(0, input.coreHalfSpreadBps);
  const ofi = Math.max(-1, Math.min(1, input.ofi));
  const askHalfExtraBps = Math.round(k * Math.max(0, ofi));
  const bidHalfExtraBps = Math.round(k * Math.max(0, -ofi));

  return {
    symmetricAddBps,
    bidHalfExtraBps,
    askHalfExtraBps,
  };
}

/**
 * Latency-arbitrage protection: incremental widening when feed RTT exceeds reference and/or
 * external mid diverges from oracle (stale/slow external vs fast internal).
 * Δ_lat = k_ℓ·max(0, ℓ−ℓ₀), Δ_div = k_d·max(0, δ−δ₀), add = min(cap, Δ_lat+Δ_div).
 */
export function computeDeskLatencyArbAddBps(avgLatencyMs: number, extOracleDivBps: number | null): number {
  const em = config.eliteMm;
  if (!em.deskLatArbEnabled) return 0;
  const latEx = Math.max(0, avgLatencyMs - em.deskLatArbRefMs);
  const divEx =
    extOracleDivBps != null && Number.isFinite(extOracleDivBps)
      ? Math.max(0, extOracleDivBps - em.deskLatArbDivRefBps)
      : 0;
  const raw = em.deskLatArbLatCoeff * latEx + em.deskLatArbDivCoeff * divEx;
  return Math.round(Math.max(0, Math.min(em.deskLatArbCapBps, raw)));
}

/**
 * Pre-trade adverse from resting imbalance: widen both sides when |OBI| is large.
 * add = min(cap, k·|OBI|·h) with h = core half-spread (bps).
 */
export function computePreTradeBookAdverseBps(bookObi: number, coreHalfSpreadBps: number): number {
  const em = config.eliteMm;
  if (!em.deskBookAdvEnabled) return 0;
  const obi = Math.max(-1, Math.min(1, bookObi));
  const h = Math.max(0, coreHalfSpreadBps);
  const raw = em.deskBookAdvCoeff * Math.abs(obi) * h;
  return Math.round(Math.max(0, Math.min(em.deskBookAdvCapBps, raw)));
}

/**
 * Fast momentum: defensive widening on the side likely to be picked off (up-move → widen ask).
 */
export function computeMomentumHalfExtrasBps(momentumBps: number): { bidHalfExtraBps: number; askHalfExtraBps: number } {
  const em = config.eliteMm;
  if (!em.deskMomentumSpreadEnabled) return { bidHalfExtraBps: 0, askHalfExtraBps: 0 };
  const cap = em.deskMomentumHalfCapBps;
  const k = em.deskMomentumSpreadCoeff;
  const m = Math.max(-200, Math.min(200, momentumBps));
  const bidHalfExtraBps = Math.round(Math.min(cap, Math.max(0, k * Math.max(0, -m))));
  const askHalfExtraBps = Math.round(Math.min(cap, Math.max(0, k * Math.max(0, m))));
  return { bidHalfExtraBps, askHalfExtraBps };
}
