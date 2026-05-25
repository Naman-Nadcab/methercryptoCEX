'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  Filter,
  RefreshCw,
  Search,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getTradingTrades, getTradingOverview, type TradeRow } from '@/lib/trading-api';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { useAdminWs } from '@/hooks/useAdminWs';

const PAGE_SIZE = 20;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(v: string | number | null | undefined, decimals = 8): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function fmtUsd(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function fmtTime(s: string | undefined): { date: string; time: string } {
  if (!s) return { date: '—', time: '' };
  try {
    const d = new Date(s);
    return {
      date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  } catch {
    return { date: '—', time: '' };
  }
}

function toIsoBoundary(local: string, endOfDay?: boolean): string | undefined {
  const t = local?.trim();
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay && t.length <= 10) d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-2xl font-bold text-admin-text tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-admin-muted">{sub}</p>}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-admin-muted hover:text-admin-text"
      title="Copy"
    >
      <ClipboardCopy className={`h-3 w-3 ${copied ? 'text-emerald-400' : ''}`} />
    </button>
  );
}

function WhaleBadge() {
  return (
    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
      <Zap className="h-2.5 w-2.5" /> Whale
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TradesPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const lastUpdatedRef = useRef<Date | null>(null);
  const [lastUpdatedDisplay, setLastUpdatedDisplay] = useState('');

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (type === 'trade_executed') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'trades-page'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
      }
    },
  });

  const [page, setPage] = useState(1);
  const [market, setMarket] = useState('');
  const [side, setSide] = useState('all');
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const fromIso = useMemo(() => toIsoBoundary(fromLocal), [fromLocal]);
  const toIso = useMemo(() => toIsoBoundary(toLocal, true), [toLocal]);

  useEffect(() => { setPage(1); }, [market, side, fromLocal, toLocal]);

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading', 'overview', token],
    queryFn: () => getTradingOverview(token),
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['admin', 'trades-page', token, page, market, side, fromIso, toIso],
    staleTime: 15_000,
    queryFn: () =>
      getTradingTrades(token, {
        page,
        limit: PAGE_SIZE,
        market: market.trim() || undefined,
        side: side === 'all' ? undefined : side,
        from: fromIso,
        to: toIso,
      }),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!isFetching && data) {
      lastUpdatedRef.current = new Date();
      setLastUpdatedDisplay(new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  }, [isFetching, data]);

  const ts = overviewData?.data?.tradeStats;
  const totalTrades = ts?.total_trades != null ? Number(ts.total_trades) : null;
  const trades24h = ts?.trades_24h != null ? Number(ts.trades_24h) : null;
  const volume24h = ts?.volume_24h != null ? Number(ts.volume_24h) : null;

  const payload = data?.data;
  const trades = (payload?.trades ?? []) as TradeRow[];
  const pagination = payload?.pagination;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const total = pagination?.total ?? 0;
  const whaleTrades = trades.filter((t) => t.is_whale_trade).length;

  // Avg trade size from current page
  const avgNotional = useMemo(() => {
    const with_notional = trades.filter((t) => t.notional_value != null);
    if (!with_notional.length) return null;
    const sum = with_notional.reduce((acc, t) => acc + parseFloat(String(t.notional_value ?? 0)), 0);
    return sum / with_notional.length;
  }, [trades]);

  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (market.trim()) activeFilters.push({ label: `Market: ${market.trim().toUpperCase()}`, onRemove: () => setMarket('') });
  if (side !== 'all') activeFilters.push({ label: `Side: ${side.toUpperCase()}`, onRemove: () => setSide('all') });
  if (fromLocal) activeFilters.push({ label: `From: ${fromLocal}`, onRemove: () => setFromLocal('') });
  if (toLocal) activeFilters.push({ label: `To: ${toLocal}`, onRemove: () => setToLocal('') });

  function exportCsv() {
    const headers = ['Trade ID', 'Market', 'Side', 'Maker', 'Taker', 'Price', 'Quantity', 'Notional', 'Maker Fee', 'Taker Fee', 'Whale', 'Time'];
    const rows = trades.map((t) => [
      t.trade_id,
      t.market ?? '',
      t.side ?? '',
      t.maker_email ?? t.maker_user_id ?? '',
      t.taker_email ?? t.taker_user_id ?? '',
      t.price ?? '',
      t.amount ?? '',
      t.notional_value ?? '',
      t.maker_fee ?? '',
      t.taker_fee ?? '',
      t.is_whale_trade ? 'Yes' : 'No',
      t.created_at ?? '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminPageFrame
      title="Trade History"
      description="Executed spot trades with real-time updates, filters, and 15s auto-refresh."
      status="active"
      error={isError ? 'Failed to load trade history.' : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Trades"
          value={totalTrades != null ? totalTrades.toLocaleString() : '—'}
          icon={BarChart3}
          color="bg-blue-500/10 text-blue-400"
          sub={trades24h != null ? `${trades24h} in last 24h` : undefined}
        />
        <KpiCard
          label="Volume (24h)"
          value={volume24h != null ? fmtUsd(volume24h) : '—'}
          icon={TrendingUp}
          color="bg-emerald-500/10 text-emerald-400"
          sub="Total notional traded"
        />
        <KpiCard
          label="Avg Trade Size"
          value={avgNotional != null ? fmtUsd(avgNotional) : '—'}
          icon={Activity}
          color="bg-violet-500/10 text-violet-400"
          sub="Current page average"
        />
        <KpiCard
          label="Whale Trades"
          value={whaleTrades > 0 ? `${whaleTrades}` : '0'}
          icon={AlertTriangle}
          color="bg-amber-500/10 text-amber-400"
          sub={`Trades ≥ $100k notional`}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-muted pointer-events-none" />
          <input
            className="w-full rounded-lg border border-admin-border bg-admin-card pl-9 pr-3 py-2 text-sm text-admin-text placeholder-admin-muted focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder="Filter by market (e.g. BTC_USDT)…"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
          />
          {market && (
            <button type="button" onClick={() => setMarket('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            showFilters || activeFilters.length > 0
              ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
              : 'border-admin-border bg-admin-card text-admin-muted hover:text-admin-text'
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
          {activeFilters.length > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
              {activeFilters.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm font-medium text-admin-muted hover:text-admin-text transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <button
          type="button"
          onClick={exportCsv}
          disabled={trades.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm font-medium text-admin-muted hover:text-admin-text transition-colors disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-admin-border bg-admin-card/50 p-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted">Side</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value)}
              className="rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="all">All Sides</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted">From</label>
            <input
              type="datetime-local"
              value={fromLocal}
              onChange={(e) => setFromLocal(e.target.value)}
              className="rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted">To</label>
            <input
              type="datetime-local"
              value={toLocal}
              onChange={(e) => setToLocal(e.target.value)}
              className="rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
        </div>
      )}

      {/* Active filter pills */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <span
              key={f.label}
              className="flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-300"
            >
              {f.label}
              <button type="button" onClick={f.onRemove} className="ml-0.5 text-blue-400 hover:text-white">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => { setMarket(''); setSide('all'); setFromLocal(''); setToLocal(''); }}
            className="text-xs text-admin-muted hover:text-admin-text underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-admin-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-admin-text">Trades</h3>
            {isFetching && !isLoading && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-admin-muted">
            {lastUpdatedDisplay && <span>Updated {lastUpdatedDisplay}</span>}
            <span>{total.toLocaleString()} total</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-admin-muted">
              <tr>
                {['Trade ID', 'Market', 'Side', 'Maker', 'Taker', 'Price', 'Quantity', 'Notional', 'Fee', 'Time'].map((h) => (
                  <th key={h} className="px-3 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {isLoading && (
                <tr>
                  <td colSpan={10} className="px-3 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-admin-muted">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span className="text-sm">Loading trades…</span>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && isError && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-admin-danger">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="text-sm">Failed to load trades.</span>
                      <button
                        type="button"
                        onClick={() => refetch()}
                        className="mt-1 rounded-lg border border-admin-border bg-admin-card px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && !isError && trades.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-12 text-center text-admin-muted">
                    No trades match the current filters.
                  </td>
                </tr>
              )}
              {!isLoading &&
                !isError &&
                trades.map((trow) => {
                  const isBuy = String(trow.side ?? '').toLowerCase() === 'buy';
                  const makerDisplay = trow.maker_email ?? (trow.maker_user_id ? trow.maker_user_id.slice(0, 8) + '…' : '—');
                  const takerDisplay = trow.taker_email ?? (trow.taker_user_id ? trow.taker_user_id.slice(0, 8) + '…' : '—');
                  const shortId = trow.trade_id.slice(0, 8) + '…';
                  const { date, time } = fmtTime(trow.created_at);
                  const totalFee =
                    trow.maker_fee != null && trow.taker_fee != null
                      ? fmtNum(parseFloat(String(trow.maker_fee)) + parseFloat(String(trow.taker_fee)), 4)
                      : trow.fee != null
                      ? fmtNum(trow.fee, 4)
                      : '—';

                  return (
                    <tr
                      key={trow.trade_id}
                      className={`group transition-colors hover:bg-white/[0.03] ${trow.is_whale_trade ? 'bg-amber-500/[0.04]' : ''}`}
                    >
                      {/* Trade ID */}
                      <td className="px-3 py-2.5 font-mono text-xs text-admin-muted">
                        <div className="flex items-center">
                          <span title={trow.trade_id}>{shortId}</span>
                          <CopyBtn text={trow.trade_id} />
                        </div>
                      </td>
                      {/* Market */}
                      <td className="px-3 py-2.5">
                        <span className="rounded-md border border-admin-border bg-white/[0.04] px-1.5 py-0.5 text-xs font-mono font-medium text-admin-text">
                          {trow.market ?? '—'}
                        </span>
                      </td>
                      {/* Side */}
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            isBuy
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-red-500/10 text-red-400'
                          }`}
                        >
                          {isBuy ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                          {String(trow.side ?? '').toUpperCase()}
                        </span>
                      </td>
                      {/* Maker */}
                      <td className="px-3 py-2.5 text-xs text-admin-text">
                        <div className="flex items-center max-w-[140px]">
                          <span className="truncate" title={trow.maker_email ?? trow.maker_user_id ?? ''}>{makerDisplay}</span>
                          {trow.maker_email && <CopyBtn text={trow.maker_email} />}
                        </div>
                      </td>
                      {/* Taker */}
                      <td className="px-3 py-2.5 text-xs text-admin-text">
                        <div className="flex items-center max-w-[140px]">
                          <span className="truncate" title={trow.taker_email ?? trow.taker_user_id ?? ''}>{takerDisplay}</span>
                          {trow.taker_email && <CopyBtn text={trow.taker_email} />}
                        </div>
                      </td>
                      {/* Price */}
                      <td className="px-3 py-2.5 tabular-nums text-admin-text">{fmtNum(trow.price, 2)}</td>
                      {/* Quantity */}
                      <td className="px-3 py-2.5 tabular-nums text-admin-text">{fmtNum(trow.amount, 8)}</td>
                      {/* Notional */}
                      <td className="px-3 py-2.5 tabular-nums text-admin-text">
                        <div className="flex items-center gap-1">
                          {fmtUsd(trow.notional_value ?? trow.notional)}
                          {trow.is_whale_trade && <WhaleBadge />}
                        </div>
                      </td>
                      {/* Fee */}
                      <td className="px-3 py-2.5 tabular-nums text-xs text-admin-muted">{totalFee}</td>
                      {/* Time */}
                      <td className="px-3 py-2.5 text-xs text-admin-muted whitespace-nowrap">
                        <div>{date}</div>
                        <div className="text-[10px] opacity-70">{time}</div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
          <p className="text-xs text-admin-muted">
            Page {pagination?.page ?? page} of {totalPages} · {total.toLocaleString()} trades
          </p>
          <div className="flex items-center gap-1">
            <PaginationBtn icon={ChevronFirst} disabled={page <= 1} onClick={() => setPage(1)} title="First" />
            <PaginationBtn icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} title="Previous" />
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const pg = start + i;
              return (
                <button
                  key={pg}
                  type="button"
                  onClick={() => setPage(pg)}
                  className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                    pg === page
                      ? 'bg-blue-600 text-white'
                      : 'border border-admin-border bg-admin-card text-admin-muted hover:text-admin-text'
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <PaginationBtn icon={ChevronRight} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} title="Next" />
            <PaginationBtn icon={ChevronLast} disabled={page >= totalPages} onClick={() => setPage(totalPages)} title="Last" />
          </div>
        </div>
      </div>
    </AdminPageFrame>
  );
}

function PaginationBtn({
  icon: Icon,
  disabled,
  onClick,
  title,
}: {
  icon: React.ElementType;
  disabled: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-admin-border bg-admin-card text-admin-muted transition-colors hover:text-admin-text disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
