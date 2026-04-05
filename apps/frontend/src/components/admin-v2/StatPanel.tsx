'use client';

import { useMemo, memo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { type PanelStatus } from './Panel';
import { SmartTooltip } from './SmartTooltip';
import { type AnomalyResult } from './useAnomalyDetector';

interface StatPanelProps {
  title: string;
  value: string | number;
  unit?: string;
  status?: PanelStatus;
  sparkline?: number[];
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  percentChange?: number;
  anomaly?: AnomalyResult;
  tooltip?: string;
  tooltipDanger?: string;
  highlighted?: boolean;
  staleWarning?: boolean;
}

const STATUS_DOT: Record<PanelStatus, string> = {
  normal: 'bg-emerald-400',
  warning: 'bg-amber-400',
  critical: 'bg-red-400',
};

const STATUS_BORDER: Record<PanelStatus, string> = {
  normal: 'border-[#1F2937]',
  warning: 'border-amber-500/30',
  critical: 'border-red-500/40',
};

const STATUS_GLOW: Record<PanelStatus, string> = {
  normal: '',
  warning: 'shadow-[0_0_16px_-4px_rgba(245,158,11,0.2)]',
  critical: 'shadow-[0_0_16px_-4px_rgba(239,68,68,0.25)]',
};

const STATUS_STROKE: Record<PanelStatus, string> = {
  normal: '#34d399',
  warning: '#fbbf24',
  critical: '#f87171',
};

function StatPanelInner({
  title, value, unit, status = 'normal', sparkline, trend,
  percentChange, anomaly, tooltip, tooltipDanger, highlighted, staleWarning,
}: StatPanelProps) {
  const chartData = useMemo(
    () => (sparkline ?? []).map((v, i) => ({ i, v })),
    [sparkline]
  );

  const hasAnomaly = anomaly?.type != null;
  const anomalyGlow = hasAnomaly
    ? anomaly.type === 'spike'
      ? 'shadow-[0_0_20px_-4px_rgba(245,158,11,0.3)]'
      : 'shadow-[0_0_20px_-4px_rgba(239,68,68,0.3)]'
    : '';
  const highlightRing = highlighted ? 'ring-2 ring-blue-500/40' : '';

  const panel = (
    <div className={`
      rounded-xl border bg-[#151922] p-4 transition-all duration-200
      hover:bg-[#1a1f2e] hover:scale-[1.02] hover:shadow-lg
      ${STATUS_BORDER[status]} ${STATUS_GLOW[status]} ${anomalyGlow} ${highlightRing}
    `}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]} ${status === 'critical' ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{title}</span>
        {staleWarning && <span className="text-amber-400 text-[10px]" title="Stale data">⚠</span>}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-3xl font-bold text-[#E5E7EB] tabular-nums leading-none truncate">{value}</span>
          {unit && <span className="text-sm text-zinc-500 font-medium">{unit}</span>}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {trend && (
            <span className={`text-xs font-medium ${
              trend.direction === 'up' ? 'text-emerald-400' : trend.direction === 'down' ? 'text-red-400' : 'text-zinc-500'
            }`}>
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.label}
            </span>
          )}
          {percentChange !== undefined && percentChange !== 0 && (
            <span className={`text-[10px] font-semibold tabular-nums ${percentChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {percentChange > 0 ? '+' : ''}{percentChange.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {hasAnomaly && (
        <div className={`mt-2 px-2 py-1 rounded text-[10px] font-semibold ${
          anomaly.type === 'spike'
            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {anomaly.label}
        </div>
      )}

      {chartData.length > 2 && (
        <div className="h-10 mt-2 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={STATUS_STROKE[status]}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  if (tooltip) {
    return <SmartTooltip content={tooltip} danger={tooltipDanger}>{panel}</SmartTooltip>;
  }
  return panel;
}

export const StatPanel = memo(StatPanelInner);
