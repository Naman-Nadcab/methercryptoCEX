'use client';

import { LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { CandleData } from '../../ChartAdapter';
import type { ChartExtensionsConfig } from '../../extension/types';
import { computeEma, computeVwapDailyUtc } from '../../indicators';
import type { LineOverlayPluginContext, ModularExtensionPatch, PricePaneOverlayPlugin } from './pluginTypes';

const toTs = (t: number) => t as UTCTimestamp;

const EMA_PERIODS = [7, 20, 50, 200] as const;

function emaLineColor(period: number): string {
  const map: Record<number, string> = {
    7: 'rgba(245, 158, 11, 0.95)',
    20: 'rgba(59, 130, 246, 0.92)',
    50: 'rgba(168, 85, 247, 0.9)',
    200: 'rgba(239, 68, 68, 0.88)',
  };
  return map[period] ?? 'rgba(96, 165, 250, 0.9)';
}

/**
 * Phase B — modular EMA stack + VWAP²: series lifecycle, full/light refresh, RAF VWAP.
 */
export class ModularEmaVwapPlugin implements PricePaneOverlayPlugin {
  readonly id = 'modular-ema-vwap';

  private readonly ctx: LineOverlayPluginContext;

  private modularEmaLines = new Map<number, ISeriesApi<'Line'>>();

  private modularVwapLine: ISeriesApi<'Line'> | null = null;

  private modularEmaInc = new Map<number, { emaBeforeLast: number }>();

  private modularVwapRaf: number | null = null;

  constructor(ctx: LineOverlayPluginContext) {
    this.ctx = ctx;
  }

  syncSeriesFromConfig(cfg: ModularExtensionPatch): void {
    const chart = this.ctx.getChart();
    if (!chart) return;
    const fmt = this.ctx.getLineFormatOptions();
    const labels = this.ctx.legendLabels;

    for (const period of EMA_PERIODS) {
      const emaKey = `ema${period}` as keyof ModularExtensionPatch;
      const on = Boolean(cfg[emaKey]);
      const existing = this.modularEmaLines.get(period);
      if (on && !existing) {
        const line = chart.addLineSeries({
          color: emaLineColor(period),
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          ...fmt,
        });
        this.modularEmaLines.set(period, line);
        labels.set(line, `EMA${period}`);
      } else if (!on && existing) {
        try {
          chart.removeSeries(existing);
        } catch {
          /* ignore */
        }
        this.modularEmaLines.delete(period);
        labels.delete(existing);
      }
    }

    if (cfg.modularVwap) {
      if (!this.modularVwapLine) {
        this.modularVwapLine = chart.addLineSeries({
          color: 'rgba(14, 165, 233, 0.9)',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
          ...fmt,
        });
        labels.set(this.modularVwapLine, 'VWAP²');
      }
    } else if (this.modularVwapLine) {
      try {
        chart.removeSeries(this.modularVwapLine);
      } catch {
        /* ignore */
      }
      labels.delete(this.modularVwapLine);
      this.modularVwapLine = null;
    }

    this.cancelDeferredWork();
  }

  onCandlesFull(workingCandles: CandleData[]): void {
    this.lastWorkingForVwap = workingCandles;
    this.cancelDeferredWork();
    const mapPts = (rows: { time: number; value: number }[]) =>
      rows.map((d) => ({ time: toTs(d.time), value: d.value }));

    this.modularEmaLines.forEach((line, period) => {
      try {
        const rows = computeEma(workingCandles, period);
        line.setData(mapPts(rows));
        if (rows.length >= 2) {
          this.modularEmaInc.set(period, { emaBeforeLast: rows[rows.length - 2]!.value });
        } else {
          this.modularEmaInc.delete(period);
        }
      } catch {
        this.modularEmaInc.delete(period);
      }
    });

    if (this.modularVwapLine) {
      try {
        this.modularVwapLine.setData(mapPts(computeVwapDailyUtc(workingCandles)));
      } catch {
        /* ignore */
      }
    }
  }

  onCandlesLight(lastBar: CandleData | null, workingCandles: CandleData[]): void {
    this.lastWorkingForVwap = workingCandles;
    if (!lastBar || workingCandles.length === 0) {
      this.onCandlesFull(workingCandles);
      return;
    }
    const wcLast = workingCandles[workingCandles.length - 1]!;
    if (wcLast.time !== lastBar.time) {
      this.onCandlesFull(workingCandles);
      return;
    }

    if (this.modularEmaLines.size > 0) {
      let needFull = false;
      this.modularEmaLines.forEach((line, period) => {
        if (needFull) return;
        if (workingCandles.length < period) {
          needFull = true;
          return;
        }
        const seed = this.modularEmaInc.get(period);
        if (!seed) {
          needFull = true;
          return;
        }
        const k = 2 / (period + 1);
        const v = k * lastBar.close + (1 - k) * seed.emaBeforeLast;
        try {
          line.update({ time: toTs(lastBar.time), value: v });
        } catch {
          needFull = true;
        }
      });
      if (needFull) {
        this.onCandlesFull(workingCandles);
        return;
      }
    }

    this.scheduleVwapRefresh();
  }

  private scheduleVwapRefresh(): void {
    if (!this.modularVwapLine) return;
    if (this.modularVwapRaf != null) return;
    this.modularVwapRaf = requestAnimationFrame(() => {
      this.modularVwapRaf = null;
      if (!this.modularVwapLine) return;
      try {
        const candles = this.lastWorkingForVwap;
        const mapPts = (rows: { time: number; value: number }[]) =>
          rows.map((d) => ({ time: toTs(d.time), value: d.value }));
        this.modularVwapLine.setData(mapPts(computeVwapDailyUtc(candles)));
      } catch {
        /* ignore */
      }
    });
  }

  /** Stash for RAF VWAP (updated each full/light pass). */
  private lastWorkingForVwap: CandleData[] = [];

  isActive(): boolean {
    return this.modularEmaLines.size > 0 || this.modularVwapLine != null;
  }

  forEachLineSeries(cb: (line: ISeriesApi<'Line'>) => void): void {
    this.modularEmaLines.forEach((line) => cb(line));
    if (this.modularVwapLine) cb(this.modularVwapLine);
  }

  cancelDeferredWork(): void {
    if (this.modularVwapRaf != null) {
      cancelAnimationFrame(this.modularVwapRaf);
      this.modularVwapRaf = null;
    }
  }

  disposeState(): void {
    this.cancelDeferredWork();
    this.modularEmaInc.clear();
    this.modularEmaLines.clear();
    this.modularVwapLine = null;
    this.lastWorkingForVwap = [];
  }
}
