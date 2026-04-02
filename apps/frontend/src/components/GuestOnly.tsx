'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authResolved, isAuthenticated } = useAuth();
  const redirectDone = useRef(false);

  useEffect(() => {
    if (!authResolved || !isAuthenticated) return;
    if (redirectDone.current) return;
    redirectDone.current = true;
    const redirect = searchParams.get('redirect');
    const allowed =
      redirect &&
      (redirect.startsWith('/dashboard') ||
        redirect.startsWith('/trade') ||
        redirect.startsWith('/markets') ||
        redirect.startsWith('/wallet') ||
        redirect.startsWith('/p2p') ||
        redirect.startsWith('/orders') ||
        redirect.startsWith('/earn'));
    const target = allowed ? redirect! : '/dashboard';
    router.replace(target);
  }, [authResolved, isAuthenticated, router, searchParams]);

  if (!authResolved) {
    if (typeof window !== 'undefined') {
      console.warn('[GuestOnly] Auth unresolved — fail-open (showing guest UI)');
    }
    return <>{children}</>;
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center bg-gray-50 p-6 text-center text-sm text-gray-600 dark:bg-[#0b0e11] dark:text-gray-400">
        Taking you to the app…
      </div>
    );
  }

  return <>{children}</>;
}
