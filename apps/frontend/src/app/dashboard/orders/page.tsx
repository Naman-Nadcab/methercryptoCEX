'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, BarChart3, RefreshCw, X as XIcon, Search, ChevronRight, Download } from 'lucide-react';
import { P2P_HREF, SPOT_TRADE_HREF } from '@/lib/routes';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { fetchMyOrders } from '@/lib/p2pApi';

type SpotOrder = {
  id: string; market: string; side: string; type: string;
  price: string | null; stop_price?: string | null;
  quantity: string; filled_quantity: string; status: string;
  created_at: string;
};
type P2POrder = {
  id: string; ad_id?: string; type?: string; crypto_asset?: string;
  fiat_currency?: string; amount?: string; price?: string;
  status?: string; created_at?: string;
};

export default function OrdersHubPage() {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();
  const [tab, setTab] = useState<'open' | 'history' | 'p2p'>('open');

  const [openOrders, setOpenOrders] = useState<SpotOrder[]>([]);
  const [openLoading, setOpenLoading] = useState(true);
  const [historyOrders, setHistoryOrders] = useState<SpotOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [p2pOrders, setP2pOrders] = useState<P2POrder[]>([]);
  const [p2pLoading, setP2pLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairFilter, setPairFilter] = useState('');
  const [sideFilter, setSideFilter] = useState<'' | 'buy' | 'sell'>('');

  const fetchOpen = useCallback(async () => {
    if (!accessToken) return;
    setOpenLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/orders?status=OPEN&limit=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({}));
      setOpenOrders(json.success && json.data?.orders ? json.data.orders : []);
    } catch { setOpenOrders([]); }
    finally { setOpenLoading(false); }
  }, [accessToken]);

  const fetchHistory = useCallback(async (cursor: string | null, append: boolean) => {
    if (!accessToken) return;
    append ? setHistoryLoadingMore(true) : setHistoryLoading(true);
    try {
      const url = new URL(`${getApiBaseUrl()}/api/v1/spot/orders`);
      url.searchParams.set('status', 'HISTORY');
      url.searchParams.set('limit', '50');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = await res.json().catch(() => ({}));
      if (json.success && json.data?.orders) {
        setHistoryOrders(prev => append ? [...prev, ...json.data.orders] : json.data.orders);
        setHistoryCursor(json.data.next_cursor ?? null);
      } else if (!append) { setHistoryOrders([]); setHistoryCursor(null); }
    } catch { if (!append) { setHistoryOrders([]); setHistoryCursor(null); } }
    finally { append ? setHistoryLoadingMore(false) : setHistoryLoading(false); }
  }, [accessToken]);

  const fetchP2P = useCallback(async () => {
    if (!accessToken) return;
    setP2pLoading(true);
    try {
      const data = await fetchMyOrders();
      setP2pOrders(Array.isArray(data) ? data : []);
    } catch { setP2pOrders([]); }
    finally { setP2pLoading(false); }
  }, [accessToken]);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (accessToken) fetchOpen();
    else setOpenLoading(false);
  }, [_hasHydrated, accessToken, fetchOpen]);
  useEffect(() => { if (tab === 'history' && accessToken) fetchHistory(null, false); }, [tab, accessToken, fetchHistory]);
  useEffect(() => { if (tab === 'p2p' && accessToken) fetchP2P(); }, [tab, accessToken, fetchP2P]);

  const handleCancel = async (orderId: string) => {
    if (!accessToken || cancellingId) return;
    setCancellingId(orderId);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (json.success) {
        setOpenOrders(prev => prev.filter(o => o.id !== orderId));
        queryClient.invalidateQueries({ queryKey: ['balances'] });
      } else { setError(getMessageFromApiError(json?.error) || 'Cancel failed'); }
    } catch { setError(getMessageFromApiError({ code: 'NETWORK_ERROR' })); }
    finally { setCancellingId(null); }
  };

  const handleCancelAll = async () => {
    for (const o of openOrders.filter(o => ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status))) {
      await handleCancel(o.id);
    }
  };

  const filteredOpen = openOrders.filter(o => {
    if (pairFilter && !o.market.toLowerCase().includes(pairFilter.toLowerCase())) return false;
    if (sideFilter && o.side !== sideFilter) return false;
    return true;
  });
  const filteredHistory = historyOrders.filter(o => {
    if (pairFilter && !o.market.toLowerCase().includes(pairFilter.toLowerCase())) return false;
    if (sideFilter && o.side !== sideFilter) return false;
    return true;
  });

  const exportCSV = () => {
    const rows = (tab === 'open' ? filteredOpen : filteredHistory);
    if (!rows.length) return;
    const header = 'Market,Side,Type,Price,Quantity,Filled,Status,Date\n';
    const csv = header + rows.map(o =>
      `${o.market},${o.side},${o.type},${o.price ?? ''},${o.quantity},${o.filled_quantity},${o.status},${o.created_at}`
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orders-${tab}-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const tabs = [
    { key: 'open' as const, label: 'Open Orders', count: openOrders.length },
    { key: 'history' as const, label: 'Order History', count: null },
    { key: 'p2p' as const, label: 'P2P Orders', count: p2pOrders.length },
  ];

  const getStatusBadge = (status: string) => {
    if (['FILLED', 'completed', 'released'].includes(status?.toLowerCase())) return 'bg-buy/15 text-buy';
    if (['CANCELLED', 'cancelled', 'expired', 'disputed'].includes(status?.toLowerCase())) return 'bg-muted text-muted-foreground';
    if (['OPEN', 'PARTIALLY_FILLED', 'pending', 'paid'].includes(status?.toLowerCase())) return 'bg-primary/15 text-primary';
    return 'bg-muted text-muted-foreground';
  };

  const filledPct = (o: SpotOrder) => {
    const filled = parseFloat(o.filled_quantity || '0');
    const total = parseFloat(o.quantity || '1');
    return total > 0 ? Math.round((filled / total) * 100) : 0;
  };

  const spotRowsForExport = tab === 'open' ? filteredOpen : filteredHistory;
  const canExportSpot = spotRowsForExport.length > 0;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Orders</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Spot open orders, order history, and P2P trades. Filter by pair and side, export CSV, or jump back to trading.
          </p>
        </div>
        <Link
          href={SPOT_TRADE_HREF}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
        >
          Go to Spot Trading
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* Tabs */}
        <div className="border-b border-border bg-muted/25 px-2 pt-2 sm:px-3">
          <div
            className="flex gap-1 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Order views"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`relative shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-primary/12 text-primary shadow-sm ring-1 ring-primary/15'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <span className="flex items-center gap-2">
                  {t.label}
                  {t.count !== null && t.count > 0 && (
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {t.count}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Filters (Spot tabs only) */}
        {(tab === 'open' || tab === 'history') && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:gap-4 sm:px-5">
            <div className="relative min-w-0 flex-1 sm:max-w-[240px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={pairFilter}
                onChange={(e) => setPairFilter(e.target.value)}
                placeholder="Filter pair…"
                className="w-full rounded-xl border border-border bg-muted/50 py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                aria-label="Filter by trading pair"
              />
            </div>
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value as '' | 'buy' | 'sell')}
              className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/15 sm:min-w-[140px]"
              aria-label="Filter by side"
            >
              <option value="">All sides</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <div className="hidden min-w-[1rem] flex-1 sm:block" />
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <button
                type="button"
                onClick={exportCSV}
                disabled={!canExportSpot}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                Export CSV
              </button>
              {tab === 'open' && openOrders.length > 1 && (
                <button
                  type="button"
                  onClick={handleCancelAll}
                  className="inline-flex items-center rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  Cancel all
                </button>
              )}
              <button
                type="button"
                onClick={() => (tab === 'open' ? fetchOpen() : fetchHistory(null, false))}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent hover:text-foreground"
                title="Refresh"
                aria-label="Refresh list"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:px-5">
            <span className="min-w-0">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded-lg p-1 hover:bg-destructive/15"
              aria-label="Dismiss error"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Open Orders Tab */}
        {tab === 'open' && (
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Date</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Pair</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Side</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Price</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Filled</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right sm:px-5">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {openLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3 sm:px-5"><div className="h-4 w-16 rounded-md bg-accent animate-pulse" /></td>
                    ))}
                  </tr>
                )) : filteredOpen.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-0">
                      <EmptyState
                        icon={BarChart3}
                        title="No open orders"
                        description="Your active spot orders will appear here. Place an order from the trading terminal."
                        actionLabel="Place order"
                        actionHref={SPOT_TRADE_HREF}
                        className="min-h-[260px] py-16"
                      />
                    </td>
                  </tr>
                ) : filteredOpen.map((o) => (
                  <tr
                    key={o.id}
                    className={`border-b border-border transition-colors hover:bg-muted/40 ${cancellingId === o.id ? 'opacity-60' : ''}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground sm:px-5">
                      {new Date(o.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <div className="flex items-center gap-2">
                        <CoinIcon symbol={o.market?.split('_')[0] || ''} size={22} />
                        <span className="font-medium text-foreground">{o.market.replace('_', '/')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-foreground sm:px-5">{o.type}</td>
                    <td className="px-4 py-3 sm:px-5">
                      <span className={`font-semibold ${o.side === 'buy' ? 'text-buy' : 'text-sell'}`}>{o.side.toUpperCase()}</span>
                    </td>
                    <td className="numeric px-4 py-3 text-foreground sm:px-5">{o.price ?? 'Market'}</td>
                    <td className="numeric px-4 py-3 text-foreground sm:px-5">{o.quantity}</td>
                    <td className="px-4 py-3 sm:px-5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${filledPct(o)}%` }} />
                        </div>
                        <span className="numeric text-xs text-muted-foreground">{filledPct(o)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${getStatusBadge(o.status)}`}>
                        {o.status === 'PENDING_TRIGGER' ? 'Pending' : o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      {['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status) && (
                        <button
                          type="button"
                          onClick={() => handleCancel(o.id)}
                          disabled={!!cancellingId}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {cancellingId === o.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Date</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Pair</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Side</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Price</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Filled</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Status</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {historyLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3 sm:px-5"><div className="h-4 w-16 rounded-md bg-accent animate-pulse" /></td>
                    ))}
                  </tr>
                )) : filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <EmptyState
                        icon={BarChart3}
                        title="No order history"
                        description="Completed and cancelled spot orders show up here once they leave the open book."
                        actionLabel="Place order"
                        actionHref={SPOT_TRADE_HREF}
                        className="min-h-[260px] py-16"
                      />
                    </td>
                  </tr>
                ) : filteredHistory.map((o) => (
                  <tr key={o.id} className="border-b border-border transition-colors hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground sm:px-5">
                      {new Date(o.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <div className="flex items-center gap-2">
                        <CoinIcon symbol={o.market?.split('_')[0] || ''} size={22} />
                        <span className="font-medium text-foreground">{o.market.replace('_', '/')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-foreground sm:px-5">{o.type}</td>
                    <td className="px-4 py-3 sm:px-5">
                      <span className={`font-semibold ${o.side === 'buy' ? 'text-buy' : 'text-sell'}`}>{o.side.toUpperCase()}</span>
                    </td>
                    <td className="numeric px-4 py-3 text-foreground sm:px-5">{o.price ?? 'Market'}</td>
                    <td className="numeric px-4 py-3 text-foreground sm:px-5">{o.quantity}</td>
                    <td className="px-4 py-3 sm:px-5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${filledPct(o)}%` }} />
                        </div>
                        <span className="numeric text-xs text-muted-foreground">{filledPct(o)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${getStatusBadge(o.status)}`}>{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!historyLoading && historyCursor && (
              <div className="flex justify-center border-t border-border px-4 py-4 sm:px-5">
                <button
                  type="button"
                  onClick={() => fetchHistory(historyCursor, true)}
                  disabled={historyLoadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-accent disabled:opacity-50"
                >
                  {historyLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  Load more
                </button>
              </div>
            )}
          </div>
        )}

        {/* P2P Orders Tab */}
        {tab === 'p2p' && (
          <div className="overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <p className="text-sm font-medium text-foreground">P2P trades</p>
                <p className="text-xs text-muted-foreground">Orders you create or take on the peer-to-peer market.</p>
              </div>
              <button
                type="button"
                onClick={fetchP2P}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:border-primary/35 hover:bg-accent hover:text-foreground"
                title="Refresh"
                aria-label="Refresh P2P orders"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <table className="min-w-[640px] w-full">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Date</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Type</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Asset</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Fiat</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Price</th>
                  <th className="whitespace-nowrap px-4 py-3 sm:px-5">Status</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right sm:px-5">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {p2pLoading ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3 sm:px-5"><div className="h-4 w-16 rounded-md bg-accent animate-pulse" /></td>
                    ))}
                  </tr>
                )) : p2pOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <EmptyState
                        icon={BarChart3}
                        title="No P2P orders"
                        description="When you buy or sell with other users, your trades will be listed here."
                        actionLabel="Go to P2P"
                        actionHref={P2P_HREF}
                        className="min-h-[260px] py-16"
                      />
                    </td>
                  </tr>
                ) : p2pOrders.map((o) => (
                  <tr key={o.id} className="border-b border-border transition-colors hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground sm:px-5">
                      {o.created_at
                        ? new Date(o.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <span className={`font-semibold ${o.type === 'buy' ? 'text-buy' : 'text-sell'}`}>{(o.type ?? '').toUpperCase()}</span>
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <div className="flex items-center gap-2">
                        {o.crypto_asset && <CoinIcon symbol={o.crypto_asset} size={22} />}
                        <span className="font-medium text-foreground">{o.crypto_asset ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground sm:px-5">{o.fiat_currency ?? '—'}</td>
                    <td className="numeric px-4 py-3 text-foreground sm:px-5">{o.amount ?? '—'}</td>
                    <td className="numeric px-4 py-3 text-foreground sm:px-5">{o.price ?? '—'}</td>
                    <td className="px-4 py-3 sm:px-5">
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${getStatusBadge(o.status ?? '')}`}>{o.status ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      <Link
                        href={`${P2P_HREF}/orders/${o.id}`}
                        className="inline-flex rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
