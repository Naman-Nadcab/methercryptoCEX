/**
 * Centralized notifications.
 * Use instead of alert() for consistent UX (toast).
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

export function notifySuccess(title: string, description?: string): void {
  if (typeof window === 'undefined') return;
  import('@/components/ui/toaster').then(({ toast }) => {
    toast({ title, description, variant: 'success' });
  });
}
