'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function P2PAdsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/p2p/orders?tab=ads');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <p className="text-muted-foreground text-sm">Redirecting to Orders / Ads…</p>
    </div>
  );
}
