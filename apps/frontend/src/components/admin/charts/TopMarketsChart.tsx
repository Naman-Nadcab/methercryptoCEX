'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';

const DEFAULT_DATA = [
  { pair: 'BTC/USDT', volume: 1250 },
  { pair: 'ETH/USDT', volume: 890 },
  { pair: 'SOL/USDT', volume: 420 },
  { pair: 'BNB/USDT', volume: 310 },
  { pair: 'XRP/USDT', volume: 280 },
];

interface TopMarketsChartProps {
  data?: { pair: string; volume: number }[];
}

export function TopMarketsChart({ data = DEFAULT_DATA }: TopMarketsChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} horizontal={false} />
        <XAxis type="number" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} tickFormatter={(v) => `$${v}k`} />
        <YAxis type="category" dataKey="pair" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} width={70} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number) => [`$${value}k`, 'Volume']}
        />
        <Bar dataKey="volume" fill={adminChartTheme.primary} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
