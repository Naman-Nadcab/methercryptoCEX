/**
 * Lightweight liquidity quality signal for UI (internal book only).
 */
import type { OrderbookSnapshot } from './spot-orderbook-cache.service.js';
import { Decimal } from '../lib/decimal.js';

const DEFAULT_SPREAD_BPS_WARN = 50; // 0.5%
const DEFAULT_MIN_DEPTH_EACH_SIDE = 3; // distinct price levels with >0 qty

export type LiquidityHealthReason = 'LOW_LIQUIDITY' | 'WIDE_SPREAD';

export type LiquidityHealthResult = {
  isHealthy: boolean;
  reason: LiquidityHealthReason | null;
  spreadBps: number | null;
  bidLevels: number;
  askLevels: number;
};

function countPositiveLevels(levels: { price: string; quantity: string }[]): number {
  let n = 0;
  for (const l of levels) {
    const q = parseFloat(l.quantity || '0');
    if (Number.isFinite(q) && q > 0) n++;
  }
  return n;
}

export function computeLiquidityHealth(
  ob: OrderbookSnapshot,
  opts?: { spreadBpsThreshold?: number; minLevelsPerSide?: number }
): LiquidityHealthResult {
  const spreadThr = opts?.spreadBpsThreshold ?? DEFAULT_SPREAD_BPS_WARN;
  const minLv = opts?.minLevelsPerSide ?? DEFAULT_MIN_DEPTH_EACH_SIDE;
  const bidLevels = countPositiveLevels(ob.bids);
  const askLevels = countPositiveLevels(ob.asks);
  const bestBid = ob.bids[0]?.price;
  const bestAsk = ob.asks[0]?.price;
  let spreadBps: number | null = null;
  if (bestBid && bestAsk) {
    const b = new Decimal(bestBid);
    const a = new Decimal(bestAsk);
    if (b.gt(0) && a.gte(b)) {
      const mid = b.plus(a).div(2);
      if (mid.gt(0)) {
        spreadBps = a.minus(b).div(mid).times(10_000).toNumber();
        if (!Number.isFinite(spreadBps)) spreadBps = null;
      }
    }
  }
  let reason: LiquidityHealthReason | null = null;
  if (bidLevels < minLv || askLevels < minLv) {
    reason = 'LOW_LIQUIDITY';
  } else if (spreadBps != null && spreadBps > spreadThr) {
    reason = 'WIDE_SPREAD';
  }
  const isHealthy = reason === null;
  return { isHealthy, reason, spreadBps, bidLevels, askLevels };
}
