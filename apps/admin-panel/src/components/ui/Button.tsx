import * as React from 'react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary disabled:pointer-events-none disabled:opacity-50',
          variant === 'primary' && 'bg-admin-primary text-white hover:bg-admin-primary/90',
          variant === 'secondary' && 'bg-white border border-admin-border text-admin-muted hover:bg-gray-50',
          variant === 'danger' && 'bg-admin-danger text-white hover:bg-admin-danger/90',
          variant === 'ghost' && 'text-admin-muted hover:bg-gray-100',
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-10 px-4 text-sm',
          size === 'lg' && 'h-11 px-6 text-base',
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
