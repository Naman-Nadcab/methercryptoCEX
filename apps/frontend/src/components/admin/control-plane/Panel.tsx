'use client';

import { ReactNode } from 'react';

const ACCENT_BORDERS: Record<string, string> = {
  primary: 'border-l-4 border-l-[var(--admin-primary)]',
  success: 'border-l-4 border-l-[var(--admin-success)]',
  warning: 'border-l-4 border-l-[var(--admin-warning)]',
  danger: 'border-l-4 border-l-[var(--admin-danger)]',
  neutral: '',
};

export interface PanelProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  noPadding?: boolean;
  /** CRM accent: colored left border */
  accent?: keyof typeof ACCENT_BORDERS;
}

export function Panel({
  title,
  subtitle,
  children,
  className = '',
  headerAction,
  noPadding = false,
  accent,
}: PanelProps) {
  return (
    <div className={`admin-card overflow-hidden rounded-xl border border-[var(--admin-card-border)] shadow-sm ${ACCENT_BORDERS[accent ?? 'neutral'] ?? ''} ${className}`}>
      {(title != null || subtitle != null || headerAction != null) && (
        <div className="px-5 py-4 border-b border-[var(--admin-card-border)] flex items-center justify-between gap-3 bg-[var(--admin-card-bg)]">
          <div className="min-w-0">
            {title != null && (
              <h2 className="text-[15px] font-semibold text-[var(--admin-text)]">{title}</h2>
            )}
            {subtitle != null && (
              <p className="text-[12px] text-[var(--admin-text-muted)] mt-0.5">{subtitle}</p>
            )}
          </div>
          {headerAction != null && (
            <div className="shrink-0">{headerAction}</div>
          )}
        </div>
      )}
      <div className={noPadding ? '' : 'p-5 bg-[var(--admin-card-bg)]'}>{children}</div>
    </div>
  );
}
