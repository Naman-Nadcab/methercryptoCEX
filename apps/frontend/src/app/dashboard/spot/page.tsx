'use client';

import { Suspense } from 'react';
import { SpotTradingGrid } from '@/components/trade/SpotTradingGrid';

export default function SpotPage() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-gray-50 text-gray-600 dark:bg-[#0b0e11] dark:text-gray-400">Loading…</div>}>
      <SpotTradingGrid />
    </Suspense>
  );
}
