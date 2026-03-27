'use client';

import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

export interface EarningsDay {
  date: string;
  earnings: number;
}

export interface ReferralEarningsChartProps {
  data?: EarningsDay[];
  loading?: boolean;
}

const DEFAULT_DAYS = 30;

function generatePlaceholderData(): EarningsDay[] {
  const now = new Date();
  const out: EarningsDay[] = [];
  for (let i = DEFAULT_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push({
      date: d.toISOString().split('T')[0],
      earnings: Math.random() * 20 + (i < 7 ? 5 : 0),
    });
  }
  return out;
}

export function ReferralEarningsChart({ data, loading = false }: ReferralEarningsChartProps) {
  const chartData = useMemo(() => {
    if (data && data.length > 0) return data;
    return generatePlaceholderData();
  }, [data]);

  const maxEarnings = useMemo(() => Math.max(1, ...chartData.map((d) => d.earnings)), [chartData]);
  const points = useMemo(() => {
    const len = chartData.length;
    return chartData.map((d, i) => ({
      x: (i / (len - 1 || 1)) * 100,
      y: 100 - (d.earnings / maxEarnings) * 90,
      date: d.date,
      earnings: d.earnings,
    }));
  }, [chartData, maxEarnings]);

  const pathD = useMemo(
    () => `M 0,100 ${points.map((p) => `L ${p.x},${p.y}`).join(' ')} L 100,100 Z`,
    [points]
  );
  const lineD = useMemo(
    () => `M ${points[0]?.x ?? 0},${points[0]?.y ?? 100} ${points.slice(1).map((p) => `L ${p.x},${p.y}`).join(' ')}`,
    [points]
  );

  return (
    <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 card-bybit">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Referral Earnings</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Last 30 days</p>
      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      ) : (
        <div className="h-48 relative">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-gray-100 dark:border-gray-800" />
            ))}
          </div>
          <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="earningsGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path d={pathD} fill="url(#earningsGrad)" />
            <path d={lineD} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" />
          </svg>
          <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-500 dark:text-gray-400 pt-1">
            {chartData
              .filter((_, i) => i % Math.max(1, Math.floor(chartData.length / 6)) === 0)
              .map((d) => (
                <span key={d.date}>{d.date.slice(5)}</span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
