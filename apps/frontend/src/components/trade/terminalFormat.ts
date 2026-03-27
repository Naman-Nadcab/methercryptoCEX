export function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function formatFixedTrim(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '—';
  const d = clampInt(decimals, 0, 12);
  const s = n.toFixed(d);
  return s.replace(/\.?0+$/, '');
}

export function formatValueFixedTrim(
  value: string | number | null | undefined,
  decimals: number
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  return formatFixedTrim(n, decimals);
}

export function formatCompactNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return String(n);
  }
}

