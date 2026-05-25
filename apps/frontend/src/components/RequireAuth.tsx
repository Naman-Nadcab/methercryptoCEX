'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useAuthStore } from '@/store/auth';

/**
 * Protected layout wrapper: never full-screen infinite spinner.
 * Unauthenticated users are redirected to login; unresolved session shows visible fallback + link.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authResolved, isAuthenticated } = useAuth();
  const user = useAuthStore((s) => s.user);
  const status = user?.status;
  const redirectDone = useRef(false);

  const loginHref = pathname ? `/login?redirect=${encodeURIComponent(pathname)}` : '/login';

  useEffect(() => {
    if (!authResolved || isAuthenticated) return;
    if (redirectDone.current) return;
    redirectDone.current = true;
    router.replace(loginHref);
  }, [authResolved, isAuthenticated, router, loginHref]);

  if (!authResolved) {
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

  if (status && status !== 'active') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 bg-muted p-6 text-center dark:bg-background">
        <p className="text-base font-semibold text-foreground">Account access is restricted</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Your account status is <span className="font-medium">{status}</span>. Trading and wallet actions are disabled.
          Contact support if you believe this is a mistake.
        </p>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/support" className="text-sm font-medium text-primary underline dark:text-blue-400">
            Contact support
          </Link>
          <Link href="/login" className="text-sm font-medium text-primary underline dark:text-blue-400">
            Sign in with another account
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
