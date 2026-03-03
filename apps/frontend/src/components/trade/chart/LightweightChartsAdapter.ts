'use client';

import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { ChartAdapter, ChartTheme, CandleData, TradeMarker } from './ChartAdapter';

export class LightweightChartsAdapter implements ChartAdapter {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastBar: CandleData | null = null;
  private intervalSeconds = 60;
  private nextCandleTime = 0;

  init(container: HTMLElement, theme: ChartTheme): void {
    if (this.chart) this.destroy();
    const isDark = theme === 'dark';
    this.chart = createChart(container, {
      layout: {
        background: { color: isDark ? '#0b0e11' : '#ffffff' },
        textColor: isDark ? '#9ca3af' : '#374151',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
        horzLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
      },
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
    });
    this.series = this.chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chart && container.isConnected) {
        this.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    this.resizeObserver.observe(container);
  }

  setCandles(data: CandleData[]): void {
    if (!this.series) return;
    const formatted = data.map((c) => ({
      time: c.time as import('lightweight-charts').UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    this.series.setData(formatted);
    const last = data[data.length - 1];
    this.lastBar = last ? { ...last } : null;
    if (data.length >= 2) this.intervalSeconds = data[1].time - data[0].time;
    this.nextCandleTime = this.lastBar ? this.lastBar.time + this.intervalSeconds : 0;
  }

  updatePrice(tickTime: number, price: number): void {
    if (!this.series) return;
    const toUTCTimestamp = (t: number) => t as import('lightweight-charts').UTCTimestamp;
    if (!this.lastBar) {
      this.series.update({ time: toUTCTimestamp(tickTime), open: price, high: price, low: price, close: price });
      return;
    }
    if (tickTime < this.nextCandleTime) {
      this.lastBar.close = price;
      this.lastBar.high = Math.max(this.lastBar.high, price);
      this.lastBar.low = Math.min(this.lastBar.low, price);
      this.series.update({
        time: toUTCTimestamp(this.lastBar.time),
        open: this.lastBar.open,
        high: this.lastBar.high,
        low: this.lastBar.low,
        close: this.lastBar.close,
      });
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
      };
      this.series.update({
        time: toUTCTimestamp(this.lastBar.time),
        open: this.lastBar.open,
        high: this.lastBar.high,
        low: this.lastBar.low,
        close: this.lastBar.close,
      });
      this.nextCandleTime += this.intervalSeconds;
    }
    this.lastBar.close = price;
    this.lastBar.high = Math.max(this.lastBar.high, price);
    this.lastBar.low = Math.min(this.lastBar.low, price);
    this.series.update({
      time: toUTCTimestamp(this.lastBar.time),
      open: this.lastBar.open,
      high: this.lastBar.high,
      low: this.lastBar.low,
      close: this.lastBar.close,
    });
  }

  setTradeMarkers(trades: TradeMarker[]): void {
    if (!this.series) return;
    const toUTCTimestamp = (t: number) => t as import('lightweight-charts').UTCTimestamp;
    const markers = trades.map((t) => ({
      time: toUTCTimestamp(t.time),
      position: (t.side === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
      color: t.side === 'buy' ? '#22c55e' : '#ef4444',
      shape: 'circle' as const,
      text: '',
    }));
    this.series.setMarkers(markers);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.lastBar = null;
    this.nextCandleTime = 0;
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
      this.series = null;
    }
  }
}
