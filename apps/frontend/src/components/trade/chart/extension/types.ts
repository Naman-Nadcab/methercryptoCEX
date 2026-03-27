/**
 * Phase 1 — plugin-style contracts for chart extensions.
 * Implementations may live in `indicators/plugins` or `tools`; the adapter orchestrates lifecycle.
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { CandleData } from '../ChartAdapter';

export interface ChartSeriesContext {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
}

/** Optional indicator that can sync from full candle history (called after candle updates). */
export interface CandleSyncIndicator {
  readonly id: string;
  sync(candles: CandleData[]): void;
  destroy(chart: IChartApi): void;
}

export type DrawingToolMode = 'none' | 'hline' | 'vline' | 'trend' | 'fib';

/** Serializable drawing state (Phase A — persist / restore). */
export type SerializedDrawing =
  | { kind: 'hline'; price: number }
  | { kind: 'vline'; time: number }
  | { kind: 'trend'; t1: number; p1: number; t2: number; p2: number }
  | { kind: 'fib'; high: number; low: number };

export interface ChartExtensionsConfig {
  /** Modular EMA stack (independent of overlay dropdown). */
  ema7?: boolean;
  ema20?: boolean;
  ema50?: boolean;
  ema200?: boolean;
  /** Second VWAP line (UTC day), independent of overlay “VWAP” option. */
  modularVwap?: boolean;
  /** Main volume histogram visibility. */
  volumeHistogram?: boolean;
}
