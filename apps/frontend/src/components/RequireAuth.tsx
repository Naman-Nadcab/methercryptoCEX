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
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 bg-muted p-6 text-center dark:bg-background">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
        <Link href={loginHref} className="text-sm font-medium text-primary underline dark:text-blue-400">
          Sign in
        </Link>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 bg-muted p-6 text-center text-sm text-muted-foreground dark:bg-background dark:text-muted-foreground">
        <p>Redirecting to sign in…</p>
        <Link href={loginHref} className="font-medium text-primary underline dark:text-blue-400">
          Continue to login
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
