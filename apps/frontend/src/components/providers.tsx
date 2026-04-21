'use client';

import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import ThemeProvider from '@/components/ThemeProvider';
import { rehydrateAuthStore, useAuthStore } from '@/store/auth';
import { notifyError } from '@/lib/notifyError';
import { TooltipProvider } from '@/components/ui/Tooltip';

/** Zustand unblock fallback if persist is slow (AuthProvider /me still needs `_hasHydrated`). */
const REHYDRATE_MAX_MS = 1200;

function unblockAuthHydration() {
  useAuthStore.getState().setHasHydrated(true);
  useAuthStore.getState().setLoading(false);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const warnedHydration = useRef(false);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /** 5 min fresh + 30 min cache keeps navigations instant without stale data risk. */
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            retry: 1,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            /** Show last-known data while re-fetching → eliminates mid-page spinners. */
            placeholderData: keepPreviousData,
          },
          mutations: {
            retry: 0,
            onError: (error) => {
              const msg = error instanceof Error ? error.message : 'Action failed';
              notifyError(msg);
            },
          },
        },
      })
  );

  useEffect(() => {
    console.log('[Providers] mounted — full provider tree active (fail-open)');
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!warnedHydration.current && typeof window !== 'undefined') {
        warnedHydration.current = true;
        console.warn('[Providers] Zustand persist slow — unblocking hydration (fail-open)');
      }
      unblockAuthHydration();
    }, REHYDRATE_MAX_MS);

    rehydrateAuthStore()
      .then(() => {
        unblockAuthHydration();
      })
      .catch(() => {
        unblockAuthHydration();
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return () => clearTimeout(timer);
  }, []);

  /** Never block the tree: QueryClient + theme + auth must wrap children from first paint. */
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <AuthProvider>{children}</AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
