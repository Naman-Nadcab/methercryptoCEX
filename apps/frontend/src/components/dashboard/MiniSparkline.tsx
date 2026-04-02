'use client';

/** Tier 1-style mini sparkline — trend based on 24h change % (null = no official change). */
export function MiniSparkline({ change, className = '' }: { change: number | null; className?: string }) {
  if (change == null) {
    return (
      <span className={`inline-block text-center text-[10px] text-gray-400 dark:text-gray-500 ${className}`} aria-hidden>
        —
      </span>
    );
  }
  const w = 48;
  const h = 24;
  const pts = 6;
  const isUp = change >= 0;
  // Generate points: slight variation to look like real chart
  const points: number[] = [];
  const base = isUp ? 0.3 : 0.7;
  for (let i = 0; i < pts; i++) {
    const t = i / (pts - 1);
    const volatility = 0.15 * Math.sin(i * 1.2) * (1 - t);
    const trend = isUp ? t * 0.4 : -t * 0.4;
    points.push(base + trend + volatility);
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pad = 2;
  const scaleX = (w - pad * 2) / (pts - 1);
  const scaleY = (h - pad * 2) / range;
  const d = points
    .map((v, i) => {
      const x = pad + i * scaleX;
      const y = h - pad - (v - min) * scaleY;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className={className} aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={isUp ? '#10b981' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
