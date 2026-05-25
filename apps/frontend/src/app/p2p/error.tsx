'use client';

import { ErrorState } from '@/components/ui/ErrorState';

export default function P2PError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 md:p-6">
      <ErrorState
        title="P2P section failed to load"
        message={error.message || 'Retry to continue your P2P flow.'}
        onRetry={reset}
      />
    </div>
  );
}
