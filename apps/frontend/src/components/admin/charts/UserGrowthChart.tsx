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
  { date: 'Mon', users: 1240, new: 48 },
  { date: 'Tue', users: 1320, new: 52 },
  { date: 'Wed', users: 1410, new: 61 },
  { date: 'Thu', users: 1490, new: 58 },
  { date: 'Fri', users: 1580, new: 72 },
  { date: 'Sat', users: 1680, new: 65 },
  { date: 'Sun', users: 1750, new: 54 },
];

interface UserGrowthChartProps {
  data?: { date: string; users: number; new?: number }[];
}

export function UserGrowthChart({ data = DEFAULT_DATA }: UserGrowthChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="userGrowthGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={adminChartTheme.secondary} stopOpacity={0.4} />
            <stop offset="100%" stopColor={adminChartTheme.secondary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="date" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
        />
        <Area type="monotone" dataKey="users" stroke={adminChartTheme.secondary} fill="url(#userGrowthGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
