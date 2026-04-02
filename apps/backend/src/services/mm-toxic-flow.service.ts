/**
 * Toxic-flow proxies: short-horizon adverse continuation + trade-to-trade slippage intensity.
 */
import { config } from '../config/index.js';
import { fetchRecentTradesForMm } from './mm-spot-recent-trades.service.js';

export type ToxicFlowMetrics = {
  avgSlippageBps: number;
  /** Fraction of trades with adverse short-horizon continuation. */
  adverseRate: number;
  /** 0..1 composite for circuit / spread widening. */
  toxicScore: number;
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export async function getToxicFlowMetrics(symbol: string): Promise<ToxicFlowMetrics> {
  const em = config.eliteMm;
  const rows = await fetchRecentTradesForMm(symbol, em.flowWindowSec, em.flowTradeLimit);
  if (rows.length < 4) {
    return { avgSlippageBps: 0, adverseRate: 0, toxicScore: 0 };
  }

  const chrono = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const adverseBps = em.toxicAdverseBps;
  const thr = adverseBps / 10_000;

  let slipSum = 0;
  let slipN = 0;
  for (let i = 1; i < chrono.length; i++) {
    const p0 = chrono[i - 1]!.price;
    const p1 = chrono[i]!.price;
    if (p1 > 0) {
      slipSum += (Math.abs(p1 - p0) / p1) * 10_000;
      slipN++;
    }
  }
  const avgSlippageBps = slipN > 0 ? slipSum / slipN : 0;

  let adverse = 0;
  let eligible = 0;
  const look = 3;
  for (let i = 0; i < chrono.length - look; i++) {
    const p0 = chrono[i]!.price;
    const window = chrono.slice(i + 1, i + 1 + look).map((t) => t.price);
    if (window.length < look) break;
    eligible++;
    if (chrono[i]!.side === 'buy') {
      const minP = Math.min(...window);
      if (minP < p0 * (1 - thr)) adverse++;
    } else {
      const maxP = Math.max(...window);
      if (maxP > p0 * (1 + thr)) adverse++;
    }
  }
  const adverseRate = eligible > 0 ? adverse / eligible : 0;

  const slipNorm = clamp01(avgSlippageBps / Math.max(1, em.toxicSlippageRefBps));
  const toxicScore = clamp01(em.toxicSlippageCoeff * slipNorm + em.toxicAdverseCoeff * adverseRate);

  return { avgSlippageBps, adverseRate, toxicScore };
}
