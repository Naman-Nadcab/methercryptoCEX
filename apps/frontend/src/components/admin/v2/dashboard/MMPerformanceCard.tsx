'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MMPerformanceCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  accent?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}

const accentColors = {
  primary: 'border-l-[var(--admin-primary)] bg-[var(--admin-primary)]/5',
  success: 'border-l-[var(--admin-success)] bg-[var(--admin-success)]/5',
  warning: 'border-l-[var(--admin-warning)] bg-[var(--admin-warning)]/5',
  danger: 'border-l-[var(--admin-danger)] bg-[var(--admin-danger)]/5',
  neutral: 'border-l-[var(--admin-card-border)]',
};

export function MMPerformanceCard({
  title,
  value,
  subtitle,
  icon,
  accent = 'primary',
  className,
}: MMPerformanceCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)] hover:shadow-[var(--admin-shadow-hover)] transition-shadow border-l-4 min-h-[100px] flex flex-col',
        accentColors[accent],
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--admin-text-muted)] uppercase tracking-wide truncate">{title}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--admin-text)] truncate">{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{subtitle}</p>}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-[var(--admin-radius)] bg-[var(--admin-primary)]/10 flex items-center justify-center shrink-0 text-[var(--admin-primary)]">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
