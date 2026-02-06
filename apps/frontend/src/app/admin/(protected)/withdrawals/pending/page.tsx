'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PendingWithdrawalsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/withdrawals?status=pending');
  }, [router]);
  return null;
}
