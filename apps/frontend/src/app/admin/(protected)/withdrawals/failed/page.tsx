'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function FailedWithdrawalsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/withdrawals?status=failed');
  }, [router]);
  return null;
}
