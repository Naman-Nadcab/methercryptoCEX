'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

export type ActionButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantStyles: Record<ActionButtonVariant, string> = {
  primary:
    'bg-[#2563EB] text-white hover:bg-[#1d4ed8] border border-transparent focus-visible:ring-2 focus-visible:ring-[#2563EB]/20',
  secondary:
    'bg-transparent border border-[#E5E7EB] text-[#111827] hover:bg-[#F9FAFB] focus-visible:ring-2 focus-visible:ring-[#2563EB]/20',
  danger:
    'bg-[#EF4444] text-white border border-transparent hover:bg-[#dc2626] focus-visible:ring-2 focus-visible:ring-[#EF4444]/20',
  ghost:
    'bg-transparent border border-transparent text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827] focus-visible:ring-2 focus-visible:ring-[#2563EB]/20',
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
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none transition-colors ${variantStyles[variant]} ${className}`}
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
