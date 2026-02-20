'use client';

import { useChartAdapter } from './chart';
import type { ChartTheme } from './chart/ChartAdapter';

interface ChartPanelProps {
  symbol?: string;
  intervalSeconds?: number;
  theme?: ChartTheme;
}

export function ChartPanel({
  symbol = 'BTC_USDT',
  intervalSeconds = 60,
  theme = 'dark',
}: ChartPanelProps) {
  useChartAdapter(symbol, intervalSeconds, theme);
  return (
    <div className="h-full min-h-0 bg-[#0b0e11] flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <span className="text-xs text-gray-500">1m</span>
        <span className="text-xs text-gray-500">5m</span>
        <span className="text-xs text-gray-500">15m</span>
        <span className="text-xs text-gray-500">1H</span>
        <span className="text-xs text-gray-500">4H</span>
        <span className="text-xs text-gray-500">1D</span>
      </div>
      <div className="flex-1 min-h-0" id="chart-mount" aria-label="Chart container" />
    </div>
  );
}
