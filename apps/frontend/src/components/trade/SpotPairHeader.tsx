'use client';

import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
import { CoinIcon } from '@/components/ui/CoinIcon';

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
    <header className="h-12 flex-shrink-0 flex items-center gap-4 lg:gap-6 px-3 lg:px-4 bg-card border-b border-border overflow-x-auto">
      <div className="flex items-center gap-2 flex-shrink-0">
        <CoinIcon symbol={symbol.split('_')[0] || symbol} size={24} />
        <span className="text-base font-semibold text-foreground font-mono tabular-nums">{display}</span>
        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-accent rounded">Spot</span>
        <Link href={ROUTES.markets} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Markets</Link>
      </div>
      <div className="flex items-center gap-3 lg:gap-5 text-xs font-mono tabular-nums flex-shrink-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold text-foreground">
            {lastPrice ?? '—'}
          </span>
          {changePercent24h != null && (
            <span className={`text-xs font-medium ${isPositive ? 'text-buy' : isNegative ? 'text-sell' : 'text-muted-foreground'}`}>
              {isPositive ? '+' : ''}{changePercent24h.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-3 lg:gap-5">
          <div><span className="text-muted-foreground mr-1">Vol</span><span className="text-foreground/80">{volume24h != null && volume24h !== '' ? Number(volume24h).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</span></div>
          <div><span className="text-muted-foreground mr-1">H</span><span className="text-foreground/80">{high24h ?? '—'}</span></div>
          <div><span className="text-muted-foreground mr-1">L</span><span className="text-foreground/80">{low24h ?? '—'}</span></div>
        </div>
      </div>
    </header>
  );
}
