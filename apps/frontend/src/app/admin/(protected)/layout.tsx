'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/admin/layout/Sidebar';
import Header from '@/components/admin/layout/Header';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Loader2 } from 'lucide-react';
import AdminSessionManager from '@/components/admin/AdminSessionManager';
import ThemeProvider from '@/components/ThemeProvider';

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, accessToken, setLoading } = useAdminAuthStore();
  const hasHydrated = useAdminAuthStore((state) => state._hasHydrated);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!hasHydrated) return;

    const token = useAdminAuthStore.getState().accessToken;
    if (!token) {
      setChecking(false);
      router.push('/admin/login');
      return;
    }

    // Verify session in background — don't block first paint
    let cancelled = false;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    fetch(`${apiUrl}/api/v1/admin/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          useAdminAuthStore.getState().logout();
          router.push('/admin/login');
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) {
          useAdminAuthStore.getState().logout();
          router.push('/admin/login');
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => { cancelled = true; };
  }, [hasHydrated, router]);

  // Only block on hydration; show shell as soon as we have a token (auth/me runs in background)
  if (!hasHydrated) {
    return (
      <ThemeProvider>
        <div className="admin-panel min-h-screen bg-background flex items-center justify-center animate-admin-fade-in">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
            <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  if (!useAdminAuthStore.getState().accessToken) {
    return null;
  }

  return (
    <ThemeProvider>
      <AdminSessionManager idleTimeout={30 * 60 * 1000} />
      <div className="admin-panel min-h-screen bg-background transition-colors duration-200">
        <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="lg:ml-[220px] min-h-screen flex flex-col transition-[margin] duration-200">
          <div className="sticky top-0 z-40 animate-admin-slide-up">
            <Header onMenuClick={() => setSidebarOpen(true)} />
          </div>
          <main className="flex-1 p-3 lg:p-4 animate-admin-fade-in">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
