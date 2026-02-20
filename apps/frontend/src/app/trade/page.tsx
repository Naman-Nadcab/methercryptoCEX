'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect /trade → /dashboard/spot so legacy or bookmarked links work.
 */
export default function TradeRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/spot');
  }, [router]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-gray-500 dark:text-gray-400">Redirecting to Spot…</p>
    </div>
  );
}
