'use client';

import type { IChartApi, ISeriesApi, LineSeriesPartialOptions, UTCTimestamp } from 'lightweight-charts';
import type { CandleData } from '../../ChartAdapter';
import { computeRsi } from '../../indicators';

const toTs = (t: number) => t as UTCTimestamp;

/**
 * Phase B tail — RSI(14) on dedicated price scale `rsi`.
 */
export class RsiPanePlugin {
  private readonly getChart: () => IChartApi | null;

  private rsiSeries: ISeriesApi<'Line'> | null = null;

  constructor(getChart: () => IChartApi | null) {
    this.getChart = getChart;
  }

  getSeries(): ISeriesApi<'Line'> | null {
    return this.rsiSeries;
  }

  isActive(): boolean {
    return this.rsiSeries != null;
  }

  syncEnabled(on: boolean): void {
    const chart = this.getChart();
    if (!chart) return;
    if (on) {
      if (this.rsiSeries) return;
      const rsiOpts: LineSeriesPartialOptions = {
        color: 'rgba(168, 85, 247, 0.95)',
        lineWidth: 2,
        priceScaleId: 'rsi',
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      };
      this.rsiSeries = chart.addLineSeries(rsiOpts);
    } else if (this.rsiSeries) {
      try {
        chart.removeSeries(this.rsiSeries);
      } catch {
        /* ignore */
      }
      this.rsiSeries = null;
    }
  }

  refresh(enabled: boolean, candles: CandleData[]): void {
    if (!enabled || !this.rsiSeries) return;
    const map = (rows: { time: number; value: number }[]) =>
      rows.map((d) => ({ time: toTs(d.time), value: d.value }));
    this.rsiSeries.setData(map(computeRsi(candles, 14)));
  }

  disposeState(): void {
    const chart = this.getChart();
    if (this.rsiSeries && chart) {
      try {
        chart.removeSeries(this.rsiSeries);
      } catch {
        /* ignore */
      }
    }
    this.rsiSeries = null;
  }
}
