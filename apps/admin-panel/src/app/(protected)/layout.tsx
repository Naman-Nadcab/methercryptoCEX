'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminAuthStore } from '@/store/auth';
import { useRealtime } from '@/hooks/useRealtime';
import { AppShell } from '@/components/shell';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

/**
 * Protected shell wrapper for every admin page under `(protected)/*`.
 *
 * Perf notes:
 *  - Waits for Zustand persist to finish rehydrating BEFORE deciding to redirect.
 *    Previously, `accessToken` was momentarily `null` during the first render tick
 *    (before rehydration) which caused a "Loading..." flash and an accidental
 *    `/login` redirect on every reload.
 *  - Renders an SSR-compatible skeleton (same component used by `loading.tsx`)
 *    instead of a bare `"Loading..."` string — user perceives structure
 *    immediately on cold navigations.
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAdminAuthStore((s) => s.accessToken);
  const hasHydrated = useAdminAuthStore((s) => s._hasHydrated);

  /**
   * Track whether we've mounted in the browser. Avoids hydration mismatch:
   * on the server, `hasHydrated` is always `false` (no localStorage) — we don't
   * want the server-rendered tree to diverge from what the client renders
   * on mount before rehydration fires.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useRealtime();

  useEffect(() => {
    if (!hasHydrated) return; // wait for persist to finish
    if (pathname?.startsWith('/login')) return;
    if (!accessToken) router.replace('/login');
  }, [accessToken, hasHydrated, pathname, router]);

  /** Pre-hydration or pre-mount → render skeleton, NOT a bare "Loading..." text. */
  if (!mounted || !hasHydrated) {
    return <PageSkeleton />;
  }

  if (!accessToken && !pathname?.startsWith('/login')) {
    /** Redirect effect above will fire — show skeleton, not a blank page. */
    return <PageSkeleton />;
  }

  return <AppShell>{children}</AppShell>;
}
