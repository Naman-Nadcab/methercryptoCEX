'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { HotWalletRow } from '@/lib/treasury-api';
import { StatusBadge } from '@/components/dashboard/StatusBadge';

function truncateAddress(addr: string, head = 8, tail = 6): string {
  if (!addr) return '—';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function formatLastSweep(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 60000;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.floor(diff)} minutes ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export interface HotWalletsTableProps {
  rows: HotWalletRow[];
}

export function HotWalletsTable({ rows }: HotWalletsTableProps) {
  const columns: ColumnDef<HotWalletRow>[] = [
    { id: 'chain_name', header: 'Chain', cell: ({ row }) => row.original.chain_name || row.original.chain_id || '—' },
    {
      id: 'address',
      header: 'Wallet Address',
      cell: ({ row }) => (
        <span className="font-mono text-sm" title={row.original.address}>
          {truncateAddress(row.original.address)}
        </span>
      ),
    },
    {
      id: 'balance',
      header: 'Balance',
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.balance || '0'}</span>
      ),
    },
    {
      id: 'last_sweep_at',
      header: 'Last Sweep',
      cell: ({ row }) => formatLastSweep(row.original.last_sweep_at),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.status === 'active' ? 'Active' : 'Inactive'} />
      ),
    },
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
        <div className="py-8 text-center text-admin-muted">No hot wallets.</div>
      )}
    </div>
  );
}
