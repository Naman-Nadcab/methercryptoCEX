'use client';

import { LineStyle, type IChartApi, type ISeriesApi, type LineSeriesPartialOptions } from 'lightweight-charts';
import type { CandleData } from '../../ChartAdapter';
import { computeVolumeSma } from '../../indicators';
import { lineSeriesDataFromRows } from '../../lightweightChartsData';

const VOL_MA_PERIOD = 9;

/**
 * Phase B tail — volume SMA on the histogram scale (priceScaleId '').
 */
export class VolumeMaPlugin {
  private readonly getChart: () => IChartApi | null;

  private volumeMaSeries: ISeriesApi<'Line'> | null = null;

  private visible = true;

  constructor(getChart: () => IChartApi | null) {
    this.getChart = getChart;
  }

  setUserVisible(on: boolean): void {
    this.visible = on;
  }

  getUserVisible(): boolean {
    return this.visible;
  }

  private ensureSeries(): void {
    const chart = this.getChart();
    if (!chart || this.volumeMaSeries) return;
    const maOpts: LineSeriesPartialOptions = {
      color: 'rgba(234, 179, 8, 0.9)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceScaleId: '',
      priceLineVisible: false,
      lastValueVisible: true,
      visible: true,
      priceFormat: { type: 'volume' },
    };
    this.volumeMaSeries = chart.addLineSeries(maOpts);
  }

  refresh(candles: CandleData[]): void {
    if (!this.getChart()) return;
    if (!this.visible) {
      this.volumeMaSeries?.applyOptions({ visible: false });
      return;
    }
    this.ensureSeries();
    if (!this.volumeMaSeries) return;
    const rows = computeVolumeSma(candles, VOL_MA_PERIOD).filter((d) => Number.isFinite(d.value));
    if (rows.length === 0) {
      this.volumeMaSeries.applyOptions({ visible: false });
      return;
    }
    const pts = lineSeriesDataFromRows(rows);
    try {
      this.volumeMaSeries.applyOptions({ visible: true });
      this.volumeMaSeries.setData(pts);
    } catch {
      this.volumeMaSeries.applyOptions({ visible: false });
    }
  }

  disposeState(): void {
    const chart = this.getChart();
    if (this.volumeMaSeries && chart) {
      try {
        chart.removeSeries(this.volumeMaSeries);
      } catch {
        /* ignore */
      }
    }
    this.volumeMaSeries = null;
  }
}
