/**
 * Pure indicator math for Lightweight Charts overlays / RSI pane.
 */

import type { CandleData } from './ChartAdapter';

export type OverlayStudyId =
  | 'none'
  | 'sma_7'
  | 'sma_9'
  | 'sma_25'
  | 'sma_99'
  | 'ema_12'
  | 'ema_26'
  | 'vwap'
  | 'bb_20';

export function utcDayStartSec(ts: number): number {
  const d = new Date(ts * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

function typicalPrice(c: CandleData): number {
  return (c.high + c.low + c.close) / 3;
}

export function computeSma(candles: CandleData[], period: number): { time: number; value: number }[] {
  if (period < 1 || candles.length < period) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const out: { time: number; value: number }[] = [];
  for (let i = period - 1; i < sorted.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += sorted[j].close;
    out.push({ time: sorted[i].time, value: s / period });
  }
  return out;
}

export function computeEma(candles: CandleData[], period: number): { time: number; value: number }[] {
  if (period < 1 || candles.length < period) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const k = 2 / (period + 1);
  const out: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += sorted[i].close;
  let ema = sum / period;
  out.push({ time: sorted[period - 1].time, value: ema });
  for (let i = period; i < sorted.length; i++) {
    ema = sorted[i].close * k + ema * (1 - k);
    out.push({ time: sorted[i].time, value: ema });
  }
  return out;
}

/** Session VWAP resets each UTC calendar day. */
export function computeVwapDailyUtc(candles: CandleData[]): { time: number; value: number }[] {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const out: { time: number; value: number }[] = [];
  let dayStart = -1;
  let cumTpV = 0;
  let cumV = 0;
  for (const c of sorted) {
    const d0 = utcDayStartSec(c.time);
    if (d0 !== dayStart) {
      dayStart = d0;
      cumTpV = 0;
      cumV = 0;
    }
    const tp = typicalPrice(c);
    const v = c.volume ?? 0;
    if (v > 0) {
      cumTpV += tp * v;
      cumV += v;
    }
    const vwap = cumV > 0 ? cumTpV / cumV : tp;
    out.push({ time: c.time, value: vwap });
  }
  return out;
}

export function computeBollinger(
  candles: CandleData[],
  period: number,
  mult: number
): {
  mid: { time: number; value: number }[];
  upper: { time: number; value: number }[];
  lower: { time: number; value: number }[];
} {
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const mid: { time: number; value: number }[] = [];
  const upper: { time: number; value: number }[] = [];
  const lower: { time: number; value: number }[] = [];
  for (let i = period - 1; i < sorted.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += sorted[j].close;
    const m = s / period;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = sorted[j].close - m;
      sumSq += d * d;
    }
    const sd = Math.sqrt(sumSq / period);
    const t = sorted[i].time;
    mid.push({ time: t, value: m });
    upper.push({ time: t, value: m + mult * sd });
    lower.push({ time: t, value: m - mult * sd });
  }
  return { mid, upper, lower };
}

/** Simple moving average of bar volume (e.g. Volume SMA 9). */
export function computeVolumeSma(candles: CandleData[], period: number): { time: number; value: number }[] {
  if (period < 1 || candles.length < period) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const out: { time: number; value: number }[] = [];
  for (let i = period - 1; i < sorted.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += sorted[j].volume ?? 0;
    out.push({ time: sorted[i].time, value: s / period });
  }
  return out;
}

/** Wilder RSI (period 14 default). */
export function computeRsi(candles: CandleData[], period: number): { time: number; value: number }[] {
  if (candles.length < period + 1 || period < 1) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const out: { time: number; value: number }[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const ch = sorted[i].close - sorted[i - 1].close;
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;

  const pushRsi = (idx: number) => {
    if (avgLoss === 0) out.push({ time: sorted[idx].time, value: 100 });
    else if (avgGain === 0) out.push({ time: sorted[idx].time, value: 0 });
    else {
      const rs = avgGain / avgLoss;
      out.push({ time: sorted[idx].time, value: 100 - 100 / (1 + rs) });
    }
  };

  pushRsi(period);

  for (let i = period + 1; i < sorted.length; i++) {
    const ch = sorted[i].close - sorted[i - 1].close;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    pushRsi(i);
  }

  return out;
}
