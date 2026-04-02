'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect /trade → canonical spot terminal.
 */
export default function TradeRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/trade/spot');
  }, [router]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-muted-foreground">Redirecting to Spot…</p>
    </div>
  );
}
