'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminV2Sidebar from '@/components/admin/v2/Sidebar';
import AdminV2Header from '@/components/admin/v2/Header';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Loader2, X } from 'lucide-react';
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
  const [hideCanonicalBanner, setHideCanonicalBanner] = useState(false);
  const setTheme = useThemeStore((s) => s.setTheme);

  const primaryAdminBase =
    (typeof process.env.NEXT_PUBLIC_ADMIN_PANEL_URL === 'string' && process.env.NEXT_PUBLIC_ADMIN_PANEL_URL.trim()) ||
    'http://localhost:3001';
  const primaryAdminUrl = `${primaryAdminBase.replace(/\/$/, '')}/dashboard`;

  useEffect(() => {
    setTheme('dark');
  }, [setTheme]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('admin_hide_canonical_console_banner') === '1') {
        setHideCanonicalBanner(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

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
          {!hideCanonicalBanner ? (
            <div
              role="status"
              className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100 lg:mx-6"
            >
              <p className="min-w-0 flex-1 leading-snug">
                <span className="font-medium text-amber-50">Primary operator console</span>
                {' — '}
                day-to-day admin and MM desk live in the{' '}
                <Link
                  href={primaryAdminUrl}
                  className="font-medium underline decoration-amber-400/80 underline-offset-2 hover:text-white"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Admin Panel app
                </Link>
                {' '}
                (dev: <span className="font-mono text-xs opacity-90">npm run dev:admin</span> → port 3001). This
                shell is legacy / extended pages only.
              </p>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem('admin_hide_canonical_console_banner', '1');
                  } catch {
                    /* ignore */
                  }
                  setHideCanonicalBanner(true);
                }}
                className="shrink-0 rounded p-1 text-amber-200/80 hover:bg-amber-500/20 hover:text-amber-50"
                aria-label="Dismiss banner"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          <main className="flex-1 p-5 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
