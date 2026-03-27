/**
 * Market data normalization for the chart system.
 * Accepts backend candle payloads, validates, enforces precision, outputs CandleData[].
 * No UI or chart logic.
 */

import type { CandleData } from './ChartAdapter';

/** Backend candle: numeric or string fields. */
export type RawCandle = {
  time: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string;
};

export interface NormalizeOptions {
  /** Max decimal places for OHLC (default 8). */
  precision?: number;
  /** If true, sort by time ascending when input order is invalid (default true). */
  sortAscending?: boolean;
}

const DEFAULT_PRECISION = 8;

function toNumber(v: number | string): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function roundToPrecision(value: number, precision: number): number {
  if (precision <= 0) return Math.round(value);
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function isValidOHLC(open: number, high: number, low: number, close: number): boolean {
  return (
    high >= open &&
    high >= close &&
    low <= open &&
    low <= close &&
    low <= high
  );
}

/**
 * Normalizes a single raw candle to CandleData or null if malformed.
 */
function normalizeOne(raw: RawCandle, precision: number): CandleData | null {
  const t = typeof raw.time === 'number' ? raw.time : parseInt(String(raw.time), 10);
  if (!Number.isFinite(t) || t < 0) return null;
  const time = Math.floor(t);

  const open = toNumber(raw.open);
  const high = toNumber(raw.high);
  const low = toNumber(raw.low);
  const close = toNumber(raw.close);
  if (open === null || high === null || low === null || close === null) return null;
  const volumeRaw = raw.volume != null ? toNumber(raw.volume) : null;

  const o = roundToPrecision(open, precision);
  const h = roundToPrecision(high, precision);
  const l = roundToPrecision(low, precision);
  const c = roundToPrecision(close, precision);
  if (!isValidOHLC(o, h, l, c)) return null;

  const candle: CandleData = { time, open: o, high: h, low: l, close: c };
  if (volumeRaw != null && Number.isFinite(volumeRaw) && volumeRaw >= 0) {
    candle.volume = roundToPrecision(volumeRaw, precision);
  }
  return candle;
}

/**
 * Normalizes backend candle data for the chart.
 * - Validates ascending timestamps (output is sorted if sortAscending is true).
 * - Validates OHLC invariants; rejects malformed candles.
 * - Enforces numeric precision.
 * Returns CandleData[] (only valid candles).
 */
export function normalizeCandleData(
  rawCandles: RawCandle[],
  options: NormalizeOptions = {}
): CandleData[] {
  const precision = options.precision ?? DEFAULT_PRECISION;
  const sortAscending = options.sortAscending !== false;

  const out: CandleData[] = [];
  for (const raw of rawCandles) {
    const candle = normalizeOne(raw, precision);
    if (candle) out.push(candle);
  }

  if (sortAscending) {
    out.sort((a, b) => a.time - b.time);
    // Dedupe by time (keep last) so timestamps are strictly ascending
    const deduped: CandleData[] = [];
    for (const c of out) {
      const last = deduped[deduped.length - 1];
      if (last && last.time === c.time) deduped[deduped.length - 1] = c;
      else deduped.push(c);
    }
    return deduped;
  }

  return out;
}
