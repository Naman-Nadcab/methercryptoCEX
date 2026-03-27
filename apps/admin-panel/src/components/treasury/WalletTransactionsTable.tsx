'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { type WalletTransactionRow } from '@/lib/treasury-api';

const columnHelper = createColumnHelper<WalletTransactionRow>();

const columns = [
  columnHelper.accessor('tx_hash', {
    header: 'Tx Hash',
    cell: ({ getValue }) => {
      const v = getValue();
      if (!v) return '—';
      return (
        <span className="font-mono text-xs" title={v}>
          {v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-8)}` : v}
        </span>
      );
    },
  }),
  columnHelper.accessor('wallet_address', {
    header: 'Wallet Address',
    cell: ({ getValue }) => {
      const v = getValue();
      if (!v || v === '—') return '—';
      return (
        <span className="font-mono text-xs" title={v}>
          {v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-6)}` : v}
        </span>
      );
    },
  }),
  columnHelper.accessor('asset', { header: 'Asset' }),
  columnHelper.accessor('amount', { header: 'Amount' }),
  columnHelper.accessor('transaction_type', { header: 'Type' }),
  columnHelper.accessor('time', {
    header: 'Time',
    cell: ({ getValue }) => {
      const v = getValue();
      if (!v) return '—';
      try {
        const d = new Date(v);
        return d.toLocaleString();
      } catch {
        return v;
      }
    },
  }),
];

export interface WalletTransactionsTableProps {
  rows: WalletTransactionRow[];
}

export function WalletTransactionsTable({ rows }: WalletTransactionsTableProps) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
      <table className="w-full min-w-[700px] text-left text-sm">
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
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                No transactions
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-admin-border last:border-0 hover:bg-gray-50/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-gray-900">
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
