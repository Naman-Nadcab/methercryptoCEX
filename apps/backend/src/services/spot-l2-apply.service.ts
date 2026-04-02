/**
 * Apply JS matcher outcome to aggregated in-memory L2 (maker removals + taker resting).
 */

import { addLiquidity, removeLiquidity } from './spot-in-memory-orderbook.service.js';
import type { MatchingOutcome } from './spot-matching.service.js';

export function applyMatchingOutcomeToMemory(
  symbol: string,
  outcome: MatchingOutcome,
  aggressorSide: 'buy' | 'sell'
): void {
  const makerSide: 'buy' | 'sell' = aggressorSide === 'buy' ? 'sell' : 'buy';
  for (const t of outcome.executedTrades) {
    removeLiquidity(symbol, makerSide, t.price, t.quantity);
  }
  if (outcome.resting) {
    addLiquidity(symbol, outcome.resting.side, outcome.resting.price, outcome.resting.quantity);
  }
}
