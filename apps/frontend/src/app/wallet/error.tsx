'use client';

import { ErrorState } from '@/components/ui/ErrorState';

export default function WalletError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 md:p-6">
      <ErrorState
        title="Wallet section failed to load"
        message={error.message || 'Retry to refresh wallet data.'}
        onRetry={reset}
      />
    </div>
  );
}
