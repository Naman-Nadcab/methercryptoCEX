'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminAuthStore } from '@/store/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { useAdminWs } from '@/hooks/useAdminWs';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAdminAuthStore((s) => s.accessToken);

  useAdminWs();

  useEffect(() => {
    if (pathname?.startsWith('/login')) return;
    if (!accessToken) {
      router.replace('/login');
    }
  }, [accessToken, pathname, router]);

  if (!accessToken && !pathname?.startsWith('/login')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-admin-bg">
        <div className="text-admin-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar />
      <div className="pl-64">
        <Topbar />
        <main className="min-h-[calc(100vh-4rem)] p-6">{children}</main>
      </div>
    </div>
  );
}
