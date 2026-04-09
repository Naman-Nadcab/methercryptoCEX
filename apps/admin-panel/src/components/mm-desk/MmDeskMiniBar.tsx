'use client';

import { cn } from '@/lib/cn';

/** 0–100 fill; optional center line at 50 for skew. */
export function MmDeskMiniBar({
  valuePct,
  centerNeutral,
  className,
  barClassName,
}: {
  valuePct: number;
  centerNeutral?: boolean;
  className?: string;
  barClassName?: string;
}) {
  const v = Math.max(0, Math.min(100, valuePct));
  return (
    <div className={cn('w-full', className)}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-admin-border/60">
        <div
          className={cn('h-full rounded-full bg-emerald-500/80 transition-all', barClassName)}
          style={{ width: `${v}%` }}
        />
        {centerNeutral ? (
          <div
            className="absolute top-0 h-full w-px bg-white/40"
            style={{ left: '50%', transform: 'translateX(-50%)' }}
            title="Neutral"
          />
        ) : null}
      </div>
    </div>
  );
}

/** Skew marker: 0 = full short bias, 50 neutral, 100 full long bias. */
export function MmDeskSkewBar({ skewPct }: { skewPct: number }) {
  const p = Math.max(0, Math.min(100, skewPct));
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-rose-500/25 via-admin-border/40 to-emerald-500/25">
      <div
        className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow"
        style={{ left: `${p}%` }}
      />
    </div>
  );
}
