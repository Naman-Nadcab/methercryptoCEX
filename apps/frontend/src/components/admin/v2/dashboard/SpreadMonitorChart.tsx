'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface SpreadMonitorChartProps {
  /** Current spread in bps (from liquidity bot config) */
  spreadBps?: number;
  /** Optional time series: e.g. [{ bucket: '2024-01-01T00:00', spreadBps: 12 }, ...] */
  series?: Array<{ bucket: string; spreadBps: number }>;
  height?: number;
}

export function SpreadMonitorChart({ spreadBps = 0, series = [], height = 260 }: SpreadMonitorChartProps) {
  const chartData = series.length > 0
    ? series.map((d) => ({
        name: d.bucket.slice(0, 16).replace('T', ' '),
        spreadBps: Number(d.spreadBps) ?? 0,
      }))
    : [
        { name: 'Now', spreadBps: spreadBps },
        { name: '', spreadBps: spreadBps },
      ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="spreadGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--admin-warning)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--admin-warning)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--admin-text-muted)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--admin-text-muted)' }}
          tickLine={false}
          tickFormatter={(v) => `${v} bps`}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--admin-card-bg)',
            border: '1px solid var(--admin-card-border)',
            borderRadius: 'var(--admin-radius)',
          }}
          labelStyle={{ color: 'var(--admin-text)' }}
          formatter={(value: number) => [`${value} bps`, 'Spread']}
        />
        {series.length === 0 && spreadBps > 0 && (
          <ReferenceLine y={spreadBps} stroke="var(--admin-warning)" strokeDasharray="4 2" />
        )}
        <Area
          type="monotone"
          dataKey="spreadBps"
          stroke="var(--admin-warning)"
          fill="url(#spreadGradient)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
