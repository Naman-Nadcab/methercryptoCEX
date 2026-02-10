'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { authResolved, isAuthenticated } = useAuth();
  const redirectDone = useRef(false);

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return;
    if (redirectDone.current) return;
    redirectDone.current = true;
    router.replace('/dashboard');
  }, [authResolved, isAuthenticated, router]);

  if (!authResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b0e11]" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
