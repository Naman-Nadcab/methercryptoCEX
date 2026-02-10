'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { Loader2, AlertCircle, Info } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';

type Market = { symbol: string; base_asset: string; quote_asset: string };
type Order = { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; status: string; created_at: string };

const MARKETS_STATIC: Market[] = [
  { symbol: 'BTC_USDT', base_asset: 'BTC', quote_asset: 'USDT' },
  { symbol: 'ETH_USDT', base_asset: 'ETH', quote_asset: 'USDT' },
];

function generateClientOrderId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function SpotTradePage() {
  const { accessToken } = useAuthStore();
  const [market, setMarket] = useState<string>(MARKETS_STATIC[0]?.symbol ?? '');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [clientOrderId, setClientOrderId] = useState(() => generateClientOrderId());
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || submitting) return;
    setSubmitResult(null);
    const qty = parseFloat(quantity);
    const pr = orderType === 'limit' ? parseFloat(price) : undefined;
    if (!Number.isFinite(qty) || qty <= 0) {
      setSubmitResult({ success: false, message: 'Invalid quantity' });
      return;
    }
    if (orderType === 'limit' && (pr == null || !Number.isFinite(pr) || pr <= 0)) {
      setSubmitResult({ success: false, message: 'Limit orders require a valid price' });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        market,
        side,
        type: orderType,
        quantity: quantity.trim(),
        client_order_id: clientOrderId,
      };
      if (orderType === 'limit' && price.trim()) body.price = price.trim();
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setSubmitResult({ success: true, message: 'Order placed (OPEN). Funds are locked.' });
        setQuantity('');
        setPrice('');
        setClientOrderId(generateClientOrderId());
        fetchOpenOrders();
      } else {
        setSubmitResult({
          success: false,
          message: getMessageFromApiError(json?.error) || json?.error?.message || 'Order failed',
        });
      }
    } catch {
      setSubmitResult({ success: false, message: 'Request failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedMarket = MARKETS_STATIC.find((m) => m.symbol === market);

  const handleCancel = async (orderId: string) => {
    if (!accessToken || cancellingOrderId) return;
    setCancelError(null);
    setCancellingOrderId(orderId);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success && json.data) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        setCancelError(getMessageFromApiError(json?.error) || json?.error?.message || 'Cancel failed');
      }
    } catch {
      setCancelError('Request failed');
    } finally {
      setCancellingOrderId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Spot Order</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Place a limit order. Funds are reserved via balance lock until order is filled or cancelled.</p>
        </div>
        <Link href="/dashboard/trade" className="text-sm text-blue-500 dark:text-blue-400 hover:underline">
          Back to Trade
        </Link>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Locked funds are reserved for open orders and shown in Spot Wallet. No matching or fills in this flow.</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Market</label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
          >
            {MARKETS_STATIC.map((m) => (
              <option key={m.symbol} value={m.symbol}>{m.symbol}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="side" checked={side === 'buy'} onChange={() => setSide('buy')} className="rounded-full" />
            <span className={side === 'buy' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>Buy</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="side" checked={side === 'sell'} onChange={() => setSide('sell')} className="rounded-full" />
            <span className={side === 'sell' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>Sell</span>
          </label>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="type" checked={orderType === 'limit'} onChange={() => setOrderType('limit')} className="rounded-full" />
            <span className="text-gray-700 dark:text-gray-300">Limit</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="type" checked={orderType === 'market'} onChange={() => setOrderType('market')} className="rounded-full" />
            <span className="text-gray-700 dark:text-gray-300">Market</span>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price ({selectedMarket?.quote_asset ?? ''})</label>
          <input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={orderType === 'market'}
            placeholder={orderType === 'market' ? 'Market price' : '0'}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity ({selectedMarket?.base_asset ?? ''})</label>
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
          />
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Client Order ID (idempotency): {clientOrderId}
        </div>
        {submitResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${submitResult.success ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            {!submitResult.success && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {submitResult.message}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting || (orderType === 'limit' && (!price.trim() || parseFloat(price) <= 0)) || !quantity.trim()}
          className="w-full py-2.5 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Place Order
        </button>
      </form>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setOrdersTab('open')}
            className={`px-4 py-3 text-sm font-medium ${ordersTab === 'open' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
          >
            Open Orders
          </button>
          <button
            type="button"
            onClick={() => setOrdersTab('history')}
            className={`px-4 py-3 text-sm font-medium ${ordersTab === 'history' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
          >
            Order History
          </button>
        </div>
        {ordersTab === 'open' && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Active orders. Cancel releases locked funds.</span>
              <button type="button" onClick={() => fetchOpenOrders()} disabled={ordersLoading} className="text-sm text-blue-500 dark:text-blue-400 hover:underline disabled:opacity-50">
                Refresh
              </button>
            </div>
            {cancelError && (
              <div className="px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex items-center justify-between">
                <span>{cancelError}</span>
                <button type="button" onClick={() => setCancelError(null)} className="underline">Dismiss</button>
              </div>
            )}
            {ordersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : orders.length === 0 ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-400 text-sm">No open orders.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="p-3 font-medium">Market</th>
                    <th className="p-3 font-medium">Side</th>
                    <th className="p-3 font-medium">Price</th>
                    <th className="p-3 font-medium">Quantity</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="p-3 font-medium text-gray-900 dark:text-white">{o.market}</td>
                      <td className="p-3">
                        <span className={o.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{o.side}</span>
                      </td>
                      <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{o.price ?? '—'}</td>
                      <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{o.quantity}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">{o.status}</span>
                      </td>
                      <td className="p-3">
                        {o.status === 'OPEN' && (
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
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {ordersTab === 'history' && (
          <>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">CANCELLED and FILLED. Read-only.</span>
            </div>
            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : historyOrders.length === 0 ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-400 text-sm">No order history.</div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="p-3 font-medium">Market</th>
                      <th className="p-3 font-medium">Side</th>
                      <th className="p-3 font-medium">Price</th>
                      <th className="p-3 font-medium">Quantity</th>
                      <th className="p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyOrders.map((o) => (
                      <tr key={o.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="p-3 font-medium text-gray-900 dark:text-white">{o.market}</td>
                        <td className="p-3">
                          <span className={o.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{o.side}</span>
                        </td>
                        <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{o.price ?? '—'}</td>
                        <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{o.quantity}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-xs ${o.status === 'FILLED' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'}`}>{o.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {historyNextCursor && (
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
          </>
        )}
      </div>
    </div>
  );
}
