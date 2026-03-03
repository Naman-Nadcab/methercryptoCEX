'use client';

import { useState } from 'react';
import { useChartAdapter } from './chart';
import type { ChartTheme } from './chart/ChartAdapter';

const INTERVALS: { label: string; seconds: number }[] = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1H', seconds: 3600 },
  { label: '4H', seconds: 14400 },
  { label: '1D', seconds: 86400 },
];

interface ChartPanelProps {
  symbol?: string;
  intervalSeconds?: number;
  theme?: ChartTheme;
}

export function ChartPanel({
  symbol = 'BTC_USDT',
  intervalSeconds: initialInterval = 60,
  theme = 'dark',
}: ChartPanelProps) {
  const [intervalSeconds, setIntervalSeconds] = useState(initialInterval);
  useChartAdapter(symbol, intervalSeconds, theme);
  return (
    <div className="h-full min-h-0 bg-[#0b0e11] flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        {INTERVALS.map(({ label, seconds }) => (
          <button
            key={seconds}
            type="button"
            onClick={() => setIntervalSeconds(seconds)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              intervalSeconds === seconds
                ? 'bg-blue-500/30 text-blue-300'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0" id="chart-mount" aria-label="Chart container" />
    </div>
  );
}
