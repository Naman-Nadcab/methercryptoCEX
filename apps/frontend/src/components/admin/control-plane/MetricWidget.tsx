'use client';

import { ReactNode } from 'react';
import { StatusBadge, type StatusBadgeVariant } from './StatusBadge';

export type MetricWidgetVariant = 'neutral' | 'positive' | 'warning' | 'danger';

const containerVariants: Record<MetricWidgetVariant, string> = {
  neutral: 'admin-card border-[#E5E7EB] rounded-[12px]',
  positive: 'admin-card border-[#10B981]/30 bg-[#10B981]/5 rounded-[12px]',
  warning: 'admin-card border-[#F59E0B]/30 bg-[#F59E0B]/5 rounded-[12px]',
  danger: 'admin-card border-[#EF4444]/30 bg-[#EF4444]/5 rounded-[12px]',
};

const valueVariants: Record<MetricWidgetVariant, string> = {
  neutral: 'text-[#111827]',
  positive: 'text-[#10B981]',
  warning: 'text-[#F59E0B]',
  danger: 'text-[#EF4444]',
};

export interface MetricWidgetProps {
  label: string;
  value: string | number;
  sublabel?: string;
  variant?: MetricWidgetVariant;
  statusBadge?: StatusBadgeVariant | null;
  href?: string;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function MetricWidget({
  label,
  value,
  sublabel,
  variant = 'neutral',
  statusBadge,
  href,
  icon,
  className = '',
  children,
}: MetricWidgetProps) {
  const content = (
    <div
      className={`min-h-0 flex flex-col p-5 ${containerVariants[variant]} ${href ? 'cursor-pointer hover:shadow-md' : ''} transition-all duration-200 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-[#6B7280] uppercase tracking-wider">
            {label}
          </p>
          <p className={`mt-0.5 text-base font-semibold tabular-nums ${valueVariants[variant]}`}>
            {value}
          </p>
          {sublabel !== undefined && sublabel !== '' && (
            <p className="mt-0.5 text-[12px] text-[#6B7280]">
              {sublabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusBadge != null && <StatusBadge variant={statusBadge} />}
          {icon && (
            <div className="w-10 h-10 rounded-xl bg-[#F1F5F9] flex items-center justify-center text-[#6B7280]">
              {icon}
            </div>
          )}
        </div>
      </div>
      {children}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block">
        {content}
      </a>
    );
  }
  return content;
}
