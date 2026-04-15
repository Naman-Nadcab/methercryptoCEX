'use client';

import { X, SlidersHorizontal, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DepositFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  asset: string;
  onAssetChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
}

const selectCls =
  'rounded-xl border border-admin-border/60 bg-white/[0.03] px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all';

export function DepositFilters({
  search,
  onSearchChange,
  asset,
  onAssetChange,
  status,
  onStatusChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  onClear,
}: DepositFiltersProps) {
  const hasFilters = !!(search || asset || status || dateFrom || dateTo);
  const activeCount = [search, asset, status, dateFrom, dateTo].filter(Boolean).length;

  return (
    <div className="rounded-2xl border border-admin-border/60 bg-admin-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* Search */}
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="TX hash or user email…"
            className="w-full rounded-xl border border-admin-border/60 bg-white/[0.03] pl-9 pr-3 py-2 text-sm text-admin-text placeholder-admin-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all"
          />
        </div>

        {/* Asset */}
        <select value={asset} onChange={(e) => onAssetChange(e.target.value)} className={selectCls}>
          <option value="">All assets</option>
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
          <option value="USDT">USDT</option>
          <option value="USDC">USDC</option>
          <option value="BNB">BNB</option>
          <option value="DAI">DAI</option>
        </select>

        {/* Status */}
        <select value={status} onChange={(e) => onStatusChange(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirming">Confirming</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className={cn(selectCls, 'w-[140px] text-xs')}
          />
          <span className="text-xs text-admin-muted">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className={cn(selectCls, 'w-[140px] text-xs')}
          />
        </div>

        {/* Clear */}
        {hasFilters && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 rounded-xl border border-red-500/25 bg-red-950/15 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/25 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Clear{activeCount > 1 ? ` (${activeCount})` : ''}
          </button>
        )}

        {/* Filter count pill */}
        {hasFilters && (
          <div className="flex items-center gap-1 rounded-full border border-blue-500/25 bg-blue-950/15 px-2.5 py-1 text-[10px] font-semibold text-blue-400">
            <SlidersHorizontal className="h-3 w-3" />
            {activeCount} filter{activeCount !== 1 ? 's' : ''} active
          </div>
        )}
      </div>
    </div>
  );
}
