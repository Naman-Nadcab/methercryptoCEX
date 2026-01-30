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
    // Don't check auth until store is hydrated
    if (!hasHydrated) return;

    // Check if admin is authenticated
    const checkAuth = async () => {
      // Get the latest token from store after hydration
      const store = useAdminAuthStore.getState();
      const token = store.accessToken;
      
      if (!token) {
        router.push('/admin/login');
        return;
      }

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        const response = await fetch(`${apiUrl}/api/v1/admin/auth/me`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          // Token invalid, clear store and redirect
          useAdminAuthStore.getState().logout();
          router.push('/admin/login');
          return;
        }

        setChecking(false);
      } catch (error) {
        router.push('/admin/login');
      }
    };

    checkAuth();
  }, [hasHydrated, router]);

  if (!hasHydrated || checking) {
    return (
      <ThemeProvider>
        <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto" />
            <p className="mt-4 text-gray-600 dark:text-gray-500 dark:text-gray-400">Loading...</p>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {/* Admin Session Manager for auto-logout */}
      <AdminSessionManager idleTimeout={30 * 60 * 1000} />
      
      <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
        <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
        <div className="lg:ml-60 min-h-screen flex flex-col">
          {/* Fixed Header */}
          <div className="sticky top-0 z-40">
            <Header onMenuClick={() => setSidebarOpen(true)} />
          </div>
          <main className="flex-1 p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
