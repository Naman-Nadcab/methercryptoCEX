'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminAuthStore } from '@/store/auth';
import { useRealtime } from '@/hooks/useRealtime';
import { AppShell } from '@/components/shell';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAdminAuthStore((s) => s.accessToken);

  // Unified realtime system — singleton WS, global query invalidation + Zustand events
  useRealtime();

  useEffect(() => {
    if (pathname?.startsWith('/login')) return;
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, pathname, router]);

  if (!accessToken && !pathname?.startsWith('/login')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-admin-bg">
        <div className="text-admin-muted animate-pulse">Loading...</div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
