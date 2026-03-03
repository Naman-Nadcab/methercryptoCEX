'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authResolved, isAuthenticated } = useAuth();
  const redirectDone = useRef(false);

  useEffect(() => {
    if (!authResolved || isAuthenticated) return;
    if (redirectDone.current) return;
    redirectDone.current = true;
    const redirect = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : '/login';
    router.replace(redirect);
  }, [authResolved, isAuthenticated, router, pathname]);

  if (!authResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b0e11]" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b0e11]" role="status" aria-label="Redirecting">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
