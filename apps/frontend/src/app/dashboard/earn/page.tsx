'use client';

import Link from 'next/link';
import { PiggyBank } from 'lucide-react';

export default function EarnPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <PiggyBank className="w-10 h-10 text-yellow-600 dark:text-yellow-400" />
        </div>
        <span className="inline-block px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 rounded-full mb-4">Coming Soon</span>
        <h1 className="text-2xl font-bold text-foreground mb-2">Earn Products</h1>
        <p className="text-muted-foreground mb-8">
          Flexible savings, staking, and on-chain earn products are coming soon.
        </p>
        <Link
          href="/wallet/convert"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/85 text-white font-medium rounded-xl transition-colors"
        >
          Explore Convert
        </Link>
      </div>
    </div>
  );
}
