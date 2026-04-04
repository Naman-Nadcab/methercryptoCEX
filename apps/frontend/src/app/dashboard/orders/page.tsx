'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, BarChart3, RefreshCw, X as XIcon } from 'lucide-react';
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

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">Orders</h1>
        <Link href="/trade/spot" className="text-sm text-primary hover:underline">Go to Spot Trading →</Link>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-border">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors relative ${tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
              {t.count !== null && t.count > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-primary/15 text-primary font-semibold">{t.count}</span>
              )}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>

        {/* Filters (Spot tabs only) */}
        {(tab === 'open' || tab === 'history') && (
          <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={pairFilter}
              onChange={e => setPairFilter(e.target.value)}
              placeholder="Filter pair..."
              className="px-3 py-1.5 text-xs bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground w-32 focus:ring-1 focus:ring-primary/40 outline-none"
            />
            <select
              value={sideFilter}
              onChange={e => setSideFilter(e.target.value as '' | 'buy' | 'sell')}
              className="px-3 py-1.5 text-xs bg-muted border border-border rounded-lg text-foreground w-24"
            >
              <option value="">All Sides</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <div className="flex-1" />
            <button onClick={exportCSV} className="text-xs text-primary hover:underline">Export CSV</button>
            {tab === 'open' && openOrders.length > 1 && (
              <button onClick={handleCancelAll} className="text-xs text-destructive hover:underline">Cancel All</button>
            )}
            <button onClick={() => tab === 'open' ? fetchOpen() : fetchHistory(null, false)} className="p-1.5 hover:bg-accent rounded-lg transition-colors">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}><XIcon className="w-4 h-4" /></button>
          </div>
        )}

        {/* Open Orders Tab */}
        {tab === 'open' && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2.5 px-3 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Pair</th>
                  <th className="py-2.5 px-3 font-medium">Type</th>
                  <th className="py-2.5 px-3 font-medium">Side</th>
                  <th className="py-2.5 px-3 font-medium">Price</th>
                  <th className="py-2.5 px-3 font-medium">Amount</th>
                  <th className="py-2.5 px-3 font-medium">Filled</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {openLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="py-2.5 px-3"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                    ))}
                  </tr>
                )) : filteredOpen.length === 0 ? (
                  <tr><td colSpan={9}><EmptyState icon={BarChart3} title="No open orders" description="Your active orders will appear here." actionLabel="Place Order" actionHref="/trade/spot" /></td></tr>
                ) : filteredOpen.map(o => (
                  <tr key={o.id} className={`border-b border-border hover:bg-muted/50 transition-colors ${cancellingId === o.id ? 'opacity-60' : ''}`}>
                    <td className="py-2.5 px-3 text-muted-foreground">{new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <CoinIcon symbol={o.market?.split('_')[0] || ''} size={20} />
                        <span className="font-medium text-foreground">{o.market.replace('_', '/')}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-foreground capitalize">{o.type}</td>
                    <td className="py-2.5 px-3"><span className={o.side === 'buy' ? 'text-buy' : 'text-sell'}>{o.side.toUpperCase()}</span></td>
                    <td className="py-2.5 px-3 font-mono text-foreground">{o.price ?? 'Market'}</td>
                    <td className="py-2.5 px-3 font-mono text-foreground">{o.quantity}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${filledPct(o)}%` }} />
                        </div>
                        <span className="text-muted-foreground">{filledPct(o)}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getStatusBadge(o.status)}`}>{o.status === 'PENDING_TRIGGER' ? 'Pending' : o.status}</span></td>
                    <td className="py-2.5 px-3 text-right">
                      {['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status) && (
                        <button onClick={() => handleCancel(o.id)} disabled={!!cancellingId} className="text-destructive hover:underline disabled:opacity-50 flex items-center gap-1 ml-auto">
                          {cancellingId === o.id && <Loader2 className="w-3 h-3 animate-spin" />}
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
            <table className="w-full text-xs min-w-[650px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2.5 px-3 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Pair</th>
                  <th className="py-2.5 px-3 font-medium">Type</th>
                  <th className="py-2.5 px-3 font-medium">Side</th>
                  <th className="py-2.5 px-3 font-medium">Price</th>
                  <th className="py-2.5 px-3 font-medium">Amount</th>
                  <th className="py-2.5 px-3 font-medium">Filled</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="py-2.5 px-3"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                    ))}
                  </tr>
                )) : filteredHistory.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState icon={BarChart3} title="No order history" description="Completed orders will appear here." actionLabel="Place Order" actionHref="/trade/spot" /></td></tr>
                ) : filteredHistory.map(o => (
                  <tr key={o.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="py-2.5 px-3 text-muted-foreground">{new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <CoinIcon symbol={o.market?.split('_')[0] || ''} size={20} />
                        <span className="font-medium text-foreground">{o.market.replace('_', '/')}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-foreground capitalize">{o.type}</td>
                    <td className="py-2.5 px-3"><span className={o.side === 'buy' ? 'text-buy' : 'text-sell'}>{o.side.toUpperCase()}</span></td>
                    <td className="py-2.5 px-3 font-mono text-foreground">{o.price ?? 'Market'}</td>
                    <td className="py-2.5 px-3 font-mono text-foreground">{o.quantity}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${filledPct(o)}%` }} />
                        </div>
                        <span className="text-muted-foreground">{filledPct(o)}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getStatusBadge(o.status)}`}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!historyLoading && historyCursor && (
              <div className="p-4 border-t border-border flex justify-center">
                <button onClick={() => fetchHistory(historyCursor, true)} disabled={historyLoadingMore} className="py-2 px-4 rounded-lg bg-accent text-foreground/80 text-sm font-medium hover:bg-accent/80 disabled:opacity-50 flex items-center gap-2">
                  {historyLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}Load more
                </button>
              </div>
            )}
          </div>
        )}

        {/* P2P Orders Tab */}
        {tab === 'p2p' && (
          <div className="overflow-x-auto">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Your P2P trades</span>
              <button onClick={fetchP2P} className="p-1.5 hover:bg-accent rounded-lg transition-colors"><RefreshCw className="w-3.5 h-3.5 text-muted-foreground" /></button>
            </div>
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2.5 px-3 font-medium">Date</th>
                  <th className="py-2.5 px-3 font-medium">Type</th>
                  <th className="py-2.5 px-3 font-medium">Asset</th>
                  <th className="py-2.5 px-3 font-medium">Fiat</th>
                  <th className="py-2.5 px-3 font-medium">Amount</th>
                  <th className="py-2.5 px-3 font-medium">Price</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {p2pLoading ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="py-2.5 px-3"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                    ))}
                  </tr>
                )) : p2pOrders.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState icon={BarChart3} title="No P2P orders" description="Your P2P trades will appear here." actionLabel="Go to P2P" actionHref="/p2p" /></td></tr>
                ) : p2pOrders.map(o => (
                  <tr key={o.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="py-2.5 px-3 text-muted-foreground">{o.created_at ? new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td className="py-2.5 px-3"><span className={o.type === 'buy' ? 'text-buy' : 'text-sell'}>{(o.type ?? '').toUpperCase()}</span></td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        {o.crypto_asset && <CoinIcon symbol={o.crypto_asset} size={20} />}
                        <span className="font-medium text-foreground">{o.crypto_asset ?? '—'}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-foreground">{o.fiat_currency ?? '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-foreground">{o.amount ?? '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-foreground">{o.price ?? '—'}</td>
                    <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getStatusBadge(o.status ?? '')}`}>{o.status ?? '—'}</span></td>
                    <td className="py-2.5 px-3 text-right"><Link href={`/p2p/orders/${o.id}`} className="text-primary hover:underline">View</Link></td>
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
