'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';

const DEFAULT_DATA = [
  { time: '00:00', volume: 12400, usd: 482000 },
  { time: '04:00', volume: 15200, usd: 591000 },
  { time: '08:00', volume: 18900, usd: 734000 },
  { time: '12:00', volume: 22100, usd: 858000 },
  { time: '16:00', volume: 25600, usd: 994000 },
  { time: '20:00', volume: 24300, usd: 944000 },
  { time: '24:00', volume: 19800, usd: 769000 },
];

interface TradingVolumeChartProps {
  data?: { time: string; volume: number; usd?: number }[];
}

export function TradingVolumeChart({ data = DEFAULT_DATA }: TradingVolumeChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={adminChartTheme.primary} stopOpacity={0.4} />
            <stop offset="100%" stopColor={adminChartTheme.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="time" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number) => [(value / 1000).toFixed(1) + 'k', 'Volume']}
        />
        <Area type="monotone" dataKey="volume" stroke={adminChartTheme.primary} fill="url(#volumeGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
