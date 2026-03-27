/**
 * Phase B — contracts for chart indicator plugins (orchestrated by LightweightChartsAdapter).
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { CandleData } from '../../ChartAdapter';
import type { ChartExtensionsConfig } from '../../extension/types';

/** Context passed to plugins that attach line series to the main price pane. */
export interface LineOverlayPluginContext {
  getChart: () => IChartApi | null;
  /** Options spread into `addLineSeries` (e.g. priceFormat from adapter precision). */
  getLineFormatOptions: () => Record<string, unknown>;
  /** Shared map: series → crosshair label (adapter owns map; plugin only mutates its series). */
  legendLabels: Map<ISeriesApi<'Line'>, string>;
}

export type ModularExtensionPatch = Pick<
  ChartExtensionsConfig,
  'ema7' | 'ema20' | 'ema50' | 'ema200' | 'modularVwap'
>;

/** Minimal lifecycle for a price-pane overlay plugin (Phase B baseline). */
export interface PricePaneOverlayPlugin {
  readonly id: string;
  /** Create/remove series from toggles; idempotent. */
  syncSeriesFromConfig(cfg: ModularExtensionPatch): void;
  /** Full history recompute (setData + incremental seeds). */
  onCandlesFull(workingCandles: CandleData[]): void;
  /** Live tick path: incremental where possible. */
  onCandlesLight(lastBar: CandleData | null, workingCandles: CandleData[]): void;
  /** True if any series is active (skip no-op refresh paths). */
  isActive(): boolean;
  /** Crosshair legend: each active line series. */
  forEachLineSeries(cb: (line: ISeriesApi<'Line'>) => void): void;
  cancelDeferredWork(): void;
  /** Clear internal maps/refs before chart.remove() (series disposed with chart). */
  disposeState(): void;
}
