'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { SweepRow } from '@/lib/treasury-api';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { RefreshCw } from 'lucide-react';

function truncateAddress(addr: string, head = 8, tail = 6): string {
  if (!addr) return '—';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export interface SweepsTableProps {
  rows: SweepRow[];
  onRetry?: (row: SweepRow) => void;
}

export function SweepsTable({ rows, onRetry }: SweepsTableProps) {
  const columns: ColumnDef<SweepRow>[] = [
    {
      id: 'id',
      header: 'Sweep ID',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{String(row.original.id).slice(0, 8)}…</span>
      ),
    },
    {
      id: 'from_address',
      header: 'From Address',
      cell: ({ row }) => (
        <span className="font-mono text-sm" title={row.original.from_address}>
          {truncateAddress(row.original.from_address)}
        </span>
      ),
    },
    {
      id: 'to_address',
      header: 'To Address',
      cell: ({ row }) => (
        <span className="font-mono text-sm" title={row.original.to_address}>
          {truncateAddress(row.original.to_address)}
        </span>
      ),
    },
    { id: 'asset', header: 'Asset', cell: ({ row }) => row.original.asset || '—' },
    {
      id: 'amount',
      header: 'Amount',
      cell: ({ row }) => <span className="tabular-nums">{row.original.amount ?? '—'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={
            row.original.status === 'completed'
              ? 'Completed'
              : row.original.status === 'failed'
                ? 'Failed'
                : 'Pending'
          }
        />
      ),
    },
    {
      id: 'created_at',
      header: 'Time',
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    ...(onRetry
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: ({ row }: { row: { original: SweepRow } }) =>
              row.original.status === 'failed' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRetry(row.original)}
                  title="Retry sweep"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              ) : (
                '—'
              ),
          } as ColumnDef<SweepRow>,
        ]
      : []),
  ];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-admin-border bg-gray-50">
              {hg.headers.map((h) => (
                <th key={h.id} className="px-4 py-3 font-medium text-admin-muted">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-admin-border last:border-0 hover:bg-gray-50/50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 text-gray-900">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="py-8 text-center text-admin-muted">No sweeps.</div>
      )}
    </div>
  );
}
