'use client';

import { LineStyle, type IChartApi, type ISeriesApi, type LineSeriesPartialOptions } from 'lightweight-charts';
import type { CandleData } from '../../ChartAdapter';
import {
  type OverlayStudyId,
  computeSma,
  computeEma,
  computeVwapDailyUtc,
  computeBollinger,
} from '../../indicators';
import type { LineOverlayPluginContext } from './pluginTypes';
import { lineSeriesDataFromRows } from '../../lightweightChartsData';

function safeSetLineData(series: ISeriesApi<'Line'> | null | undefined, rows: { time: number; value: number }[]): void {
  if (!series) return;
  try {
    series.setData(lineSeriesDataFromRows(rows));
  } catch {
    try {
      series.setData([]);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Phase B tail — dropdown overlay (SMA/EMA/VWAP) + Bollinger triple line on main pane.
 */
export class OverlayStudyPlugin {
  private readonly ctx: LineOverlayPluginContext;

  private overlayLine: ISeriesApi<'Line'> | null = null;

  private bbUpper: ISeriesApi<'Line'> | null = null;

  private bbMid: ISeriesApi<'Line'> | null = null;

  private bbLower: ISeriesApi<'Line'> | null = null;

  constructor(ctx: LineOverlayPluginContext) {
    this.ctx = ctx;
  }

  getOverlayLine(): ISeriesApi<'Line'> | null {
    return this.overlayLine;
  }

  getBbUpper(): ISeriesApi<'Line'> | null {
    return this.bbUpper;
  }

  getBbMid(): ISeriesApi<'Line'> | null {
    return this.bbMid;
  }

  getBbLower(): ISeriesApi<'Line'> | null {
    return this.bbLower;
  }

  private clearAllSeries(): void {
    const chart = this.ctx.getChart();
    if (!chart) return;
    const labels = this.ctx.legendLabels;
    if (this.overlayLine) {
      labels.delete(this.overlayLine);
      try {
        chart.removeSeries(this.overlayLine);
      } catch {
        /* ignore */
      }
      this.overlayLine = null;
    }
    for (const s of [this.bbUpper, this.bbMid, this.bbLower]) {
      if (s) {
        labels.delete(s);
        try {
          chart.removeSeries(s);
        } catch {
          /* ignore */
        }
      }
    }
    this.bbUpper = null;
    this.bbMid = null;
    this.bbLower = null;
  }

  /** Rebuild line series for the selected study (no data yet). */
  rebuildForStudy(study: OverlayStudyId): void {
    this.clearAllSeries();
    const chart = this.ctx.getChart();
    if (!chart || study === 'none') return;

    const fmt = this.ctx.getLineFormatOptions() as LineSeriesPartialOptions;

    if (study === 'bb_20') {
      const band: LineSeriesPartialOptions = {
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        ...fmt,
      };
      this.bbUpper = chart.addLineSeries({
        ...band,
        color: 'rgba(148, 163, 184, 0.75)',
        lineStyle: LineStyle.Dashed,
      });
      this.ctx.legendLabels.set(this.bbUpper, 'BB up');
      this.bbMid = chart.addLineSeries({
        ...band,
        color: 'rgba(96, 165, 250, 0.88)',
        lineStyle: LineStyle.Solid,
      });
      this.ctx.legendLabels.set(this.bbMid, 'BB mid');
      this.bbLower = chart.addLineSeries({
        ...band,
        color: 'rgba(148, 163, 184, 0.75)',
        lineStyle: LineStyle.Dashed,
      });
      this.ctx.legendLabels.set(this.bbLower, 'BB lo');
      return;
    }

    const overlayOpts: LineSeriesPartialOptions = {
      color: 'rgba(96, 165, 250, 0.9)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      ...fmt,
    };
    this.overlayLine = chart.addLineSeries(overlayOpts);
    this.ctx.legendLabels.set(this.overlayLine, study === 'vwap' ? 'VWAP' : 'Ovl');
  }

  refreshForStudy(study: OverlayStudyId, candles: CandleData[]): void {
    switch (study) {
      case 'none':
        break;
      case 'sma_7':
        safeSetLineData(this.overlayLine, computeSma(candles, 7));
        break;
      case 'sma_9':
        safeSetLineData(this.overlayLine, computeSma(candles, 9));
        break;
      case 'sma_25':
        safeSetLineData(this.overlayLine, computeSma(candles, 25));
        break;
      case 'sma_99':
        safeSetLineData(this.overlayLine, computeSma(candles, 99));
        break;
      case 'ema_12':
        safeSetLineData(this.overlayLine, computeEma(candles, 12));
        break;
      case 'ema_26':
        safeSetLineData(this.overlayLine, computeEma(candles, 26));
        break;
      case 'vwap':
        safeSetLineData(this.overlayLine, computeVwapDailyUtc(candles));
        break;
      case 'bb_20': {
        const { mid, upper, lower } = computeBollinger(candles, 20, 2);
        safeSetLineData(this.bbMid, mid);
        safeSetLineData(this.bbUpper, upper);
        safeSetLineData(this.bbLower, lower);
        break;
      }
      default:
        break;
    }
  }

  disposeState(): void {
    this.clearAllSeries();
  }
}
