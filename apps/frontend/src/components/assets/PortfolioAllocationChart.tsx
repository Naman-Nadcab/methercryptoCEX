'use client';

import { useMemo } from 'react';

export interface AllocationItem {
  symbol: string;
  value: number;
  percent: number;
}

const CHART_COLORS = [
  'hsl(160 84% 45%)', // primary green
  'hsl(217 91% 60%)', // blue
  'hsl(45 93% 47%)',  // yellow/amber
  'hsl(280 67% 58%)', // purple
  'hsl(0 84% 60%)',   // red
  'hsl(173 80% 40%)', // teal
  'hsl(30 100% 55%)', // orange
  'hsl(200 90% 50%)', // cyan
];

function buildSectorPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} L ${cx} ${cy} Z`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy - r * Math.sin(rad),
  };
}

export interface PortfolioAllocationChartProps {
  items: AllocationItem[];
  size?: number;
}

export function PortfolioAllocationChart({ items, size = 180 }: PortfolioAllocationChartProps) {
  const { paths, total } = useMemo(() => {
    const filtered = items.filter((i) => i.value > 0);
    const total = filtered.reduce((s, i) => s + i.value, 0);
    if (filtered.length === 0 || total <= 0) return { paths: [], total: 0 };
    let startAngle = 0;
    const paths = filtered.map((item, idx) => {
      const sweep = (item.value / total) * 360;
      const endAngle = startAngle + sweep;
      const path = buildSectorPath(size / 2, size / 2, (size / 2) * 0.9, startAngle, endAngle);
      startAngle = endAngle;
      return {
        symbol: item.symbol,
        percent: item.percent,
        path,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      };
    });
    return { paths, total };
  }, [items, size]);

  const innerR = (size / 2) * 0.5;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="bg-card rounded-xl p-5 border border-border card-bybit">
      <h3 className="text-sm font-semibold text-foreground mb-4">Portfolio Allocation</h3>
      {paths.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-24 h-24 rounded-full border-2 border-dashed border-border flex items-center justify-center mb-3">
            <span className="text-xs text-muted-foreground">No assets</span>
          </div>
          <p className="text-sm text-muted-foreground">Deposit to see allocation</p>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
              {paths.map((p, i) => (
                <path
                  key={p.symbol}
                  d={p.path}
                  fill={p.color}
                  opacity={0.9}
                  stroke="rgba(0,0,0,0.1)"
                  strokeWidth={0.5}
                />
              ))}
              <circle cx={cx} cy={cy} r={innerR} fill="hsl(var(--card))" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            </svg>
          </div>
          <div className="flex flex-wrap gap-3 min-w-0">
            {paths.map((p, i) => (
              <div key={p.symbol} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="text-sm text-foreground/80 truncate">{p.symbol}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{p.percent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
