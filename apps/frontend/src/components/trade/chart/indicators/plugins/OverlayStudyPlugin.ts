'use client';

import { LineStyle, type IChartApi, type ISeriesApi, type LineSeriesPartialOptions, type UTCTimestamp } from 'lightweight-charts';
import type { CandleData } from '../../ChartAdapter';
import {
  type OverlayStudyId,
  computeSma,
  computeEma,
  computeVwapDailyUtc,
  computeBollinger,
} from '../../indicators';
import type { LineOverlayPluginContext } from './pluginTypes';

const toTs = (t: number) => t as UTCTimestamp;

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
    const map = (rows: { time: number; value: number }[]) =>
      rows.map((d) => ({ time: toTs(d.time), value: d.value }));

    switch (study) {
      case 'none':
        break;
      case 'sma_7':
        this.overlayLine?.setData(map(computeSma(candles, 7)));
        break;
      case 'sma_9':
        this.overlayLine?.setData(map(computeSma(candles, 9)));
        break;
      case 'sma_25':
        this.overlayLine?.setData(map(computeSma(candles, 25)));
        break;
      case 'sma_99':
        this.overlayLine?.setData(map(computeSma(candles, 99)));
        break;
      case 'ema_12':
        this.overlayLine?.setData(map(computeEma(candles, 12)));
        break;
      case 'ema_26':
        this.overlayLine?.setData(map(computeEma(candles, 26)));
        break;
      case 'vwap':
        this.overlayLine?.setData(map(computeVwapDailyUtc(candles)));
        break;
      case 'bb_20': {
        const { mid, upper, lower } = computeBollinger(candles, 20, 2);
        this.bbMid?.setData(map(mid));
        this.bbUpper?.setData(map(upper));
        this.bbLower?.setData(map(lower));
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
