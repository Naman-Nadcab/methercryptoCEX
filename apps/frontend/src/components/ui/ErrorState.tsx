'use client';

import { AlertCircle } from 'lucide-react';

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/60 px-4 py-10 text-center dark:border-red-900/40 dark:bg-red-950/20"
      role="alert"
    >
      <AlertCircle className="mb-3 h-10 w-10 text-red-500" aria-hidden />
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {message ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 min-h-[44px] min-w-[120px]"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
