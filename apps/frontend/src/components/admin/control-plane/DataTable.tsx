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
          <div className="rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/5 p-4 inline-flex items-center gap-3 text-[#EF4444] text-sm">
            {error}
          </div>
        </div>
      ) : isEmpty ? (
        <div className="px-5 py-8 text-center text-[13px] text-[#6B7280]">
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
      className={`px-5 py-3.5 text-[12px] font-medium text-[#6B7280] uppercase tracking-wider whitespace-nowrap ${alignClass} ${className}`}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[#E5E7EB]">{children}</tbody>;
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
      className={`hover:bg-[#F9FAFB] focus-within:bg-[#F9FAFB] transition-colors ${className}`}
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
      className={`px-5 py-3.5 text-[14px] text-[#111827] whitespace-nowrap tabular-nums ${alignClass} ${mono ? 'font-mono text-[13px]' : ''} ${className}`}
    >
      {children}
    </td>
  );
}
