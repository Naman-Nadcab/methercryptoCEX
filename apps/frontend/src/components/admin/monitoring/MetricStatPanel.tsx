'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';

type ThresholdLevel = 'normal' | 'warning' | 'critical';

interface Threshold {
  value: number;
  level: 'warning' | 'critical';
}

interface MetricStatPanelProps {
  label: string;
  value: number | string;
  unit?: string;
  sparklineData?: number[];
  thresholds?: Threshold[];
  description?: string;
  icon?: React.ReactNode;
  className?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
}

function getLevel(value: number | string | undefined, thresholds?: Threshold[]): ThresholdLevel {
  if (value == null || !thresholds?.length) return 'normal';
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(n)) return 'normal';
  const critical = thresholds.find((t) => t.level === 'critical');
  if (critical && n >= critical.value) return 'critical';
  const warning = thresholds.find((t) => t.level === 'warning');
  if (warning && n >= warning.value) return 'warning';
  return 'normal';
}

const BORDER_MAP: Record<ThresholdLevel, string> = {
  normal: 'border-zinc-800',
  warning: 'border-amber-500/40',
  critical: 'border-red-500/50',
};

const VALUE_COLOR: Record<ThresholdLevel, string> = {
  normal: 'text-zinc-100',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

const SPARK_COLOR: Record<ThresholdLevel, string> = {
  normal: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

const INDICATOR: Record<ThresholdLevel, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500 animate-pulse',
};

export function MetricStatPanel({
  label,
  value,
  unit,
  sparklineData,
  thresholds,
  description,
  icon,
  className = '',
  trend,
  trendValue,
}: MetricStatPanelProps) {
  const level = getLevel(value, thresholds);

  const chartData = useMemo(
    () => (sparklineData ?? []).map((v, i) => ({ i, v })),
    [sparklineData],
  );

  const displayValue = typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div
      className={`rounded-xl border bg-zinc-900 ${BORDER_MAP[level]} p-4 flex flex-col justify-between min-h-[140px] transition-all duration-300 hover:bg-zinc-900/80 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${INDICATOR[level]}`} />
          <span className="text-xs font-medium text-zinc-400 truncate uppercase tracking-wider">
            {label}
          </span>
        </div>
        {icon && <div className="text-zinc-500 shrink-0">{icon}</div>}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums leading-none ${VALUE_COLOR[level]}`}>
              {displayValue}
            </span>
            {unit && <span className="text-xs text-zinc-500">{unit}</span>}
          </div>
          {description && (
            <p className="text-[11px] text-zinc-500 mt-1 truncate">{description}</p>
          )}
          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-1">
              <span
                className={`text-[11px] font-medium ${
                  trend === 'up'
                    ? 'text-emerald-400'
                    : trend === 'down'
                      ? 'text-red-400'
                      : 'text-zinc-500'
                }`}
              >
                {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
              </span>
            </div>
          )}
        </div>

        {chartData.length > 1 && (
          <div className="w-20 h-10 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={SPARK_COLOR[level]}
                  strokeWidth={1.5}
                  dot={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
