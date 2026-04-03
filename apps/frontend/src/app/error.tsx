'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/routes';

/**
 * Segment error boundary — catches render errors below the root layout.
 * Logs to console; offers recovery without a silent blank screen.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[exchange-frontend] app/error.tsx', error?.message, error?.digest ?? '');
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 bg-muted px-4 py-16 text-center dark:bg-background">
      <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {process.env.NODE_ENV === 'development' ? error.message : 'Please try again or return home.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
        <Link href={ROUTES.home} className="text-sm font-medium text-primary hover:underline">
          Home
        </Link>
      </div>
    </div>
  );
}
