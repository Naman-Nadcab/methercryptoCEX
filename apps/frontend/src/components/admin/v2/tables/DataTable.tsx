'use client';

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type ColumnFiltersState,
  type RowData,
} from '@tanstack/react-table';
import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DataTableProps<T extends RowData> {
  /** Table data (current page for server-side) */
  data: T[];
  /** Column definitions */
  columns: ColumnDef<T, unknown>[];
  /** Total row count (for server-side pagination) */
  rowCount?: number;
  /** Server-side: pagination is controlled by parent */
  manualPagination?: boolean;
  /** Server-side: sorting is controlled by parent */
  manualSorting?: boolean;
  /** Initial page size */
  pageSize?: number;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Controlled pagination state (for server-side) */
  pagination?: PaginationState;
  onPaginationChange?: (updater: (prev: PaginationState) => PaginationState) => void;
  /** Controlled sorting state (for server-side) */
  sorting?: SortingState;
  onSortingChange?: (updater: (prev: SortingState) => SortingState) => void;
  /** Controlled column filters (for server-side or client-side) */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (updater: (prev: ColumnFiltersState) => ColumnFiltersState) => void;
  /** Search / global filter value */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Show search input in toolbar */
  showSearch?: boolean;
  /** Show export CSV button */
  showExport?: boolean;
  /** CSV filename (without .csv) */
  exportFilename?: string;
  /** Title above table */
  title?: string;
  /** Subtitle (e.g. "X total") */
  subtitle?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Optional class for wrapper */
  className?: string;
  /** Optional render for row actions or extra toolbar content */
  toolbarExtra?: React.ReactNode;
  /** Optional render for row (e.g. link to detail) */
  getRowClassName?: (row: T) => string | undefined;
}

function escapeCsvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function DataTable<T extends RowData>({
  data,
  columns,
  rowCount = 0,
  manualPagination = true,
  manualSorting = true,
  pageSize: initialPageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  pagination: controlledPagination,
  onPaginationChange,
  sorting: controlledSorting,
  onSortingChange,
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange,
  searchValue = '',
  onSearchChange,
  showSearch = true,
  showExport = true,
  exportFilename = 'export',
  title,
  subtitle,
  emptyMessage = 'No rows',
  isLoading = false,
  className,
  toolbarExtra,
  getRowClassName,
}: DataTableProps<T>) {
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>([]);

  const pagination = controlledPagination ?? internalPagination;
  const setPagination = onPaginationChange ?? setInternalPagination;
  const sorting = controlledSorting ?? internalSorting;
  const setSorting = onSortingChange ?? setInternalSorting;
  const columnFilters = controlledColumnFilters ?? internalColumnFilters;
  const setColumnFilters = onColumnFiltersChange ?? setInternalColumnFilters;

  const pageCount = manualPagination && rowCount > 0
    ? Math.ceil(rowCount / pagination.pageSize) || 1
    : -1;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    manualPagination,
    manualSorting,
    pageCount: pageCount >= 0 ? pageCount : undefined,
    state: {
      pagination,
      sorting,
      columnFilters,
      globalFilter: searchValue,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: onSearchChange
      ? (updater) => {
          const next = typeof updater === 'function' ? updater(searchValue) : updater;
          onSearchChange(String(next ?? ''));
        }
      : undefined,
  });

  const handleExportCsv = useCallback(() => {
    const allHeaders = table.getHeaderGroups()[0]?.headers ?? [];
    const headerIds = allHeaders.map((h) => h.column.id);
    const headerLabels = allHeaders.map((header) => {
      const def = header.column.columnDef;
      const meta = (def as { meta?: { header?: string } }).meta;
      if (meta?.header) return meta.header;
      const h = def.header;
      return typeof h === 'string' ? h : header.column.id;
    });
    const rows = table.getRowModel().rows.map((row) =>
      headerIds.map((id) => {
        const value = row.getValue(id);
        return escapeCsvCell(value);
      })
    );
    const csvContent = [
      headerLabels.map(escapeCsvCell).join(','),
      ...rows.map((r) => r.join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [table, columns, exportFilename]);

  const total = manualPagination ? rowCount : data.length;
  const canPrev = pagination.pageIndex > 0;
  const canNext = pageCount < 0 || pagination.pageIndex < pageCount - 1;

  return (
    <div className={cn('admin-card overflow-hidden', className)}>
      {(title || subtitle || showSearch || showExport || toolbarExtra) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--admin-card-border)]">
          <div className="flex flex-wrap items-center gap-3">
            {title && <h3 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h3>}
            {subtitle && <span className="text-xs text-[var(--admin-text-muted)]">{subtitle}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showSearch && onSearchChange && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--admin-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="pl-8 pr-3 py-1.5 w-40 min-w-0 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)] placeholder-[var(--admin-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)]/30"
                />
              </div>
            )}
            {showExport && (
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={data.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] text-xs font-medium text-[var(--admin-text)] hover:bg-[var(--admin-hover-bg)] disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            )}
            {toolbarExtra}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-[var(--admin-card-border)] bg-[var(--admin-input-bg)]/80">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--admin-text-muted)]',
                      header.column.getCanSort() && 'cursor-pointer select-none hover:text-[var(--admin-text)]'
                    )}
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="text-[var(--admin-text-muted)]">
                          {header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-[var(--admin-text-muted)]">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-[var(--admin-text-muted)]">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-[var(--admin-card-border)]/60 hover:bg-[var(--admin-hover-bg)] transition-colors',
                    getRowClassName?.(row.original)
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-[var(--admin-text)]">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(manualPagination ? pageCount > 1 : table.getPageCount() > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--admin-card-border)]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--admin-text-muted)]">
              Page {pagination.pageIndex + 1} of {pageCount >= 0 ? pageCount : table.getPageCount()}
              {manualPagination && rowCount > 0 && ` (${rowCount} total)`}
            </span>
            {manualPagination && (
              <select
                value={pagination.pageSize}
                onChange={(e) =>
                  setPagination((prev) => ({
                    ...prev,
                    pageSize: Number(e.target.value),
                    pageIndex: 0,
                  }))
                }
                className="rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] px-2 py-1 text-xs text-[var(--admin-text)]"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>{n} per page</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canPrev || isLoading}
              onClick={() => table.setPageIndex(0)}
              className="p-1.5 rounded border border-[var(--admin-card-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-hover-bg)] disabled:opacity-50"
              title="First page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!canPrev || isLoading}
              onClick={() => table.previousPage()}
              className="p-1.5 rounded border border-[var(--admin-card-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-hover-bg)] disabled:opacity-50"
              title="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs text-[var(--admin-text-muted)]">
              {pagination.pageIndex + 1} / {pageCount >= 0 ? pageCount : table.getPageCount()}
            </span>
            <button
              type="button"
              disabled={!canNext || isLoading}
              onClick={() => table.nextPage()}
              className="p-1.5 rounded border border-[var(--admin-card-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-hover-bg)] disabled:opacity-50"
              title="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!canNext || isLoading}
              onClick={() => table.setPageIndex((pageCount >= 0 ? pageCount : table.getPageCount()) - 1)}
              className="p-1.5 rounded border border-[var(--admin-card-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-hover-bg)] disabled:opacity-50"
              title="Last page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
