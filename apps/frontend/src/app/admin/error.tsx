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
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/20 mb-6">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">Something went wrong</h1>
        <p className="text-gray-400 text-sm mb-6">
          The admin panel hit an error. This can happen if the backend is not running or there is a connection issue.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          <Link
            href="/admin/login"
            className="inline-flex items-center justify-center px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Go to login
          </Link>
        </div>
        <div className="mt-6 text-left text-xs text-gray-500 bg-gray-900/50 rounded-lg p-3 space-y-1">
          <p>1. Start the backend: <code className="bg-gray-800 px-1 rounded">cd apps/backend &amp;&amp; npm run dev</code></p>
          <p>2. It should listen at <code className="bg-gray-800 px-1 rounded">{getApiBaseUrl()}</code></p>
          <p>3. Click Try again or go to login and sign in again.</p>
        </div>
      </div>
    </div>
  );
}
