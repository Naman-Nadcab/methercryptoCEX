'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/routes';
import { ChevronRight, Home } from 'lucide-react';

export type DashboardBreadcrumb = { label: string; href?: string };

type DashboardPageShellProps = {
  title: string;
  description?: string;
  /** Omit or pass [] for pages that should not show a breadcrumb row */
  breadcrumbs?: DashboardBreadcrumb[];
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Shared page frame for dashboard routes: eyebrow, title, optional actions.
 * Uses existing gray / blue / dark surface tokens — no theme swap.
 */
export function DashboardPageShell({
  title,
  description,
  breadcrumbs,
  actions,
  children,
  className = '',
}: DashboardPageShellProps) {
  const crumbs = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : null;

  return (
    <div className={`w-full ${className}`}>
      <header className="mb-6 sm:mb-8">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground dark:hover:text-white transition-colors"
            >
              <Home className="w-3.5 h-3.5 opacity-80" aria-hidden />
              <span>Home</span>
            </Link>
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground shrink-0" aria-hidden />
                  {isLast || !c.href ? (
                    <span
                      className={
                        isLast
                          ? 'font-medium text-foreground/80 px-1.5 py-0.5'
                          : 'px-1.5 py-0.5'
                      }
                      aria-current={isLast ? 'page' : undefined}
                    >
                      {c.label}
                    </span>
                  ) : (
                    <Link
                      href={c.href}
                      className="rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground dark:hover:text-white transition-colors"
                    >
                      {c.label}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Dashboard
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
        </div>
      </header>

      {children}
    </div>
  );
}
