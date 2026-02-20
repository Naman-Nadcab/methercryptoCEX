'use client';

import { ReactNode } from 'react';
import { Panel } from './Panel';

export interface DataTableContainerProps {
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  emptyMessage?: string;
  isEmpty?: boolean;
  /** When set, show error state instead of empty. Fetch failure vs success+empty. */
  error?: string | null;
  /** When true (default), wrap children in a single table. Set false when children already include table + filters. */
  wrapTable?: boolean;
  className?: string;
}

export function DataTableContainer({
  title,
  subtitle,
  headerAction,
  children,
  emptyMessage = 'No data',
  isEmpty = false,
  error = null,
  wrapTable = true,
  className = '',
}: DataTableContainerProps) {
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      headerAction={headerAction}
      noPadding
      className={className}
    >
      {error ? (
        <div className="px-3 py-6 text-center">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 inline-flex items-center gap-3 text-red-400 text-sm">
            {error}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
          {emptyMessage}
        </div>
      ) : wrapTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" data-admin-table>
            {children}
          </table>
        </div>
      ) : (
        children
      )}
    </Panel>
  );
}

export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/40">
        {children}
      </tr>
    </thead>
  );
}

export function DataTableTh({
  children,
  className = '',
  align = 'left',
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  const alignClass =
    align === 'right'
      ? 'text-right'
      : align === 'center'
        ? 'text-center'
        : 'text-left';
  return (
    <th
      className={`px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${alignClass} ${className}`}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function DataTableRow({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={`hover:bg-muted/40 focus-within:bg-muted/40 ${className}`}
    >
      {children}
    </tr>
  );
}

export function DataTableCell({
  children,
  className = '',
  align = 'left',
  mono,
  title,
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  title?: string;
}) {
  const alignClass =
    align === 'right'
      ? 'text-right'
      : align === 'center'
        ? 'text-center'
        : 'text-left';
  return (
    <td
      title={title}
      className={`px-3 py-2 text-[12px] text-foreground whitespace-nowrap tabular-nums ${alignClass} ${mono ? 'font-mono text-[11px]' : ''} ${className}`}
    >
      {children}
    </td>
  );
}
