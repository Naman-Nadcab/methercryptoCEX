'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardP2PPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/p2p');
  }, [router]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-gray-500 dark:text-gray-400">Redirecting to P2P...</p>
    </div>
  );
}
