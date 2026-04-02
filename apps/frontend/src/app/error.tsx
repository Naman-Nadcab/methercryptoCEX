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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 bg-gray-50 px-4 py-16 text-center dark:bg-[#0b0e11]">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Something went wrong</h1>
      <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
        {process.env.NODE_ENV === 'development' ? error.message : 'Please try again or return home.'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try again
        </button>
        <Link href={ROUTES.home} className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Home
        </Link>
      </div>
    </div>
  );
}
