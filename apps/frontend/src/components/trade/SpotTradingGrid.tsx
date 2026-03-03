'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useBalancesByAccount } from '@/lib/balances';
import { useSpotWs, type OrderbookSnapshot, type TickerMessage, type TradeMessage } from '@/hooks/useSpotWs';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { toast } from '@/components/ui/toaster';
import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
import { SpotDepthChart } from './SpotDepthChart';
import { SpotOrderbookPanel } from './SpotOrderbookPanel';
import { SpotOrderEntryPanel } from './SpotOrderEntryPanel';
import { SpotBottomPanel } from './SpotBottomPanel';

type Market = {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  status?: string;
  maker_fee?: string;
  taker_fee?: string;
  min_qty?: string;
  min_notional?: string;
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
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get('symbol')?.toUpperCase().replace(/-/g, '_') ?? '';
  const { accessToken } = useAuthStore();
  const isAuth = Boolean(accessToken);

  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [symbol, setSymbol] = useState('');
  const [orderbook, setOrderbook] = useState<OrderbookSnapshot | null>(null);
  const [orderbookLoading, setOrderbookLoading] = useState(true);
  const [ticker, setTicker] = useState<TickerMessage | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeMessage[]>([]);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market'>('limit');
  const [timeInForce, setTimeInForce] = useState<'gtc' | 'ioc' | 'fok'>('gtc');
  const [price, setPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [trailingDelta, setTrailingDelta] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const clientOrderIdRef = useRef(generateClientOrderId());

  const { data: balancesByAccount = [], refetch: refetchBalances } = useBalancesByAccount(isAuth);
  const balanceMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const row of balancesByAccount) {
      m[row.symbol] = row.trading ?? '0';
    }
    return m;
  }, [balancesByAccount]);

  const selectedMarket = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';
  const makerFee = selectedMarket?.maker_fee ? parseFloat(selectedMarket.maker_fee) : 0.001;
  const takerFee = selectedMarket?.taker_fee ? parseFloat(selectedMarket.taker_fee) : 0.001;

  const availableBalance = useMemo(() => {
    if (side === 'buy') return balanceMap[quoteAsset] ?? '0';
    return balanceMap[baseAsset] ?? '0';
  }, [side, baseAsset, quoteAsset, balanceMap]);

  const lastPrice = ticker?.last_price ?? (orderbook
    ? (orderbook.asks[0]?.price ?? orderbook.bids[0]?.price ?? null)
    : null);
  const isStop = orderType === 'stop_loss' || orderType === 'stop_limit';
  const effectivePrice = (orderType === 'limit' || orderType === 'stop_limit') && price ? price : lastPrice ?? '0';
  const priceNum = parseFloat(effectivePrice) || 0;
  const stopPriceNum = parseFloat(stopPrice) || 0;
  const qtyNum = parseFloat(quantity) || 0;
  const total = (priceNum * qtyNum).toFixed(8);
  const trailingDeltaNum = parseFloat(trailingDelta) || 0;
  const canSubmit =
    qtyNum > 0 &&
    baseAsset &&
    quoteAsset &&
    (orderType === 'market' ||
      (orderType === 'limit' && priceNum > 0) ||
      (orderType === 'stop_loss' && stopPriceNum > 0) ||
      (orderType === 'stop_limit' && priceNum > 0 && stopPriceNum > 0) ||
      (orderType === 'trailing_stop_market' && trailingDeltaNum > 0 && trailingDeltaNum <= 100));

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

  const setMaxQty = useCallback(() => {
    if (!baseAsset || !quoteAsset) return;
    if (side === 'buy') {
      const bal = parseFloat(availableBalance) || 0;
      const priceForMax = orderType === 'stop_loss' && stopPriceNum > 0 ? stopPriceNum : priceNum;
      if (priceForMax > 0) setQuantity((bal / priceForMax).toFixed(8));
      else setQuantity('');
    } else {
      setQuantity(availableBalance || '0');
    }
  }, [side, availableBalance, priceNum, stopPriceNum, orderType, baseAsset, quoteAsset]);

  const setQtyPercent = useCallback((percent: number) => {
    if (!baseAsset || !quoteAsset || percent <= 0 || percent > 1) return;
    if (side === 'buy') {
      const bal = parseFloat(availableBalance) || 0;
      const priceForMax = orderType === 'stop_loss' && stopPriceNum > 0 ? stopPriceNum : priceNum;
      if (priceForMax > 0) setQuantity(((bal * percent) / priceForMax).toFixed(8));
      else setQuantity('');
    } else {
      const bal = parseFloat(availableBalance) || 0;
      setQuantity((bal * percent).toFixed(8));
    }
  }, [side, availableBalance, priceNum, stopPriceNum, orderType, baseAsset, quoteAsset]);

  const { subscribe, unsubscribe, connected } = useSpotWs({
    onOrderbook: (data) => {
      if (data.symbol === symbol) setOrderbook(data);
    },
    onTicker: (data) => {
      if (data.symbol === symbol) setTicker(data);
    },
    onTrades: (data) => {
      setRecentTrades(data.slice(0, 20));
    },
  });

  useEffect(() => {
    let cancelled = false;
    api.get<Market[]>('/api/v1/spot/markets').then((res) => {
      if (cancelled) return;
      setMarketsLoading(false);
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        setMarkets(res.data);
        const sym = symbolParam && res.data.some((m) => m.symbol === symbolParam)
          ? symbolParam
          : res.data[0]!.symbol;
        setSymbol(sym);
      }
    }).catch(() => {
      if (!cancelled) setMarketsLoading(false);
    });
    return () => { cancelled = true; };
  }, [symbolParam]);

  useEffect(() => {
    if (!symbol) return;
    setOrderbook(null);
    setOrderbookLoading(true);
    api.get<{ bids: { price: string; quantity: string }[]; asks: { price: string; quantity: string }[] }>(
      `/api/v1/spot/orderbook/${encodeURIComponent(symbol)}?limit=20`
    ).then((res) => {
      if (res.success && res.data) {
        setOrderbook({
          symbol,
          bids: res.data.bids ?? [],
          asks: res.data.asks ?? [],
        });
      }
    }).catch(() => {}).finally(() => setOrderbookLoading(false));

    api.get<{
      last_price: string | null;
      bid: string | null;
      ask: string | null;
      volume_24h?: string;
      high_24h?: string;
      low_24h?: string;
    }>(`/api/v1/spot/ticker/${encodeURIComponent(symbol)}`).then((res) => {
      if (res.success && res.data) {
        setTicker({
          symbol,
          last_price: res.data.last_price,
          bid: res.data.bid,
          ask: res.data.ask,
          volume_24h: res.data.volume_24h,
          high_24h: res.data.high_24h,
          low_24h: res.data.low_24h,
        });
      }
    }).catch(() => {});
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

  const handleSubmit = useCallback(async () => {
    if (!isAuth || !symbol || submitting || !canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    const cid = generateClientOrderId();
    clientOrderIdRef.current = cid;
    const body: Record<string, string> = {
      market: symbol,
      side,
      type: orderType,
      quantity: quantity.trim(),
      client_order_id: cid,
    };
    if ((orderType === 'limit' || orderType === 'stop_limit') && price.trim()) body.price = price.trim();
    if ((orderType === 'stop_loss' || orderType === 'stop_limit') && stopPrice.trim()) body.stop_price = stopPrice.trim();
    if (orderType === 'trailing_stop_market' && trailingDelta.trim()) body.trailing_delta = trailingDelta.trim();
    if (orderType === 'limit' || orderType === 'stop_limit') body.time_in_force = timeInForce;
    if (orderType === 'market' || orderType === 'trailing_stop_market') body.time_in_force = 'ioc';

    const res = await api.post<{ id?: string }>('/api/v1/spot/order', body);
    setSubmitting(false);
    if (res.success) {
      const qty = quantity;
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
        description: `${sd === 'buy' ? 'Buy' : 'Sell'} ${qty} ${base} ${ot === 'market' ? '(Market)' : '(Limit)'}`,
        variant: 'success',
      });
    } else {
      setSubmitError(getMessageFromApiError(res.error) ?? res.error?.message ?? 'Order failed');
    }
  }, [isAuth, symbol, side, orderType, timeInForce, price, stopPrice, trailingDelta, quantity, canSubmit, submitting, queryClient, refetchBalances]);

  if (marketsLoading || (markets.length > 0 && !symbol)) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0b0e11] text-gray-400">
        Loading markets…
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#0b0e11] text-gray-400">
        No spot markets available
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-[#0b0e11] text-white">
      <PairHeader
        symbol={symbol}
        baseAsset={baseAsset}
        quoteAsset={quoteAsset}
        lastPrice={ticker?.last_price ?? null}
        high24h={ticker?.high_24h ?? null}
        low24h={ticker?.low_24h ?? null}
        volume24h={ticker?.volume_24h ?? null}
        markets={markets}
        onSymbolChange={setSymbol}
        wsConnected={connected}
      />
      <div className="flex-1 min-h-0 grid grid-cols-[58fr_21fr_21fr] gap-px bg-white/5 p-0">
        <div className="flex flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0">
            <ChartPanel symbol={symbol} intervalSeconds={60} theme="dark" />
          </div>
          <SpotDepthChart bids={orderbook?.bids ?? []} asks={orderbook?.asks ?? []} height={72} />
        </div>
        <SpotOrderbookPanel
          bids={orderbook?.bids ?? []}
          asks={orderbook?.asks ?? []}
          quoteAsset={quoteAsset}
          baseAsset={baseAsset}
          onPriceClick={handlePriceClick}
          loading={orderbookLoading}
          recentTrades={recentTrades}
        />
        <SpotOrderEntryPanel
          side={side}
          orderType={orderType}
          price={price}
          stopPrice={stopPrice}
          trailingDelta={trailingDelta}
          quantity={quantity}
          total={total}
          baseAsset={baseAsset}
          quoteAsset={quoteAsset}
          availableBalance={availableBalance}
          makerFeePercent={makerFee}
          takerFeePercent={takerFee}
          timeInForce={timeInForce}
          canSubmit={!!(canSubmit && isAuth)}
          loading={submitting}
          onSideChange={setSide}
          onOrderTypeChange={setOrderType}
          onPriceChange={setPrice}
          onStopPriceChange={setStopPrice}
          onTrailingDeltaChange={setTrailingDelta}
          onQuantityChange={setQuantity}
          onSetMaxQty={setMaxQty}
          onSetQtyPercent={setQtyPercent}
          onTimeInForceChange={setTimeInForce}
          onSubmit={handleSubmit}
          estimatedFillPrice={estimatedFillPrice}
          estimatedSlippagePct={estimatedSlippagePct}
        />
      </div>
      {submitError && (
        <div className="px-4 py-2 bg-red-500/20 text-red-400 text-sm border-t border-red-500/20 flex justify-between items-center">
          <span>{submitError}</span>
          <button type="button" onClick={() => setSubmitError(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}
      <SpotBottomPanel symbol={symbol} isAuth={isAuth} ordersVersion={ordersVersion} />
    </div>
  );
}
