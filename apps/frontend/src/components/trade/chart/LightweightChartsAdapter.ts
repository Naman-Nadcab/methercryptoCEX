'use client';

import {
  createChart,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { ChartAdapter, ChartTheme, CandleData, TradeMarker } from './ChartAdapter';
import { getDomChartCrosshairColors, getDomChartThemeOptions, getTradingChartColors } from './cssTradingColors';
import { formatFixedTrim } from '../terminalFormat';
import type { ChartExtensionsConfig, DrawingToolMode, SerializedDrawing } from './extension/types';
import { throttleLeading } from './utils/throttle';
import { DrawingToolManager } from './tools/DrawingToolManager';
import { ModularEmaVwapPlugin } from './indicators/plugins/ModularEmaVwapPlugin';
import { OverlayStudyPlugin } from './indicators/plugins/OverlayStudyPlugin';
import { RsiPanePlugin } from './indicators/plugins/RsiPanePlugin';
import { VolumeMaPlugin } from './indicators/plugins/VolumeMaPlugin';
import type { OverlayStudyId } from './indicators';

const toTs = (t: number) => t as UTCTimestamp;

export class LightweightChartsAdapter implements ChartAdapter {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private volumeSeries: ISeriesApi<'Histogram'> | null = null;
  private volumeMaEnabled = true;
  private priceScaleMode: 'normal' | 'log' | 'percent' = 'normal';
  private lastBar: CandleData | null = null;
  private intervalSeconds = 60;
  private nextCandleTime = 0;
  private allCandles: CandleData[] = [];
  private theme: ChartTheme = 'dark';
  private pricePrecision = 6;
  private legendPrecision = 6;
  private legendCallback: ((text: string) => void) | null = null;
  private overlayStudy: OverlayStudyId = 'none';
  private rsiEnabled = false;
  private throttledLightRefresh = throttleLeading<void>(100, () => this.refreshStudies('light'));

  /** Phase 2–4 — modular toggles (defaults off except volume on). */
  private extensions: ChartExtensionsConfig = { volumeHistogram: true };

  /** Legend / crosshair labels for line series (modular EMA/VWAP + overlay + BB). */
  private lineSeriesLegendLabel = new Map<ISeriesApi<'Line'>, string>();

  /** Phase B — modular EMA 7/20/50/200 + VWAP² (plugin). */
  private modularPlugin: ModularEmaVwapPlugin | null = null;

  private overlayPlugin: OverlayStudyPlugin | null = null;

  private rsiPlugin: RsiPanePlugin | null = null;

  private volumeMaPlugin: VolumeMaPlugin | null = null;

  private drawingTools: DrawingToolManager | null = null;

  private drawingMutateListener: (() => void) | null = null;

  private drawingMode: DrawingToolMode = 'none';

  private crosshairThrottled: ((p: MouseEventParams) => void) | null = null;

  private getContainerSize(container: HTMLElement): { w: number; h: number } {
    const rect = container.getBoundingClientRect();
    const w = Math.max(0, Math.floor(rect.width)) || container.clientWidth || 0;
    const h = Math.max(0, Math.floor(rect.height)) || container.clientHeight || 0;
    return { w, h };
  }

  /** Merge live `lastBar` into copy of history for accurate indicators. */
  private workingCandles(): CandleData[] {
    if (this.allCandles.length === 0) return [];
    if (!this.lastBar) return this.allCandles;
    const lastStored = this.allCandles[this.allCandles.length - 1]!;
    if (lastStored.time === this.lastBar.time) {
      return [...this.allCandles.slice(0, -1), { ...this.lastBar }];
    }
    if (this.lastBar.time > lastStored.time) {
      return [...this.allCandles, { ...this.lastBar }];
    }
    return this.allCandles;
  }

  private applyLayout(): void {
    if (!this.chart || !this.series || !this.volumeSeries) return;
    const rsiOn = this.rsiEnabled && (this.rsiPlugin?.isActive() ?? false);
    if (rsiOn) {
      this.series.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.36 } });
      this.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.68, bottom: 0.2 } });
      this.chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.84, bottom: 0.02 } });
    } else {
      this.series.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
      this.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
  }

  init(container: HTMLElement, theme: ChartTheme): void {
    if (this.chart) this.destroy();
    this.theme = theme;
    const { w, h } = this.getContainerSize(container);
    if (w <= 0 || h <= 0) return;
    const opts = getDomChartThemeOptions(theme);
    const cx = getDomChartCrosshairColors();
    const colors = getTradingChartColors();
    this.chart = createChart(container, {
      ...opts,
      layout: {
        ...opts.layout,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
      },
      grid: { ...opts.grid },
      crosshair: {
        mode: 1,
        vertLine: {
          width: 1,
          color: cx.line,
          style: 2,
          labelBackgroundColor: cx.labelBg,
        },
        horzLine: {
          width: 1,
          color: cx.line,
          style: 2,
          labelBackgroundColor: cx.labelBg,
        },
      },
      rightPriceScale: {
        ...opts.rightPriceScale,
        scaleMargins: { top: 0.08, bottom: 0.22 },
        borderVisible: true,
        alignLabels: true,
        minimumWidth: 64,
      },
      timeScale: {
        ...opts.timeScale,
        rightOffset: 8,
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        borderColor: opts.timeScale.borderColor,
      },
      handleScroll: true,
      handleScale: true,
      autoSize: true,
      width: w,
      height: h,
      localization: {
        locale: 'en-US',
        timeFormatter: (t: number) => {
          const d = new Date(t * 1000);
          return d.toLocaleString('en-GB', {
            timeZone: 'UTC',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        },
      },
    });
    const lineCtx = {
      getChart: () => this.chart,
      getLineFormatOptions: () => this.priceFormatOptions() as Record<string, unknown>,
      legendLabels: this.lineSeriesLegendLabel,
    };
    this.modularPlugin = new ModularEmaVwapPlugin(lineCtx);
    this.overlayPlugin = new OverlayStudyPlugin(lineCtx);
    this.rsiPlugin = new RsiPanePlugin(() => this.chart);
    this.volumeMaPlugin = new VolumeMaPlugin(() => this.chart);
    this.volumeMaPlugin.setUserVisible(this.volumeMaEnabled);
    this.series = this.chart.addCandlestickSeries({
      upColor: colors.up,
      downColor: colors.down,
      borderVisible: false,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineWidth: 1,
      priceLineColor: colors.up,
      ...this.priceFormatOptions(),
    });
    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: 'rgba(156, 163, 175, 0.25)',
    });
    this.volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    this.wireCrosshair();
    this.overlayPlugin.rebuildForStudy(this.overlayStudy);
    this.rsiPlugin.syncEnabled(this.rsiEnabled);
    this.syncExtensionSeries();
    this.applyLayout();
    this.applyPriceScaleMode();
  }

  private priceFormatOptions() {
    const p = Math.min(12, Math.max(0, Math.floor(this.pricePrecision)));
    const minMove = 10 ** -p;
    return {
      priceFormat: {
        type: 'price' as const,
        precision: p,
        minMove,
      },
    };
  }

  setLegendCallback(cb: ((text: string) => void) | null): void {
    this.legendCallback = cb;
    this.emitLegend(this.lastBar);
  }

  setLegendPrecision(decimals: number): void {
    this.legendPrecision = Math.min(12, Math.max(0, Math.floor(decimals)));
  }

  setPricePrecision(decimals: number): void {
    this.pricePrecision = Math.min(12, Math.max(0, Math.floor(decimals)));
    this.series?.applyOptions(this.priceFormatOptions());
  }

  /** Seconds until current candle closes (UTC bar time). */
  getSecondsToBarClose(): number | null {
    if (this.nextCandleTime <= 0) return null;
    const now = Math.floor(Date.now() / 1000);
    const d = this.nextCandleTime - now;
    return d < 0 ? 0 : d;
  }

  setOverlayStudy(id: OverlayStudyId | string): void {
    const next = (id === 'none' || !id ? 'none' : id) as OverlayStudyId;
    this.overlayStudy = next;
    if (!this.chart) return;
    this.overlayPlugin?.rebuildForStudy(this.overlayStudy);
    this.refreshStudies('full');
  }

  setRsiEnabled(on: boolean): void {
    this.rsiEnabled = on;
    if (!this.chart) return;
    this.rsiPlugin?.syncEnabled(on);
    this.applyLayout();
    this.refreshStudies('full');
  }

  setVolumeMaEnabled(on: boolean): void {
    this.volumeMaEnabled = on;
    this.volumeMaPlugin?.setUserVisible(on);
    this.volumeMaPlugin?.refresh(this.workingCandles());
  }

  setPriceScaleMode(mode: 'normal' | 'log' | 'percent'): void {
    this.priceScaleMode = mode;
    this.applyPriceScaleMode();
  }

  private applyPriceScaleMode(): void {
    if (!this.series) return;
    const mode =
      this.priceScaleMode === 'log'
        ? PriceScaleMode.Logarithmic
        : this.priceScaleMode === 'percent'
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;
    try {
      this.series.priceScale().applyOptions({ mode });
    } catch {
      try {
        this.series.priceScale().applyOptions({ mode: PriceScaleMode.Normal });
      } catch {
        /* ignore */
      }
    }
  }

  /** Save chart as PNG (no TradingView; uses library screenshot). */
  exportChartPng(filenameBase: string): void {
    if (!this.chart) return;
    try {
      const canvas = this.chart.takeScreenshot();
      const safe = filenameBase.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'chart';
      const a = document.createElement('a');
      a.download = `${safe}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch {
      // ignore
    }
  }

  /** Legacy MA dropdown → overlay study. */
  setMaOverlay(period: number | null): void {
    if (period == null) {
      this.setOverlayStudy('none');
      return;
    }
    const map: Record<number, OverlayStudyId> = {
      7: 'sma_7',
      9: 'sma_9',
      25: 'sma_25',
      99: 'sma_99',
    };
    const id = map[period];
    if (id) this.setOverlayStudy(id);
    else this.setOverlayStudy('none');
  }

  private fmtPrice(n: number): string {
    return formatFixedTrim(n, this.legendPrecision);
  }

  private fmtVol(v: number | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
    return formatFixedTrim(v, 2);
  }

  /** Matches chart `timeFormatter` (UTC, en-GB) for legend consistency. */
  private fmtBarTimeUtc(sec: number): string {
    const d = new Date(sec * 1000);
    return d.toLocaleString('en-GB', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private emitLegend(bar: CandleData | null): void {
    if (!this.legendCallback) return;
    if (!bar) {
      this.legendCallback('');
      return;
    }
    const ch = bar.close >= bar.open ? '▲' : '▼';
    const change = bar.close - bar.open;
    const pct = bar.open !== 0 ? (change / bar.open) * 100 : 0;
    const sign = change >= 0 ? '+' : '';
    this.legendCallback(
      `T ${this.fmtBarTimeUtc(bar.time)} UTC  ${ch} O ${this.fmtPrice(bar.open)}  H ${this.fmtPrice(bar.high)}  L ${this.fmtPrice(bar.low)}  C ${this.fmtPrice(bar.close)}  ${sign}${pct.toFixed(2)}%  Vol ${this.fmtVol(bar.volume)}`
    );
  }

  /** Crosshair row + optional modular EMA / overlay / RSI from `seriesData` (throttled). */
  private emitCrosshairLegend(param: MouseEventParams): void {
    if (!this.legendCallback || !this.series) return;
    const t = param.time as UTCTimestamp | undefined;
    if (t == null || param.point === undefined) {
      this.emitLegend(this.lastBar);
      return;
    }
    const timeNum = typeof t === 'number' ? t : Number(t);
    const bar = this.allCandles.find((c) => c.time === timeNum) ?? this.lastBar;
    if (!bar) {
      this.legendCallback('');
      return;
    }
    const ch = bar.close >= bar.open ? '▲' : '▼';
    const change = bar.close - bar.open;
    const pct = bar.open !== 0 ? (change / bar.open) * 100 : 0;
    const sign = change >= 0 ? '+' : '';
    let text = `T ${this.fmtBarTimeUtc(timeNum)} UTC  ${ch} O ${this.fmtPrice(bar.open)}  H ${this.fmtPrice(bar.high)}  L ${this.fmtPrice(
      bar.low
    )}  C ${this.fmtPrice(bar.close)}  ${sign}${pct.toFixed(2)}%  Vol ${this.fmtVol(bar.volume)}`;

    const appendLine = (series: ISeriesApi<'Line'> | null, fallbackLabel: string) => {
      if (!series) return;
      const d = param.seriesData.get(series);
      if (!d || typeof d !== 'object' || !('value' in d)) return;
      const v = (d as { value: number }).value;
      if (!Number.isFinite(v)) return;
      const label = this.lineSeriesLegendLabel.get(series) ?? fallbackLabel;
      text += `  ${label} ${this.fmtPrice(v)}`;
    };

    this.modularPlugin?.forEachLineSeries((line) => appendLine(line, 'EMA'));
    appendLine(this.overlayPlugin?.getOverlayLine() ?? null, 'Ovl');
    appendLine(this.overlayPlugin?.getBbUpper() ?? null, 'BB up');
    appendLine(this.overlayPlugin?.getBbMid() ?? null, 'BB mid');
    appendLine(this.overlayPlugin?.getBbLower() ?? null, 'BB lo');

    const rsiSeries = this.rsiPlugin?.getSeries() ?? null;
    if (rsiSeries) {
      const d = param.seriesData.get(rsiSeries);
      if (d && typeof d === 'object' && 'value' in d) {
        const v = (d as { value: number }).value;
        if (Number.isFinite(v)) text += `  RSI ${v.toFixed(2)}`;
      }
    }

    this.legendCallback(text);
  }

  private wireCrosshair(): void {
    if (!this.chart || !this.series) return;
    this.crosshairThrottled = throttleLeading(50, (param: MouseEventParams) => {
      this.emitCrosshairLegend(param);
    });
    this.chart.subscribeCrosshairMove((param: MouseEventParams) => {
      const t = param.time as UTCTimestamp | undefined;
      if (t == null || param.point === undefined) {
        this.emitLegend(this.lastBar);
        return;
      }
      this.crosshairThrottled?.(param);
    });
  }

  /** Phase 9 — UI: merge toggles; safe to call often. */
  applyExtensions(patch: Partial<ChartExtensionsConfig>): void {
    this.extensions = { ...this.extensions, ...patch };
    this.syncExtensionSeries();
    this.refreshStudies('full');
  }

  private syncExtensionSeries(): void {
    if (!this.chart || !this.series) return;
    const cfg = this.extensions;

    this.modularPlugin?.syncSeriesFromConfig({
      ema7: cfg.ema7,
      ema20: cfg.ema20,
      ema50: cfg.ema50,
      ema200: cfg.ema200,
      modularVwap: cfg.modularVwap,
    });

    if (this.volumeSeries) {
      const vis = cfg.volumeHistogram !== false;
      this.volumeSeries.applyOptions({ visible: vis });
    }
  }

  private refreshModularForKind(kind: 'full' | 'light'): void {
    const p = this.modularPlugin;
    if (!p?.isActive()) return;
    const candles = this.workingCandles();
    if (kind === 'full') {
      p.onCandlesFull(candles);
    } else {
      p.onCandlesLight(this.lastBar, candles);
    }
  }

  attachDrawingOverlay(overlayRoot: HTMLElement): void {
    if (!this.chart || !this.series) return;
    this.detachDrawingOverlay();
    this.drawingTools = new DrawingToolManager(this.chart, this.series, overlayRoot);
    this.drawingTools.setMode(this.drawingMode);
    this.drawingTools.setMutateCallback(this.drawingMutateListener);
  }

  /** Optional: persist drawings (e.g. localStorage) when user edits annotations. */
  setDrawingMutateListener(cb: (() => void) | null): void {
    this.drawingMutateListener = cb;
    this.drawingTools?.setMutateCallback(cb);
  }

  detachDrawingOverlay(): void {
    this.drawingTools?.destroy();
    this.drawingTools = null;
  }

  setDrawingToolMode(mode: DrawingToolMode): void {
    this.drawingMode = mode;
    this.drawingTools?.setMode(mode);
  }

  clearDrawings(): void {
    this.drawingTools?.clearAll();
  }

  /** Phase A — JSON-serializable drawings for persistence / workspace restore. */
  exportDrawings(): SerializedDrawing[] {
    return this.drawingTools?.serializeDrawings() ?? [];
  }

  importDrawings(payload: SerializedDrawing[]): void {
    this.drawingTools?.loadSerializedDrawings(payload);
  }

  updateTheme(theme: ChartTheme): void {
    if (!this.chart) return;
    this.theme = theme;
    const opts = getDomChartThemeOptions(theme);
    const cx = getDomChartCrosshairColors();
    const colors = getTradingChartColors();
    this.chart.applyOptions({
      layout: opts.layout,
      grid: opts.grid,
      crosshair: {
        vertLine: { color: cx.line, labelBackgroundColor: cx.labelBg },
        horzLine: { color: cx.line, labelBackgroundColor: cx.labelBg },
      },
      rightPriceScale: {
        ...opts.rightPriceScale,
        borderVisible: true,
        alignLabels: true,
      },
      timeScale: opts.timeScale,
    });
    this.series?.applyOptions({
      upColor: colors.up,
      downColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      ...this.priceFormatOptions(),
    });
    this.updatePriceLineColor();
    this.applyLayout();
    this.applyPriceScaleMode();
  }

  private refreshStudies(kind: 'full' | 'light' = 'full'): void {
    try {
      this.refreshStudiesInner(kind);
    } catch {
      /* indicators must not break candle rendering */
    }
  }

  private refreshStudiesInner(kind: 'full' | 'light'): void {
    const candles = this.workingCandles();
    this.overlayPlugin?.refreshForStudy(this.overlayStudy, candles);
    this.rsiPlugin?.refresh(this.rsiEnabled, candles);
    this.volumeMaPlugin?.refresh(candles);
    this.refreshModularForKind(kind);
  }

  private volColor(up: boolean): string {
    const c = getTradingChartColors();
    return up ? c.upVolume : c.downVolume;
  }

  private updatePriceLineColor(): void {
    if (!this.series || !this.lastBar) return;
    const colors = getTradingChartColors();
    const up = this.lastBar.close >= this.lastBar.open;
    this.series.applyOptions({
      priceLineColor: up ? colors.up : colors.down,
    });
  }

  setCandles(data: CandleData[]): void {
    if (!this.series) return;
    this.allCandles = [...data];
    const formatted = data.map((c) => ({
      time: toTs(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    this.series.setData(formatted);
    if (this.volumeSeries) {
      const vol = data.map((c) => ({
        time: toTs(c.time),
        value: c.volume ?? 0,
        color: this.volColor(c.close >= c.open),
      }));
      this.volumeSeries.setData(vol);
    }
    const last = data[data.length - 1];
    this.lastBar = last ? { ...last } : null;
    if (data.length >= 2) this.intervalSeconds = data[1]!.time - data[0]!.time;
    this.nextCandleTime = this.lastBar ? this.lastBar.time + this.intervalSeconds : 0;
    this.refreshStudies('full');
    this.updatePriceLineColor();
    this.emitLegend(this.lastBar);
  }

  prependCandles(data: CandleData[]): void {
    if (!this.series) return;
    if (data.length === 0) return;
    const merged = [...data, ...this.allCandles];
    merged.sort((a, b) => a.time - b.time);
    const deduped: CandleData[] = [];
    for (const c of merged) {
      const last = deduped[deduped.length - 1];
      if (last && last.time === c.time) deduped[deduped.length - 1] = c;
      else deduped.push(c);
    }
    this.setCandles(deduped);
  }

  private applyTick(tickTime: number, price: number, volumeDelta?: number): void {
    if (!this.series) return;
    const volAdd = volumeDelta != null && Number.isFinite(volumeDelta) && volumeDelta > 0 ? volumeDelta : 0;

    if (!this.lastBar) {
      const bar: CandleData = { time: tickTime, open: price, high: price, low: price, close: price, volume: volAdd };
      this.lastBar = { ...bar };
      this.nextCandleTime = this.lastBar.time + this.intervalSeconds;
      this.series.update({ time: toTs(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      this.volumeSeries?.update?.({
        time: toTs(bar.time),
        value: bar.volume ?? 0,
        color: this.volColor(true),
      });
      this.updatePriceLineColor();
      this.emitLegend(this.lastBar);
      this.refreshStudies('full');
      return;
    }

    if (tickTime < this.nextCandleTime) {
      this.lastBar.close = price;
      this.lastBar.high = Math.max(this.lastBar.high, price);
      this.lastBar.low = Math.min(this.lastBar.low, price);
      this.lastBar.volume = (this.lastBar.volume ?? 0) + volAdd;
      this.series.update({
        time: toTs(this.lastBar.time),
        open: this.lastBar.open,
        high: this.lastBar.high,
        low: this.lastBar.low,
        close: this.lastBar.close,
      });
      if (this.volumeSeries) {
        this.volumeSeries.update({
          time: toTs(this.lastBar.time),
          value: this.lastBar.volume ?? 0,
          color: this.volColor(this.lastBar.close >= this.lastBar.open),
        });
      }
      this.updatePriceLineColor();
      this.emitLegend(this.lastBar);
      this.throttledLightRefresh();
      return;
    }

    while (tickTime >= this.nextCandleTime) {
      const prevClose: number = this.lastBar.close;
      this.lastBar = {
        time: this.nextCandleTime,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
      };
      this.series.update({
        time: toTs(this.lastBar.time),
        open: this.lastBar.open,
        high: this.lastBar.high,
        low: this.lastBar.low,
        close: this.lastBar.close,
      });
      this.volumeSeries?.update?.({
        time: toTs(this.lastBar.time),
        value: this.lastBar.volume ?? 0,
        color: 'rgba(156, 163, 175, 0.2)',
      });
      this.nextCandleTime += this.intervalSeconds;
    }

    this.lastBar.close = price;
    this.lastBar.high = Math.max(this.lastBar.high, price);
    this.lastBar.low = Math.min(this.lastBar.low, price);
    this.lastBar.volume = (this.lastBar.volume ?? 0) + volAdd;
    this.series.update({
      time: toTs(this.lastBar.time),
      open: this.lastBar.open,
      high: this.lastBar.high,
      low: this.lastBar.low,
      close: this.lastBar.close,
    });
    if (this.volumeSeries) {
      this.volumeSeries.update({
        time: toTs(this.lastBar.time),
        value: this.lastBar.volume ?? 0,
        color: this.volColor(this.lastBar.close >= this.lastBar.open),
      });
    }
    this.updatePriceLineColor();
    this.emitLegend(this.lastBar);
    this.refreshStudies('full');
  }

  updatePrice(tickTime: number, price: number): void {
    this.applyTick(tickTime, price);
  }

  updateTrade(tickTime: number, price: number, volumeDelta: number): void {
    this.applyTick(tickTime, price, volumeDelta);
  }

  fitContent(): void {
    this.chart?.timeScale().fitContent();
  }

  setTradeMarkers(trades: TradeMarker[]): void {
    if (!this.series) return;
    const colors = getTradingChartColors();
    const markers = trades.map((t) => ({
      time: toTs(t.time),
      position: (t.side === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
      color: t.side === 'buy' ? colors.up : colors.down,
      shape: (t.side === 'buy' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
      text: '',
    }));
    this.series.setMarkers(markers);
  }

  destroy(): void {
    this.detachDrawingOverlay();
    this.modularPlugin?.disposeState();
    this.modularPlugin = null;
    this.overlayPlugin?.disposeState();
    this.overlayPlugin = null;
    this.rsiPlugin?.disposeState();
    this.rsiPlugin = null;
    this.volumeMaPlugin?.disposeState();
    this.volumeMaPlugin = null;
    this.legendCallback = null;
    this.crosshairThrottled = null;
    this.lineSeriesLegendLabel.clear();
    this.lastBar = null;
    this.nextCandleTime = 0;
    this.allCandles = [];
    const c = this.chart;
    this.chart = null;
    this.series = null;
    this.volumeSeries = null;
    try {
      c?.remove();
    } catch {
      // ignore
    }
  }
}
