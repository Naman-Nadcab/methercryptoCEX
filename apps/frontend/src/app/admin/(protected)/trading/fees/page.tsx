'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Spot Trading → Fees & Limits: redirect to Fee Management → Spot Fees
 * so there is a single source of truth for trading fee configuration.
 */
export default function TradingFeesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/fees/trading');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <p className="text-gray-500 dark:text-gray-400">Redirecting to Spot Fees…</p>
    </div>
  );
}
