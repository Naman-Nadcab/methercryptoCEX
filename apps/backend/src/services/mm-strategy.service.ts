/**
 * Lightweight spread policy for MM runtime pair overrides (auto vs manual, flow / global mode)
 * plus profit-oriented vol / inventory / PnL adjustments (computeMmProfitOrientedQuote).
 */
import type { MMGlobalMode, MMPairRuntimeConfig, SpreadMode } from './mm-runtime-config.service.js';
import { logger } from '../lib/logger.js';

export type MmStrategyInventoryHint = {
  /** Extra half-spread widening from inventory risk (bps); softens/tightens auto path only. */
  extraSpreadBps?: number;
};

const VOL_REF_BPS = 80;
/** Realized vol at or above this ⇒ size_multiplier applies 0.7 (profit-oriented sizing). */
const HIGH_VOL_THRESHOLD_BPS = 70;

function clampSpread(bps: number): number {
  return Math.min(500, Math.max(1, Math.round(bps)));
}

function normalizeStrategySymbol(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/-/g, '_');
}

export function isMajorBtcEthSymbol(symbol: string | undefined): boolean {
  const s = normalizeStrategySymbol(symbol);
  return s === 'BTC_USDT' || s === 'BTCUSDT' || s === 'ETH_USDT' || s === 'ETHUSDT';
}

/** Final full-spread safety band (bps). */
export function clampMmFullSpreadBps(bps: number): number {
  if (!Number.isFinite(bps)) return 5;
  return Math.min(50, Math.max(5, Math.round(bps * 100) / 100));
}

/** Task 1: anchor desk base into BTC/ETH 8–10 bps vs alts 12–18 bps. */
function optimalTierBaseSpreadBps(symbol: string | undefined, raw: number): number {
  const x = Number.isFinite(raw) && raw > 0 ? raw : isMajorBtcEthSymbol(symbol) ? 9 : 15;
  if (isMajorBtcEthSymbol(symbol)) return Math.min(10, Math.max(8, Math.round(x)));
  return Math.min(18, Math.max(12, Math.round(x)));
}

function clampSpreadBuild(bps: number): number {
  return clampMmFullSpreadBps(bps);
}

function scaleHalvesToTargetFull(
  bid: number,
  ask: number,
  targetFull: number
): { bid_spread_bps: number; ask_spread_bps: number; spread_bps: number } {
  const minH = 2.5;
  let b = Math.max(minH, bid);
  let a = Math.max(minH, ask);
  let sum = b + a;
  if (sum < 1e-9) {
    const h = Math.max(minH, targetFull / 2);
    b = h;
    a = h;
    sum = b + a;
  }
  const r = targetFull / sum;
  b = Math.max(minH, b * r);
  a = Math.max(minH, a * r);
  sum = b + a;
  const r2 = targetFull / sum;
  b = Math.max(minH, b * r2);
  a = Math.max(minH, a * r2);
  return {
    bid_spread_bps: Math.round(b * 100) / 100,
    ask_spread_bps: Math.round(a * 100) / 100,
    spread_bps: Math.round((b + a) * 100) / 100,
  };
}

function clampSizeMultFinal(m: number): number {
  if (!Number.isFinite(m)) return 1;
  return Math.min(1.5, Math.max(0.4, m));
}

/** Round-trip fee floor for full spread (bps): 2 × max(maker, taker) per leg, conservative. */
export function computeMinProfitSpreadBps(makerFeeBps: number, takerFeeBps: number): number {
  const m = Math.max(0, Number.isFinite(makerFeeBps) ? makerFeeBps : 0);
  const t = Math.max(0, Number.isFinite(takerFeeBps) ? takerFeeBps : 0);
  return 2 * Math.max(m, t);
}

