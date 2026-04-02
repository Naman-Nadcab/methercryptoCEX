'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import { Loader2, AlertCircle, Info } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { getMessageFromApiError } from '@/lib/errorMessages';

type Market = { symbol: string; base_asset: string; quote_asset: string };
type Order = { id: string; market: string; side: string; type: string; price: string | null; stop_price?: string | null; quantity: string; filled_quantity: string; status: string; created_at: string };

function generateClientOrderId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function SpotTradePage() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuthStore();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [market, setMarket] = useState<string>('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market' | 'stop_loss' | 'stop_limit'>('limit');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
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
  const submitInFlightRef = useRef(false);

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
    const url = getApiBaseUrl();
    if (!url) return;
    fetch(`${url}/api/v1/spot/markets`)
      .then((r) => r.json())
      .then((json: { success?: boolean; data?: Market[] }) => {
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          setMarkets(json.data);
          setMarket((m) => (m && json.data!.some((x) => x.symbol === m) ? m : json.data![0].symbol));
        }
      })
      .catch(() => {})
      .finally(() => setMarketsLoading(false));
  }, []);

  useEffect(() => {
    if (ordersTab === 'history') fetchHistoryOrders(null, false);
  }, [ordersTab, fetchHistoryOrders]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || submitting || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitResult(null);
    const qty = parseFloat(quantity);
    const pr = (orderType === 'limit' || orderType === 'stop_limit') ? parseFloat(price) : undefined;
    const stopPr = (orderType === 'stop_loss' || orderType === 'stop_limit') ? parseFloat(stopPrice) : undefined;
    if (!Number.isFinite(qty) || qty <= 0) {
      setSubmitResult({ success: false, message: 'Enter a quantity greater than 0.' });
      submitInFlightRef.current = false;
      return;
    }
    if (orderType === 'limit' && (pr == null || !Number.isFinite(pr) || pr <= 0)) {
      setSubmitResult({ success: false, message: 'Enter a price for limit orders.' });
      submitInFlightRef.current = false;
      return;
    }
    if ((orderType === 'stop_loss' || orderType === 'stop_limit') && (stopPr == null || !Number.isFinite(stopPr) || stopPr <= 0)) {
      setSubmitResult({ success: false, message: 'Enter a trigger price for stop orders.' });
      submitInFlightRef.current = false;
      return;
    }
    if (orderType === 'stop_limit' && (pr == null || !Number.isFinite(pr) || pr <= 0)) {
      setSubmitResult({ success: false, message: 'Enter a limit price for stop-limit orders.' });
      submitInFlightRef.current = false;
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
      if ((orderType === 'limit' || orderType === 'stop_limit') && price.trim()) body.price = price.trim();
      if ((orderType === 'stop_loss' || orderType === 'stop_limit') && stopPrice.trim()) body.stop_price = stopPrice.trim();
      const res = await fetch(`${getApiBaseUrl()}/api/v1/spot/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        const isStop = orderType === 'stop_loss' || orderType === 'stop_limit';
        setSubmitResult({ success: true, message: isStop ? 'Order placed (Pending Trigger). Funds are locked.' : 'Order placed (OPEN). Funds are locked.' });
        setQuantity('');
        setPrice('');
        setStopPrice('');
        setClientOrderId(generateClientOrderId());
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        fetchOpenOrders();
      } else {
        setSubmitResult({
          success: false,
          message: getMessageFromApiError(json?.error) || json?.error?.message || 'Order failed',
        });
      }
    } catch {
      setSubmitResult({ success: false, message: 'Connection issue. Your request may not have reached the server. Safe to try again.' });
    } finally {
      setSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const selectedMarket = markets.find((m) => m.symbol === market);
  const showPrice = orderType === 'limit' || orderType === 'stop_limit';
  const showStopPrice = orderType === 'stop_loss' || orderType === 'stop_limit';

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
      if (res.ok && json.success) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        queryClient.invalidateQueries({ queryKey: ['balances'] });
      } else {
        setCancelError(getMessageFromApiError(json?.error) || json?.error?.message || 'Cancel failed');
      }
    } catch {
      setCancelError('Connection issue. Your request may not have reached the server. Safe to try again.');
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
        <Link href="/trade/spot" className="text-sm text-blue-500 dark:text-blue-400 hover:underline">
          Back to Trade
        </Link>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-sm">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Limit orders match when price is reached. Stop orders trigger when market hits trigger price. Funds are locked until filled or cancelled.</span>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4 transition-all duration-200 ease-out hover:bg-gray-50/80 dark:hover:bg-white/[0.07] dark:hover:border-white/20">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Market</label>
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            disabled={marketsLoading}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white disabled:opacity-50"
          >
            {markets.length === 0 && <option value="">{marketsLoading ? 'Loading…' : 'No markets'}</option>}
            {markets.map((m) => (
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
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="type" checked={orderType === 'limit'} onChange={() => setOrderType('limit')} className="rounded-full" />
            <span className="text-gray-700 dark:text-gray-300">Limit</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="type" checked={orderType === 'market'} onChange={() => setOrderType('market')} className="rounded-full" />
            <span className="text-gray-700 dark:text-gray-300">Market</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="type" checked={orderType === 'stop_loss'} onChange={() => setOrderType('stop_loss')} className="rounded-full" />
            <span className="text-gray-700 dark:text-gray-300">Stop</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="type" checked={orderType === 'stop_limit'} onChange={() => setOrderType('stop_limit')} className="rounded-full" />
            <span className="text-gray-700 dark:text-gray-300">Stop Limit</span>
          </label>
        </div>
        {showStopPrice && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trigger price ({selectedMarket?.quote_asset ?? ''})</label>
            <input
              type="number"
              step="any"
              min="0"
              value={stopPrice}
              onChange={(e) => setStopPrice(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            />
          </div>
        )}
        {showPrice && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price ({selectedMarket?.quote_asset ?? ''})</label>
            <input
              type="number"
              step="any"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={orderType === 'stop_limit' ? 'Limit price' : '0'}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            />
          </div>
        )}
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
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm animate-fade-in ${submitResult.success ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            {!submitResult.success && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {submitResult.message}
          </div>
        )}
        <button
          type="submit"
          disabled={
            submitting ||
            !market ||
            !quantity.trim() ||
            (orderType === 'limit' && (!price.trim() || parseFloat(price) <= 0)) ||
            (orderType === 'stop_loss' && (!stopPrice.trim() || parseFloat(stopPrice) <= 0)) ||
            (orderType === 'stop_limit' && ((!stopPrice.trim() || parseFloat(stopPrice) <= 0) || (!price.trim() || parseFloat(price) <= 0)))
          }
          aria-busy={submitting}
          className="w-full py-2.5 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[120px] transition-transform duration-75 active:scale-[0.97] active:brightness-110"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Place Order
        </button>
      </form>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden transition-all duration-200 ease-out dark:hover:border-white/20">
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
              <div className="px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex items-center justify-between animate-fade-in-fast">
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
                  <tr className="text-left uppercase text-xs tracking-wider text-gray-400 border-b border-gray-200 dark:border-white/10">
                    <th className="p-3 font-medium">Market</th>
                    <th className="p-3 font-medium">Side</th>
                    <th className="p-3 font-medium">Price</th>
                    <th className="p-3 font-medium">Trigger</th>
                    <th className="p-3 font-medium">Quantity</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const canCancel = ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(o.status);
                    const displayStatus = o.status === 'PENDING_TRIGGER' ? 'Pending Trigger' : o.status;
                    return (
                      <tr key={o.id} className="border-b border-gray-100 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors duration-150">
                        <td className="p-3 font-medium text-gray-900 dark:text-white tabular-nums tracking-tight">{o.market}</td>
                        <td className="p-3">
                          <span className={`tabular-nums tracking-tight ${o.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{o.side}</span>
                        </td>
                        <td className="p-3 tabular-nums tracking-tight text-gray-700 dark:text-gray-300">{o.price ?? '—'}</td>
                        <td className="p-3 tabular-nums tracking-tight text-gray-700 dark:text-gray-300">{o.stop_price ?? '—'}</td>
                        <td className="p-3 tabular-nums tracking-tight text-gray-700 dark:text-gray-300">{o.quantity}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">{displayStatus}</span>
                        </td>
                        <td className="p-3">
                          {canCancel && (
                            <button
                              type="button"
                              disabled={cancellingOrderId !== null}
                              onClick={() => handleCancel(o.id)}
                              className="text-red-500 dark:text-red-400 hover:underline disabled:opacity-60 disabled:cursor-not-allowed text-sm flex items-center gap-1 transition-transform duration-75 active:scale-[0.97]"
                            >
                              {cancellingOrderId === o.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              {cancellingOrderId === o.id ? 'Cancelling…' : 'Cancel'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
                    <tr className="text-left uppercase text-xs tracking-wider text-gray-400 border-b border-gray-200 dark:border-white/10">
                      <th className="p-3 font-medium">Market</th>
                      <th className="p-3 font-medium">Side</th>
                      <th className="p-3 font-medium">Price</th>
                      <th className="p-3 font-medium">Quantity</th>
                      <th className="p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyOrders.map((o) => (
                      <tr key={o.id} className="border-b border-gray-100 dark:border-white/10">
                        <td className="p-3 font-medium text-gray-900 dark:text-white tabular-nums tracking-tight">{o.market}</td>
                        <td className="p-3">
                          <span className={`tabular-nums tracking-tight ${o.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{o.side}</span>
                        </td>
                        <td className="p-3 tabular-nums tracking-tight text-gray-700 dark:text-gray-300">{o.price ?? '—'}</td>
                        <td className="p-3 tabular-nums tracking-tight text-gray-700 dark:text-gray-300">{o.quantity}</td>
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
