'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface LiquidityDepthChartProps {
  /** By-market volume data (e.g. from analytics/liquidity by_market) */
  data?: Array<{ market: string; volume: number }>;
  height?: number;
}

export function LiquidityDepthChart({ data = [], height = 260 }: LiquidityDepthChartProps) {
  const chartData = data.slice(0, 10).map((d) => ({
    market: d.market,
    volume: Number(d.volume) || 0,
  }));

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--admin-text-muted)]"
        style={{ height }}
      >
        No liquidity data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="market"
          tick={{ fontSize: 11, fill: 'var(--admin-text-muted)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--admin-text-muted)' }}
          tickLine={false}
          tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v))}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--admin-card-bg)',
            border: '1px solid var(--admin-card-border)',
            borderRadius: 'var(--admin-radius)',
          }}
          labelStyle={{ color: 'var(--admin-text)' }}
          formatter={(value: number) => [Number(value).toLocaleString(), 'Volume']}
        />
        <Bar
          dataKey="volume"
          fill="var(--admin-primary)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
