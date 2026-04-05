'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { type PanelStatus } from './Panel';

type TimeRange = '5m' | '15m' | '1h' | '6h' | '24h';
type RefreshInterval = 5 | 15 | 30 | 60 | 0;

interface TimeSeriesPoint {
  time: string;
  value: number;
}

interface TimeSeriesPanelProps {
  title: string;
  data: TimeSeriesPoint[];
  status?: PanelStatus;
  warningThreshold?: number;
  criticalThreshold?: number;
  unit?: string;
  color?: string;
  onTimeRangeChange?: (range: TimeRange) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

const TIME_RANGES: TimeRange[] = ['5m', '15m', '1h', '6h', '24h'];
const REFRESH_OPTIONS: { label: string; value: RefreshInterval }[] = [
  { label: '5s', value: 5 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: 'Off', value: 0 },
];

const STATUS_BORDER: Record<PanelStatus, string> = {
  normal: 'border-[#1F2937]',
  warning: 'border-amber-500/30',
  critical: 'border-red-500/40',
};

export function TimeSeriesPanel({
  title, data, status = 'normal', warningThreshold, criticalThreshold,
  unit = '', color = '#3b82f6', onTimeRangeChange, onRefresh, loading,
}: TimeSeriesPanelProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(15);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleTimeRange = useCallback((range: TimeRange) => {
    setTimeRange(range);
    onTimeRangeChange?.(range);
  }, [onTimeRangeChange]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0 && onRefresh) {
      intervalRef.current = setInterval(onRefresh, refreshInterval * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refreshInterval, onRefresh]);

  const currentValue = data.length > 0 ? data[data.length - 1]!.value : null;
  const formattedValue = currentValue !== null
    ? `${currentValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`
    : '—';

  return (
    <div className={`rounded-xl border bg-[#151922] transition-all duration-200 hover:bg-[#1a1f2e] ${STATUS_BORDER[status]}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">{title}</h3>
          {loading && (
            <div className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
          )}
        </div>
        <span className="text-lg font-semibold text-[#E5E7EB] tabular-nums">{formattedValue}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 pb-3">
        <div className="flex gap-1">
          {TIME_RANGES.map((r) => (
            <button key={r} onClick={() => handleTimeRange(r)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                timeRange === r
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/5'
              }`}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {REFRESH_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => setRefreshInterval(o.value)}
              className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                refreshInterval === o.value
                  ? 'bg-zinc-700 text-zinc-300'
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-48 px-2 pb-4">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis
                dataKey="time" tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false} axisLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} width={45} />
              <Tooltip
                contentStyle={{ backgroundColor: '#151922', border: '1px solid #1F2937', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#6B7280' }}
                itemStyle={{ color: '#E5E7EB' }}
                formatter={(v: number) => [`${v.toLocaleString()}${unit}`, '']}
              />
              {warningThreshold !== undefined && (
                <ReferenceLine y={warningThreshold} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} />
              )}
              {criticalThreshold !== undefined && (
                <ReferenceLine y={criticalThreshold} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
              )}
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-zinc-600">No data</div>
        )}
      </div>
    </div>
  );
}