function applyMinProfitSpreadFloor(
  q: MmProfitOrientedQuote,
  makerFeeBps: number,
  takerFeeBps: number
): MmProfitOrientedQuote {
  const minFull = computeMinProfitSpreadBps(makerFeeBps, takerFeeBps);
  if (minFull <= 1e-6 || q.spread_bps >= minFull) return q;
  const r = minFull / Math.max(1e-6, q.spread_bps);
  let bid = q.bid_spread_bps * r;
  let ask = q.ask_spread_bps * r;
  bid = Math.max(2.5, bid);
  ask = Math.max(2.5, ask);
  let sum = bid + ask;
  if (sum < minFull) {
    const add = (minFull - sum) / 2;
    bid += add;
    ask += add;
    sum = bid + ask;
  }
  return {
    spread_bps: Math.round(sum * 100) / 100,
    bid_spread_bps: Math.round(bid * 100) / 100,
    ask_spread_bps: Math.round(ask * 100) / 100,
    size_multiplier: q.size_multiplier,
  };
}

type SpreadLearnState = { adjBps: number; cyclesWithoutNewFill: number };
const spreadLearnBySymbol = new Map<string, SpreadLearnState>();
/** Last 1h fill count seen when decay ran; used to detect consecutive cycles with no new fills. */
const lastFills1hAtDecay = new Map<string, number>();

function learningKey(symbol: string | undefined): string {
  return normalizeStrategySymbol(symbol).replace(/-/g, '_');
}

const LEARN_ADJ_CLAMP = { min: -10, max: 10 } as const;

/**
 * Per symbol, per bot cycle: decay adj toward neutral, optional stale-data extra decay, clamp.
 * Pass `fills1h` when known so streak logic runs; omit to skip streak / ×0.9 (safe fallback).
 */
export function getMmSpreadLearningAdjBps(
  symbol: string | undefined,
  cycleCtx?: { fills1h?: number | null }
): number {
  const k = learningKey(symbol);
  if (!k) return 0;
  const prev = spreadLearnBySymbol.get(k) ?? { adjBps: 0, cyclesWithoutNewFill: 0 };
  let adj = prev.adjBps;
  let cyclesWithoutNewFill = prev.cyclesWithoutNewFill;

  adj *= 0.95;

  const fh = cycleCtx?.fills1h;
  if (fh != null && Number.isFinite(fh)) {
    const fills = Math.max(0, Math.floor(fh));
    const last = lastFills1hAtDecay.get(k);
    if (last != null && fills <= last) {
      cyclesWithoutNewFill = Math.min(999, cyclesWithoutNewFill + 1);
    } else {
      cyclesWithoutNewFill = 0;
    }
    lastFills1hAtDecay.set(k, fills);
    if (cyclesWithoutNewFill >= 10) {
      adj *= 0.9;
    }
  }

  adj = Math.min(LEARN_ADJ_CLAMP.max, Math.max(LEARN_ADJ_CLAMP.min, adj));
  spreadLearnBySymbol.set(k, { adjBps: adj, cyclesWithoutNewFill });
  return adj;
}

/**
 * Phase C: lightweight spread learning from last cycle's core spread, fill proxy, and PnL.
 * Skips tight/wide rules when inputs are missing or non-finite (base decay already applied in getMmSpreadLearningAdjBps).
 */
