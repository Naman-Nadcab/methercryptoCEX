'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WalletWithdrawIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/wallet/withdraw/crypto');
  }, [router]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  );
}
