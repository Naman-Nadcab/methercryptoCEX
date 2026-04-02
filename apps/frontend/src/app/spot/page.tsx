'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { ROUTES, SPOT_TRADE_HREF, loginWithRedirect } from '@/lib/routes';

export default function SpotPublicPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const loggedIn = _hasHydrated && !!accessToken;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11] flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Spot</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-center max-w-md">
        Public read-only view. Sign in to place orders and manage balances.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        {loggedIn ? (
          <Link
            href={SPOT_TRADE_HREF}
            className="px-5 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-center transition-colors"
          >
            Go to Trading
          </Link>
        ) : (
          <Link
            href={loginWithRedirect(SPOT_TRADE_HREF)}
            className="px-5 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-center transition-colors"
          >
            Login to Trade
          </Link>
        )}
        <Link
          href={ROUTES.home}
          className="px-5 py-2.5 rounded-lg font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-center transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
