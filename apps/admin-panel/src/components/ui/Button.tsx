import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:   'bg-admin-primary text-white hover:bg-admin-primary-hover shadow-sm',
  secondary: 'bg-admin-card border border-admin-border text-admin-text hover:bg-admin-card-hover shadow-sm',
  danger:    'bg-admin-danger text-white hover:bg-admin-danger/80 shadow-sm',
  success:   'bg-admin-success text-white hover:bg-admin-success/80 shadow-sm',
  ghost:     'text-admin-muted hover:bg-white/5 hover:text-admin-text',
  outline:   'border border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text',
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1',
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, iconRight, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center rounded-ds-md font-medium transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary focus-visible:ring-offset-1 focus-visible:ring-offset-admin-bg',
          'disabled:pointer-events-none disabled:opacity-40',
          'active:scale-[0.98]',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
        {iconRight && !loading && <span className="shrink-0">{iconRight}</span>}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button };
