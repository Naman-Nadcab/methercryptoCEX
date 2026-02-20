'use client';

import { ReactNode } from 'react';

export interface PanelProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  noPadding?: boolean;
}

export function Panel({
  title,
  subtitle,
  children,
  className = '',
  headerAction,
  noPadding = false,
}: PanelProps) {
  return (
    <div
      className={`rounded-[4px] border border-border bg-card overflow-hidden ${className}`}
    >
      {(title != null || subtitle != null || headerAction != null) && (
        <div className="px-3 py-2 border-b border-border bg-muted/40 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {title != null && (
              <h2 className="text-[13px] font-semibold text-foreground">
                {title}
              </h2>
            )}
            {subtitle != null && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction != null && (
            <div className="shrink-0">{headerAction}</div>
          )}
        </div>
      )}
      <div className={noPadding ? '' : 'p-3'}>{children}</div>
    </div>
  );
}
