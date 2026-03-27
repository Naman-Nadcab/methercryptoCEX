'use client';

import { cn } from '@/lib/utils';

export interface LiquidityHeatmapRow {
  pair: string;
  bid: number;
  ask: number;
  spread: number;
}

function getColor(pct: number) {
  if (pct >= 80) return 'from-[var(--admin-success)]/30 to-[var(--admin-success)]/10';
  if (pct >= 60) return 'from-[var(--admin-primary)]/30 to-[var(--admin-primary)]/10';
  if (pct >= 40) return 'from-[var(--admin-warning)]/30 to-[var(--admin-warning)]/10';
  return 'from-[var(--admin-text-muted)]/20 to-[var(--admin-text-muted)]/5';
}

const DEFAULT_PAIRS: LiquidityHeatmapRow[] = [
  { pair: 'BTC/USDT', bid: 85, ask: 82, spread: 0.02 },
  { pair: 'ETH/USDT', bid: 78, ask: 76, spread: 0.03 },
  { pair: 'SOL/USDT', bid: 62, ask: 60, spread: 0.05 },
  { pair: 'BNB/USDT', bid: 71, ask: 69, spread: 0.04 },
  { pair: 'XRP/USDT', bid: 58, ask: 55, spread: 0.06 },
];

export interface LiquidityHeatmapProps {
  data?: LiquidityHeatmapRow[];
  className?: string;
}

export function LiquidityHeatmap({ data = DEFAULT_PAIRS, className }: LiquidityHeatmapProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {data.map((row) => (
        <div key={row.pair} className="flex items-center gap-3">
          <span className="text-xs text-[var(--admin-text-muted)] w-20 shrink-0 font-medium">{row.pair}</span>
          <div className="flex-1 flex gap-1">
            <div
              className={cn(
                'h-6 rounded-l bg-gradient-to-r border border-[var(--admin-card-border)] flex items-center justify-center text-xs font-medium text-[var(--admin-text)] min-w-[48px]',
                getColor(row.bid)
              )}
              title="Bid depth"
            >
              {Math.round(row.bid)}%
            </div>
            <div
              className={cn(
                'h-6 rounded-r bg-gradient-to-r border border-[var(--admin-card-border)] flex items-center justify-center text-xs font-medium text-[var(--admin-text)] min-w-[48px]',
                getColor(row.ask)
              )}
              title="Ask depth"
            >
              {Math.round(row.ask)}%
            </div>
          </div>
          <span className="text-xs text-[var(--admin-text-muted)] w-14 text-right tabular-nums">
            {row.spread < 1 ? row.spread.toFixed(2) : row.spread.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
