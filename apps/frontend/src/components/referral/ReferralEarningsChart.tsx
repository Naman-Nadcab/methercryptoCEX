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

export function ReferralEarningsChart({ data, loading = false }: ReferralEarningsChartProps) {
  const chartData = useMemo(() => (data && data.length > 0 ? data : []), [data]);

  const maxEarnings = useMemo(
    () => Math.max(1, ...chartData.map((d) => d.earnings)),
    [chartData]
  );
  const points = useMemo(() => {
    const len = chartData.length;
    if (len === 0) return [];
    return chartData.map((d, i) => ({
      x: (i / (len - 1 || 1)) * 100,
      y: 100 - (d.earnings / maxEarnings) * 90,
      date: d.date,
      earnings: d.earnings,
    }));
  }, [chartData, maxEarnings]);

  const pathD = useMemo(
    () => (points.length ? `M 0,100 ${points.map((p) => `L ${p.x},${p.y}`).join(' ')} L 100,100 Z` : ''),
    [points]
  );
  const lineD = useMemo(
    () =>
      points.length
        ? `M ${points[0]!.x},${points[0]!.y} ${points.slice(1).map((p) => `L ${p.x},${p.y}`).join(' ')}`
        : '',
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
      ) : chartData.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-center px-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">No daily earnings history yet.</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Totals above reflect your live referral account.</p>
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
