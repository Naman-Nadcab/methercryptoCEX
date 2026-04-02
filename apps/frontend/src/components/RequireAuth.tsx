'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

/**
 * Protected layout wrapper: never full-screen infinite spinner.
 * Unauthenticated users are redirected to login; unresolved session shows visible fallback + link.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authResolved, isAuthenticated } = useAuth();
  const redirectDone = useRef(false);

  const loginHref = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : '/login';

  useEffect(() => {
    if (!authResolved || isAuthenticated) return;
    if (redirectDone.current) return;
    redirectDone.current = true;
    router.replace(loginHref);
  }, [authResolved, isAuthenticated, router, loginHref]);

  if (!authResolved) {
    if (typeof window !== 'undefined') {
      console.warn('[RequireAuth] Session not resolved — showing fallback (not blocking app)');
    }
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 bg-gray-50 p-6 text-center dark:bg-[#0b0e11]">
        <p className="text-sm text-gray-600 dark:text-gray-400">Checking your session…</p>
        <Link href={loginHref} className="text-sm font-medium text-blue-600 underline dark:text-blue-400">
          Sign in
        </Link>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 bg-gray-50 p-6 text-center text-sm text-gray-600 dark:bg-[#0b0e11] dark:text-gray-400">
        <p>Redirecting to sign in…</p>
        <Link href={loginHref} className="font-medium text-blue-600 underline dark:text-blue-400">
          Continue to login
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
