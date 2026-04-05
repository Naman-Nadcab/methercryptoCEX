'use client';

import { ReactNode } from 'react';
import { StatusBadge, type StatusBadgeVariant } from './StatusBadge';

export type MetricWidgetVariant = 'neutral' | 'positive' | 'warning' | 'danger';

const containerVariants: Record<MetricWidgetVariant, string> = {
  neutral: 'admin-card border-[var(--admin-card-border)] rounded-[12px]',
  positive: 'admin-card border-[var(--admin-success)]/30 bg-[var(--admin-success)]/5 rounded-[12px]',
  warning: 'admin-card border-[var(--admin-warning)]/30 bg-[var(--admin-warning)]/5 rounded-[12px]',
  danger: 'admin-card border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/5 rounded-[12px]',
};

const valueVariants: Record<MetricWidgetVariant, string> = {
  neutral: 'text-[var(--admin-text)]',
  positive: 'text-[var(--admin-success)]',
  warning: 'text-[var(--admin-warning)]',
  danger: 'text-[var(--admin-danger)]',
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
          <p className="text-[12px] font-medium text-[var(--admin-text-muted)] uppercase tracking-wider">
            {label}
          </p>
          <p className={`mt-0.5 text-base font-semibold tabular-nums ${valueVariants[variant]}`}>
            {value}
          </p>
          {sublabel !== undefined && sublabel !== '' && (
            <p className="mt-0.5 text-[12px] text-[var(--admin-text-muted)]">
              {sublabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusBadge != null && <StatusBadge variant={statusBadge} />}
          {icon && (
            <div className="w-10 h-10 rounded-xl bg-[var(--admin-hover-bg)] flex items-center justify-center text-[var(--admin-text-muted)]">
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
