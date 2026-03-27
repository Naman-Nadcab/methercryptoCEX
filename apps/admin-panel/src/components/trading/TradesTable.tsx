'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { TradeRow } from '@/lib/trading-api';
import { Badge } from '@/components/ui/Badge';

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

export function TradesTable({ rows }: { rows: TradeRow[] }) {
  const columns: ColumnDef<TradeRow>[] = [
    {
      accessorKey: 'trade_id',
      header: 'Trade ID',
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm">{String(row.original.trade_id ?? '').slice(0, 8)}…</span>
          {row.original.is_whale_trade && (
            <Badge variant="warning" className="shrink-0">Whale Trade</Badge>
          )}
        </div>
      ),
    },
    { accessorKey: 'market', header: 'Market', cell: ({ getValue }) => getValue() ?? '—' },
    {
      id: 'buyer',
      header: 'Buyer',
      cell: ({ row }) =>
        (row.original.side as string)?.toLowerCase() === 'buy'
          ? (row.original.user_email ?? row.original.user_id ?? '—')
          : '—',
    },
    {
      id: 'seller',
      header: 'Seller',
      cell: ({ row }) =>
        (row.original.side as string)?.toLowerCase() === 'sell'
          ? (row.original.user_email ?? row.original.user_id ?? '—')
          : '—',
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
      id: 'fee',
      header: 'Fee',
      cell: ({ row }) => {
        const fee = row.original.fee;
        const asset = row.original.fee_asset;
        if (fee == null || fee === '') return '—';
        return (
          <span className="tabular-nums">
            {formatNum(fee)}
            {asset ? ` ${asset}` : ''}
          </span>
        );
      },
    },
    {
      accessorKey: 'created_at',
      header: 'Time',
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
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
      <table className="w-full min-w-[800px] border-collapse">
        <thead className="sticky top-0 z-10 bg-gray-50">
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
                No trades found.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-admin-border/60 hover:bg-gray-50">
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
