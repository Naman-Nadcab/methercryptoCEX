'use client';

import { ErrorState } from '@/components/ui/ErrorState';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 md:p-6">
      <ErrorState
        title="Dashboard section failed to load"
        message={error.message || 'Please retry this section.'}
        onRetry={reset}
      />
    </div>
  );
}
