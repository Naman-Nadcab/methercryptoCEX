'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function P2POrderLegacyRedirect() {
  const router = useRouter();
  const params = useParams();
  const orderId = typeof params?.orderId === 'string' ? params.orderId : '';
  useEffect(() => {
    if (orderId) router.replace(`/dashboard/p2p/orders/${orderId}`);
  }, [router, orderId]);
  return (
    <div className="min-h-screen bg-[#0b0e11] flex items-center justify-center">
      <p className="text-gray-500">Redirecting to order...</p>
    </div>
  );
}
