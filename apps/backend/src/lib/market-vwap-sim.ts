/**
 * VWAP simulation against L2 levels for market-order slippage checks (internal book only).
 * Callers must pass the full `bids` / `asks` arrays returned for the symbol (do not pre-slice depth).
 */
import { Decimal, type DecimalInstance } from './decimal.js';
import type { OrderbookSnapshot } from '../services/spot-orderbook-cache.service.js';

export type VwapSimResult = {
  vwap: DecimalInstance;
  /** True if full `qty` can be filled from provided levels. */
  fullyFilled: boolean;
  filledQty: DecimalInstance;
};

export function simulateMarketVwapFromBook(
  ob: OrderbookSnapshot,
  side: 'buy' | 'sell',
  qty: DecimalInstance
): VwapSimResult {
  const levels = side === 'buy' ? ob.asks : ob.bids;
  let remaining = qty;
  let notional = new Decimal(0);
  for (const lvl of levels) {
    const p = new Decimal(lvl.price || '0');
    const q = new Decimal(lvl.quantity || '0');
    if (!p.isFinite() || !q.isFinite() || p.lte(0) || q.lte(0)) continue;
    const take = Decimal.min(remaining, q);
    notional = notional.plus(take.times(p));
    remaining = remaining.minus(take);
    if (remaining.lte(0)) break;
  }
  const filled = qty.minus(remaining);
  if (filled.lte(0) || !filled.isFinite()) {
    return { vwap: new Decimal(0), fullyFilled: false, filledQty: new Decimal(0) };
  }
  const vwap = notional.div(filled);
  return { vwap, fullyFilled: remaining.lte(0), filledQty: filled };
}

/** Sum base qty on the side the aggressor lifts (buy → asks, sell → bids). */
export function totalBaseLiquidityOnSide(ob: OrderbookSnapshot, side: 'buy' | 'sell'): DecimalInstance {
  const levels = side === 'buy' ? ob.asks : ob.bids;
  let t = new Decimal(0);
  for (const lvl of levels) {
    const q = new Decimal(lvl.quantity || '0');
    if (q.isFinite() && q.gt(0)) t = t.plus(q);
  }
  return t;
}

export function adverseSlippageBps(
  side: 'buy' | 'sell',
  lastPrice: DecimalInstance,
  vwap: DecimalInstance
): DecimalInstance {
  if (!lastPrice.isFinite() || lastPrice.lte(0) || !vwap.isFinite() || vwap.lte(0)) return new Decimal(0);
  if (side === 'buy') {
    return vwap.gt(lastPrice) ? vwap.minus(lastPrice).div(lastPrice).times(10_000) : new Decimal(0);
  }
  return vwap.lt(lastPrice) ? lastPrice.minus(vwap).div(lastPrice).times(10_000) : new Decimal(0);
}
