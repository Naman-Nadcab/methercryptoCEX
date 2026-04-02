'use client';

import Link from 'next/link';
import { LineChart } from 'lucide-react';

export default function DemoTradingPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <LineChart className="w-10 h-10 text-primary" />
        </div>
        <span className="inline-block px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded-full mb-4">Coming Soon</span>
        <h1 className="text-2xl font-bold text-foreground mb-2">Demo Trading</h1>
        <p className="text-muted-foreground mb-8">
          Practice with virtual funds. Coming soon.
        </p>
        <Link
          href="/trade/spot"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-xl transition-colors"
        >
          Go to Spot Trading
        </Link>
      </div>
    </div>
  );
}
