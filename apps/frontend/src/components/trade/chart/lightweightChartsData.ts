/**
 * Lightweight Charts enforces ascending, unique timestamps for setData/setMarkers/update.
 * Backend + live merges can violate that; sanitize at every boundary so the UI never hard-crashes.
 */

import type { UTCTimestamp } from 'lightweight-charts';
import type { CandleData, TradeMarker } from './ChartAdapter';

export function floorUtcTimeSeconds(t: unknown): number | null {
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Sort by time ascending, floor seconds, dedupe equal times (keep last row).
 */
export function sanitizeKeyedByTime<T extends { time: number }>(items: readonly T[]): T[] {
  const staged = items
    .map((row) => {
      const ft = floorUtcTimeSeconds(row.time);
      if (ft == null) return null;
      return { ...row, time: ft } as T;
    })
    .filter((x): x is T => x != null);

  staged.sort((a, b) => a.time - b.time);

  const out: T[] = [];
  for (const row of staged) {
    const prev = out[out.length - 1];
    if (prev && prev.time === row.time) out[out.length - 1] = row;
    else out.push(row);
  }
  return out;
}

export function sanitizeCandles(data: CandleData[]): CandleData[] {
  return sanitizeKeyedByTime(data.map((c) => ({ ...c })));
}

export function lineSeriesDataFromRows(rows: readonly { time: number; value: number }[]): {
  time: UTCTimestamp;
  value: number;
}[] {
  return sanitizeKeyedByTime(rows.map((r) => ({ time: r.time, value: r.value }))).map((r) => ({
    time: r.time as UTCTimestamp,
    value: r.value,
  }));
}

export function histogramSeriesDataFromCandles(candles: CandleData[], volColor: (up: boolean) => string): {
  time: UTCTimestamp;
  value: number;
  color: string;
}[] {
  return sanitizeCandles(candles).map((c) => ({
    time: c.time as UTCTimestamp,
    value: c.volume ?? 0,
    color: volColor(c.close >= c.open),
  }));
}

export function candlestickDataFromSanitized(candles: CandleData[]): {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}[] {
  return sanitizeCandles(candles).map((c) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

export function sanitizeTradeMarkers(trades: readonly TradeMarker[]): TradeMarker[] {
  return sanitizeKeyedByTime(trades.map((t) => ({ ...t })));
}
