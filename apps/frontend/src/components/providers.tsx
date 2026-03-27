'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import ThemeProvider from '@/components/ThemeProvider';
import { rehydrateAuthStore } from '@/store/auth';
import { notifyError } from '@/lib/notifyError';

/** Max wait for rehydration; resolve immediately when done. No artificial 5s delay. */
const REHYDRATE_MAX_MS = 2000;

export function Providers({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHydrated(true), REHYDRATE_MAX_MS);
    rehydrateAuthStore()
      .then(() => setHydrated(true))
      .catch(() => setHydrated(true))
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            onError: (error) => {
              const msg = error instanceof Error ? error.message : 'Action failed';
              notifyError(msg);
            },
          },
        },
      })
  );

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0b0e11]" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
