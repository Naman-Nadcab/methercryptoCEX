/**
 * Centralized error notification.
 * Ensures no user action fails silently - always shows visible feedback.
 */

export function notifyError(
  message: string,
  opts?: { title?: string; variant?: 'destructive' | 'warning' | 'default' }
): void {
  if (typeof window === 'undefined') return;
  import('@/components/ui/toaster').then(({ toast }) => {
    toast({
      title: opts?.title ?? 'Error',
      description: message,
      variant: opts?.variant ?? 'destructive',
    });
  });
}
