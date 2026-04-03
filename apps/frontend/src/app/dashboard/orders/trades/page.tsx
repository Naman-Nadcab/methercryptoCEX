'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, History, Loader2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { CoinIcon } from '@/components/ui/CoinIcon';

type TradeRow = {
  id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  fee: string | null;
  fee_asset?: string | null;
  fee_currency?: string | null;
  created_at: string;
  order_id?: string | null;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

function parseTradesResponse(raw: unknown): { trades: TradeRow[]; pagination: Pagination | null } {
  if (!raw || typeof raw !== 'object') return { trades: [], pagination: null };
  const r = raw as { success?: boolean; data?: unknown; pagination?: Pagination };
  if (!r.success) return { trades: [], pagination: null };

  let trades: TradeRow[] = [];
  if (Array.isArray(r.data)) {
    trades = r.data as TradeRow[];
  } else if (r.data && typeof r.data === 'object' && Array.isArray((r.data as { trades?: unknown }).trades)) {
    trades = (r.data as { trades: TradeRow[] }).trades;
  }
  return { trades, pagination: r.pagination ?? null };
}

function normalizeMarketFilter(input: string): string | null {
  const t = input.trim().toUpperCase().replace(/\//g, '_').replace(/\s+/g, '');
  if (/^[A-Z0-9]+_[A-Z0-9]+$/.test(t)) return t;
  return null;
}

function parseDayBoundary(isoDate: string, endOfDay: boolean): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function tradeTotal(price: string, qty: string): string {
  const p = parseFloat(price);
  const q = parseFloat(qty);
  if (!Number.isFinite(p) || !Number.isFinite(q)) return '—';
  return (p * q).toString();
}

function feeDisplay(t: TradeRow): string {
  const cur = t.fee_currency ?? t.fee_asset ?? '';
  if (t.fee == null || t.fee === '') return cur ? `— ${cur}` : '—';
  return cur ? `${t.fee} ${cur}` : String(t.fee);
}

export default function TradeHistoryPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pairFilter, setPairFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'' | 'buy' | 'sell'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchPage = useCallback(
    async (nextPage: number, append: boolean) => {
      if (!accessToken) return;
      append ? setLoadingMore(true) : setLoading(true);
      try {
        const market = normalizeMarketFilter(pairFilter);
        const baseQs = new URLSearchParams({ limit: '50', page: String(nextPage) });
        if (market) baseQs.set('market', market);

        let raw: unknown = await api.get<unknown>(`/api/v1/spot/trade-history?${baseQs}`, { notifyOnError: false });
        if (!(raw as { success?: boolean }).success) {
          raw = await api.get<unknown>(`/api/v1/spot/trades?${baseQs}`, { notifyOnError: false });
        }
        const { trades: rows, pagination } = parseTradesResponse(raw);

        setTrades((prev) => (append ? [...prev, ...rows] : rows));
        if (pagination) {
          setTotalPages(Math.max(1, pagination.totalPages ?? 1));
          setPage(pagination.page ?? nextPage);
        } else if (!append) {
          setTotalPages(1);
          setPage(1);
        }
      } catch {
        if (!append) {
          setTrades([]);
          setTotalPages(1);
          setPage(1);
        }
      } finally {
        append ? setLoadingMore(false) : setLoading(false);
      }
    },
    [accessToken, pairFilter]
  );

  useEffect(() => {
    if (!_hasHydrated || !accessToken) {
      if (_hasHydrated && !accessToken) setLoading(false);
      return;
    }
    setTrades([]);
    setPage(1);
    setTotalPages(1);
    fetchPage(1, false);
  }, [_hasHydrated, accessToken, pairFilter, fetchPage]);

  const fromTs = useMemo(() => parseDayBoundary(dateFrom, false), [dateFrom]);
  const toTs = useMemo(() => parseDayBoundary(dateTo, true), [dateTo]);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      const displayPair = t.market.replace(/_/g, '/');
      if (pairFilter.trim()) {
        const q = pairFilter.trim().toLowerCase();
        if (!displayPair.toLowerCase().includes(q) && !t.market.toLowerCase().includes(q)) return false;
      }
      if (sideFilter && String(t.side).toLowerCase() !== sideFilter) return false;
      const ts = new Date(t.created_at).getTime();
      if (fromTs != null && ts < fromTs) return false;
      if (toTs != null && ts > toTs) return false;
      return true;
    });
  }, [trades, pairFilter, sideFilter, fromTs, toTs]);

  const canLoadMore = page < totalPages;

  const exportCsv = () => {
    if (!filteredTrades.length) return;
    const header = 'Date,Pair,Side,Price,Amount,Fee,Total,Order ID\n';
    const lines = filteredTrades.map((t) => {
      const pair = t.market.replace(/_/g, '/');
      const side = String(t.side).toUpperCase();
      const total = tradeTotal(t.price, t.quantity);
      const fee = feeDisplay(t).replace(/,/g, ' ');
      const oid = t.order_id ?? '';
      return `${t.created_at},${pair},${side},${t.price},${t.quantity},${fee},${total},${oid}`;
    });
    const blob = new Blob([header + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showEmpty = !loading && filteredTrades.length === 0;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/orders"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            Orders
          </Link>
          <h1 className="text-xl font-semibold text-foreground">Trade History</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!filteredTrades.length}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted text-sm font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Download className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => fetchPage(1, false)}
            disabled={loading || !accessToken}
            className="p-2 rounded-lg border border-border bg-muted text-foreground hover:bg-muted/80 disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={pairFilter}
            onChange={(e) => setPairFilter(e.target.value)}
            placeholder="Pair (e.g. BTC_USDT)"
            className="px-3 py-1.5 text-xs bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground min-w-[140px] focus:ring-1 focus:ring-primary/40 outline-none"
          />
          <select
            value={sideFilter}
            onChange={(e) => setSideFilter(e.target.value as '' | 'buy' | 'sell')}
            className="px-3 py-1.5 text-xs bg-muted border border-border rounded-lg text-foreground w-28"
          >
            <option value="">All sides</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground text-xs"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2.5 px-3 font-medium">Date</th>
                <th className="py-2.5 px-3 font-medium">Pair</th>
                <th className="py-2.5 px-3 font-medium">Side</th>
                <th className="py-2.5 px-3 font-medium">Price</th>
                <th className="py-2.5 px-3 font-medium">Amount</th>
                <th className="py-2.5 px-3 font-medium">Fee</th>
                <th className="py-2.5 px-3 font-medium">Total</th>
                <th className="py-2.5 px-3 font-medium">Order ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="py-2.5 px-3">
                        <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : showEmpty ? (
                <tr>
                  <td colSpan={8} className="p-0 align-top">
                    <EmptyState
                      icon={History}
                      title="No trades yet"
                      description="Your executed spot fills will appear here."
                      actionLabel="Spot trading"
                      actionHref="/trade/spot"
                    />
                  </td>
                </tr>
              ) : (
                filteredTrades.map((t) => {
                  const side = String(t.side).toLowerCase();
                  const isBuy = side === 'buy';
                  return (
                    <tr key={`${t.id}-${t.created_at}`} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                        {new Date(t.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-foreground">
                        <span className="inline-flex items-center gap-2">
                          <CoinIcon symbol={t.market.split('_')[0] ?? t.market} size={20} />
                          {t.market.replace(/_/g, '/')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={isBuy ? 'text-buy' : 'text-sell'}>{side === 'buy' || side === 'sell' ? side.toUpperCase() : String(t.side).toUpperCase()}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-foreground">{t.price}</td>
                      <td className="py-2.5 px-3 font-mono text-foreground">{t.quantity}</td>
                      <td className="py-2.5 px-3 font-mono text-muted-foreground">{feeDisplay(t)}</td>
                      <td className="py-2.5 px-3 font-mono text-foreground">{tradeTotal(t.price, t.quantity)}</td>
                      <td className="py-2.5 px-3 font-mono text-muted-foreground break-all max-w-[140px]">
                        {t.order_id ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && canLoadMore && (
          <div className="p-4 border-t border-border flex justify-center">
            <button
              type="button"
              onClick={() => fetchPage(page + 1, true)}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
