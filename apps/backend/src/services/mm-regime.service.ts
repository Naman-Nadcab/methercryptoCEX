/**
 * Market regime from short-horizon trade returns: trending vs mean-reverting (lag-1 autocorr + variance ratio).
 */
import { fetchRecentTradesForMm } from './mm-spot-recent-trades.service.js';
import { config } from '../config/index.js';

export type MarketRegimeLabel = 'trending' | 'mean_reverting' | 'neutral';

export type MarketRegimeResult = {
  label: MarketRegimeLabel;
  lag1Autocorr: number;
  varianceRatio: number;
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/**
 * ρ₁ on log returns; VR = Var(long half) / Var(short half) on same window.
 */
export async function detectMarketRegime(symbol: string): Promise<MarketRegimeResult> {
  const em = config.eliteMm;
  const rows = await fetchRecentTradesForMm(symbol, em.regimeWindowSec, em.regimeMaxTrades);
  if (rows.length < em.regimeMinTrades) {
    return { label: 'neutral', lag1Autocorr: 0, varianceRatio: 1 };
  }

  const chrono = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const prices = chrono.map((t) => t.price).filter((p) => p > 0);
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1]!;
    const b = prices[i]!;
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  if (r.length < 8) {
    return { label: 'neutral', lag1Autocorr: 0, varianceRatio: 1 };
  }

  const m = mean(r);
  let num = 0;
  let den = 0;
  for (let i = 1; i < r.length; i++) {
    const x = r[i]! - m;
    const y = r[i - 1]! - m;
    num += x * y;
    den += y * y;
  }
  const lag1Autocorr = den > 1e-20 ? num / den : 0;

  const mid = Math.floor(r.length / 2);
  const first = r.slice(0, mid);
  const second = r.slice(mid);
  const v1 = variance(first);
  const v2 = variance(second);
  const varianceRatio = v2 > 1e-20 ? v1 / v2 : 1;

  let label: MarketRegimeLabel = 'neutral';
  if (lag1Autocorr >= em.regimeTrendRhoMin || varianceRatio >= em.regimeVrTrendMin) {
    label = 'trending';
  } else if (lag1Autocorr <= em.regimeMrRhoMax || varianceRatio <= em.regimeVrMrMax) {
    label = 'mean_reverting';
  }

  return { label, lag1Autocorr, varianceRatio };
}
