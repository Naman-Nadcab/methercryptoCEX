'use client';

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AdminUserRow } from '@/lib/users-api';
import { KycStatusIndicator } from './KycStatusIndicator';
import { RiskBadge } from './RiskBadge';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { UserRowActions } from './UserRowActions';

function formatBalance(val: string | number | undefined): string {
  if (val === undefined || val === null) return '—';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function formatDate(val: string | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString(undefined, { dateStyle: 'short' });
  } catch {
    return '—';
  }
}

function displayStatus(status: string): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'locked') return 'Banned';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
}

export interface UsersTableProps {
  data: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onExportCsv?: (rows: AdminUserRow[]) => void;
  onSuspend?: (user: AdminUserRow) => void;
  onBan?: (user: AdminUserRow) => void;
  onReset2FA?: (user: AdminUserRow) => void;
}

export function UsersTable({
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onExportCsv,
  onSuspend,
  onBan,
  onReset2FA,
}: UsersTableProps) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<AdminUserRow>[]>(
    () => [
      {
        accessorKey: 'username',
        header: 'User Name',
        cell: ({ row }) => {
          const u = row.original;
          const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.email || '—';
          return <span className="font-medium text-admin-text">{name || u.id.slice(0, 8)}</span>;
        },
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ getValue }) => <span className="text-admin-muted">{(getValue() as string) || '—'}</span>,
      },
      {
        id: 'kyc',
        header: 'KYC',
        cell: ({ row }) => (
          <KycStatusIndicator
            kycStatus={row.original.kyc_status}
            kycLevel={row.original.kyc_level}
          />
        ),
      },
      {
        id: 'balance',
        header: 'Balance',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatBalance(row.original.total_balance as string | number)}</span>
        ),
      },
      {
        id: 'risk',
        header: 'Risk',
        cell: ({ row }) => (
          <RiskBadge
            level={(row.original.risk_level as 'low' | 'medium' | 'high') ?? 'low'}
            flags={row.original.risk_flags}
          />
        ),
      },
      {
        id: 'volume30d',
        header: '30d Volume',
        cell: ({ row }) => (
          <span className="tabular-nums">{formatBalance(row.original.volume_30d as string | number)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => (
          <StatusBadge status={displayStatus((getValue() as string) ?? '')} />
        ),
      },
      {
        accessorKey: 'country_code',
        header: 'Country',
        cell: ({ getValue }) => <span className="text-admin-muted">{(getValue() as string) || '—'}</span>,
      },
      {
        accessorKey: 'created_at',
        header: 'Created',
        cell: ({ getValue }) => <span className="text-admin-muted">{formatDate(getValue() as string)}</span>,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <UserRowActions
            user={row.original}
            onSuspend={onSuspend}
            onBan={onBan}
            onReset2FA={onReset2FA}
          />
        ),
      },
    ],
    [onSuspend, onBan, onReset2FA]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="overflow-hidden rounded-xl border border-admin-border bg-admin-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="sticky top-0 z-10 bg-white/[0.02]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted"
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="ml-1">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : null}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-admin-muted">
                  No users found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-admin-border/60 transition-colors hover:bg-admin-card/5"
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/users/${row.original.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(`/users/${row.original.id}`);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm" onClick={(e) => cell.column.id === 'actions' && e.stopPropagation()}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-admin-border bg-admin-card/[0.03] px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-admin-muted">
          {onExportCsv && (
            <button
              type="button"
              onClick={() => onExportCsv(data)}
              className="text-admin-primary hover:underline"
            >
              Export CSV
            </button>
          )}
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onPageChange(page - 1)}
            className="rounded border border-admin-border bg-admin-card px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-admin-card/5"
          >
            Previous
          </button>
          <span className="text-sm text-admin-muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => onPageChange(page + 1)}
            className="rounded border border-admin-border bg-admin-card px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-admin-card/5"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
