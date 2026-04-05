'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

type TimeRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';
type RefreshInterval = 5 | 15 | 30 | 60 | 0;
type ThresholdLevel = 'normal' | 'warning' | 'critical';

interface Threshold {
  value: number;
  level: 'warning' | 'critical';
  label?: string;
}

interface DataPoint {
  time: string;
  value?: number;
  [key: string]: string | number | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartDataRow = { time: string; [key: string]: any };

interface TimeSeriesPanelProps {
  title: string;
  data: ChartDataRow[];
  dataKey?: string;
  unit?: string;
  thresholds?: Threshold[];
  currentValue?: number | string;
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
  refreshInterval?: RefreshInterval;
  onRefreshIntervalChange?: (interval: RefreshInterval) => void;
  lineColor?: string;
  fillOpacity?: number;
  height?: number;
  className?: string;
  lines?: Array<{ dataKey: string; color: string; name: string }>;
}

const TIME_RANGES: TimeRange[] = ['5m', '15m', '1h', '6h', '24h', '7d'];
const REFRESH_OPTIONS: { label: string; value: RefreshInterval }[] = [
  { label: '5s', value: 5 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: 'Off', value: 0 },
];

function getThresholdLevel(value: number | undefined, thresholds?: Threshold[]): ThresholdLevel {
  if (value == null || !thresholds?.length) return 'normal';
  const critical = thresholds.find((t) => t.level === 'critical');
  if (critical && value >= critical.value) return 'critical';
  const warning = thresholds.find((t) => t.level === 'warning');
  if (warning && value >= warning.value) return 'warning';
  return 'normal';
}

const BORDER_COLORS: Record<ThresholdLevel, string> = {
  normal: 'border-emerald-500/40',
  warning: 'border-amber-500/60',
  critical: 'border-red-500/60',
};

const GLOW_COLORS: Record<ThresholdLevel, string> = {
  normal: '',
  warning: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]',
  critical: 'shadow-[0_0_12px_rgba(239,68,68,0.2)]',
};

export function TimeSeriesPanel({
  title,
  data,
  dataKey = 'value',
  unit = '',
  thresholds,
  currentValue,
  timeRange: controlledRange,
  onTimeRangeChange,
  refreshInterval: controlledRefresh,
  onRefreshIntervalChange,
  lineColor = '#3b82f6',
  fillOpacity = 0.08,
  height = 220,
  className = '',
  lines,
}: TimeSeriesPanelProps) {
  const [internalRange, setInternalRange] = useState<TimeRange>('15m');
  const [internalRefresh, setInternalRefresh] = useState<RefreshInterval>(15);
  const [showRefreshMenu, setShowRefreshMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const range = controlledRange ?? internalRange;
  const refresh = controlledRefresh ?? internalRefresh;

  const handleRangeChange = useCallback(
    (r: TimeRange) => {
      onTimeRangeChange ? onTimeRangeChange(r) : setInternalRange(r);
    },
    [onTimeRangeChange],
  );

  const handleRefreshChange = useCallback(
    (r: RefreshInterval) => {
      onRefreshIntervalChange ? onRefreshIntervalChange(r) : setInternalRefresh(r);
      setShowRefreshMenu(false);
    },
    [onRefreshIntervalChange],
  );

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowRefreshMenu(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const numericCurrent =
    typeof currentValue === 'number'
      ? currentValue
      : typeof currentValue === 'string'
        ? parseFloat(currentValue)
        : data.length > 0
          ? (data[data.length - 1][dataKey] as number)
          : undefined;

  const level = getThresholdLevel(numericCurrent, thresholds);

  const refreshLabel = REFRESH_OPTIONS.find((o) => o.value === refresh)?.label ?? 'Off';

  return (
    <div
      className={`rounded-xl border bg-zinc-900 ${BORDER_COLORS[level]} ${GLOW_COLORS[level]} transition-all duration-300 ${className}`}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              level === 'critical'
                ? 'bg-red-500 animate-pulse'
                : level === 'warning'
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
            }`}
          />
          <h3 className="text-sm font-medium text-zinc-100 truncate">{title}</h3>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Auto-refresh toggle */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowRefreshMenu((p) => !p)}
              className="text-[10px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 px-2 py-1 rounded transition-colors"
            >
              ↻ {refreshLabel}
            </button>
            {showRefreshMenu && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[80px]">
                {REFRESH_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => handleRefreshChange(o.value)}
                    className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      refresh === o.value
                        ? 'text-blue-400 bg-zinc-700/50'
                        : 'text-zinc-300 hover:bg-zinc-700/50'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Time range selector */}
          <div className="flex items-center bg-zinc-800 rounded-lg p-0.5">
            {TIME_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => handleRangeChange(r)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${
                  range === r
                    ? 'bg-zinc-600 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Current value */}
      {currentValue != null && (
        <div className="px-4 pt-3 flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold tabular-nums ${
              level === 'critical'
                ? 'text-red-400'
                : level === 'warning'
                  ? 'text-amber-400'
                  : 'text-zinc-100'
            }`}
          >
            {typeof currentValue === 'number' ? currentValue.toLocaleString() : currentValue}
          </span>
          {unit && <span className="text-xs text-zinc-500">{unit}</span>}
        </div>
      )}

      {/* Chart */}
      <div className="px-2 pb-3 pt-2">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${title.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={fillOpacity * 3} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#52525b"
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#52525b"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={45}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
            />
            <Tooltip
              contentStyle={{
                background: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelStyle={{ color: '#a1a1aa' }}
              itemStyle={{ color: '#e4e4e7' }}
            />

            {/* Threshold reference lines */}
            {thresholds?.map((t) => (
              <ReferenceLine
                key={`${t.level}-${t.value}`}
                y={t.value}
                stroke={t.level === 'critical' ? '#ef4444' : '#f59e0b'}
                strokeDasharray="6 3"
                strokeWidth={1}
                label={{
                  value: t.label ?? t.level,
                  position: 'insideTopRight',
                  fill: t.level === 'critical' ? '#ef4444' : '#f59e0b',
                  fontSize: 10,
                }}
              />
            ))}

            {lines ? (
              lines.map((l) => (
                <Line
                  key={l.dataKey}
                  type="monotone"
                  dataKey={l.dataKey}
                  stroke={l.color}
                  strokeWidth={2}
                  dot={false}
                  name={l.name}
                  animationDuration={300}
                />
              ))
            ) : (
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                animationDuration={300}
                fill={`url(#fill-${title.replace(/\s+/g, '-')})`}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
