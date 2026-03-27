'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="admin-card rounded-xl border border-border shadow-sm max-w-md w-full p-6 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-destructive/10 text-destructive mb-5">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h1>
        <p className="text-muted-foreground text-sm mb-5">
          The admin panel encountered an error. This can happen if the backend is unavailable or there is a connection issue.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          <Link
            href="/admin/login"
            className="inline-flex items-center justify-center px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground bg-muted/50 hover:bg-muted transition-colors"
          >
            Go to login
          </Link>
        </div>
        <div className="mt-5 text-left text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 space-y-1">
          <p>1. Ensure backend is running: <code className="bg-muted px-1 rounded">cd apps/backend &amp;&amp; npm run dev</code></p>
          <p>2. API base: <code className="bg-muted px-1 rounded">{getApiBaseUrl()}</code></p>
          <p>3. Click Try again or sign in again from login.</p>
        </div>
      </div>
    </div>
  );
}
