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
  { day: 'Mon', orders: 42, volume: 125 },
  { day: 'Tue', orders: 58, volume: 168 },
  { day: 'Wed', orders: 51, volume: 142 },
  { day: 'Thu', orders: 67, volume: 195 },
  { day: 'Fri', orders: 74, volume: 218 },
  { day: 'Sat', orders: 69, volume: 201 },
  { day: 'Sun', orders: 62, volume: 178 },
];

interface P2PActivityChartProps {
  data?: { day: string; orders: number; volume: number }[];
}

export function P2PActivityChart({ data = DEFAULT_DATA }: P2PActivityChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="p2pGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={adminChartTheme.warning} stopOpacity={0.4} />
            <stop offset="100%" stopColor={adminChartTheme.warning} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="day" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number, name: string) => [value, name === 'volume' ? 'Volume (k USDT)' : 'Orders']}
        />
        <Area type="monotone" dataKey="orders" stroke={adminChartTheme.warning} fill="url(#p2pGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
