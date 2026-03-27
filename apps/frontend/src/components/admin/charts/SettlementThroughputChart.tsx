'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';

const DEFAULT_DATA = [
  { hour: '00:00', settled: 120, pending: 8 },
  { hour: '04:00', settled: 145, pending: 5 },
  { hour: '08:00', settled: 210, pending: 12 },
  { hour: '12:00', settled: 285, pending: 6 },
  { hour: '16:00', settled: 320, pending: 4 },
  { hour: '20:00', settled: 268, pending: 7 },
  { hour: '24:00', settled: 195, pending: 9 },
];

interface SettlementThroughputChartProps {
  data?: { hour: string; settled: number; pending?: number }[];
}

export function SettlementThroughputChart({ data = DEFAULT_DATA }: SettlementThroughputChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
        <XAxis dataKey="hour" stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <YAxis stroke={adminChartTheme.axis} fontSize={11} tickLine={false} />
        <Tooltip
          contentStyle={{
            background: adminChartTheme.tooltipBg,
            border: `1px solid ${adminChartTheme.tooltipBorder}`,
            borderRadius: '8px',
          }}
          labelStyle={{ color: adminChartTheme.axis }}
        />
        <Line type="monotone" dataKey="settled" stroke={adminChartTheme.success} strokeWidth={2} dot={false} name="Settled" />
        <Line type="monotone" dataKey="pending" stroke={adminChartTheme.warning} strokeWidth={1.5} dot={false} name="Pending" />
      </LineChart>
    </ResponsiveContainer>
  );
}
