import * as React from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
export type BadgeStyle = 'filled' | 'outline' | 'dot';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  badgeStyle?: BadgeStyle;
  size?: BadgeSize;
}

const VARIANT_FILLED: Record<BadgeVariant, string> = {
  default: 'bg-white/5 text-admin-muted',
  success: 'bg-admin-success/15 text-admin-success',
  warning: 'bg-admin-warning/15 text-admin-warning',
  danger:  'bg-admin-danger/15 text-admin-danger',
  info:    'bg-admin-info/15 text-admin-info',
  primary: 'bg-admin-primary/15 text-admin-primary',
};

const VARIANT_OUTLINE: Record<BadgeVariant, string> = {
  default: 'border-admin-border text-admin-muted',
  success: 'border-admin-success/30 text-admin-success',
  warning: 'border-admin-warning/30 text-admin-warning',
  danger:  'border-admin-danger/30 text-admin-danger',
  info:    'border-admin-info/30 text-admin-info',
  primary: 'border-admin-primary/30 text-admin-primary',
};

const DOT_COLORS: Record<BadgeVariant, string> = {
  default: 'bg-admin-muted',
  success: 'bg-admin-success',
  warning: 'bg-admin-warning',
  danger:  'bg-admin-danger',
  info:    'bg-admin-info',
  primary: 'bg-admin-primary',
};

function Badge({
  className,
  variant = 'default',
  badgeStyle = 'filled',
  size = 'sm',
  children,
  ...props
}: BadgeProps) {
  const sizeClass = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-0.5';

  if (badgeStyle === 'dot') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 font-medium', sizeClass, className)} {...props}>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', DOT_COLORS[variant])} />
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        sizeClass,
        badgeStyle === 'outline'
          ? cn('border bg-transparent', VARIANT_OUTLINE[variant])
          : VARIANT_FILLED[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
