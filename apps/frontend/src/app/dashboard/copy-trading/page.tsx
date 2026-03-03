'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';

export default function CopyTradingPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
          <Users className="w-10 h-10 text-purple-600 dark:text-purple-400" />
        </div>
        <span className="inline-block px-3 py-1 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-full mb-4">Coming Soon</span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Copy Trading</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          Copy top traders and automate your strategies. Coming soon.
        </p>
        <Link
          href="/dashboard/spot"
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
        >
          Trade on Spot
        </Link>
      </div>
    </div>
  );
}
