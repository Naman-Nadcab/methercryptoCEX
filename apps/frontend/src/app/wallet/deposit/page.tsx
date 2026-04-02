'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WalletDepositIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/wallet/deposit/crypto');
  }, [router]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-gray-50 dark:bg-[#0b0e11]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  );
}
