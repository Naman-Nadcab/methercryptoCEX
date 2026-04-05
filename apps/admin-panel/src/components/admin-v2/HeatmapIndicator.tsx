'use client';

import { memo } from 'react';

interface HeatmapIndicatorProps {
  trades: number;
  withdrawals: number;
  alerts: number;
}

function intensityLevel(value: number, low: number, high: number): 0 | 1 | 2 | 3 {
  if (value <= 0) return 0;
  if (value < low) return 1;
  if (value < high) return 2;
  return 3;
}

const CELL_COLORS = [
  'bg-zinc-800',
  'bg-emerald-500/40',
  'bg-amber-500/50',
  'bg-red-500/60',
] as const;

const CELL_LABELS = ['Idle', 'Low', 'Moderate', 'High'] as const;

function HeatmapInner({ trades, withdrawals, alerts }: HeatmapIndicatorProps) {
  const cells = [
    { label: 'Trades', level: intensityLevel(trades, 10, 100) },
    { label: 'Withdrawals', level: intensityLevel(withdrawals, 5, 50) },
    { label: 'Alerts', level: intensityLevel(alerts, 1, 5) },
  ];

  return (
    <div className="flex items-center gap-2">
      {cells.map((cell) => (
        <div key={cell.label} className="flex items-center gap-1.5" title={`${cell.label}: ${CELL_LABELS[cell.level]}`}>
          <div className={`w-3 h-3 rounded-sm transition-colors duration-500 ${CELL_COLORS[cell.level]}`} />
          <span className="text-[10px] text-zinc-600">{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

export const HeatmapIndicator = memo(HeatmapInner);
