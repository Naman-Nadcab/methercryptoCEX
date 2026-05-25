'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getTradingMarkets, getTradingOrders, getTradingOverview, type OrderRow } from '@/lib/trading-api';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import {
  ShoppingCart, TrendingUp, Percent, XCircle, BarChart3,
  ChevronLeft, ChevronRight, RefreshCw, Download, Copy, Check,
  ArrowUpRight, ArrowDownRight, Search, SlidersHorizontal, Clock,
} from 'lucide-react';
import { cn as _cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 20;

/**
 * Backend enum is lowercase. The legacy uppercase values were silently failing
 * the status filter (SQL rejects unknown enum labels). We keep labels the same
 * but use the enum values the DB actually recognizes. `open` is a pseudo status
 * that the backend expands to ('new','partially_filled').
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'filled', label: 'Filled' },
  { value: 'partially_filled', label: 'Partially Filled' },
  { value: 'cancelled', label: 'Cancelled' },
];

const SIDE_OPTIONS = [
  { value: 'all', label: 'Both Sides' },
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
];

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  OPEN:             { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400' },
  NEW:              { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400' },
  FILLED:           { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  PARTIALLY_FILLED: { bg: 'bg-blue-500/10',    text: 'text-blue-400',    dot: 'bg-blue-400' },
  CANCELLED:        { bg: 'bg-red-500/10',      text: 'text-red-400',     dot: 'bg-red-400' },
  REJECTED:         { bg: 'bg-red-500/10',      text: 'text-red-400',     dot: 'bg-red-400' },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtNum(v: string | number | null | undefined, decimals = 8): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtTime(s: string | undefined): { date: string; time: string } {
  if (!s) return { date: '—', time: '' };
  try {
    const d = new Date(s);
    return {
      date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  } catch {
    return { date: '—', time: '' };
  }
}

function fillPct(filled: string | null | undefined, amount: string): number {
  const f = parseFloat(String(filled ?? '0'));
  const a = parseFloat(String(amount ?? '0'));
  if (!a || Number.isNaN(f) || Number.isNaN(a)) return 0;
  return Math.min(100, (f / a) * 100);
}

function exportCsv(orders: OrderRow[]) {
  const header = 'Order ID,User,Market,Side,Type,Price,Quantity,Filled,Status,Created';
  const rows = orders.map((o) =>
    [o.order_id, o.user_email ?? o.user_id, o.market, o.side, o.order_type ?? '',
     o.price, o.amount, o.filled ?? '', o.status, o.created_at].join(',')
  );
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                           */
/* ------------------------------------------------------------------ */

function KpiCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string | number; icon: typeof ShoppingCart;
  color: string; sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-admin-border bg-admin-card px-4 py-3">
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl shrink-0', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">{label}</p>
        <p className="text-lg font-bold text-admin-text tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-admin-muted">{sub}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <button type="button" onClick={handle} className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-admin-muted hover:text-admin-text">
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Fill progress bar                                                  */
/* ------------------------------------------------------------------ */

function FillBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-blue-400' : 'bg-white/10')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-admin-muted w-7 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function OrdersPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [market, setMarket] = useState('');
  const [side, setSide] = useState('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['order_created', 'order_cancelled', 'order_filled'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'orders-page'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
        setLastUpdated(new Date());
      }
    },
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchDraft.trim()), 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => { setPage(1); }, [status, market, side, debouncedQ]);

  const { data: marketsRes } = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    queryFn: () => getTradingMarkets(token),
    enabled: !!token,
    staleTime: 60_000,
  });

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading', 'overview', token],
    queryFn: () => getTradingOverview(token),
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data, isLoading, isFetching, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['admin', 'orders-page', token, page, status, market, side, debouncedQ],
    staleTime: 30_000,
    queryFn: () =>
      getTradingOrders(token, {
        page,
        limit: PAGE_SIZE,
        status: status === 'all' ? undefined : status,
        market: market || undefined,
        side: side === 'all' ? undefined : side,
        q: debouncedQ || undefined,
      }),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!dataUpdatedAt || !data?.success) return;
    setLastUpdated(new Date(dataUpdatedAt));
  }, [dataUpdatedAt, data?.success]);

  const marketOptions = useMemo(() => {
    const rows = marketsRes?.data?.markets ?? [];
    return [{ value: '', label: 'All Markets' }, ...rows.map((m) => ({ value: m.symbol, label: m.symbol }))];
  }, [marketsRes?.data?.markets]);

  // Backend returns: { total_orders, active_orders, filled_orders, orders_24h }
  const ov = overviewData?.data?.orderStats as {
    total_orders?: string | number;
    active_orders?: string | number;
    filled_orders?: string | number;
    orders_24h?: string | number;
  } | undefined;

  const orders = (data?.data?.orders ?? []) as OrderRow[];
  const pagination = data?.data?.pagination;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const total = pagination?.total ?? 0;

  // Derived KPIs from real backend fields
  const totalOrders = ov?.total_orders != null ? Number(ov.total_orders) : null;
  const activeOrders = ov?.active_orders != null ? Number(ov.active_orders) : null;
  const filledOrders = ov?.filled_orders != null ? Number(ov.filled_orders) : null;
  const orders24h = ov?.orders_24h != null ? Number(ov.orders_24h) : null;

  // Fill rate = filled / total * 100
  const fillRate = totalOrders && totalOrders > 0 && filledOrders != null
    ? ((filledOrders / totalOrders) * 100).toFixed(1)
    : null;

  // Cancel rate = (total - active - filled) / total * 100
  const cancelledOrders = totalOrders != null && activeOrders != null && filledOrders != null
    ? Math.max(0, totalOrders - activeOrders - filledOrders)
    : null;
  const cancelRate = totalOrders && totalOrders > 0 && cancelledOrders != null
    ? ((cancelledOrders / totalOrders) * 100).toFixed(1)
    : null;

  const openCount = activeOrders ?? 0;
  const pageStatus = openCount > 1000 ? 'risk' as const : openCount > 100 ? 'warning' as const : 'active' as const;

  const hasActiveFilters = status !== 'all' || market !== '' || side !== 'all' || debouncedQ !== '';

  const handleRefresh = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['admin', 'trading', 'overview'] });
  }, [refetch, queryClient]);

  const handleClearFilters = useCallback(() => {
    setStatus('all');
    setMarket('');
    setSide('all');
    setSearchDraft('');
    setDebouncedQ('');
  }, []);

  return (
    <AdminPageFrame
      title="Orders"
      description="Monitor and inspect all spot trading orders in real time."
      status={pageStatus}
      error={isError ? ((error as { message?: string })?.message ?? 'Failed to load orders') : null}
      onRetry={() => void refetch()}
    >
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Open Orders"
          value={activeOrders != null ? activeOrders.toLocaleString() : '—'}
          icon={ShoppingCart}
          color="bg-amber-500/10 text-amber-400"
          sub={totalOrders != null ? `${totalOrders.toLocaleString()} total · ${orders24h ?? 0} today` : undefined}
        />
        <KpiCard
          label="Fill Rate"
          value={fillRate != null ? `${fillRate}%` : '—'}
          icon={TrendingUp}
          color="bg-emerald-500/10 text-emerald-400"
          sub={filledOrders != null ? `${filledOrders.toLocaleString()} filled` : undefined}
        />
        <KpiCard
          label="Total Orders"
          value={totalOrders != null ? totalOrders.toLocaleString() : '—'}
          icon={BarChart3}
          color="bg-blue-500/10 text-blue-400"
          sub={orders24h != null ? `${orders24h} in last 24h` : undefined}
        />
        <KpiCard
          label="Cancel Rate"
          value={cancelRate != null ? `${cancelRate}%` : '—'}
          icon={XCircle}
          color="bg-red-500/10 text-red-400"
          sub={cancelledOrders != null ? `${cancelledOrders.toLocaleString()} cancelled` : undefined}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search order ID, user email or ID…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="w-full rounded-lg border border-admin-border bg-admin-card pl-9 pr-3 py-2 text-xs text-admin-text placeholder:text-admin-muted/60 focus:outline-none focus:ring-1 focus:ring-admin-primary/40 transition-colors"
          />
          {searchDraft && (
            <button type="button" onClick={() => setSearchDraft('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text">
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Filter toggle */}
          <button type="button" onClick={() => setShowFilters((p) => !p)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
              showFilters || hasActiveFilters
                ? 'border-admin-primary/40 bg-admin-primary/5 text-admin-primary'
                : 'border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text')}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-admin-primary text-[9px] font-bold text-white">
                {[status !== 'all', market !== '', side !== 'all', debouncedQ !== ''].filter(Boolean).length}
              </span>
            )}
          </button>

          {/* Refresh */}
          <button type="button" onClick={handleRefresh} disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border px-3 py-2 text-xs font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-50">
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            {isFetching && !isLoading ? 'Updating…' : 'Refresh'}
          </button>

          {/* Export */}
          <button type="button" onClick={() => exportCsv(orders)} disabled={orders.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border px-3 py-2 text-xs font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-30">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-admin-border bg-admin-card px-4 py-3">
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-admin-border bg-[#0B0E14] px-3 py-2 text-xs text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-primary/40">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Market</label>
            <select value={market} onChange={(e) => setMarket(e.target.value)}
              className="rounded-lg border border-admin-border bg-[#0B0E14] px-3 py-2 text-xs text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-primary/40">
              {marketOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Side</label>
            <select value={side} onChange={(e) => setSide(e.target.value)}
              className="rounded-lg border border-admin-border bg-[#0B0E14] px-3 py-2 text-xs text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-primary/40">
              {SIDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={handleClearFilters}
              className="rounded-lg border border-admin-border px-3 py-2 text-xs font-medium text-admin-muted hover:bg-white/5 hover:text-red-400 hover:border-red-500/30 transition-colors">
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Active filter pills */}
      {hasActiveFilters && !showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-admin-muted uppercase tracking-wider">Active filters:</span>
          {status !== 'all' && (
            <FilterPill label={`Status: ${status.replace('_', ' ')}`} onRemove={() => setStatus('all')} />
          )}
          {market && (
            <FilterPill label={`Market: ${market}`} onRemove={() => setMarket('')} />
          )}
          {side !== 'all' && (
            <FilterPill label={`Side: ${side}`} onRemove={() => setSide('all')} />
          )}
          {debouncedQ && (
            <FilterPill label={`Search: "${debouncedQ}"`} onRemove={() => { setSearchDraft(''); setDebouncedQ(''); }} />
          )}
          <button type="button" onClick={handleClearFilters} className="text-[10px] text-red-400 hover:underline">Clear all</button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-admin-primary" />
            <h3 className="text-xs font-semibold text-admin-text">Order Book</h3>
            {isFetching && !isLoading && (
              <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-medium text-blue-400">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="flex items-center gap-1 text-[10px] text-admin-muted">
                <Clock className="h-3 w-3" />
                Updated {lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <span className="text-[10px] text-admin-muted tabular-nums">
              {total.toLocaleString()} total · page {page}/{totalPages}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-admin-border bg-white/[0.02]">
                {['Order ID', 'User', 'Market', 'Side', 'Type', 'Price', 'Qty', 'Fill', 'Status', 'Created'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-admin-muted whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border/50">
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 rounded bg-white/[0.04] animate-pulse" style={{ width: `${40 + Math.random() * 40}%` }} />
                    </td>
                  ))}
                </tr>
              ))}

              {!isLoading && orders.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <ShoppingCart className="h-8 w-8 mx-auto mb-3 text-admin-muted/30" />
                    <p className="text-sm font-medium text-admin-muted">No orders match your filters</p>
                    {hasActiveFilters && (
                      <button type="button" onClick={handleClearFilters} className="mt-2 text-xs text-admin-primary hover:underline">
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              )}

              {!isLoading && orders.map((o) => {
                const sideUp = String(o.side ?? '').toUpperCase();
                const isBuy = sideUp === 'BUY';
                const statusKey = String(o.status ?? '').toUpperCase();
                const style = STATUS_STYLE[statusKey] ?? { bg: 'bg-white/5', text: 'text-admin-muted', dot: 'bg-admin-muted' };
                const pct = fillPct(o.filled, o.amount);
                const ts = fmtTime(o.created_at);
                const shortId = o.order_id.slice(-8);

                return (
                  <tr key={o.order_id} className="group hover:bg-white/[0.025] transition-colors">
                    {/* Order ID */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[11px] text-admin-muted" title={o.order_id}>…{shortId}</span>
                        <CopyBtn text={o.order_id} />
                      </div>
                    </td>

                    {/* User */}
                    <td className="px-4 py-3 max-w-[160px]">
                      <span className="block truncate text-xs text-admin-text" title={o.user_email ?? o.user_id}>
                        {o.user_email ?? o.user_id ?? '—'}
                      </span>
                    </td>

                    {/* Market */}
                    <td className="px-4 py-3">
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-semibold text-admin-text">
                        {o.market ?? '—'}
                      </span>
                    </td>

                    {/* Side */}
                    <td className="px-4 py-3">
                      <span className={cn('flex items-center gap-1 text-xs font-bold', isBuy ? 'text-emerald-400' : 'text-red-400')}>
                        {isBuy
                          ? <ArrowUpRight className="h-3.5 w-3.5" />
                          : <ArrowDownRight className="h-3.5 w-3.5" />}
                        {sideUp || '—'}
                      </span>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3 text-xs text-admin-muted capitalize">
                      {o.order_type ? String(o.order_type).replace(/_/g, ' ').toLowerCase() : '—'}
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 font-mono text-xs text-admin-text tabular-nums">
                      {fmtNum(o.price, 4)}
                    </td>

                    {/* Quantity */}
                    <td className="px-4 py-3 font-mono text-xs text-admin-text tabular-nums">
                      {fmtNum(o.amount, 4)}
                    </td>

                    {/* Fill progress */}
                    <td className="px-4 py-3">
                      <FillBar pct={pct} />
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        style.bg, style.text, 'border-current/20')}>
                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', style.dot,
                          statusKey === 'OPEN' && 'animate-pulse')} />
                        {statusKey.replace(/_/g, ' ')}
                      </span>
                    </td>

                    {/* Time */}
                    <td className="px-4 py-3">
                      <div className="text-[10px] text-admin-muted leading-tight">
                        <div>{ts.date}</div>
                        <div className="text-admin-muted/60">{ts.time}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-xs text-admin-muted">
              Showing <b className="text-admin-text">{orders.length}</b> of <b className="text-admin-text">{total.toLocaleString()}</b> orders
            </p>
            {hasActiveFilters && (
              <span className="text-[10px] text-amber-400">(filtered)</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setPage(1)} disabled={page <= 1}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-30 text-[10px] font-bold">
              «
            </button>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-30">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            {/* Page numbers */}
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p: number;
                if (totalPages <= 5) p = i + 1;
                else if (page <= 3) p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else p = page - 2 + i;
                return (
                  <button key={p} type="button" onClick={() => setPage(p)}
                    className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-medium transition-colors',
                      p === page
                        ? 'bg-admin-primary/15 border border-admin-primary/40 text-admin-primary'
                        : 'border border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text')}>
                    {p}
                  </button>
                );
              })}
            </div>

            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-30">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-30 text-[10px] font-bold">
              »
            </button>
          </div>
        </div>
      </div>
    </AdminPageFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter pill                                                        */
/* ------------------------------------------------------------------ */

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-admin-border bg-white/[0.04] px-2 py-0.5 text-[10px] text-admin-muted">
      {label}
      <button type="button" onClick={onRemove} className="ml-0.5 hover:text-red-400 transition-colors">
        <XCircle className="h-3 w-3" />
      </button>
    </span>
  );
}
