'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';

const DEFAULT_DATA = [
  { name: 'BTC/USDT', value: 42, color: adminChartTheme.primary },
  { name: 'ETH/USDT', value: 28, color: adminChartTheme.secondary },
  { name: 'SOL/USDT', value: 15, color: adminChartTheme.success },
  { name: 'Others', value: 15, color: adminChartTheme.warning },
];

interface TradeDistributionChartProps {
  data?: { name: string; value: number; color?: string }[];
}

export function TradeDistributionChart({ data = DEFAULT_DATA }: TradeDistributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color ?? adminChartTheme.primary} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number, name: string) => [`${value}%`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
