/**
 * Phase C — Fibonacci UI lives in `DrawingToolManager` (`fib` mode + `SerializedDrawing` kind `fib`).
 * This class remains a thin placeholder for future extraction (e.g. shared math with server-side TA).
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export interface FibonacciToolContext {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
}

export class FibonacciRetracementTool {
  private ctx: FibonacciToolContext | null = null;

  init(ctx: FibonacciToolContext): void {
    this.destroy();
    this.ctx = ctx;
  }

  /** Use chart toolbar “Fib” + `DrawingToolManager` for interactive placement. */
  setSwing(_highTime: number, _highPrice: number, _lowTime: number, _lowPrice: number): void {
    if (!this.ctx) return;
  }

  destroy(): void {
    this.ctx = null;
  }
}
