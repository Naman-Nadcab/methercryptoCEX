/**
 * Candle continuity validation. Ensures sorted, strictly increasing time,
 * detects gaps and backward timestamps. Optionally fills gaps with synthetic candles.
 * No UI or chart logic. Pure TypeScript utility.
 */

import type { CandleData } from './ChartAdapter';

export interface ContinuityGap {
  /** Time of last candle before the gap */
  afterTime: number;
  /** Time of first candle after the gap */
  nextTime: number;
}

export interface ValidateContinuityOptions {
  /** If true, insert synthetic candles in gaps (open = prev close, high = low = close = open) */
  fillGaps?: boolean;
}

export interface ValidateContinuityResult {
  /** Candles sorted ascending, strictly increasing time; gaps filled if fillGaps was true */
  candles: CandleData[];
  /** true if no backward timestamps and (no gaps > intervalSeconds, or gaps were filled) */
  valid: boolean;
  /** Indices in the original sorted array where timestamp was not strictly increasing (duplicates) */
  backwardIndices: number[];
  /** Gaps where nextTime - afterTime > intervalSeconds */
  gaps: ContinuityGap[];
}

/**
 * Ensures candles are sorted ascending and time is strictly increasing.
 * Detects gaps > intervalSeconds and backward timestamps.
 * Optionally fills gaps with synthetic candles: open = prev close, high = low = close = open.
 */
export function validateCandleContinuity(
  candles: CandleData[],
  intervalSeconds: number,
  options: ValidateContinuityOptions = {}
): ValidateContinuityResult {
  const fillGaps = options.fillGaps === true;

  if (candles.length === 0) {
    return { candles: [], valid: true, backwardIndices: [], gaps: [] };
  }

  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const deduped: CandleData[] = [];
  const backwardIndices: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const prev = deduped[deduped.length - 1];
    if (prev && c.time <= prev.time) {
      backwardIndices.push(i);
      deduped[deduped.length - 1] = c;
    } else {
      deduped.push(c);
    }
  }

  const gaps: ContinuityGap[] = [];
  for (let i = 1; i < deduped.length; i++) {
    const prev = deduped[i - 1];
    const curr = deduped[i];
    if (curr.time - prev.time > intervalSeconds) {
      gaps.push({ afterTime: prev.time, nextTime: curr.time });
    }
  }

  let resultCandles: CandleData[] = deduped;
  if (fillGaps && gaps.length > 0) {
    resultCandles = [];
    for (let i = 0; i < deduped.length; i++) {
      resultCandles.push(deduped[i]);
      if (i + 1 < deduped.length) {
        const prev = deduped[i];
        const next = deduped[i + 1];
        if (next.time - prev.time > intervalSeconds) {
          let t = prev.time + intervalSeconds;
          const open = prev.close;
          while (t < next.time) {
            resultCandles.push({
              time: t,
              open,
              high: open,
              low: open,
              close: open,
            });
            t += intervalSeconds;
          }
        }
      }
    }
  }

  const valid =
    backwardIndices.length === 0 && (gaps.length === 0 || fillGaps);

  return {
    candles: resultCandles,
    valid,
    backwardIndices,
    gaps,
  };
}
