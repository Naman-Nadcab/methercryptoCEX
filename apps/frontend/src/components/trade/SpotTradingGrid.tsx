'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useBalancesByAccount } from '@/lib/balances';
import { useSpotWs, type OrderbookSnapshot, type TickerMessage, type TradeMessage } from '@/hooks/useSpotWs';
import { getMessageFromApiError } from '@/lib/errorMessages';
import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
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
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
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
  const effectivePrice = orderType === 'limit' && price ? price : lastPrice ?? '0';
  const priceNum = parseFloat(effectivePrice) || 0;
  const qtyNum = parseFloat(quantity) || 0;
  const total = (priceNum * qtyNum).toFixed(8);
  const canSubmit =
    qtyNum > 0 &&
    (orderType === 'market' || (orderType === 'limit' && priceNum > 0)) &&
    baseAsset &&
    quoteAsset;

  const setMaxQty = useCallback(() => {
    if (!baseAsset || !quoteAsset) return;
    if (side === 'buy') {
      const bal = parseFloat(availableBalance) || 0;
      if (priceNum > 0) setQuantity((bal / priceNum).toFixed(8));
      else setQuantity('');
    } else {
      setQuantity(availableBalance || '0');
    }
  }, [side, availableBalance, priceNum, baseAsset, quoteAsset]);

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
    if (orderType === 'limit' && price.trim()) body.price = price.trim();

    const res = await api.post<{ id?: string }>('/api/v1/spot/orders', body);
    setSubmitting(false);
    if (res.success) {
      setQuantity('');
      setPrice('');
      setOrdersVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      refetchBalances();
    } else {
      setSubmitError(getMessageFromApiError(res.error) ?? res.error?.message ?? 'Order failed');
    }
  }, [isAuth, symbol, side, orderType, price, quantity, canSubmit, submitting, queryClient, refetchBalances]);

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
      />
      <div className="flex-1 min-h-0 grid grid-cols-[58fr_21fr_21fr] gap-[1px] bg-white/5">
        <ChartPanel symbol={symbol} intervalSeconds={60} theme="dark" />
        <SpotOrderbookPanel
          bids={orderbook?.bids ?? []}
          asks={orderbook?.asks ?? []}
          quoteAsset={quoteAsset}
          baseAsset={baseAsset}
          onPriceClick={handlePriceClick}
        />
        <SpotOrderEntryPanel
          side={side}
          orderType={orderType}
          price={price}
          quantity={quantity}
          total={total}
          baseAsset={baseAsset}
          quoteAsset={quoteAsset}
          availableBalance={availableBalance}
          makerFeePercent={makerFee}
          takerFeePercent={takerFee}
          canSubmit={!!(canSubmit && isAuth)}
          loading={submitting}
          onSideChange={setSide}
          onOrderTypeChange={setOrderType}
          onPriceChange={setPrice}
          onQuantityChange={setQuantity}
          onSetMaxQty={setMaxQty}
          onSubmit={handleSubmit}
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
