'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProcessingWithdrawalsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/withdrawals?status=processing');
  }, [router]);
  return null;
}
