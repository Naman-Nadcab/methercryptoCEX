'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminV2Sidebar from '@/components/admin/v2/Sidebar';
import AdminV2Header from '@/components/admin/v2/Header';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Loader2 } from 'lucide-react';
import AdminSessionManager from '@/components/admin/AdminSessionManager';
import ThemeProvider from '@/components/ThemeProvider';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAdminRealtime } from '@/hooks/admin/useAdminRealtime';
import { useThemeStore } from '@/store/theme';

export default function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, accessToken, setLoading } = useAdminAuthStore();
  useAdminRealtime();
  const hasHydrated = useAdminAuthStore((state) => state._hasHydrated);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const setTheme = useThemeStore((s) => s.setTheme);

  useEffect(() => {
    setTheme('dark');
  }, [setTheme]);

  useEffect(() => {
    if (!hasHydrated) return;

    const token = useAdminAuthStore.getState().accessToken;
    if (!token) {
      setChecking(false);
      router.push('/admin/login');
      return;
    }

    // Verify session and refresh admin (role + permissions) from GET /admin/auth/me
    let cancelled = false;
    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/admin/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          useAdminAuthStore.getState().logout();
          router.push('/admin/login');
          return;
        }
        try {
          const result = await response.json();
          if (result?.success && result?.data) {
            const admin = result.data;
            useAdminAuthStore.getState().setAdmin({
              id: admin.id,
              email: admin.email ?? '',
              name: admin.name ?? '',
              role: admin.role ?? '',
              permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
            });
          }
        } catch {
          // Keep existing store admin if parse fails
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
      <div className="admin-panel min-h-screen bg-[var(--admin-bg)]">
        <AdminV2Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="lg:ml-[260px] min-h-screen flex flex-col transition-[margin] duration-200">
          <AdminV2Header onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 p-5 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
