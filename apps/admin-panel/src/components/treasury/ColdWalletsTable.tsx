'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { ColdWalletRow } from '@/lib/treasury-api';

function truncateAddress(addr: string | null, head = 8, tail = 6): string {
  if (!addr) return '—';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export interface ColdWalletsTableProps {
  rows: ColdWalletRow[];
}

export function ColdWalletsTable({ rows }: ColdWalletsTableProps) {
  const columns: ColumnDef<ColdWalletRow>[] = [
    { id: 'chain_name', header: 'Chain', cell: ({ row }) => row.original.chain_name || row.original.chain_id || '—' },
    {
      id: 'address',
      header: 'Wallet Address',
      cell: ({ row }) => (
        <span className="font-mono text-sm" title={row.original.address ?? ''}>
          {truncateAddress(row.original.address)}
        </span>
      ),
    },
    {
      id: 'balance',
      header: 'Balance',
      cell: () => <span className="text-admin-muted">—</span>,
    },
    {
      id: 'reserve_percentage',
      header: 'Reserve Percentage',
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.reserve_percentage}%</span>
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
        <div className="py-8 text-center text-admin-muted">No cold wallets.</div>
      )}
    </div>
  );
}
