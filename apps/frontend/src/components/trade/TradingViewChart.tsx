'use client';

import { useEffect, useRef } from 'react';

/** Map our market symbol (e.g. BTC_USDT) to TradingView symbol (e.g. BINANCE:BTCUSDT) */
function toTradingViewSymbol(symbol: string): string {
  const s = (symbol || '').replace(/-/g, '_').toUpperCase();
  if (!s) return 'BINANCE:BTCUSDT';
  const [base, quote] = s.split('_');
  if (base && quote) return `BINANCE:${base}${quote}`;
  return `BINANCE:${s}`;
}

interface TradingViewChartProps {
  symbol: string;
  height?: number;
  theme?: 'light' | 'dark';
}

declare global {
  interface Window {
    TradingView?: {
      widget: new (opts: Record<string, unknown>) => unknown;
    };
  }
}

export function TradingViewChart({ symbol, height = 340, theme = 'dark' }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<unknown>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) return;

    const containerId = 'tv_' + Math.random().toString(36).slice(2, 9);
    container.id = containerId;
    const tvSymbol = toTradingViewSymbol(symbol);

    const init = () => {
      if (!window.TradingView || !containerRef.current) return;
      const el = containerRef.current;
      el.innerHTML = '';
      el.id = containerId;
      try {
        widgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: '60',
          timezone: 'Etc/UTC',
          theme,
          style: '1',
          locale: 'en',
          toolbar_bg: theme === 'dark' ? '#1e2026' : '#fff',
          enable_publishing: false,
          allow_symbol_change: true,
          container_id: containerId,
          height,
        });
      } catch (_) {
        el.innerHTML = '<div class="flex items-center justify-center h-full text-muted-foreground text-sm">Chart failed to load</div>';
      }
    };

    if (window.TradingView) {
      init();
      return () => {
        if (containerRef.current) containerRef.current.innerHTML = '';
        widgetRef.current = null;
      };
    }

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => init();
    document.head.appendChild(script);
    return () => {
      script.remove();
      if (containerRef.current) containerRef.current.innerHTML = '';
      widgetRef.current = null;
    };
  }, [symbol, theme, height]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-[4px] overflow-hidden"
      style={{ minHeight: height }}
    />
  );
}
