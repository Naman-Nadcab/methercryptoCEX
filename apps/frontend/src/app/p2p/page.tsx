'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function P2PRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/p2p/buy/USDT/INR');
  }, [router]);
  return (
    <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center">
      <p className="text-gray-500">Redirecting to P2P...</p>
    </div>
  );
}
