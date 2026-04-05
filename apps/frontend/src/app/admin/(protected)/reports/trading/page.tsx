'use client';

import { BarChart3 } from 'lucide-react';

export default function TradingReportsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="p-4 rounded-full bg-primary/10 mb-4">
        <BarChart3 className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Trading Reports</h2>
      <p className="text-muted-foreground max-w-md">
        Detailed trading analytics including volume breakdowns, pair performance, spread analysis, and maker/taker ratio reports.
      </p>
    </div>
  );
}
