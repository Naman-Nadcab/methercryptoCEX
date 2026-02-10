'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { useSpotWs } from '@/hooks/useSpotWs';
import {
  RefreshCw,
  X,
  Loader2,
  ChevronDown,
} from 'lucide-react';

type Market = { id: string; symbol: string; base_asset: string; quote_asset: string; min_qty: string; min_notional: string; maker_fee?: string; taker_fee?: string };
type Ticker = { symbol: string; last_price: string | null; bid: string | null; ask: string | null; status?: string; volume_24h?: string; high_24h?: string; low_24h?: string };
type OrderbookLevel = { price: string; quantity: string };
type Order = { id: string; market: string; side: string; type: string; price: string | null; quantity: string; filled_quantity: string; remaining_quantity?: string; status: string; displayStatus: string; created_at: string };
type Trade = { id: string; order_id: string; market: string; side: string; price: string; quantity: string; fee: string; fee_asset: string | null; created_at: string };
type BalanceRow = { symbol: string; funding: string; trading: string; total: string };

export default function TradePage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [symbol, setSymbol] = useState<string>('');
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [orderbook, setOrderbook] = useState<{ bids: OrderbookLevel[]; asks: OrderbookLevel[] }>({ bids: [], asks: [] });
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [marketDropdownOpen, setMarketDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'open' | 'orders' | 'trades'>('open');
  const [refreshKey, setRefreshKey] = useState(0);
  const [cancelAllLoading, setCancelAllLoading] = useState(false);
  const subsRef = useRef<Set<string>>(new Set());

  const selectedMarket = markets.find((m) => m.symbol === symbol);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';
  const tradingBalance = balances.find((b) => b.symbol === (side === 'buy' ? quoteAsset : baseAsset))?.trading ?? '0';
  const minQty = selectedMarket ? parseFloat(selectedMarket.min_qty) : 0;
  const minNotional = selectedMarket ? parseFloat(selectedMarket.min_notional) : 0;
  const makerFeeRate = selectedMarket?.maker_fee != null ? parseFloat(selectedMarket.maker_fee) : 0.001;
  const takerFeeRate = selectedMarket?.taker_fee != null ? parseFloat(selectedMarket.taker_fee) : 0.001;
  const feeRate = orderType === 'limit' ? makerFeeRate : takerFeeRate;
  const priceNum = parseFloat(price) || 0;
  const qtyNum = parseFloat(quantity) || 0;
  const notional = orderType === 'market' ? (ticker?.last_price ? qtyNum * parseFloat(ticker.last_price) : 0) : qtyNum * priceNum;
  const feeEstimate = orderType === 'market' && ticker?.last_price ? qtyNum * parseFloat(ticker.last_price) * takerFeeRate : notional * feeRate;
  const validQty = qtyNum >= minQty;
  const validNotional = notional >= minNotional;
  const validPrice = orderType === 'market' || priceNum > 0;
  const marketPaused = ticker?.status === 'maintenance';
  const canSubmit = validQty && validNotional && validPrice && !!symbol && !orderLoading && !marketPaused;

  const fetchMarkets = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: Market[] }>('/api/v1/spot/markets');
    if (res.success && res.data?.length) {
      setMarkets(res.data);
      if (!symbol && res.data[0]) setSymbol(res.data[0].symbol);
    }
  }, [symbol]);

  const fetchTicker = useCallback(async () => {
    if (!symbol) return;
    const res = await api.get<{ success: boolean; data: Ticker }>(`/api/v1/spot/ticker/${encodeURIComponent(symbol)}`);
    if (res.success && res.data) setTicker(res.data);
  }, [symbol]);

  const fetchOrderbook = useCallback(async () => {
    if (!symbol) return;
    const res = await api.get<{ success: boolean; data: { bids: OrderbookLevel[]; asks: OrderbookLevel[] } }>(`/api/v1/spot/orderbook/${encodeURIComponent(symbol)}?limit=15`);
    if (res.success && res.data) setOrderbook(res.data);
  }, [symbol]);

  const fetchBalances = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: BalanceRow[] }>('/api/v1/wallet/balances/by-account');
    if (res.success && res.data) setBalances(res.data);
  }, []);

  const fetchOpenOrders = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: Order[] }>('/api/v1/spot/open-orders');
    if (res.success && res.data) setOpenOrders(res.data);
  }, []);

  const fetchOrderHistory = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: Order[]; pagination: { total: number } }>('/api/v1/spot/order-history?limit=20');
    if (res.success && res.data) setOrderHistory(res.data);
  }, []);

  const fetchTradeHistory = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: Trade[]; pagination: { total: number } }>('/api/v1/spot/trade-history?limit=20');
    if (res.success && res.data) setTradeHistory(res.data);
  }, []);

  const { connected: wsConnected, subscribe: wsSubscribe, unsubscribe: wsUnsubscribe } = useSpotWs({
    onOrderbook: (data) => {
      if (data.symbol === symbol) setOrderbook({ bids: data.bids || [], asks: data.asks || [] });
    },
    onTrades: (data) => {
      if (symbol && data.length > 0 && data[0]?.market === symbol) {
        setRecentTrades((prev) => [
          ...data.map((t: { price: string; quantity: string; side: string; time?: string; created_at?: string }) => ({
            price: t.price,
            qty: t.quantity,
            side: t.side,
            time: t.time ?? t.created_at ?? '',
          })),
          ...prev.slice(0, 30),
        ]);
      }
    },
    onTicker: (data) => {
      if (data.symbol === symbol) {
        setTicker((prev) => ({
          symbol: data.symbol,
          last_price: data.last_price ?? prev?.last_price ?? null,
          bid: data.bid ?? prev?.bid ?? null,
          ask: data.ask ?? prev?.ask ?? null,
          status: data.status ?? prev?.status,
          volume_24h: data.volume_24h ?? prev?.volume_24h,
          high_24h: data.high_24h ?? prev?.high_24h,
          low_24h: data.low_24h ?? prev?.low_24h,
        }));
      }
    },
    onOrderUpdate: (data) => {
      setOpenOrders((prev) => {
        if (data.status === 'CANCELLED' || data.status === 'FILLED') {
          return prev.filter((o) => o.id !== data.id);
        }
        return prev.map((o) => (o.id === data.id ? { ...o, status: data.status, displayStatus: data.displayStatus ?? o.displayStatus, filled_quantity: data.filled_quantity ?? o.filled_quantity } : o));
      });
      setRefreshKey((k) => k + 1);
    },
    onTradeUpdate: () => {
      fetchTradeHistory();
      fetchBalances();
    },
  });

  const [recentTrades, setRecentTrades] = useState<{ price: string; qty: string; side: string; time: string }[]>([]);

  useEffect(() => {
    if (!symbol || !wsConnected) return;
    const channels = [`orderbook:${symbol}`, `trades:${symbol}`, `ticker:${symbol}`];
    channels.forEach((ch) => {
      if (!subsRef.current.has(ch)) {
        subsRef.current.add(ch);
        wsSubscribe(ch);
      }
    });
    wsSubscribe('user.orders');
    wsSubscribe('user.trades');
    return () => {
      channels.forEach((ch) => {
        subsRef.current.delete(ch);
        wsUnsubscribe(ch);
      });
      wsUnsubscribe('user.orders');
      wsUnsubscribe('user.trades');
    };
  }, [symbol, wsConnected, wsSubscribe, wsUnsubscribe]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      await fetchMarkets();
      await fetchBalances();
      setLoading(false);
    })();
  }, [fetchMarkets, fetchBalances]);

  useEffect(() => {
    if (!symbol) return;
    fetchTicker();
    fetchOrderbook();
    const t = setInterval(() => {
      fetchTicker();
      fetchOrderbook();
    }, 5000);
    return () => clearInterval(t);
  }, [symbol, fetchTicker, fetchOrderbook]);

  useEffect(() => {
    fetchOpenOrders();
    fetchOrderHistory();
    fetchTradeHistory();
  }, [fetchOpenOrders, fetchOrderHistory, fetchTradeHistory, refreshKey]);

  const handlePlaceOrder = async () => {
    if (!canSubmit) return;
    setOrderLoading(true);
    setError(null);
    const body: { market: string; side: string; type: string; quantity: string; price?: string } = {
      market: symbol,
      side,
      type: orderType,
      quantity: quantity,
    };
    if (orderType === 'limit') body.price = price;
    const res = await api.post<{ success: boolean; data?: Order; error?: { code?: string; message?: string } }>('/api/v1/spot/order', body);
    setOrderLoading(false);
    if (res.success && res.data) {
      setQuantity('');
      setPrice('');
      setRefreshKey((k) => k + 1);
      fetchOpenOrders();
      fetchOrderHistory();
      fetchTradeHistory();
      fetchBalances();
      fetchOrderbook();
    } else {
      setError(getMessageFromApiError(res.error));
    }
  };

  const handleCancel = async (orderId: string) => {
    const res = await api.post<{ success: boolean; error?: { code?: string; message?: string } }>(`/api/v1/spot/order/${orderId}/cancel`, {});
    if (res.success) {
      setRefreshKey((k) => k + 1);
      fetchOpenOrders();
      fetchBalances();
      fetchOrderbook();
    } else {
      setError(getMessageFromApiError(res.error));
    }
  };

  const handleCancelAll = async () => {
    if (!symbol) return;
    setCancelAllLoading(true);
    setError(null);
    const res = await api.post<{ success: boolean; data?: { cancelled: number }; error?: { code?: string; message?: string } }>('/api/v1/spot/orders/cancel-all', { market: symbol });
    setCancelAllLoading(false);
    if (res.success) {
      setOpenOrders((prev) => prev.filter((o) => o.market !== symbol));
      setRefreshKey((k) => k + 1);
      fetchBalances();
      fetchOrderbook();
    } else {
      setError(getMessageFromApiError(res.error));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Spot Trading</h1>
        <a href="/dashboard/trade/spot" className="text-sm text-blue-500 dark:text-blue-400 hover:underline">Place order (balance lock)</a>
      </div>

      {/* Market selector */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMarketDropdownOpen(!marketDropdownOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-lg text-left min-w-[180px]"
        >
          <span className="font-medium">{symbol || 'Select market'}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${marketDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        {marketDropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMarketDropdownOpen(false)} />
            <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
              {markets.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSymbol(m.symbol);
                    setMarketDropdownOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 flex justify-between"
                >
                  <span>{m.symbol}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {marketPaused && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-sm">
          Trading is temporarily paused for this market. Orders cannot be placed.
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Chart placeholder + 24h stats + Orderbook + Recent trades */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl p-4 h-48 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <span>Price chart (mock) — {symbol || 'Select market'}</span>
          </div>
          {symbol && ticker && (
            <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Last</span>
                <p className="font-medium text-gray-900 dark:text-white">{ticker.last_price ?? '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">24h Volume</span>
                <p className="font-medium text-gray-900 dark:text-white">{ticker.volume_24h ? Number(ticker.volume_24h).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">24h High</span>
                <p className="font-medium text-gray-900 dark:text-white">{ticker.high_24h ?? '—'}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">24h Low</span>
                <p className="font-medium text-gray-900 dark:text-white">{ticker.low_24h ?? '—'}</p>
              </div>
            </div>
          )}
          <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex justify-between text-sm">
              <span className="font-medium">Order book</span>
              {wsConnected && <span className="text-green-600 dark:text-green-400 text-xs">Live</span>}
              <button type="button" onClick={() => { fetchOrderbook(); fetchTicker(); }} className="text-blue-500 hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 text-sm">
              <div>
                <div className="px-3 py-1.5 bg-green-500/10 text-green-600 dark:text-green-400 font-medium">Bids</div>
                {(() => {
                  const maxBid = Math.max(...orderbook.bids.slice(0, 10).map((b) => parseFloat(b.quantity)), 1);
                  return orderbook.bids.slice(0, 10).map((b, i) => (
                    <div key={i} className="relative px-3 py-1 flex justify-between items-center">
                      <div className="absolute inset-0 bg-green-500/10 rounded" style={{ width: `${(parseFloat(b.quantity) / maxBid) * 100}%` }} />
                      <span className="relative z-10">{b.price}</span>
                      <span className="relative z-10 text-gray-500">{b.quantity}</span>
                    </div>
                  ));
                })()}
              </div>
              <div>
                <div className="px-3 py-1.5 bg-red-500/10 text-red-600 dark:text-red-400 font-medium">Asks</div>
                {(() => {
                  const maxAsk = Math.max(...orderbook.asks.slice(0, 10).map((a) => parseFloat(a.quantity)), 1);
                  return orderbook.asks.slice(0, 10).map((a, i) => (
                    <div key={i} className="relative px-3 py-1 flex justify-between items-center">
                      <div className="absolute inset-0 bg-red-500/10 rounded" style={{ width: `${(parseFloat(a.quantity) / maxAsk) * 100}%` }} />
                      <span className="relative z-10">{a.price}</span>
                      <span className="relative z-10 text-gray-500">{a.quantity}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-sm font-medium">Recent trades</div>
            <div className="max-h-32 overflow-y-auto text-sm">
              {recentTrades.length === 0 && <div className="px-4 py-3 text-gray-500">No recent trades</div>}
              {recentTrades.slice(0, 15).map((t, i) => (
                <div key={i} className="px-4 py-1 flex justify-between">
                  <span className={t.side === 'buy' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>{t.price}</span>
                  <span className="text-gray-500">{t.qty}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Order form + Balance */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setSide('buy')}
                className={`flex-1 py-2 text-sm font-medium ${side === 'buy' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide('sell')}
                className={`flex-1 py-2 text-sm font-medium ${side === 'sell' ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
              >
                Sell
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setOrderType('limit')}
                className={`flex-1 py-1.5 text-xs rounded ${orderType === 'limit' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
              >
                Limit
              </button>
              <button
                type="button"
                onClick={() => setOrderType('market')}
                className={`flex-1 py-1.5 text-xs rounded ${orderType === 'market' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
              >
                Market
              </button>
            </div>
            {orderType === 'limit' && (
              <label className="block mt-3 text-sm">
                Price ({quoteAsset})
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#181a20] text-gray-900 dark:text-white"
                />
              </label>
            )}
            <label className="block mt-3 text-sm">
              Quantity ({baseAsset})
              <input
                type="number"
                step="any"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-[#181a20] text-gray-900 dark:text-white"
              />
            </label>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
              <p>Balance: {tradingBalance} {side === 'buy' ? quoteAsset : baseAsset}</p>
              <p>Maker fee: {(makerFeeRate * 100).toFixed(2)}% · Taker fee: {(takerFeeRate * 100).toFixed(2)}%</p>
              <p>Est. fee: ~{feeEstimate.toFixed(8)} {quoteAsset}</p>
              {!validQty && qtyNum > 0 && <p className="text-amber-600">Min qty: {minQty}</p>}
              {!validNotional && notional > 0 && <p className="text-amber-600">Min notional: {minNotional}</p>}
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handlePlaceOrder}
              className={`mt-4 w-full py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 ${side === 'buy' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'} text-white disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {orderLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {marketPaused ? 'Trading paused' : `${side === 'buy' ? 'Buy' : 'Sell'} ${baseAsset}`}
            </button>
          </div>
          <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h3 className="text-sm font-medium mb-2">Trading balance</h3>
            <div className="text-sm space-y-1 max-h-32 overflow-y-auto">
              {balances.filter((b) => parseFloat(b.trading) > 0).map((b) => (
                <div key={b.symbol} className="flex justify-between">
                  <span>{b.symbol}</span>
                  <span>{b.trading}</span>
                </div>
              ))}
              {balances.filter((b) => parseFloat(b.trading) > 0).length === 0 && (
                <p className="text-gray-500">No trading balance. Transfer from Funding first.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Orders / Trades panel */}
      <div className="bg-white dark:bg-[#1e2026] border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(['open', 'orders', 'trades'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500 dark:text-gray-400'}`}
            >
              {tab === 'open' ? 'Open orders' : tab === 'orders' ? 'Order history' : 'Trade history'}
            </button>
          ))}
        </div>
        <div className="p-4 overflow-x-auto">
          {activeTab === 'open' && (
            <>
              <div className="px-4 py-2 flex justify-end">
                <button
                  type="button"
                  disabled={!symbol || openOrders.filter((o) => o.market === symbol).length === 0 || cancelAllLoading}
                  onClick={handleCancelAll}
                  className="text-sm text-red-500 hover:underline disabled:opacity-50 flex items-center gap-1"
                >
                  {cancelAllLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Cancel all ({symbol ? openOrders.filter((o) => o.market === symbol).length : 0})
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="pb-2">Market</th>
                    <th className="pb-2">Side</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Price</th>
                    <th className="pb-2">Filled / Total</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((o) => {
                    const total = parseFloat(o.quantity);
                    const filled = parseFloat(o.filled_quantity);
                    const pct = total > 0 ? (filled / total) * 100 : 0;
                    const isFilled = o.status === 'FILLED';
                    const isPartial = o.status === 'PARTIALLY_FILLED';
                    return (
                      <tr key={o.id} className={`border-t border-gray-100 dark:border-gray-800 ${isFilled ? 'bg-green-500/5' : isPartial ? 'bg-amber-500/5' : ''}`}>
                        <td>{o.market}</td>
                        <td className={o.side === 'buy' ? 'text-green-600' : 'text-red-600'}>{o.side}</td>
                        <td>{o.type}</td>
                        <td>{o.price ?? '—'}</td>
                        <td>
                          <div className="flex flex-col">
                            <span>{o.filled_quantity} / {o.quantity}</span>
                            {(isPartial || isFilled) && (
                              <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden mt-0.5">
                                <div className="h-full bg-green-500 rounded" style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td>{o.displayStatus}</td>
                        <td>
                          {(o.status === 'OPEN' || o.status === 'PARTIALLY_FILLED') && (
                            <button type="button" onClick={() => handleCancel(o.id)} className="text-red-500 hover:underline text-xs">Cancel</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {openOrders.length === 0 && <tr><td colSpan={7} className="py-4 text-gray-500 text-center">No open orders</td></tr>}
                </tbody>
              </table>
            </>
          )}
          {activeTab === 'orders' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2">Market</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Price</th>
                  <th className="pb-2">Filled / Total</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.map((o) => (
                  <tr key={o.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td>{o.market}</td>
                    <td className={o.side === 'buy' ? 'text-green-600' : 'text-red-600'}>{o.side}</td>
                    <td>{o.type}</td>
                    <td>{o.price ?? '—'}</td>
                    <td>{o.filled_quantity} / {o.quantity}</td>
                    <td>{o.displayStatus}</td>
                    <td className="text-gray-500">{new Date(o.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {orderHistory.length === 0 && <tr><td colSpan={7} className="py-4 text-gray-500 text-center">No order history</td></tr>}
              </tbody>
            </table>
          )}
          {activeTab === 'trades' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2">Market</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Price</th>
                  <th className="pb-2">Quantity</th>
                  <th className="pb-2">Fee</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {tradeHistory.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td>{t.market}</td>
                    <td className={t.side === 'buy' ? 'text-green-600' : 'text-red-600'}>{t.side}</td>
                    <td>{t.price}</td>
                    <td>{t.quantity}</td>
                    <td>{t.fee} {t.fee_asset ?? ''}</td>
                    <td className="text-gray-500">{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {tradeHistory.length === 0 && <tr><td colSpan={6} className="py-4 text-gray-500 text-center">No trades yet</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
