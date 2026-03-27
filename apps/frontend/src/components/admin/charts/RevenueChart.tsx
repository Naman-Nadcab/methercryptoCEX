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
  { day: 'Mon', revenue: 12400 },
  { day: 'Tue', revenue: 15200 },
  { day: 'Wed', revenue: 13800 },
  { day: 'Thu', revenue: 18900 },
  { day: 'Fri', revenue: 22100 },
  { day: 'Sat', revenue: 25600 },
  { day: 'Sun', revenue: 24300 },
];

interface RevenueChartProps {
  data?: { day: string; revenue: number }[];
}

export function RevenueChart({ data = DEFAULT_DATA }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={adminChartTheme.success} stopOpacity={0.4} />
            <stop offset="100%" stopColor={adminChartTheme.success} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="day" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
        />
        <Area type="monotone" dataKey="revenue" stroke={adminChartTheme.success} fill="url(#revenueGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
