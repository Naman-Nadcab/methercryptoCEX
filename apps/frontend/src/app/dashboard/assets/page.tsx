'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AssetsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/assets/overview');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}
