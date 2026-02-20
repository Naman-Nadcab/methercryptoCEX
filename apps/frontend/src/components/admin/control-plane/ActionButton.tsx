'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

export type ActionButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantStyles: Record<ActionButtonVariant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:opacity-90 border border-transparent focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  secondary:
    'bg-transparent border border-border text-foreground hover:bg-muted focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  danger:
    'bg-destructive text-destructive-foreground border border-transparent hover:opacity-90 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  ghost:
    'bg-transparent border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
};

export interface ActionButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ActionButtonVariant;
  icon?: ReactNode;
  children: ReactNode;
  loading?: boolean;
}

export function ActionButton({
  variant = 'primary',
  icon,
  children,
  loading = false,
  disabled,
  className = '',
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled ?? loading}
      className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-[4px] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${variantStyles[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
