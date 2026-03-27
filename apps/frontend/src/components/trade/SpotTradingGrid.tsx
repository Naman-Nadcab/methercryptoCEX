'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { useBalancesByAccount } from '@/lib/balances';
import { useSpotWs, type OrderbookSnapshot, type TickerMessage, type TradeMessage } from '@/hooks/useSpotWs';
import { useSpotFavorites } from '@/hooks/useSpotFavorites';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';
import { ExchangeHeader } from '@/components/layout/ExchangeHeader';
import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
import { ChartErrorBoundary } from './chart/ChartErrorBoundary';
import { SpotDepthChart } from './SpotDepthChart';
import { SpotOrderbookPanel } from './SpotOrderbookPanel';
import { SpotOrderEntryPanel } from './SpotOrderEntryPanel';
import { SpotBottomPanel } from './SpotBottomPanel';
import { formatFixedTrim, formatValueFixedTrim } from './terminalFormat';

type Market = {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status?: string;
  maker_fee?: string;
  taker_fee?: string;
  min_qty?: string;
  min_notional?: string;
  price_precision?: number;
  qty_precision?: number;
};

function generateClientOrderId(): string {
  return crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function SpotTradingGrid() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get('symbol')?.toUpperCase().replace(/-/g, '_') ?? '';
  const { accessToken, user } = useAuthStore();
  const { resolvedTheme } = useThemeStore();
  const isAuth = Boolean(accessToken);
  const chartTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [chartIntervalSeconds, setChartIntervalSeconds] = useState(60);
  const [chartViewMode, setChartViewMode] = useState<'chart' | 'depth'>('chart');

  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot | null>(null);
  const [orderbookLoading, setOrderbookLoading] = useState(true);
  const [ticker, setTicker] = useState<TickerMessage | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeMessage[]>([]);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market' | 'oco'>('limit');
  const [timeInForce, setTimeInForce] = useState<'gtc' | 'ioc' | 'fok'>('gtc');
  const [postOnly, setPostOnly] = useState(false);
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingDelta, setTrailingDelta] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const clientOrderIdRef = useRef(generateClientOrderId());

  const { data: balancesByAccount = [], refetch: refetchBalances } = useBalancesByAccount(isAuth);
  const { sortWithFavoritesFirst, isFavorite, toggle: toggleFavorite } = useSpotFavorites();
  const balanceMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const row of balancesByAccount) {
      m[row.symbol] = row.trading ?? '0';
    }
    return m;
  }, [balancesByAccount]);

  const sortedMarkets = useMemo(() => sortWithFavoritesFirst(markets), [markets, sortWithFavoritesFirst]);
  const selectedMarket = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';

  const setSymbolAndUrl = useCallback((s: string) => {
    setSymbol(s);
    router.replace(`/dashboard/spot?symbol=${encodeURIComponent(s)}`, { scroll: false });
  }, [router]);

  const handleSideChange = useCallback((s: 'buy' | 'sell') => {
    setSide(s);
    if (s === 'buy') setOrderType((t) => (t === 'oco' ? 'limit' : t));
  }, []);

  useEffect(() => {
    if (orderType !== 'limit') setPostOnly(false);
  }, [orderType]);

  useEffect(() => {
    if (postOnly && timeInForce !== 'gtc') setTimeInForce('gtc');
  }, [postOnly, timeInForce]);
  const makerFee = selectedMarket?.maker_fee ? parseFloat(selectedMarket.maker_fee) : 0.001;
  const takerFee = selectedMarket?.taker_fee ? parseFloat(selectedMarket.taker_fee) : 0.001;
  const pricePrecision = selectedMarket?.price_precision ?? 6;
  const qtyPrecision = selectedMarket?.qty_precision ?? 6;

  const availableBalance = useMemo(() => {
    if (side === 'buy') return balanceMap[quoteAsset] ?? '0';
    return balanceMap[baseAsset] ?? '0';
  }, [side, baseAsset, quoteAsset, balanceMap]);

  // Bybit-style: last price from ticker, else mid of best bid/ask for consistent display in header and orderbook
  const lastPrice =
    ticker?.last_price ??
    (orderbook?.bids?.[0] && orderbook?.asks?.[0]
      ? String((parseFloat(orderbook.bids[0].price) + parseFloat(orderbook.asks[0].price)) / 2)
      : orderbook?.asks?.[0]?.price ?? orderbook?.bids?.[0]?.price ?? null);

  /** Tier-1: prefer (last − open) / open; fallback to legacy (last − low) / low if no trades in window. */
  const dayChangePct24h = useMemo(() => {
    const last = ticker?.last_price != null && ticker.last_price !== '' ? Number(ticker.last_price) : NaN;
    const open = ticker?.open_24h != null && ticker.open_24h !== '' ? Number(ticker.open_24h) : NaN;
    if (Number.isFinite(last) && Number.isFinite(open) && open > 0) {
      return ((last - open) / open) * 100;
    }
    const low = ticker?.low_24h != null && ticker.low_24h !== '' ? Number(ticker.low_24h) : NaN;
    if (Number.isFinite(last) && Number.isFinite(low) && low > 0) {
      return ((last - low) / low) * 100;
    }
    return null;
  }, [ticker?.last_price, ticker?.open_24h, ticker?.low_24h]);
  /** Quote price for total, min-notional, max-qty, and fee estimates (tier-1 accuracy per order type). */
  const effectivePrice = useMemo(() => {
    const last = lastPrice ?? '0';
    if (orderType === 'limit' || orderType === 'oco') return price?.trim() ? price : last;
    if (orderType === 'stop_limit') {
      if (price?.trim()) return price;
      if (stopPrice?.trim()) return stopPrice;
      return last;
    }
    if (orderType === 'stop_loss') return stopPrice?.trim() ? stopPrice : last;
    if (orderType === 'market' || orderType === 'trailing_stop_market') return last;
    return last;
  }, [orderType, price, stopPrice, lastPrice]);

  const priceNum = parseFloat(effectivePrice) || 0;
  const limitFieldNum = parseFloat(price?.trim() || '0') || 0;
  const stopPriceNum = parseFloat(stopPrice) || 0;
  const qtyNum = parseFloat(quantity) || 0;
  const trailingDeltaNum = parseFloat(trailingDelta) || 0;
  const minQty = selectedMarket?.min_qty != null ? parseFloat(selectedMarket.min_qty) : 0;
  const minNotional = selectedMarket?.min_notional != null ? parseFloat(selectedMarket.min_notional) : 0;

  const availNumForMax = parseFloat(availableBalance || '0') || 0;
  const maxBuyBaseEstimate = useMemo(() => {
    if (side !== 'buy' || priceNum <= 0 || availNumForMax <= 0) return null;
    const raw = availNumForMax / priceNum;
    const factor = 10 ** qtyPrecision;
    const floored = Math.floor(raw * factor) / factor;
    return formatFixedTrim(floored, qtyPrecision);
  }, [side, priceNum, availNumForMax, qtyPrecision]);

  const maxSellQuoteEstimate = useMemo(() => {
    if (side !== 'sell' || priceNum <= 0 || availNumForMax <= 0) return null;
    return formatFixedTrim(priceNum * availNumForMax, Math.min(10, Math.max(2, pricePrecision)));
  }, [side, priceNum, availNumForMax, pricePrecision]);

  const { estimatedFillPrice, estimatedSlippagePct } = useMemo(() => {
    if (orderType !== 'market' || !orderbook || qtyNum <= 0 || !lastPrice) return { estimatedFillPrice: null as string | null, estimatedSlippagePct: null as number | null };
    const last = parseFloat(lastPrice);
    if (!Number.isFinite(last) || last <= 0) return { estimatedFillPrice: null, estimatedSlippagePct: null };
    let remaining = qtyNum;
    let cost = 0;
    const levels = side === 'buy' ? orderbook.asks : orderbook.bids;
    for (const row of levels) {
      const p = parseFloat(row.price) || 0;
      const q = parseFloat(row.quantity) || 0;
      if (q <= 0 || p <= 0) continue;
      const fill = Math.min(remaining, q);
      cost += p * fill;
      remaining -= fill;
      if (remaining <= 0) break;
    }
    if (remaining > 0) return { estimatedFillPrice: null, estimatedSlippagePct: null };
    const avgFill = cost / qtyNum;
    const slippagePct = side === 'buy'
      ? ((avgFill - last) / last) * 100
      : ((last - avgFill) / last) * 100;
    return {
      estimatedFillPrice: avgFill.toFixed(8),
      estimatedSlippagePct: Number.isFinite(slippagePct) ? slippagePct : null,
    };
  }, [orderType, orderbook, qtyNum, side, lastPrice]);

  const notional = useMemo(() => {
    if (orderType === 'market' && estimatedFillPrice && qtyNum > 0) {
      const fill = parseFloat(estimatedFillPrice);
      if (Number.isFinite(fill) && fill > 0) return fill * qtyNum;
    }
    return priceNum * qtyNum;
  }, [orderType, estimatedFillPrice, qtyNum, priceNum]);

  const total = useMemo(
    () => formatFixedTrim(notional, Math.min(10, Math.max(2, pricePrecision))),
    [notional, pricePrecision]
  );

  const validationMessage = useMemo(() => {
    if (!selectedMarket) return null;
    if (orderType === 'trailing_stop_market' && trailingDeltaNum > 0 && (trailingDeltaNum < 0.1 || trailingDeltaNum > 100)) {
      return 'Callback rate must be between 0.1% and 100%';
    }
    if (qtyNum > 0 && minQty > 0 && qtyNum < minQty) {
      return `Minimum quantity is ${formatValueFixedTrim(selectedMarket.min_qty, qtyPrecision)} ${baseAsset}`;
    }
    if (notional > 0 && minNotional > 0 && notional < minNotional) {
      return `Minimum notional is ${formatValueFixedTrim(selectedMarket.min_notional, Math.min(10, Math.max(2, pricePrecision)))} ${quoteAsset}`;
    }
    if (orderType === 'market' && qtyNum > 0 && orderbook != null && estimatedFillPrice == null) {
      return 'Visible order book cannot fill this size — reduce quantity or use a limit order.';
    }
    return null;
  }, [
    selectedMarket,
    orderType,
    trailingDeltaNum,
    qtyNum,
    minQty,
    minNotional,
    notional,
    quoteAsset,
    baseAsset,
    qtyPrecision,
    pricePrecision,
    estimatedFillPrice,
    orderbook,
  ]);

  const canSubmit =
    !validationMessage &&
    qtyNum > 0 &&
    baseAsset &&
    quoteAsset &&
    (orderType === 'market' ||
      (orderType === 'limit' && limitFieldNum > 0) ||
      (orderType === 'stop_loss' && stopPriceNum > 0) ||
      (orderType === 'stop_limit' && limitFieldNum > 0 && stopPriceNum > 0) ||
      (orderType === 'trailing_stop_market' && trailingDeltaNum >= 0.1 && trailingDeltaNum <= 100) ||
      (orderType === 'oco' && side === 'sell' && limitFieldNum > 0 && stopPriceNum > 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const key = e.key?.toLowerCase();
      if (key === 'b') { setSide('buy'); e.preventDefault(); }
      else if (key === 's') { setSide('sell'); e.preventDefault(); }
      else if (key === 'p') { document.getElementById('spot-price')?.focus(); e.preventDefault(); }
      else if (key === 'q') { document.getElementById('spot-quantity')?.focus(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSide]);

  const setMaxQty = useCallback(() => {
    if (!baseAsset || !quoteAsset) return;
    const factor = 10 ** qtyPrecision;
    if (side === 'buy') {
      const bal = parseFloat(availableBalance) || 0;
      if (priceNum > 0) {
        const q = Math.floor((bal / priceNum) * factor) / factor;
        setQuantity(q.toFixed(qtyPrecision));
      } else setQuantity('');
    } else {
      const bal = parseFloat(availableBalance) || 0;
      const q = Math.floor(bal * factor) / factor;
      setQuantity(q.toFixed(qtyPrecision));
    }
  }, [side, availableBalance, priceNum, baseAsset, quoteAsset, qtyPrecision]);

  const setQtyPercent = useCallback((percent: number) => {
    if (!baseAsset || !quoteAsset || percent <= 0 || percent > 1) return;
    const factor = 10 ** qtyPrecision;
    if (side === 'buy') {
      const bal = parseFloat(availableBalance) || 0;
      if (priceNum > 0) {
        const raw = (bal * percent) / priceNum;
        const q = Math.floor(raw * factor) / factor;
        setQuantity(q.toFixed(qtyPrecision));
      } else setQuantity('');
    } else {
      const bal = parseFloat(availableBalance) || 0;
      const q = Math.floor(bal * percent * factor) / factor;
      setQuantity(q.toFixed(qtyPrecision));
    }
  }, [side, availableBalance, priceNum, baseAsset, quoteAsset, qtyPrecision]);

  const [tradesVersion, setTradesVersion] = useState(0);
  const orderbookThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOrderbookRef = useRef<OrderbookSnapshot | null>(null);
  const ORDERBOOK_THROTTLE_MS = 100;

  const { subscribe, unsubscribe, connected, reconnectAttempt } = useSpotWs({
    onOrderbook: (data, type) => {
      if (data.symbol !== symbol) return;
      if (type === 'orderbook_snapshot') {
        if (orderbookThrottleRef.current) {
          clearTimeout(orderbookThrottleRef.current);
          orderbookThrottleRef.current = null;
        }
        pendingOrderbookRef.current = null;
        setOrderbook(data);
        return;
      }
      pendingOrderbookRef.current = data;
      if (orderbookThrottleRef.current != null) return;
      orderbookThrottleRef.current = setTimeout(() => {
        orderbookThrottleRef.current = null;
        const pending = pendingOrderbookRef.current;
        if (pending && pending.symbol === symbol) setOrderbook(pending);
      }, ORDERBOOK_THROTTLE_MS);
    },
    onTicker: (data) => {
      if (data.symbol !== symbol) return;
      setTicker((prev) => {
        if (!prev) return { ...data };
        return {
          ...prev,
          last_price: data.last_price ?? prev.last_price,
          bid: data.bid ?? prev.bid,
          ask: data.ask ?? prev.ask,
          volume_24h: data.volume_24h ?? prev.volume_24h,
          base_volume_24h: data.base_volume_24h ?? prev.base_volume_24h,
          open_24h: data.open_24h ?? prev.open_24h,
          high_24h: data.high_24h ?? prev.high_24h,
          low_24h: data.low_24h ?? prev.low_24h,
        };
      });
    },
    onTrades: (data) => {
      setRecentTrades(data.slice(0, 20));
    },
    onOrderUpdate: () => {
      setOrdersVersion((v) => v + 1);
    },
    onTradeUpdate: () => {
      setTradesVersion((v) => v + 1);
    },
  });

  const fetchMarkets = useCallback(async (signal?: AbortSignal) => {
    setMarketsError(null);
    setMarketsLoading(true);
    try {
      const res = await api.get<Market[]>('/api/v1/spot/markets', {
        signal,
        notifyOnError: false,
        skipAuth: true,
      });
      if (signal?.aborted) return;
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        setMarkets(res.data);
        const sym = symbolParam && res.data.some((m) => m.symbol === symbolParam)
          ? symbolParam
          : res.data[0]!.symbol;
        setSymbol(sym);
      } else {
        setMarkets([]);
        setMarketsError(res.success ? 'No markets available' : (res.error?.message ?? 'Failed to load markets'));
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      setMarkets([]);
      setMarketsError('Failed to load markets. Retry.');
    } finally {
      if (!signal?.aborted) setMarketsLoading(false);
    }
  }, [symbolParam]);

  useEffect(() => {
    const ac = new AbortController();
    const fallback = setTimeout(() => {
      ac.abort();
      setMarketsLoading(false);
      setMarketsError(
        'Request timed out — backend slow or unreachable. Start API (e.g. port 4000) and retry.'
      );
    }, 45000);

    fetchMarkets(ac.signal).finally(() => clearTimeout(fallback));

    return () => {
      ac.abort();
      clearTimeout(fallback);
    };
  }, [symbolParam, fetchMarkets]);

  useEffect(() => {
    if (!symbol) return;
    const ac = new AbortController();
    if (orderbookThrottleRef.current) {
      clearTimeout(orderbookThrottleRef.current);
      orderbookThrottleRef.current = null;
    }
    pendingOrderbookRef.current = null;
    setOrderbook(null);
    setOrderbookLoading(true);

    const currentSymbol = symbol;
    api.get<{ bids: { price: string; quantity: string }[]; asks: { price: string; quantity: string }[] }>(
      `/api/v1/spot/orderbook/${encodeURIComponent(symbol)}?limit=20`,
      { signal: ac.signal, notifyOnError: false, skipAuth: true }
    ).then((res) => {
      if (ac.signal.aborted) return;
      if (res.success && res.data && currentSymbol === symbol) {
        setOrderbook({
          symbol: currentSymbol,
          bids: res.data.bids ?? [],
          asks: res.data.asks ?? [],
        });
      }
    }).catch((e) => {
      if (e?.name === 'AbortError') return;
    }).finally(() => {
      if (!ac.signal.aborted) setOrderbookLoading(false);
    });

    api.get<{
      last_price: string | null;
      bid: string | null;
      ask: string | null;
      volume_24h?: string;
      base_volume_24h?: string;
      open_24h?: string | null;
      high_24h?: string;
      low_24h?: string;
    }>(`/api/v1/spot/ticker/${encodeURIComponent(symbol)}`, {
      signal: ac.signal,
      notifyOnError: false,
      skipAuth: true,
    }).then((res) => {
      if (ac.signal.aborted) return;
      if (res.success && res.data && currentSymbol === symbol) {
        setTicker({
          symbol: currentSymbol,
          last_price: res.data.last_price,
          bid: res.data.bid,
          ask: res.data.ask,
          volume_24h: res.data.volume_24h,
          base_volume_24h: res.data.base_volume_24h,
          open_24h: res.data.open_24h ?? null,
          high_24h: res.data.high_24h,
          low_24h: res.data.low_24h,
        });
      }
    }).catch((e) => {
      if (e?.name === 'AbortError') return;
    });

    return () => ac.abort();
  }, [symbol]);

  useEffect(() => {
    if (!symbol || !connected) return;
    subscribe(`orderbook:${symbol}`);
    subscribe(`ticker:${symbol}`);
    subscribe(`trades:${symbol}`);
    if (isAuth) {
      subscribe('user.orders');
      subscribe('user.trades');
    }
    return () => {
      unsubscribe(`orderbook:${symbol}`);
      unsubscribe(`ticker:${symbol}`);
      unsubscribe(`trades:${symbol}`);
      if (isAuth) {
        unsubscribe('user.orders');
        unsubscribe('user.trades');
      }
    };
  }, [symbol, connected, isAuth, subscribe, unsubscribe]);

  const handlePriceClick = useCallback((p: string, q: string) => {
    setPrice(p);
    if (q && !quantity) setQuantity(q);
  }, [quantity]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!isAuth || !symbol || submitting || !canSubmit) {
      throw new Error('Cannot submit order');
    }
    setSubmitError(null);
    setSubmitting(true);
    const qtySnap = quantity.trim();
    try {
      if (orderType === 'oco' && side === 'sell') {
        const ocoGroupId = generateClientOrderId();
        const body1: Record<string, string> = {
          market: symbol,
          side: 'sell',
          type: 'limit',
          price: price.trim(),
          quantity: qtySnap,
          time_in_force: 'gtc',
          oco_group_id: ocoGroupId,
          client_order_id: generateClientOrderId(),
        };
        const body2: Record<string, string> = {
          market: symbol,
          side: 'sell',
          type: 'stop_loss',
          stop_price: stopPrice.trim(),
          quantity: qtySnap,
          time_in_force: 'gtc',
          oco_group_id: ocoGroupId,
          client_order_id: generateClientOrderId(),
        };
        const res1 = await api.post<{ id?: string }>('/api/v1/spot/order', body1);
        if (!res1.success) {
          const msg = getMessageFromApiError(res1.error) ?? res1.error?.message ?? 'OCO limit order failed';
          setSubmitError(msg);
          throw new Error(msg);
        }
        const res2 = await api.post<{ id?: string }>('/api/v1/spot/order', body2);
        if (!res2.success) {
          setSubmitError('Take-profit order placed, but stop-loss failed. Cancel the TP order in Open Orders if needed.');
          setOrdersVersion((v) => v + 1);
          queryClient.invalidateQueries({ queryKey: ['balances'] });
          refetchBalances();
          throw new Error('OCO partial failure');
        }
        setQuantity('');
        setPrice('');
        setStopPrice('');
        setOrdersVersion((v) => v + 1);
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        refetchBalances();
        toast({ title: 'OCO order placed', description: `Take-profit + Stop-loss for ${qtySnap} ${baseAsset}`, variant: 'success' });
        return;
      }
      const cid = generateClientOrderId();
      clientOrderIdRef.current = cid;
      const body: Record<string, string | boolean> = {
        market: symbol,
        side,
        type: orderType,
        quantity: qtySnap,
        client_order_id: cid,
      };
      if ((orderType === 'limit' || orderType === 'stop_limit') && price.trim()) body.price = price.trim();
      if ((orderType === 'stop_loss' || orderType === 'stop_limit') && stopPrice.trim()) body.stop_price = stopPrice.trim();
      if (orderType === 'trailing_stop_market' && trailingDelta.trim()) body.trailing_delta = trailingDelta.trim();
      if (orderType === 'limit' || orderType === 'stop_limit') body.time_in_force = timeInForce;
      if (orderType === 'market' || orderType === 'trailing_stop_market') body.time_in_force = 'ioc';
      if (orderType === 'limit' && postOnly) body.post_only = true;

      const res = await api.post<{ id?: string }>('/api/v1/spot/order', body);
      if (res.success) {
        const base = baseAsset;
        const sd = side;
        const ot = orderType;
        setQuantity('');
        setPrice('');
        setStopPrice('');
        setTrailingDelta('');
        setOrdersVersion((v) => v + 1);
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        refetchBalances();
        toast({
          title: 'Order placed',
          description: `${sd === 'buy' ? 'Buy' : 'Sell'} ${qtySnap} ${base} ${ot === 'market' ? '(Market)' : '(Limit)'}`,
          variant: 'success',
        });
      } else {
        const msg = getMessageFromApiError(res.error) ?? res.error?.message ?? 'Order failed';
        setSubmitError(msg);
        throw new Error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }, [isAuth, symbol, side, orderType, timeInForce, postOnly, price, stopPrice, trailingDelta, quantity, canSubmit, submitting, baseAsset, queryClient, refetchBalances]);

  if (marketsLoading && markets.length === 0 && !marketsError) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-gray-50 px-4 dark:bg-[#0b0e11]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" aria-hidden />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Loading spot markets…</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-5 bg-gray-50 px-4 dark:bg-[#0b0e11]">
        <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-800 dark:bg-[#181a20]">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{marketsError || 'No spot markets available'}</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Start the backend (default <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">http://localhost:4000</code>
            ), ensure Postgres is up, and run migrations/seed if <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">spot_markets</code> is empty.
          </p>
          {typeof window !== 'undefined' && (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              API base: <span className="font-mono">{getApiBaseUrl() || '(same origin)'}</span>
              {' · '}
              Override with <span className="font-mono">NEXT_PUBLIC_API_BASE_URL</span>
            </p>
          )}
          {(marketsError || marketsLoading) && (
            <button
              type="button"
              onClick={() => fetchMarkets()}
              disabled={marketsLoading}
              className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (markets.length > 0 && !symbol) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50 dark:bg-[#0b0e11]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-sm text-gray-600 dark:text-gray-400">Preparing terminal…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-[#0b0e11] dark:text-gray-100">
      {!connected && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
          {reconnectAttempt > 0 ? `Reconnecting (attempt ${reconnectAttempt})…` : 'Market data stream disconnected — order book may be stale.'}
        </div>
      )}
      <ExchangeHeader
        showPairSearch
        currentSymbol={symbol}
        symbols={markets.map((m) => m.symbol)}
        onSymbolSelect={setSymbolAndUrl}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3">
        <div
          className={[
            'grid min-h-0 flex-1 gap-2',
            'grid-cols-1',
            'md:grid-cols-2',
            'lg:grid-cols-[minmax(0,6fr)_minmax(0,1.8fr)_minmax(0,2.2fr)]',
            'grid-rows-[1fr_minmax(220px,auto)]',
            'md:grid-rows-[1fr_minmax(220px,auto)]',
            'lg:grid-rows-[1fr_minmax(220px,auto)]',
          ].join(' ')}
        >
        {/* Chart + pair strip (aligned with chart only) */}
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-white shadow-sm dark:border-gray-800/90 dark:bg-[#181a20] dark:shadow-none md:col-span-1 lg:col-start-1 lg:row-start-1">
          <PairHeader
            embedded
            symbol={symbol}
            baseAsset={baseAsset}
            quoteAsset={quoteAsset}
            lastPrice={ticker?.last_price ?? null}
            bid={orderbook?.bids?.[0]?.price ?? ticker?.bid ?? null}
            ask={orderbook?.asks?.[0]?.price ?? ticker?.ask ?? null}
            pricePrecision={pricePrecision}
            changePct24h={dayChangePct24h}
            high24h={ticker?.high_24h ?? null}
            low24h={ticker?.low_24h ?? null}
            volume24h={ticker?.base_volume_24h ?? null}
            turnover24h={ticker?.volume_24h ?? null}
            markets={sortedMarkets}
            onSymbolChange={setSymbolAndUrl}
            wsConnected={connected}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            tierLevel={user?.tierLevel}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ChartErrorBoundary resetKey={`${symbol}-${chartIntervalSeconds}-${chartViewMode}`}>
              <ChartPanel
                symbol={symbol}
                baseAsset={baseAsset}
                quoteAsset={quoteAsset}
                pricePrecision={pricePrecision}
                intervalSeconds={chartIntervalSeconds}
                theme={chartTheme}
                lastPrice={ticker?.last_price ?? null}
                bid={ticker?.bid ?? null}
                ask={ticker?.ask ?? null}
                high24h={ticker?.high_24h ?? null}
                low24h={ticker?.low_24h ?? null}
                volume24h={ticker?.base_volume_24h ?? null}
                turnoverQuote24h={ticker?.volume_24h ?? null}
                dayChangePct24h={dayChangePct24h}
                onIntervalSecondsChange={setChartIntervalSeconds}
                livePrice={ticker?.last_price ?? null}
                liveTrades={recentTrades}
                viewMode={chartViewMode}
                onViewModeChange={setChartViewMode}
                depthBids={orderbook?.bids ?? []}
                depthAsks={orderbook?.asks ?? []}
                hideDuplicatePairSummary
              />
            </ChartErrorBoundary>
          </div>
          {chartViewMode === 'chart' && (
            <SpotDepthChart bids={orderbook?.bids ?? []} asks={orderbook?.asks ?? []} height={70} />
          )}
        </div>

        {/* Middle (lg) / Left col row 2 (md): Orderbook + Bottom. On lg use contents so Orderbook and Bottom are separate grid cells. */}
        <div className="flex min-h-0 flex-col md:col-start-1 md:row-start-2 lg:contents">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-white shadow-sm dark:border-gray-800/90 dark:bg-[#181a20] dark:shadow-none lg:col-start-2 lg:row-start-1 lg:h-full lg:min-h-0">
            <SpotOrderbookPanel
              bids={orderbook?.bids ?? []}
              asks={orderbook?.asks ?? []}
              quoteAsset={quoteAsset}
              baseAsset={baseAsset}
              onPriceClick={handlePriceClick}
              onTradePriceClick={handlePriceClick}
              loading={orderbookLoading}
              recentTrades={recentTrades}
              lastPrice={ticker?.last_price ?? null}
              pricePrecision={pricePrecision}
              qtyPrecision={qtyPrecision}
            />
          </div>
          {/* Bottom panel: lg = col 1–2 row 2 (left end to middle); on md below orderbook in same column */}
          <div
            id="spot-terminal-activity"
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-white shadow-sm dark:border-gray-800/90 dark:bg-[#181a20] dark:shadow-none lg:col-span-2 lg:col-start-1 lg:row-start-2 scroll-mt-4"
          >
            <SpotBottomPanel symbol={symbol} isAuth={isAuth} ordersVersion={ordersVersion} tradesVersion={tradesVersion} />
          </div>
        </div>

        {/* Right: Buy/Sell — full height (spans both rows on lg) */}
        <div className="min-h-0 min-w-0 rounded-lg border border-gray-200/90 bg-white shadow-sm dark:border-gray-800/90 dark:bg-[#181a20] dark:shadow-none md:col-start-2 md:row-start-1 md:row-span-2 lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <SpotOrderEntryPanel
            side={side}
            orderType={orderType}
            price={price}
            stopPrice={stopPrice}
            trailingDelta={trailingDelta}
            quantity={quantity}
            total={total}
            notionalQuote={notional}
            referencePrice={priceNum}
            maxBuyBaseEstimate={maxBuyBaseEstimate}
            maxSellQuoteEstimate={maxSellQuoteEstimate}
            baseAsset={baseAsset}
            quoteAsset={quoteAsset}
            availableBalance={availableBalance}
            pricePrecision={pricePrecision}
            qtyPrecision={qtyPrecision}
            makerFeePercent={makerFee}
            takerFeePercent={takerFee}
            timeInForce={timeInForce}
            canSubmit={!!(canSubmit && isAuth)}
            isAuth={isAuth}
            validationMessage={validationMessage ?? undefined}
            loading={submitting}
            onSideChange={handleSideChange}
            onOrderTypeChange={setOrderType}
            onPriceChange={setPrice}
            onStopPriceChange={setStopPrice}
            onTrailingDeltaChange={setTrailingDelta}
            onQuantityChange={setQuantity}
            onSetMaxQty={setMaxQty}
            onSetQtyPercent={setQtyPercent}
            onTimeInForceChange={setTimeInForce}
            postOnly={postOnly}
            onPostOnlyChange={setPostOnly}
            onSubmit={handleSubmit}
            estimatedFillPrice={estimatedFillPrice}
            estimatedSlippagePct={estimatedSlippagePct}
            bestBid={orderbook?.bids?.[0]?.price ?? ticker?.bid ?? null}
            bestAsk={orderbook?.asks?.[0]?.price ?? ticker?.ask ?? null}
            lastPrice={lastPrice}
            instrumentMinQty={selectedMarket?.min_qty}
            instrumentMinNotional={selectedMarket?.min_notional}
          />
        </div>
        </div>
      </div>
      {submitError && (
        <div className="px-4 py-2 bg-destructive/20 text-destructive text-sm border-t border-destructive/20 flex justify-between items-center">
          <span>{submitError}</span>
          <button type="button" onClick={() => setSubmitError(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
