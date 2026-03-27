'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export interface OrderbookDepthChartProps {
  /** Bid depth (USD or quote value) */
  bidDepth: number;
  /** Ask depth (USD or quote value) */
  askDepth: number;
  /** Optional symbol label */
  symbol?: string;
  height?: number;
}

export function OrderbookDepthChart({ bidDepth, askDepth, symbol = '', height = 220 }: OrderbookDepthChartProps) {
  const data = [
    { name: 'Bid', depth: bidDepth, fill: 'var(--chart-success)' },
    { name: 'Ask', depth: askDepth, fill: 'var(--chart-danger)' },
  ].filter((d) => d.depth > 0);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--admin-text-muted)]"
        style={{ height }}
      >
        No depth data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 8, left: 40, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--admin-text-muted)' }} tickLine={false} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v))} />
        <YAxis type="category" dataKey="name" width={36} tick={{ fontSize: 11, fill: 'var(--admin-text)' }} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--admin-card-bg)',
            border: '1px solid var(--admin-card-border)',
            borderRadius: 'var(--admin-radius)',
          }}
          formatter={(value: number) => [value.toLocaleString(), 'Depth']}
        />
        <Legend />
        <Bar dataKey="depth" name="Depth" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
