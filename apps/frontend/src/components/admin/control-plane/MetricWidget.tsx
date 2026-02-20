'use client';

import { ReactNode } from 'react';
import { StatusBadge, type StatusBadgeVariant } from './StatusBadge';

export type MetricWidgetVariant = 'neutral' | 'positive' | 'warning' | 'danger';

const containerVariants: Record<MetricWidgetVariant, string> = {
  neutral: 'border-border bg-card',
  positive: 'border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10',
  warning: 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/5 dark:bg-red-500/10',
};

const valueVariants: Record<MetricWidgetVariant, string> = {
  neutral: 'text-foreground',
  positive: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-700 dark:text-red-400',
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
      className={`rounded-[4px] border p-3 min-h-0 flex flex-col ${containerVariants[variant]} ${href ? 'hover:opacity-95 cursor-pointer' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
          <p className={`mt-0.5 text-base font-semibold tabular-nums ${valueVariants[variant]}`}>
            {value}
          </p>
          {sublabel !== undefined && sublabel !== '' && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {sublabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusBadge != null && <StatusBadge variant={statusBadge} />}
          {icon && (
            <div className="w-7 h-7 rounded-[4px] bg-muted flex items-center justify-center text-muted-foreground">
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
