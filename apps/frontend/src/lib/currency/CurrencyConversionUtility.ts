'use client';

export type DisplayCurrency = 'USDT' | 'INR';

export const DEFAULT_USDT_INR_RATE = 83;

export function normalizeDisplayCurrency(value: unknown): DisplayCurrency {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return v === 'INR' ? 'INR' : 'USDT';
}

export function convertUsdtToDisplay(amountUsdt: number, displayCurrency: DisplayCurrency, usdtInrRate: number): number {
  if (!Number.isFinite(amountUsdt)) return 0;
  if (displayCurrency === 'INR') return amountUsdt * usdtInrRate;
  return amountUsdt;
}

export function formatDisplayCurrency(value: number, displayCurrency: DisplayCurrency, maxUsdtDecimals = 8): string {
  if (!Number.isFinite(value)) return '—';
  if (displayCurrency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return `${trimFixed(value, maxUsdtDecimals)} USDT`;
}

export function formatSecondaryDisplayFromUsdt(
  amountUsdt: number,
  displayCurrency: DisplayCurrency,
  usdtInrRate: number,
  maxUsdtDecimals = 8
): string | null {
  if (!Number.isFinite(amountUsdt)) return null;
  if (displayCurrency === 'USDT') return null;
  const converted = convertUsdtToDisplay(amountUsdt, displayCurrency, usdtInrRate);
  return `≈ ${formatDisplayCurrency(converted, displayCurrency, maxUsdtDecimals)}`;
}

function trimFixed(value: number, maxDecimals: number): string {
  const safe = Math.max(0, Math.min(8, Math.floor(maxDecimals)));
  const raw = value.toFixed(safe);
  return raw.replace(/\.?0+$/, '');
}
