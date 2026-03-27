'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const ACCENT_BORDERS: Record<string, string> = {
  primary: 'border-t-4 border-t-[var(--admin-primary)]',
  success: 'border-t-4 border-t-[var(--admin-success)]',
  warning: 'border-t-4 border-t-[var(--admin-warning)]',
  danger: 'border-t-4 border-t-[var(--admin-danger)]',
  p2p: 'border-t-4 border-t-[var(--admin-accent-p2p)]',
  reports: 'border-t-4 border-t-[var(--admin-accent-reports)]',
  neutral: '',
};

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  accent?: keyof typeof ACCENT_BORDERS;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
}

export function ChartCard({
  title,
  subtitle,
  children,
  accent = 'primary',
  viewAllHref,
  viewAllLabel = 'View all',
  className = '',
}: ChartCardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] overflow-hidden shadow-[var(--admin-shadow)] hover:shadow-[var(--admin-shadow-hover)] transition-shadow bg-white',
        ACCENT_BORDERS[accent] ?? '',
        className
      )}
    >
      <div className="px-5 py-4 border-b border-[var(--admin-card-border)] flex items-center justify-between gap-3 bg-[var(--admin-card-bg)]">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--admin-text)]">{title}</h3>
          {subtitle != null && subtitle !== '' && (
            <p className="text-[12px] text-[var(--admin-text-muted)] mt-0.5">{subtitle}</p>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-[12px] font-medium text-[var(--admin-primary)] hover:underline shrink-0"
          >
            {viewAllLabel} →
          </Link>
        )}
      </div>
      <div className="p-5 bg-[var(--admin-card-bg)]">{children}</div>
    </div>
  );
}