export function observeMmSpreadLearning(
  symbol: string | undefined,
  input: {
    spread_bps: number;
    fill_rate: number;
    pnl_usd: number;
    min_profit_spread_bps: number;
  }
): void {
  const k = learningKey(symbol);
  if (!k) return;
  const st = spreadLearnBySymbol.get(k) ?? { adjBps: 0, cyclesWithoutNewFill: 0 };
  let adj = st.adjBps;
  const { spread_bps, fill_rate, pnl_usd, min_profit_spread_bps } = input;
  if (!Number.isFinite(spread_bps)) return;

  const minPOk = Number.isFinite(min_profit_spread_bps) && min_profit_spread_bps >= 0;
  const minP = minPOk ? min_profit_spread_bps : NaN;
  const frOk = Number.isFinite(fill_rate);
  const fr = frOk ? Math.max(0, Math.min(1, fill_rate)) : NaN;
  const pnlOk = Number.isFinite(pnl_usd);
  const pnl = pnlOk ? pnl_usd : NaN;

  if (minPOk && pnlOk && pnl < 0) {
    const tooTight = spread_bps < minP + 5 || spread_bps < 16;
    if (tooTight) adj += 2;
  }
  if (minPOk && frOk) {
    const wide = spread_bps >= Math.max(30, minP * 1.4);
    if (wide && fr < 0.07) adj -= 2;
  }

  adj = Math.round(Math.min(LEARN_ADJ_CLAMP.max, Math.max(LEARN_ADJ_CLAMP.min, adj)));
  spreadLearnBySymbol.set(k, { adjBps: adj, cyclesWithoutNewFill: st.cyclesWithoutNewFill });
}

export function getMmSpreadLearningSnapshot(): Record<string, { adj_bps: number }> {
  const out: Record<string, { adj_bps: number }> = {};
  for (const [sym, v] of spreadLearnBySymbol) out[sym] = { adj_bps: v.adjBps };
  return out;
}

export type MmProfitOrientedQuote = {
  spread_bps: number;
  bid_spread_bps: number;
  ask_spread_bps: number;
  size_multiplier: number;
  /** When true, bot should not place/replace quotes this cycle (spread below fee floor after clamps). */
  skip_placement?: boolean;
};

/**
 * Vol adjustment: volatility_bps * 0.1, clamped [0, 8].
 */
export function computeVolatilityAdjBps(volatilityBps: number): number {
  const v = Math.max(0, volatilityBps) * 0.1;
  return Math.max(0, Math.min(8, v));
}

/**
 * Inventory imbalance add-on for total spread (4–8 bps) + skew split across bid/ask halves.
 */
export function computeInventorySpreadAdjBps(inventoryRatio: number | null | undefined): number {
  if (inventoryRatio == null || !Number.isFinite(inventoryRatio)) return 0;
  if (inventoryRatio > 0.55) {
    const t = Math.min(1, (inventoryRatio - 0.55) / (1 - 0.55));
    return 4 + 4 * t;
  }
  if (inventoryRatio < 0.45) {
    const t = Math.min(1, (0.45 - inventoryRatio) / 0.45);
    return 4 + 4 * t;
  }
  return 0;
}

/**
 * PnL widening when losing: min(6, abs(pnl)/100). Uses ~1h window PnL passed from caller.
 */
export function computePnlAdjBps(recentPnlUsd: number | null | undefined): number {
  if (recentPnlUsd == null || !Number.isFinite(recentPnlUsd) || recentPnlUsd >= 0) return 0;
  return Math.min(6, Math.abs(recentPnlUsd) / 100);
}

/**
 * Profit-oriented quote: extends desk base spread with vol / inventory / recent PnL; sizes down in high vol + imbalance.
 */
