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
  volume?: number;
}

export interface TradeMarker {
  time: number;
  price: number;
  side: 'buy' | 'sell';
}

export interface ChartAdapter {
  init(container: HTMLElement, theme: ChartTheme): void;
  /** Re-apply layout/grid/scale colors when app theme changes (light/dark). */
  updateTheme?(theme: ChartTheme): void;
  setCandles(data: CandleData[]): void;
  /** Optional: Used for history backfill without full re-init. */
  prependCandles?(data: CandleData[]): void;
  updatePrice(tickTime: number, price: number): void;
  /** Update last candle using trade tick (adds volume if provided). */
  updateTrade?(tickTime: number, price: number, volumeDelta: number): void;
  fitContent?(): void;
  setTradeMarkers?(trades: TradeMarker[]): void;
  /** Optional: MA overlay. period = 7, 25, 99 etc.; null = hide */
  setMaOverlay?(period: number | null): void;
  destroy(): void;
}
