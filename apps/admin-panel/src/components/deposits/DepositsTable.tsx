'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DepositRow } from '@/lib/deposits-api';
import { DepositStatusBadge } from './DepositStatusBadge';
import { ConfirmationProgress } from './ConfirmationProgress';
import { LargeDepositBadge, StuckDepositBadge, isDepositStuck } from './DepositIndicators';
import { Button } from '@/components/ui/Button';
import { User, CreditCard } from 'lucide-react';

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function truncateHash(h: string | null | undefined): string {
  if (!h) return '—';
  if (h.length <= 16) return h;
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export interface DepositsTableProps {
  rows: DepositRow[];
  onManualCredit: (d: DepositRow) => void;
  canManualCredit?: boolean;
}

export function DepositsTable({ rows, onManualCredit, canManualCredit = true }: DepositsTableProps) {
  const router = useRouter();

  const columns: ColumnDef<DepositRow>[] = [
    {
      accessorKey: 'deposit_id',
      header: 'Deposit ID',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm">{String(getValue() ?? '').slice(0, 8)}…</span>
      ),
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => (
        <span className="text-admin-text">
          {(row.original.user_email ?? row.original.user_id) ?? '—'}
        </span>
      ),
    },
    {
      id: 'asset',
      header: 'Asset',
      cell: ({ row }) => row.original.token_symbol ?? '—',
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="tabular-nums">{(row.original.amount as string) ?? '—'}</span>
          {row.original.is_large_deposit && <LargeDepositBadge />}
        </div>
      ),
    },
    {
      id: 'tx_hash',
      header: 'TX Hash',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{truncateHash(row.original.tx_hash as string)}</span>
      ),
    },
    {
      id: 'confirmations',
      header: 'Confirmations',
      cell: ({ row }) => (
        <ConfirmationProgress
          confirmations={Number(row.original.confirmations ?? 0)}
          required={Number(row.original.required_confirmations ?? 0)}
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <DepositStatusBadge status={(row.original.status as string) ?? ''} />
          {isDepositStuck(row.original.status as string, row.original.created_at as string) && (
            <StuckDepositBadge />
          )}
        </div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ getValue }) => (
        <span className="text-admin-muted text-sm">{formatDate(getValue() as string)}</span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => router.push(`/deposits/${row.original.deposit_id}`)}
            title="View"
          >
            View
          </Button>
          <Link href={`/users/${row.original.user_id}`}>
            <Button variant="ghost" size="sm" className="h-8 px-2" title="View User">
              <User className="h-4 w-4" />
            </Button>
          </Link>
          {canManualCredit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              title="Manual Credit"
              onClick={() => onManualCredit(row.original)}
            >
              <CreditCard className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-card">
      <table className="w-full min-w-[900px] border-collapse">
        <thead className="sticky top-0 z-10 bg-white/[0.02]">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="border-b border-admin-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-admin-muted">
                No deposits found.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-admin-border/60 hover:bg-admin-card/5 cursor-pointer"
                onClick={() => router.push(`/deposits/${row.original.deposit_id}`)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
