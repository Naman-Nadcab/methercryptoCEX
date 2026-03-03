'use client';

import Link from 'next/link';
import { LineChart } from 'lucide-react';

export default function DemoTradingPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <LineChart className="w-10 h-10 text-blue-600 dark:text-blue-400" />
        </div>
        <span className="inline-block px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded-full mb-4">Coming Soon</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Demo Trading</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          Practice with virtual funds. Coming soon.
        </p>
        <Link
          href="/dashboard/spot"
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
        >
          Go to Spot Trading
        </Link>
      </div>
    </div>
  );
}