export function computeMmProfitOrientedQuote(params: {
  baseSpreadBps: number;
  volatilityBps: number;
  inventoryRatio: number | null | undefined;
  recentPnlUsd: number | null | undefined;
  symbol?: string;
  learningAdjBps?: number;
  makerFeeBps?: number;
  takerFeeBps?: number;
  /** Prior-cycle fill proxy [0,1]; if missing, fill–spread balance is skipped. */
  fillRate?: number | null;
  /** MM user 1h trade count; fill_rate spread tweak only applies when >= 3 (low-volume guard). */
  fills1hForFillRate?: number | null;
  /** Manual pair spread bypasses tier base clamp. */
  spreadMode?: SpreadMode;
}): MmProfitOrientedQuote {
  const learn =
    params.learningAdjBps != null && Number.isFinite(params.learningAdjBps)
      ? Math.round(params.learningAdjBps)
      : 0;
  let baseRaw = Number.isFinite(params.baseSpreadBps) && params.baseSpreadBps > 0 ? params.baseSpreadBps : 10;
  if (params.spreadMode !== 'manual') {
    baseRaw = optimalTierBaseSpreadBps(params.symbol, baseRaw);
  }
  const volAdj = computeVolatilityAdjBps(params.volatilityBps);
  const invAdj = computeInventorySpreadAdjBps(params.inventoryRatio);
  const pnlAdj = computePnlAdjBps(params.recentPnlUsd);
  const spread_bps = clampSpreadBuild(baseRaw + volAdj + invAdj + pnlAdj + learn);

  const half = spread_bps / 2;
  const ratio = params.inventoryRatio;
  let bid_spread_bps = half;
  let ask_spread_bps = half;
  if (invAdj > 0 && ratio != null && Number.isFinite(ratio)) {
    const skew = Math.min(invAdj / 2, Math.max(0, half - 2.5));
    if (ratio > 0.55) {
      bid_spread_bps = half + skew;
      ask_spread_bps = half - skew;
    } else if (ratio < 0.45) {
      bid_spread_bps = half - skew;
      ask_spread_bps = half + skew;
    }
  }

  bid_spread_bps = Math.max(2.5, bid_spread_bps);
  ask_spread_bps = Math.max(2.5, ask_spread_bps);
  const sum0 = bid_spread_bps + ask_spread_bps;
  if (sum0 > 1e-6) {
    const scale = spread_bps / sum0;
    bid_spread_bps = Math.max(2.5, bid_spread_bps * scale);
    ask_spread_bps = Math.max(2.5, ask_spread_bps * scale);
  }

  let spreadOut = spread_bps;
  let bidOut = bid_spread_bps;
  let askOut = ask_spread_bps;
  const pnlTune = params.recentPnlUsd;
  if (pnlTune != null && Number.isFinite(pnlTune)) {
    let sp = spreadOut;
    if (pnlTune > 100) sp *= 0.95;
    if (pnlTune < -100) sp *= 1.1;
    const clamped = clampSpreadBuild(sp);
    const r = spreadOut > 0 ? clamped / spreadOut : 1;
    spreadOut = clamped;
    bidOut = Math.max(2.5, bid_spread_bps * r);
    askOut = Math.max(2.5, ask_spread_bps * r);
    const sum1 = bidOut + askOut;
    if (sum1 > 1e-6) {
      const r2 = spreadOut / sum1;
      bidOut = Math.max(2.5, bidOut * r2);
      askOut = Math.max(2.5, askOut * r2);
    }
  }

  const fr = params.fillRate;
  const fillN =
    params.fills1hForFillRate != null && Number.isFinite(params.fills1hForFillRate)
      ? Math.max(0, Math.floor(params.fills1hForFillRate))
      : 0;
  if (fillN >= 3 && fr != null && Number.isFinite(fr)) {
    const f = Math.max(0, Math.min(1, fr));
    let m = 1;
    if (f > 0.6) m = 1.1;
    else if (f < 0.2) m = 0.9;
    if (m !== 1) {
      spreadOut = clampSpreadBuild(spreadOut * m);
      const halves = scaleHalvesToTargetFull(bidOut, askOut, spreadOut);
      spreadOut = halves.spread_bps;
      bidOut = halves.bid_spread_bps;
      askOut = halves.ask_spread_bps;
    }
  }

  let size_multiplier = 1;
  if (params.volatilityBps >= HIGH_VOL_THRESHOLD_BPS) size_multiplier *= 0.7;
  if (
    params.inventoryRatio != null &&
    Number.isFinite(params.inventoryRatio) &&
    (params.inventoryRatio > 0.55 || params.inventoryRatio < 0.45)
  ) {
    size_multiplier *= 0.85;
  }
  size_multiplier = clampSizeMultFinal(size_multiplier);

  const major = isMajorBtcEthSymbol(params.symbol);
  const refLo = major ? 8 : 12;
  const refHi = major ? 10 : 18;
  const wide = spreadOut >= refHi + 4 || spreadOut >= refHi * 1.12;
  const tight = spreadOut <= refLo + 0.25;
  if (wide && !tight) size_multiplier *= 1.2;
  else if (tight && !wide) size_multiplier *= 0.8;
  size_multiplier = clampSizeMultFinal(size_multiplier);

  if (process.env.MM_STRATEGY_DEBUG === 'true') {
    logger.debug('MM_STRATEGY_DEBUG', {
      spread_bps: spreadOut,
      volAdj,
      invAdj,
      pnlAdj,
      learnAdj: learn,
      symbol: params.symbol,
    });
  }

  let out: MmProfitOrientedQuote = {
    spread_bps: spreadOut,
    bid_spread_bps: Math.round(bidOut * 100) / 100,
    ask_spread_bps: Math.round(askOut * 100) / 100,
    size_multiplier,
  };
  const mk = params.makerFeeBps;
  const tk = params.takerFeeBps;
  if (mk != null && tk != null && Number.isFinite(mk) && Number.isFinite(tk)) {
    out = applyMinProfitSpreadFloor(out, mk, tk);
  }

  const capped = clampMmFullSpreadBps(out.spread_bps);
  const fin = scaleHalvesToTargetFull(out.bid_spread_bps, out.ask_spread_bps, capped);
  out = {
    ...out,
    spread_bps: fin.spread_bps,
    bid_spread_bps: fin.bid_spread_bps,
    ask_spread_bps: fin.ask_spread_bps,
  };

  let skip_placement = false;
  if (mk != null && tk != null && Number.isFinite(mk) && Number.isFinite(tk)) {
    const minF = computeMinProfitSpreadBps(mk, tk);
    if (out.spread_bps + 1e-3 < minF) skip_placement = true;
  }

  return { ...out, skip_placement };
}

