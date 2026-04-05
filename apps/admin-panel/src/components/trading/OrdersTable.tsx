'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { OrderRow } from '@/lib/trading-api';
import { OrderStatusBadge } from './OrderStatusBadge';

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function formatNum(v: string | number | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const columns: ColumnDef<OrderRow>[] = [
    {
      accessorKey: 'order_id',
      header: 'Order ID',
      cell: ({ getValue }) => (
        <span className="font-mono text-sm">{String(getValue() ?? '').slice(0, 8)}…</span>
      ),
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => (
        <span className="text-admin-text">{row.original.user_email ?? row.original.user_id ?? '—'}</span>
      ),
    },
    { accessorKey: 'market', header: 'Market', cell: ({ getValue }) => getValue() ?? '—' },
    {
      accessorKey: 'side',
      header: 'Side',
      cell: ({ getValue }) => (
        <span className={String(getValue()).toLowerCase() === 'buy' ? 'text-admin-success' : 'text-admin-danger'}>
          {(getValue() as string)?.toUpperCase() ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'price',
      header: 'Price',
      cell: ({ getValue }) => <span className="tabular-nums">{formatNum(getValue() as string)}</span>,
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      cell: ({ getValue }) => <span className="tabular-nums">{formatNum(getValue() as string)}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <OrderStatusBadge status={(getValue() as string) ?? ''} />,
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ getValue }) => (
        <span className="text-admin-muted text-sm">{formatDate(getValue() as string)}</span>
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
      <table className="w-full min-w-[800px] border-collapse">
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
                No orders found.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-admin-border/60 hover:bg-admin-card/5">
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
