import * as React from 'react';
import { cn } from '@/lib/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-gray-100 text-admin-muted',
        variant === 'success' && 'bg-green-100 text-admin-success',
        variant === 'warning' && 'bg-amber-100 text-admin-warning',
        variant === 'danger' && 'bg-red-100 text-admin-danger',
        variant === 'info' && 'bg-blue-100 text-blue-700',
        className
      )}
      {...props}
    />
  );
}

export { Badge };
