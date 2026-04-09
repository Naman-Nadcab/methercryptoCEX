'use client';

import { cn } from '@/lib/cn';

type Props = {
  values: number[];
  className?: string;
  /** Stroke color (tailwind stroke class on SVG). */
  strokeClass?: string;
  height?: number;
  width?: number;
};

/**
 * Lightweight SVG sparkline — no deps. Empty or single point draws a flat line.
 */
export function MmDeskSparkline({
  values,
  className,
  strokeClass = 'stroke-emerald-400/80',
  height = 20,
  width = 56,
}: Props) {
  const pad = 1;
  const w = width;
  const h = height;
  if (!values.length) {
    return (
      <svg width={w} height={h} className={cn('shrink-0', className)} aria-hidden>
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} className="stroke-admin-border/50" strokeWidth="1" />
      </svg>
    );
  }

  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const span = vmax - vmin || 1;
  const n = values.length;
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0;

  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const t = (v - vmin) / span;
    const y = pad + (1 - t) * (h - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      width={w}
      height={h}
      className={cn('shrink-0 overflow-visible', className)}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      <polyline
        fill="none"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClass}
        points={pts.join(' ')}
      />
    </svg>
  );
}
