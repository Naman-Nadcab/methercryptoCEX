'use client';

/**
 * Canonical spot terminal. Same implementation as /dashboard/spot.
 */
import { Suspense } from 'react';
import { SpotTradingGrid } from '@/components/trade/SpotTradingGrid';
import { Skeleton } from '@/components/ui/Skeleton';

function SpotPageSkeleton() {
  return (
    <div
      className="flex h-screen w-full flex-col bg-background"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-800">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 max-w-md flex-1" />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export default function TradeSpotPage() {
  return (
    <Suspense fallback={<SpotPageSkeleton />}>
      <SpotTradingGrid />
    </Suspense>
  );
}
