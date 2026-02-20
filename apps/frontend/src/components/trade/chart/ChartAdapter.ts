/**
 * Engine-agnostic chart adapter.
 * Swap implementations (e.g. LightweightCharts vs TradingView) without changing layout.
 */

export type ChartTheme = 'dark' | 'light';

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartAdapter {
  init(container: HTMLElement, theme: ChartTheme): void;
  setCandles(data: CandleData[]): void;
  updatePrice(tickTime: number, price: number): void;
  destroy(): void;
}
