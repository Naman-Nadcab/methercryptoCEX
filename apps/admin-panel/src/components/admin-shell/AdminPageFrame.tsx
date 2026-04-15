'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export type AdminPageStatus = 'active' | 'warning' | 'risk';

const STATUS_BADGE: Record<AdminPageStatus, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
  active: { variant: 'success', label: 'Active' },
  warning: { variant: 'warning', label: 'Warning' },
  risk: { variant: 'danger', label: 'Risk' },
};

/**
 * Tier-1 standard page chrome: header + optional KPI row + error surface with retry.
 * Wrap existing page content — do not remove inner tables/forms.
 */
export function AdminPageFrame(props: {
  title: string;
  description?: string;
  status?: AdminPageStatus;
  quickActions?: ReactNode;
  metrics?: ReactNode;
  error?: string | null;
  onRetry?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { title, description, status = 'active', quickActions, metrics, error, onRetry, children, className } = props;
  const sb = STATUS_BADGE[status];

  return (
    <div className={cn('space-y-6 p-6', className)}>
      <header className="flex flex-col gap-3 border-b border-admin-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-admin-text">{title}</h1>
            <Badge variant={sb.variant}>{sb.label}</Badge>
          </div>
          {description ? <p className="mt-1 text-sm text-admin-muted">{description}</p> : null}
        </div>
        {quickActions ? <div className="flex flex-wrap gap-2">{quickActions}</div> : null}
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-admin-danger/40 bg-admin-danger/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex gap-2 text-sm text-admin-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
          {onRetry ? (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      {metrics ? <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics}</section> : null}

      <div className="space-y-6">{children}</div>
    </div>
  );
}
