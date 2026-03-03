'use client';

import { Suspense } from 'react';
import { SpotTradingGrid } from '@/components/trade/SpotTradingGrid';

export default function SpotPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-[#0b0e11] text-gray-400">Loading…</div>}>
      <SpotTradingGrid />
    </Suspense>
  );
}