/** Global desk mode: safe = wider, aggressive = tighter (still clamped). */
export function applyGlobalModeToSpreadBps(baseBps: number, mode: MMGlobalMode): number {
  let m = 1;
  if (mode === 'safe') m = 1.08;
  else if (mode === 'aggressive') m = 0.94;
  return clampSpread(baseBps * m);
}

function volatilityModeMult(v: MMPairRuntimeConfig['volatility_mode']): number {
  if (v === 'low') return 0.92;
  if (v === 'high') return 1.12;
  return 1;
}

function flowModeMult(f: MMPairRuntimeConfig['flow_mode']): number {
  if (f === 'aggressive') return 0.9;
  if (f === 'defensive') return 1.14;
  return 1;
}

/**
 * Returns full spread in bps (same semantics as LIQUIDITY_BOT_SPREAD_BPS before half-spread split in the bot).
 */
export function calculateSpread(
  _symbol: string,
  pairCfg: MMPairRuntimeConfig,
  volatilityBps: number,
  inventory: MmStrategyInventoryHint,
  envBaselineSpreadBps: number,
  globalMode: MMGlobalMode
): number {
  const volN = Math.min(1.5, Math.max(0, volatilityBps) / VOL_REF_BPS);
  const invAdd = Math.max(0, inventory.extraSpreadBps ?? 0) * 0.35;

  let base: number;
  if (pairCfg.spread_mode === 'manual') {
    base = pairCfg.spread_bps;
  } else {
    const b0 = Math.max(1, envBaselineSpreadBps);
    base = b0 * (0.88 + 0.42 * volN) + invAdd;
    base *= volatilityModeMult(pairCfg.volatility_mode);
  }

  base *= flowModeMult(pairCfg.flow_mode);
  base = applyGlobalModeToSpreadBps(base, globalMode);
  return clampSpread(base);
}
