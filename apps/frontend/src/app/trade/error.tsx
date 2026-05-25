'use client';

import { ErrorState } from '@/components/ui/ErrorState';

export default function TradeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 md:p-6">
      <ErrorState
        title="Trading view failed to load"
        message={error.message || 'Retry to restore market panels.'}
        onRetry={reset}
      />
    </div>
  );
}
