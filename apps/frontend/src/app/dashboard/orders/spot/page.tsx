'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';

type Order = { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: string };

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
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Spot Orders</h1>
        <Link href="/dashboard/spot" className="text-sm text-blue-500 dark:text-blue-400 hover:underline">Spot Trading →</Link>
      </div>
      <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setOrdersTab('open')}
            className={`px-4 py-2.5 text-sm font-medium ${ordersTab === 'open' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
          >
            Open Orders
          </button>
          <button
            type="button"
            onClick={() => setOrdersTab('history')}
            className={`px-4 py-2.5 text-sm font-medium ${ordersTab === 'history' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
          >
            Order History
          </button>
        </div>
        {ordersTab === 'open' && (
          <>
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">Active orders. Cancel releases locked funds.</span>
              <button type="button" onClick={() => fetchOpenOrders()} disabled={ordersLoading} aria-busy={ordersLoading} className="text-sm text-blue-500 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
                Refresh
              </button>
            </div>
            {cancelError && (
              <div className="px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex items-center justify-between">
                <span>{cancelError}</span>
                <button type="button" onClick={() => setCancelError(null)} className="underline">Dismiss</button>
              </div>
            )}
            <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Market</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Side</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Price</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Quantity</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Status</th>
                    <th className="py-2 px-2 font-medium uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    [1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-8 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                        <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                      </tr>
                    ))
                  ) : orders.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-500 dark:text-gray-400 text-xs">No open orders.</td></tr>
                  ) : (
                    orders.map((o) => (
                    <tr key={o.id} className={`border-b border-gray-100 dark:border-gray-800 transition-colors duration-100 hover:bg-gray-50 dark:hover:bg-white/5 ${cancellingOrderId === o.id ? 'opacity-75 bg-gray-50 dark:bg-white/5' : ''}`}>
                      <td className="py-2 px-2 font-medium text-gray-900 dark:text-white tabular-nums">{o.market}</td>
                      <td className="py-2 px-2 tabular-nums">
                        <span className={o.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{o.side}</span>
                      </td>
                      <td className="py-2 px-2 font-mono text-gray-700 dark:text-gray-300 tabular-nums">{o.price ?? '—'}</td>
                      <td className="py-2 px-2 font-mono text-gray-700 dark:text-gray-300 tabular-nums">{o.quantity}</td>
                      <td className="py-2 px-2">
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">{o.status}</span>
                      </td>
                      <td className="py-2 px-2">
                        {(o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED') && (
                          <button
                            type="button"
                            disabled={cancellingOrderId !== null}
                            onClick={() => handleCancel(o.id)}
                            className="text-red-500 dark:text-red-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-1"
                          >
                            {cancellingOrderId === o.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            {cancellingOrderId === o.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    </tr>
                    ))
                  )}
                </tbody>
              </table>
          </>
        )}
        {ordersTab === 'history' && (
          <>
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">CANCELLED and FILLED. Read-only.</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
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
                    <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-8 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                      <td className="py-2 px-2"><div className="h-3 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" /></td>
                    </tr>
                  ))
                ) : historyOrders.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-500 dark:text-gray-400 text-xs">No order history.</td></tr>
                ) : (
                  historyOrders.map((o) => (
                      <tr key={o.id} className="border-b border-gray-100 dark:border-gray-800 transition-colors duration-100 hover:bg-gray-50 dark:hover:bg-white/5">
                        <td className="py-2 px-2 font-medium text-gray-900 dark:text-white tabular-nums">{o.market}</td>
                        <td className="py-2 px-2 tabular-nums">
                          <span className={o.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{o.side}</span>
                        </td>
                        <td className="py-2 px-2 font-mono text-gray-700 dark:text-gray-300 tabular-nums">{o.price ?? '—'}</td>
                        <td className="py-2 px-2 font-mono text-gray-700 dark:text-gray-300 tabular-nums">{o.quantity}</td>
                        <td className="py-2 px-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${o.status === 'FILLED' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>{o.status}</span>
                        </td>
                      </tr>
                  ))
                )}
              </tbody>
            </table>
                {!historyLoading && historyNextCursor && (
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-center">
                    <button
                      type="button"
                      onClick={() => fetchHistoryOrders(historyNextCursor, true)}
                      disabled={historyLoadMore}
                      className="py-2 px-4 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
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
