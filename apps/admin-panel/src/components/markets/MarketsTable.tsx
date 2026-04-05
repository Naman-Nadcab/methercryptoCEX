'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import Link from 'next/link';
import type { MarketRow } from '@/lib/markets-api';
import { MarketStatusBadge } from './MarketStatusBadge';
import { Button } from '@/components/ui/Button';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { Badge } from '@/components/ui/Badge';
import { Play, Pause, Square, Edit, Trash2, Loader2 } from 'lucide-react';

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function displaySymbol(row: MarketRow): string {
  const base = row.base_asset ?? '';
  const quote = row.quote_asset ?? '';
  if (base && quote) return `${base}/${quote}`;
  return (row.symbol ?? '').replace(/_/g, '/') || '—';
}

export interface MarketsTableProps {
  rows: MarketRow[];
  onEnable: (row: MarketRow) => void;
  onDisable: (row: MarketRow) => void;
  onPause: (row: MarketRow) => void;
  onResume: (row: MarketRow) => void;
  onEditFees: (row: MarketRow) => void;
  onToggleActive?: (row: MarketRow) => void;
  onDelete?: (row: MarketRow) => void;
  togglingId?: string | null;
}

export function MarketsTable({
  rows,
  onEnable,
  onDisable,
  onPause,
  onResume,
  onEditFees,
  onToggleActive,
  onDelete,
  togglingId,
}: MarketsTableProps) {
  const columns: ColumnDef<MarketRow>[] = [
    {
      id: 'market',
      header: 'Market',
      cell: ({ row }) => (
        <Link
          href={`/markets/${encodeURIComponent((row.original.symbol ?? '').replace(/\//g, '_'))}`}
          className="font-medium text-admin-primary hover:underline"
        >
          {displaySymbol(row.original)}
        </Link>
      ),
    },
    {
      id: 'base_asset',
      header: 'Base Asset',
      cell: ({ row }) => row.original.base_asset ?? '—',
    },
    {
      id: 'quote_asset',
      header: 'Quote Asset',
      cell: ({ row }) => row.original.quote_asset ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <MarketStatusBadge
            status={row.original.status}
            is_active={row.original.is_active}
            trading_enabled={row.original.trading_enabled}
          />
          {row.original.low_liquidity && (
            <Badge variant="warning">Low Liquidity</Badge>
          )}
        </div>
      ),
    },
    {
      id: 'maker_fee',
      header: 'Maker Fee',
      cell: ({ row }) => {
        const v = row.original.maker_fee;
        if (v == null) return '—';
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : String(v);
      },
    },
    {
      id: 'taker_fee',
      header: 'Taker Fee',
      cell: ({ row }) => {
        const v = row.original.taker_fee;
        if (v == null) return '—';
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : String(v);
      },
    },
    {
      id: 'price_precision',
      header: 'Price Precision',
      cell: ({ row }) => row.original.price_precision ?? row.original.qty_precision ?? '—',
    },
    {
      id: 'qty_precision',
      header: 'Quantity Precision',
      cell: ({ row }) => row.original.qty_precision ?? row.original.price_precision ?? '—',
    },
    {
      id: 'created',
      header: 'Created',
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    ...(onToggleActive
      ? [
          {
            id: 'active_toggle',
            header: 'Active',
            cell: ({ row }: { row: { original: MarketRow } }) => {
              const r = row.original;
              const active = r.is_active !== false;
              const toggling = togglingId === (r.id ?? r.symbol);
              return (
                <ProtectedAction permission="markets:manage" fallback="disabled">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    disabled={toggling}
                    onClick={() => onToggleActive(r)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary ${active ? 'bg-admin-primary' : 'bg-white/20'}`}
                  >
                    {toggling ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-admin-card shadow">
                        <Loader2 className="h-3 w-3 animate-spin text-admin-muted" />
                      </span>
                    ) : (
                      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-admin-card shadow ring-0 transition-transform duration-200 ${active ? 'translate-x-4' : 'translate-x-0'}`} />
                    )}
                  </button>
                </ProtectedAction>
              );
            },
          } as ColumnDef<MarketRow>,
        ]
      : []),
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const r = row.original;
        const status = (r.status ?? '').toLowerCase();
        const isActive = status === 'active' && r.is_active !== false && r.trading_enabled !== false;
        return (
          <ProtectedAction permission="markets:manage" fallback="disabled">
            <div className="flex items-center gap-1">
              {!isActive && status !== 'active' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onEnable(r)}
                  title="Enable market"
                >
                  <Play className="h-4 w-4" />
                </Button>
              )}
              {isActive && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDisable(r)}
                  title="Disable market"
                >
                  <Square className="h-4 w-4" />
                </Button>
              )}
              {isActive && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onPause(r)}
                  title="Pause trading"
                >
                  <Pause className="h-4 w-4" />
                </Button>
              )}
              {!isActive && status !== 'disabled' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onResume(r)}
                  title="Resume trading"
                >
                  <Play className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEditFees(r)}
                title="Edit fees"
              >
                <Edit className="h-4 w-4" />
              </Button>
              {onDelete && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDelete(r)}
                  title="Delete pair"
                  className="text-admin-danger hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </ProtectedAction>
        );
      },
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-card">
      <table className="w-full text-left text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-admin-border bg-white/[0.02]">
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
            <tr key={row.id} className="border-b border-admin-border last:border-0 hover:bg-admin-card/[0.03]">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 text-admin-text">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="py-12 text-center text-admin-muted">No markets found.</div>
      )}
    </div>
  );
}
