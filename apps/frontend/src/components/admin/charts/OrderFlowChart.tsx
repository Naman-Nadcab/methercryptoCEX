'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';

const DEFAULT_DATA = [
  { hour: '00', buy: 420, sell: 380 },
  { hour: '04', buy: 510, sell: 490 },
  { hour: '08', buy: 720, sell: 680 },
  { hour: '12', buy: 890, sell: 820 },
  { hour: '16', buy: 950, sell: 910 },
  { hour: '20', buy: 780, sell: 750 },
  { hour: '24', buy: 620, sell: 590 },
];

interface OrderFlowChartProps {
  data?: { hour: string; buy: number; sell: number }[];
}

export function OrderFlowChart({ data = DEFAULT_DATA }: OrderFlowChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="hour" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} tickFormatter={(v) => `${(v / 100).toFixed(0)}`} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number, name: string) => [value, name === 'buy' ? 'Buy' : 'Sell']}
        />
        <Bar dataKey="buy" fill={adminChartTheme.success} radius={[4, 4, 0, 0]} name="buy" />
        <Bar dataKey="sell" fill={adminChartTheme.danger} radius={[4, 4, 0, 0]} name="sell" />
      </BarChart>
    </ResponsiveContainer>
  );
}
