'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { Loader2, BarChart3 } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';

type Order = { id: string; market: string; side: string; type: string; price: string | null; stop_price?: string | null; quantity: string; filled_quantity: string; status: string; created_at: string };

export default function SpotOrdersViewPage() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuthStore();
  const [ordersTab, setOrdersTab] = useState<'open' | 'history'>('open');
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadMore, setHistoryLoadMore] = useState(false);

  const fetchOpenOrders = useCallback(async () => {
    if (!accessToken) return;
    setOrdersLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/orders?status=OPEN&limit=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (json.success && json.data?.orders) {
        setOrders(json.data.orders);
      } else {
        setOrders([]);
      }
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [accessToken]);

  const fetchHistoryOrders = useCallback(async (cursor: string | null, append: boolean) => {
    if (!accessToken) return;
    if (append) setHistoryLoadMore(true);
    else setHistoryLoading(true);
    try {
      const url = new URL(`${getApiBaseUrl()}/api/v1/spot/orders`);
      url.searchParams.set('status', 'HISTORY');
      url.searchParams.set('limit', '50');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = await res.json().catch(() => ({}));
      if (json.success && json.data?.orders) {
        const list = json.data.orders as Order[];
        setHistoryOrders((prev) => (append ? [...prev, ...list] : list));
        setHistoryNextCursor(json.data.next_cursor ?? null);
      } else if (!append) {
        setHistoryOrders([]);
        setHistoryNextCursor(null);
      }
    } catch {
      if (!append) {
        setHistoryOrders([]);
        setHistoryNextCursor(null);
      }
    } finally {
      if (append) setHistoryLoadMore(false);
      else setHistoryLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchOpenOrders();
  }, [fetchOpenOrders]);

  useEffect(() => {
    if (ordersTab === 'history') fetchHistoryOrders(null, false);
  }, [ordersTab, fetchHistoryOrders]);

  const handleCancel = async (orderId: string) => {
    if (!accessToken || cancellingOrderId) return;
    setCancellingOrderId(orderId);
    setCancelError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (json.success) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        queryClient.invalidateQueries({ queryKey: ['balances'] });
      } else {
        setCancelError(getMessageFromApiError(json?.error) || 'Cancel failed');
      }
    } catch {
      setCancelError(getMessageFromApiError({ code: 'NETWORK_ERROR' }));
    } finally {
      setCancellingOrderId(null);
    }
  };

  return (
    <div className="p-4 md:p-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold text-foreground">Spot Orders</h1>
        <Link href="/trade/spot" className="text-sm text-primary hover:underline">Spot Trading →</Link>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setOrdersTab('open')}
            className={`px-4 py-2.5 text-sm font-medium ${ordersTab === 'open' ? 'border-b-2 border-blue-500 text-primary' : 'text-muted-foreground'}`}
          >
            Open Orders
          </button>
          <button
            type="button"
            onClick={() => setOrdersTab('history')}
            className={`px-4 py-2.5 text-sm font-medium ${ordersTab === 'history' ? 'border-b-2 border-blue-500 text-primary' : 'text-muted-foreground'}`}
          >
            Order History
          </button>
        </div>
        {ordersTab === 'open' && (
          <>
            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Active orders. Cancel releases locked funds.</span>
              <button type="button" onClick={() => fetchOpenOrders()} disabled={ordersLoading} aria-busy={ordersLoading} className="text-sm text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
                Refresh
              </button>
            </div>
            {cancelError && (
              <div className="px-4 py-2 bg-red-500/10 text-destructive text-sm flex items-center justify-between">
                <span>{cancelError}</span>
                <button type="button" onClick={() => setCancelError(null)} className="underline">Dismiss</button>
              </div>
            )}
            <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Market</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Side</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Price</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Trigger</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Quantity</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Status</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    [1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="border-b border-border">
                        <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-8 rounded bg-accent animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-16 rounded bg-accent animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-accent animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-accent animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-accent animate-pulse" /></td>
                      </tr>
                    ))
                  ) : orders.length === 0 ? (
                    <tr><td colSpan={7} className="p-0 align-top">
                      <EmptyState
                        icon={BarChart3}
                        title="No open orders"
                        description="Place a limit, market, or stop order to see it here."
                        actionLabel="Place order"
                        actionHref="/trade/spot"
                      />
                    </td></tr>
                  ) : (
                    orders.map((o) => {
                      const canCancel = ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status);
                      const displayStatus = o.status === 'PENDING_TRIGGER' ? 'Pending Trigger' : o.status;
                      return (
                    <tr key={o.id} className={`border-b border-border transition-colors duration-100 hover:bg-muted dark:hover:bg-card/5 ${cancellingOrderId === o.id ? 'opacity-75 bg-muted dark:bg-card/5' : ''}`}>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1.5">
                          <CoinIcon symbol={o.market?.split('_')[0] || ''} size={18} />
                          <span className="font-medium text-foreground tabular-nums">{o.market}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 tabular-nums">
                        <span className={o.side === 'buy' ? 'text-buy' : 'text-destructive'}>{o.side}</span>
                      </td>
                      <td className="py-2 px-2 font-mono text-foreground/80 tabular-nums">{o.price ?? '—'}</td>
                      <td className="py-2 px-2 font-mono text-foreground/80 tabular-nums">{o.stop_price ?? '—'}</td>
                      <td className="py-2 px-2 font-mono text-foreground/80 tabular-nums">{o.quantity}</td>
                      <td className="py-2 px-2">
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-primary">{displayStatus}</span>
                      </td>
                      <td className="py-2 px-2">
                        {canCancel && (
                          <button
                            type="button"
                            disabled={cancellingOrderId !== null}
                            onClick={() => handleCancel(o.id)}
                            className="text-destructive hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-1"
                          >
                            {cancellingOrderId === o.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            {cancellingOrderId === o.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                    ); })
                  )}
                </tbody>
              </table>
          </>
        )}
        {ordersTab === 'history' && (
          <>
            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">CANCELLED and FILLED. Read-only.</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 px-2 font-medium uppercase tracking-wide">Market</th>
                  <th className="py-2 px-2 font-medium uppercase tracking-wide">Side</th>
                  <th className="py-2 px-2 font-medium uppercase tracking-wide">Price</th>
                  <th className="py-2 px-2 font-medium uppercase tracking-wide">Quantity</th>
                  <th className="py-2 px-2 font-medium uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  [1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-8 rounded bg-accent animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-16 rounded bg-accent animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-accent animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-accent animate-pulse" /></td>
                    </tr>
                  ))
                ) : historyOrders.length === 0 ? (
                  <tr><td colSpan={5} className="p-0 align-top">
                    <EmptyState
                      icon={BarChart3}
                      title="No order history"
                      description="Filled and cancelled orders will appear here."
                      actionLabel="Place order"
                      actionHref="/trade/spot"
                    />
                  </td></tr>
                ) : (
                  historyOrders.map((o) => (
                      <tr key={o.id} className="border-b border-border transition-colors duration-100 hover:bg-muted dark:hover:bg-card/5">
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1.5">
                            <CoinIcon symbol={o.market?.split('_')[0] || ''} size={18} />
                            <span className="font-medium text-foreground tabular-nums">{o.market}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 tabular-nums">
                          <span className={o.side === 'buy' ? 'text-buy' : 'text-destructive'}>{o.side}</span>
                        </td>
                        <td className="py-2 px-2 font-mono text-foreground/80 tabular-nums">{o.price ?? '—'}</td>
                        <td className="py-2 px-2 font-mono text-foreground/80 tabular-nums">{o.quantity}</td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${o.status === 'FILLED' ? 'bg-green-500/20 text-buy' : 'bg-muted text-muted-foreground'}`}>{o.status}</span>
                        </td>
                      </tr>
                  ))
                )}
              </tbody>
            </table>
                {!historyLoading && historyNextCursor && (
                  <div className="p-4 border-t border-border flex justify-center">
                    <button
                      type="button"
                      onClick={() => fetchHistoryOrders(historyNextCursor, true)}
                      disabled={historyLoadMore}
                      className="py-2 px-4 rounded-lg bg-accent text-foreground/80 text-sm font-medium hover:bg-muted disabled:opacity-50 flex items-center gap-2"
                    >
                      {historyLoadMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
      </div>
    </div>
  );
}
