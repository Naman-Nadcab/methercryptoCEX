'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CompletedWithdrawalsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/withdrawals?status=completed');
  }, [router]);
  return null;
}
