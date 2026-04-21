'use client';

import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /** 5 min fresh + 30 min cache: covers typical cross-page navigation without re-fetching. */
            staleTime: 5 * 60_000,
            gcTime: 30 * 60_000,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 1,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
            /** Keep last-known data while re-fetching → no spinner flash on page switches. */
            placeholderData: keepPreviousData,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
