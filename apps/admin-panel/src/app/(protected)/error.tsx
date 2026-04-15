'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { AlertTriangle } from 'lucide-react';

/**
 * Catches runtime errors under the protected shell so operators see a recovery path
 * instead of a bare Next 500 page.
 */
export default function ProtectedSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin-panel]', error);
  }, [error]);

  const msg = error?.message ?? 'Unknown error';
  const staleChunk =
    msg.includes('Cannot find module') && (msg.includes('.js') || msg.includes('.next'));

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
      <div className="flex items-start gap-3 rounded-lg border border-admin-danger/30 bg-admin-danger/10 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-admin-danger" />
        <div>
          <h1 className="text-sm font-semibold text-admin-text">This page failed to load</h1>
          <p className="mt-1 text-xs text-admin-muted break-words">{msg}</p>
          {error.digest ? (
            <p className="mt-2 text-[10px] font-mono text-admin-muted">Digest: {error.digest}</p>
          ) : null}
        </div>
      </div>
      {staleChunk ? (
        <p className="text-xs text-admin-muted">
          यह अक्सर पुराना <code className="rounded bg-white/10 px-1">.next</code> build होने पर आता है। Dev server बंद करके{' '}
          <code className="rounded bg-white/10 px-1">cd apps/admin-panel && rm -rf .next && npm run dev</code> चलाएँ।
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" size="sm" onClick={() => reset()}>
          Try again
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => (window.location.href = '/dashboard')}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
