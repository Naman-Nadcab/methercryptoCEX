/**
 * Mock candle generator for testing. No API or backend.
 * Feed result into adapter.setCandles().
 */

import type { CandleData } from './ChartAdapter';

export interface MockCandleOptions {
  /** Number of candles to generate */
  count?: number;
  /** Interval in seconds (e.g. 60 = 1m, 300 = 5m, 3600 = 1h) */
  intervalSeconds?: number;
  /** Start time (unix seconds). Default: now - count * interval */
  startTime?: number;
  /** Base price for first candle open */
  basePrice?: number;
  /** Max absolute price change per candle (fraction of base), e.g. 0.02 = 2% */
  volatility?: number;
  /** Optional seed for reproducible sequences */
  seed?: number;
}

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

export function generateMockCandles(options: MockCandleOptions = {}): CandleData[] {
  const {
    count = 100,
    intervalSeconds = 60,
    basePrice = 50000,
    volatility = 0.015,
    seed,
  } = options;

  const now = Math.floor(Date.now() / 1000);
  const startTime = options.startTime ?? now - count * intervalSeconds;
  const random = seed !== undefined ? seededRandom(seed) : () => Math.random();

  const candles: CandleData[] = [];
  let open = basePrice;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSeconds;
    const change = (random() - 0.48) * 2 * volatility * open;
    const close = Math.max(0.01, open + change);
    const low = Math.min(open, close) - random() * volatility * open * 0.5;
    const high = Math.max(open, close) + random() * volatility * open * 0.5;

    const finalHigh = Math.max(high, open, close);
    const finalLow = Math.max(0.01, Math.min(low, open, close));
    candles.push({
      time,
      open,
      high: Math.max(finalHigh, finalLow),
      low: Math.min(finalLow, finalHigh),
      close,
    });
    open = close;
  }

  return candles;
}
