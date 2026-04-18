/**
 * Pipeline: raw backend candles → normalized → continuity-validated with gap fill → CandleData[].
 * No UI or chart logic. Pure TypeScript helper.
 */

import type { CandleData } from './ChartAdapter';
import type { RawCandle } from './normalizeCandleData';
import { normalizeCandleData } from './normalizeCandleData';
import { validateCandleContinuity } from './validateCandleContinuity';

/**
 * 1. normalizeCandleData(rawCandles)
 * 2. validateCandleContinuity(candles, intervalSeconds, { fillGaps: true })
 * 3. Return cleaned CandleData[]
 */
export function buildChartCandles(
  rawCandles: RawCandle[],
  intervalSeconds: number
): CandleData[] {
  const candles = normalizeCandleData(rawCandles);
  // fillGaps: false — Lightweight Charts natively handles gaps (shows empty space).
  // Synthetic flat doji candles make the chart look wrong; real gaps are cleaner.
  const { candles: cleaned } = validateCandleContinuity(candles, intervalSeconds, {
    fillGaps: false,
  });
  return cleaned;
}
