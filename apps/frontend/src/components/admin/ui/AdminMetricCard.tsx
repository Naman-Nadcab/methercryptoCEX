'use client';

import { ReactNode } from 'react';
import Link from 'next/link';

export interface AdminMetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: ReactNode;
  href?: string;
  variant?: 'neutral' | 'positive' | 'warning' | 'danger';
  className?: string;
}

const variantClasses = {
  neutral: 'border-[#E5E7EB]',
  positive: 'border-[#10B981]/30 bg-[#10B981]/5',
  warning: 'border-[#F59E0B]/30 bg-[#F59E0B]/5',
  danger: 'border-[#EF4444]/30 bg-[#EF4444]/5',
};

export function AdminMetricCard({
  label,
  value,
  sublabel,
  icon,
  href,
  variant = 'neutral',
  className = '',
}: AdminMetricCardProps) {
  const card = (
    <div
      className={`admin-card border rounded-[12px] p-5 flex flex-col min-h-0 ${variantClasses[variant]} ${href ? 'cursor-pointer hover:shadow-md' : ''} transition-all duration-200 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-[#6B7280] uppercase tracking-wider">{label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">{value}</p>
          {sublabel != null && sublabel !== '' && (
            <p className="mt-0.5 text-[12px] text-[#6B7280]">{sublabel}</p>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-[#F1F5F9] flex items-center justify-center text-[#6B7280] shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
  if (href) return <Link href={href}>{card}</Link>;
  return card;
}
