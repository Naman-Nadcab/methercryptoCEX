/**
 * Internal book execution estimate only — no external venue simulation (PURE_INTERNAL).
 */
import { Decimal } from '../lib/decimal.js';
import type { OrderbookSnapshot } from './spot-orderbook-cache.service.js';
import { simulateMarketVwapFromBook } from '../lib/market-vwap-sim.js';

export type SimulatedOrderInput = {
  market: string;
  side: 'buy' | 'sell';
  quantity: string;
};

export type BestExecutionSim = {
  bestPath: 'internal' | 'external_estimate' | 'unknown';
  internalVwap: string | null;
  internalFullyFilled: boolean;
  externalVwapEstimate: string | null;
  externalFullyFilled: boolean;
  note: string;
  internal_fill_possible: boolean;
  external_fill_possible: boolean;
  recommended_action: 'WAIT' | 'PARTIAL' | 'FULL_INTERNAL';
  router_hint: string | null;
};

/**
 * Simulates fill against internal L2 only. External fields are always inert (not executable).
 */
export async function simulateBestExecution(
  internal: OrderbookSnapshot,
  order: SimulatedOrderInput
): Promise<BestExecutionSim> {
  const qty = new Decimal(order.quantity || '0');
  if (qty.lte(0) || !qty.isFinite()) {
    return {
      bestPath: 'unknown',
      internalVwap: null,
      internalFullyFilled: false,
      externalVwapEstimate: null,
      externalFullyFilled: false,
      note: 'invalid_quantity',
      internal_fill_possible: false,
      external_fill_possible: false,
      recommended_action: 'WAIT',
      router_hint: 'Invalid quantity.',
    };
  }
  const int = simulateMarketVwapFromBook(internal, order.side, qty);
  const intV = int.fullyFilled && int.vwap.gt(0) ? int.vwap : int.vwap.gt(0) ? int.vwap : null;
  const internalPartial = int.filledQty.gt(0) && !int.fullyFilled;
  const internal_fill_possible = int.filledQty.gt(0);

  return {
    bestPath: intV ? 'internal' : 'unknown',
    internalVwap: intV?.toString() ?? null,
    internalFullyFilled: int.fullyFilled,
    externalVwapEstimate: null,
    externalFullyFilled: false,
    note: 'pure_internal',
    internal_fill_possible,
    external_fill_possible: false,
    recommended_action: int.fullyFilled ? 'FULL_INTERNAL' : internalPartial ? 'PARTIAL' : 'WAIT',
    router_hint: int.fullyFilled
      ? null
      : internalPartial
        ? 'Only partial fill possible on internal liquidity.'
        : 'Insufficient internal liquidity for this size.',
  };
}
