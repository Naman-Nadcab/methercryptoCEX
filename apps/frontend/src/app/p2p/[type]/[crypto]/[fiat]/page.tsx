'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function P2PLegacyRedirect() {
  const router = useRouter();
  const params = useParams();
  const type = (params?.type as string) || 'buy';
  const crypto = (params?.crypto as string) || 'USDT';
  const fiat = (params?.fiat as string) || 'INR';
  useEffect(() => {
    router.replace(`/dashboard/p2p/${type}/${crypto}/${fiat}`);
  }, [router, type, crypto, fiat]);
  return (
    <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center">
      <p className="text-gray-500">Redirecting to P2P...</p>
    </div>
  );
}
