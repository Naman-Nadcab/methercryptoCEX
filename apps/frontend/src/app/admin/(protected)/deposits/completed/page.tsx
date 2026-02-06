'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function CompletedDepositsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/deposits?status=completed');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[320px]">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      <span className="ml-3 text-gray-500 dark:text-gray-400">Loading completed deposits...</span>
    </div>
  );
}
