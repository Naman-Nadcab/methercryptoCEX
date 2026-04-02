'use client';

import Link from 'next/link';
import { TrendingUp, Users, ClipboardList } from 'lucide-react';

export default function OrdersHubPage() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Orders</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        View and manage your trading orders.
      </p>
      <div className="space-y-3">
        <Link
          href="/orders/spot"
          className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900 dark:text-white">Spot Orders</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">View and manage spot orders</p>
          </div>
          <span className="text-gray-400">→</span>
        </Link>
        <Link
          href="/orders/p2p"
          className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900 dark:text-white">P2P Orders</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">View and manage P2P orders</p>
          </div>
          <span className="text-gray-400">→</span>
        </Link>
        <Link
          href="/wallet/convert"
          className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900 dark:text-white">Convert</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Convert between assets</p>
          </div>
          <span className="text-gray-400">→</span>
        </Link>
      </div>
    </div>
  );
}
