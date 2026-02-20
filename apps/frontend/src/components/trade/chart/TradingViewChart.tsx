'use client';

import { useEffect, useRef } from 'react';

/** Map exchange symbol (e.g. BTC_USDT) to generic chart symbol (e.g. BTCUSDT) */
function toTradingViewSymbol(symbol: string): string {
  const normalized = (symbol || '').replace(/-/g, '_').toUpperCase();
  if (!normalized) return 'BTCUSDT';
  const [base, quote] = normalized.split('_');
  if (!base || !quote) return normalized.replace('_', '');
  return `${base}${quote}`;
}

interface TradingViewChartProps {
  symbol: string;
  height?: number;
  theme?: 'light' | 'dark';
  className?: string;
}

export function TradingViewChart({ symbol, height = 400, theme = 'dark', className = '' }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = toTradingViewSymbol(symbol);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.type = 'text/javascript';
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: '60',
      timezone: 'Etc/UTC',
      theme,
      style: '1',
      locale: 'en',
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: true,
      save_image: false,
      calendar: false,
      allow_symbol_change: false,
      studies: [],
      support_host: 'https://www.tradingview.com',
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [tvSymbol, theme]);

  return (
    <div
      className={`tradingview-widget-container ${className}`}
      ref={containerRef}
      style={{ height: `${height}px`, width: '100%' }}
    />
  );
}
