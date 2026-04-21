'use client';

/**
 * Canonical spot terminal. Same implementation as /dashboard/spot.
 *
 * Perf: `SpotTradingGrid` pulls in `lightweight-charts` (~250 KB gz) plus the
 * orderbook/order-form widgets. We load it via `dynamic()` so the terminal's
 * route bundle is tiny — user sees the skeleton immediately, the chart JS
 * streams in the background. `ssr: false` because the chart needs the DOM.
 */
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/Skeleton';

function SpotPageSkeleton() {
  return (
    <div
      className="flex h-full w-full flex-col bg-background"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 dark:border-border">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 max-w-md flex-1" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

const SpotTradingGrid = dynamic(
  () => import('@/components/trade/SpotTradingGrid').then((m) => m.SpotTradingGrid),
  { ssr: false, loading: () => <SpotPageSkeleton /> }
);

export default function TradeSpotPage() {
  return <SpotTradingGrid />;
}
