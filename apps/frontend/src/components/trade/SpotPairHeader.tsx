'use client';

import Link from 'next/link';
import { ROUTES } from '@/lib/routes';

interface SpotPairHeaderProps {
  symbol: string;
  displaySymbol?: string;
  lastPrice: string | null;
  changePercent24h: number | null;
  high24h: string | null;
  low24h: string | null;
  volume24h?: string | null;
}

export function SpotPairHeader({
  symbol,
  displaySymbol,
  lastPrice,
  changePercent24h,
  high24h,
  low24h,
  volume24h,
}: SpotPairHeaderProps) {
  const display = displaySymbol ?? symbol.replace('_', '/');
  const isPositive = changePercent24h != null && changePercent24h >= 0;
  const isNegative = changePercent24h != null && changePercent24h < 0;

  return (
    <header className="h-14 flex-shrink-0 flex items-center gap-6 px-4 bg-[#0b0e11] dark:bg-background border-b border-white/5">
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold text-white font-mono tabular-nums">{display}</span>
        <span className="text-xs text-muted-foreground">Spot</span>
        <Link href={ROUTES.markets} className="text-xs text-muted-foreground hover:text-white">Markets</Link>
      </div>
      <div className="flex items-center gap-4 text-sm font-mono tabular-nums">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold text-white">
            {lastPrice ?? '—'}
          </span>
          {changePercent24h != null && (
            <span
              className={`text-xs font-medium ${
                isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-muted-foreground'
              }`}
            >
              {isPositive ? '+' : ''}
              {changePercent24h.toFixed(2)}%
            </span>
          )}
        </div>
        <span className="text-muted-foreground">24h Vol</span>
        <span className="text-muted-foreground">{volume24h != null && volume24h !== '' ? Number(volume24h).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span>
        <span className="text-muted-foreground">24h High</span>
        <span className="text-muted-foreground">{high24h ?? '—'}</span>
        <span className="text-muted-foreground">24h Low</span>
        <span className="text-muted-foreground">{low24h ?? '—'}</span>
      </div>
    </header>
  );
}
