'use client';

import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
import { OrderbookPanel } from './OrderbookPanel';
import { OrderEntryPanel } from './OrderEntryPanel';
import { BottomPanel } from './BottomPanel';

export function TradingGrid() {
  return (
    <div className="h-screen w-full flex flex-col bg-[#0b0e11] text-white">
      <PairHeader />
      <div className="flex-1 min-h-0 grid grid-cols-[58fr_21fr_21fr] gap-[1px] bg-white/5">
        <ChartPanel />
        <OrderbookPanel />
        <OrderEntryPanel />
      </div>
      <BottomPanel />
    </div>
  );
}
