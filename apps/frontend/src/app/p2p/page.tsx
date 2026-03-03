'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { Users } from 'lucide-react';

export default function P2PPublicPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const loggedIn = _hasHydrated && !!accessToken;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11] flex flex-col items-center justify-center p-6">
      <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
        <Users className="w-7 h-7 text-blue-500" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">P2P Trading</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-center max-w-md">
        Buy and sell crypto with other users. Sign in to browse ads and start trading.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        {loggedIn ? (
          <Link
            href="/dashboard/p2p"
            className="px-5 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-center transition-colors"
            aria-label="Go to P2P trading"
          >
            Go to P2P
          </Link>
        ) : (
          <Link
            href="/login?redirect=/dashboard/p2p"
            className="px-5 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-center transition-colors"
            aria-label="Login to trade P2P"
          >
            Login to Trade
          </Link>
        )}
        <Link
          href="/"
          className="px-5 py-2.5 rounded-lg font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-center transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
