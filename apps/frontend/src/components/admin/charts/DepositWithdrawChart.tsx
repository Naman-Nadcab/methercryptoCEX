'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';

const DEFAULT_DATA = [
  { day: 'Mon', deposit: 420, withdraw: 380 },
  { day: 'Tue', deposit: 510, withdraw: 440 },
  { day: 'Wed', deposit: 380, withdraw: 410 },
  { day: 'Thu', deposit: 590, withdraw: 520 },
  { day: 'Fri', deposit: 720, withdraw: 610 },
  { day: 'Sat', deposit: 650, withdraw: 580 },
  { day: 'Sun', deposit: 480, withdraw: 490 },
];

interface DepositWithdrawChartProps {
  data?: { day: string; deposit: number; withdraw: number }[];
}

export function DepositWithdrawChart({ data = DEFAULT_DATA }: DepositWithdrawChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="day" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} tickFormatter={(v) => `$${v}k`} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
          formatter={(value: number) => [`$${value}k`, '']}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => value} />
        <Bar dataKey="deposit" fill={adminChartTheme.success} radius={[4, 4, 0, 0]} name="Deposit" />
        <Bar dataKey="withdraw" fill={adminChartTheme.warning} radius={[4, 4, 0, 0]} name="Withdraw" />
      </BarChart>
    </ResponsiveContainer>
  );
}
