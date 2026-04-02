'use client';

import { memo, useCallback, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { ExchangeHeader } from '@/components/layout/ExchangeHeader';
import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
import { ChartErrorBoundary } from './chart/ChartErrorBoundary';
import { SpotDepthChart } from './SpotDepthChart';
import { SpotOrderbookPanel } from './SpotOrderbookPanel';
import { SpotOrderEntryPanel } from './SpotOrderEntryPanel';
import { SpotBottomPanel } from './SpotBottomPanel';
import { SpotPositionPanel } from './SpotPositionPanel';
import { formatFixedTrim, formatValueFixedTrim } from './terminalFormat';
import {
  useSpotMarketOrderbook,
  useSpotMarketTicker,
  useSpotMarketTrades,
  useSpotMarketStream,
} from './SpotMarketDataContext';

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

function useDayChangePct24h(ticker: ReturnType<typeof useSpotMarketTicker>['ticker']) {
  return useMemo(() => {
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
}

const SpotDepthSection = memo(function SpotDepthSection() {
  const { orderbook } = useSpotMarketOrderbook();
  return <SpotDepthChart bids={orderbook?.bids ?? []} asks={orderbook?.asks ?? []} height={70} />;
});

function SpotChartSection({
  symbol,
  baseAsset,
  quoteAsset,
  pricePrecision,
  chartIntervalSeconds,
  chartTheme,
  chartViewMode,
  onIntervalSecondsChange,
  onViewModeChange,
}: {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  chartIntervalSeconds: number;
  chartTheme: 'dark' | 'light';
  chartViewMode: 'chart' | 'depth';
  onIntervalSecondsChange: (v: number) => void;
  onViewModeChange: (m: 'chart' | 'depth') => void;
}) {
  const { ticker } = useSpotMarketTicker();
  const { recentTrades } = useSpotMarketTrades();
  const { orderbook } = useSpotMarketOrderbook();
  const dayChangePct24h = useDayChangePct24h(ticker);

  return (
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
        onIntervalSecondsChange={onIntervalSecondsChange}
        livePrice={ticker?.last_price ?? null}
        liveTrades={recentTrades}
        viewMode={chartViewMode}
        onViewModeChange={onViewModeChange}
        depthBids={orderbook?.bids ?? []}
        depthAsks={orderbook?.asks ?? []}
        hideDuplicatePairSummary
      />
    </ChartErrorBoundary>
  );
}

function SpotPairHeaderSection({
  embedded,
  symbol,
  baseAsset,
  quoteAsset,
  pricePrecision,
  sortedMarkets,
  onSymbolChange,
  isFavorite,
  onToggleFavorite,
  tierLevel,
}: {
  embedded?: boolean;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  sortedMarkets: Market[];
  onSymbolChange: (s: string) => void;
  isFavorite: (s: string) => boolean;
  onToggleFavorite: (s: string) => void;
  tierLevel?: number;
}) {
  const { ticker } = useSpotMarketTicker();
  const { orderbook } = useSpotMarketOrderbook();
  const { streamPhase, lastRttMs } = useSpotMarketStream();
  const dayChangePct24h = useDayChangePct24h(ticker);

  const lastPrice =
    ticker?.last_price ??
    (orderbook?.bids?.[0] && orderbook?.asks?.[0]
      ? String((parseFloat(orderbook.bids[0].price) + parseFloat(orderbook.asks[0].price)) / 2)
      : orderbook?.asks?.[0]?.price ?? orderbook?.bids?.[0]?.price ?? null);

  return (
    <PairHeader
      embedded={embedded}
      symbol={symbol}
      baseAsset={baseAsset}
      quoteAsset={quoteAsset}
      lastPrice={lastPrice}
      bid={orderbook?.bids?.[0]?.price ?? ticker?.bid ?? null}
      ask={orderbook?.asks?.[0]?.price ?? ticker?.ask ?? null}
      pricePrecision={pricePrecision}
      changePct24h={dayChangePct24h}
      high24h={ticker?.high_24h ?? null}
      low24h={ticker?.low_24h ?? null}
      volume24h={ticker?.base_volume_24h ?? null}
      turnover24h={ticker?.volume_24h ?? null}
      markets={sortedMarkets}
      onSymbolChange={onSymbolChange}
      wsStreamPhase={streamPhase}
      wsLastRttMs={lastRttMs}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      tierLevel={tierLevel}
    />
  );
}

const SpotOrderbookSection = memo(function SpotOrderbookSection({
  quoteAsset,
  baseAsset,
  pricePrecision,
  qtyPrecision,
  onPriceClick,
}: {
  quoteAsset: string;
  baseAsset: string;
  pricePrecision: number;
  qtyPrecision: number;
  onPriceClick: (p: string, q: string) => void;
}) {
  const { orderbook, orderbookLoading } = useSpotMarketOrderbook();
  const { ticker } = useSpotMarketTicker();
  const { recentTrades } = useSpotMarketTrades();

  return (
    <SpotOrderbookPanel
      bids={orderbook?.bids ?? []}
      asks={orderbook?.asks ?? []}
      quoteAsset={quoteAsset}
      baseAsset={baseAsset}
      onPriceClick={onPriceClick}
      onTradePriceClick={onPriceClick}
      loading={orderbookLoading}
      recentTrades={recentTrades}
      lastPrice={ticker?.last_price ?? null}
      pricePrecision={pricePrecision}
      qtyPrecision={qtyPrecision}
    />
  );
});

function SpotOrderEntrySection({
  side,
  orderType,
  timeInForce,
  postOnly,
  price,
  stopPrice,
  trailingDelta,
  quantity,
  baseAsset,
  quoteAsset,
  availableBalance,
  pricePrecision,
  qtyPrecision,
  makerFee,
  takerFee,
  isAuth,
  submitting,
  handleSideChange,
  setOrderType,
  setPrice,
  setStopPrice,
  setTrailingDelta,
  setQuantity,
  setTimeInForce,
  setPostOnly,
  handleSubmit,
  selectedMarket,
}: {
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market';
  timeInForce: 'gtc' | 'ioc' | 'fok';
  postOnly: boolean;
  price: string;
  stopPrice: string;
  trailingDelta: string;
  quantity: string;
  baseAsset: string;
  quoteAsset: string;
  availableBalance: string;
  pricePrecision: number;
  qtyPrecision: number;
  makerFee: number;
  takerFee: number;
  isAuth: boolean;
  submitting: boolean;
  handleSideChange: (s: 'buy' | 'sell') => void;
  setOrderType: (t: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market') => void;
  setPrice: (v: string) => void;
  setStopPrice: (v: string) => void;
  setTrailingDelta: (v: string) => void;
  setQuantity: (v: string) => void;
  setTimeInForce: (t: 'gtc' | 'ioc' | 'fok') => void;
  setPostOnly: (v: boolean) => void;
  handleSubmit: () => Promise<void>;
  selectedMarket: Market | undefined;
}) {
  const { orderbook } = useSpotMarketOrderbook();
  const { ticker } = useSpotMarketTicker();

  const lastPrice =
    ticker?.last_price ??
    (orderbook?.bids?.[0] && orderbook?.asks?.[0]
      ? String((parseFloat(orderbook.bids[0].price) + parseFloat(orderbook.asks[0].price)) / 2)
      : orderbook?.asks?.[0]?.price ?? orderbook?.bids?.[0]?.price ?? null);

  const effectivePrice = useMemo(() => {
    const last = lastPrice ?? '0';
    if (orderType === 'limit') return price?.trim() ? price : last;
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
  }, [side, availableBalance, priceNum, baseAsset, quoteAsset, qtyPrecision, setQuantity]);

  const setQtyPercent = useCallback(
    (percent: number) => {
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
    },
    [side, availableBalance, priceNum, baseAsset, quoteAsset, qtyPrecision, setQuantity]
  );

  const { estimatedFillPrice, estimatedSlippagePct } = useMemo(() => {
    if (orderType !== 'market' || !orderbook || qtyNum <= 0 || !lastPrice) {
      return { estimatedFillPrice: null as string | null, estimatedSlippagePct: null as number | null };
    }
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
    const slippagePct =
      side === 'buy' ? ((avgFill - last) / last) * 100 : ((last - avgFill) / last) * 100;
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
      (orderType === 'trailing_stop_market' && trailingDeltaNum >= 0.1 && trailingDeltaNum <= 100));

  return (
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
      canSubmit={Boolean(canSubmit && isAuth)}
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
  );
}

export interface SpotTradingGridTerminalProps {
  markets: Market[];
  sortedMarkets: Market[];
  symbol: string;
  setSymbolAndUrl: (s: string) => void;
  isAuth: boolean;
  userTierLevel?: number;
  chartTheme: 'dark' | 'light';
  chartIntervalSeconds: number;
  setChartIntervalSeconds: (v: number) => void;
  chartViewMode: 'chart' | 'depth';
  setChartViewMode: (m: 'chart' | 'depth') => void;
  isFavorite: (s: string) => boolean;
  toggleFavorite: (s: string) => void;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market';
  timeInForce: 'gtc' | 'ioc' | 'fok';
  postOnly: boolean;
  price: string;
  stopPrice: string;
  trailingDelta: string;
  quantity: string;
  submitting: boolean;
  submitError: string | null;
  setSubmitError: (v: string | null) => void;
  ordersVersion: number;
  tradesVersion: number;
  handleSideChange: (s: 'buy' | 'sell') => void;
  setOrderType: (t: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market') => void;
  setPrice: (v: string) => void;
  setStopPrice: (v: string) => void;
  setTrailingDelta: (v: string) => void;
  setQuantity: (v: string) => void;
  setTimeInForce: (t: 'gtc' | 'ioc' | 'fok') => void;
  setPostOnly: (v: boolean) => void;
  handleSubmit: () => Promise<void>;
  handlePriceClick: (p: string, q: string) => void;
  availableBalance: string;
}

export function SpotTradingGridTerminal(props: SpotTradingGridTerminalProps) {
  const {
    markets,
    sortedMarkets,
    symbol,
    setSymbolAndUrl,
    isAuth,
    userTierLevel,
    chartTheme,
    chartIntervalSeconds,
    setChartIntervalSeconds,
    chartViewMode,
    setChartViewMode,
    isFavorite,
    toggleFavorite,
    side,
    orderType,
    timeInForce,
    postOnly,
    price,
    stopPrice,
    trailingDelta,
    quantity,
    submitting,
    submitError,
    setSubmitError,
    ordersVersion,
    tradesVersion,
    handleSideChange,
    setOrderType,
    setPrice,
    setStopPrice,
    setTrailingDelta,
    setQuantity,
    setTimeInForce,
    setPostOnly,
    handleSubmit,
    handlePriceClick,
    availableBalance,
  } = props;

  const { reconnectAttempt, streamPhase, lastRttMs, liteMode, liteHint } = useSpotMarketStream();

  const selectedMarket = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';
  const pricePrecision = selectedMarket?.price_precision ?? 6;
  const qtyPrecision = selectedMarket?.qty_precision ?? 6;
  const makerFee = selectedMarket?.maker_fee ? parseFloat(selectedMarket.maker_fee) : 0.001;
  const takerFee = selectedMarket?.taker_fee ? parseFloat(selectedMarket.taker_fee) : 0.001;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-background dark:text-gray-100">
      {liteMode && (
        <div
          className="flex flex-shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/12 px-4 py-1.5 text-xs font-semibold text-amber-950 dark:bg-amber-950/35 dark:text-amber-50"
          role="status"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <span>
            Lite mode active — market data updates are throttled server-side.
            {liteHint ? ` ${liteHint}` : ''}
          </span>
        </div>
      )}
      {streamPhase !== 'live' && (
        <div
          className={`flex flex-shrink-0 items-center gap-2 border-b px-4 py-2 text-sm font-semibold ${
            streamPhase === 'disconnected'
              ? 'border-red-500/35 bg-red-500/10 text-red-950 dark:bg-red-950/30 dark:text-red-100'
              : 'border-amber-500/30 bg-amber-500/15 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
          }`}
          role="status"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${streamPhase === 'disconnected' ? 'bg-red-500' : 'animate-pulse bg-amber-500'}`}
            aria-hidden
          />
          {streamPhase === 'connecting' && 'Connecting to market data…'}
          {streamPhase === 'reconnecting' &&
            (reconnectAttempt > 0
              ? `Reconnecting (attempt ${reconnectAttempt})…`
              : 'Connection lost — reconnecting…')}
          {streamPhase === 'disconnected' &&
            'Market data stream unavailable — showing last known prices; refresh or try again shortly.'}
          {streamPhase === 'reconnecting' && lastRttMs != null && lastRttMs > 0 && (
            <span className="ml-auto font-mono text-xs font-normal opacity-80">last RTT {lastRttMs}ms</span>
          )}
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
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-card shadow-sm dark:border-gray-800/90 dark:bg-card dark:shadow-none md:col-span-1 lg:col-start-1 lg:row-start-1">
            <SpotPairHeaderSection
              embedded
              symbol={symbol}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
              pricePrecision={pricePrecision}
              sortedMarkets={sortedMarkets}
              onSymbolChange={setSymbolAndUrl}
              isFavorite={isFavorite}
              onToggleFavorite={toggleFavorite}
              tierLevel={userTierLevel}
            />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <SpotChartSection
                symbol={symbol}
                baseAsset={baseAsset}
                quoteAsset={quoteAsset}
                pricePrecision={pricePrecision}
                chartIntervalSeconds={chartIntervalSeconds}
                chartTheme={chartTheme}
                chartViewMode={chartViewMode}
                onIntervalSecondsChange={setChartIntervalSeconds}
                onViewModeChange={setChartViewMode}
              />
            </div>
            {chartViewMode === 'chart' && <SpotDepthSection />}
          </div>

          <div className="flex min-h-0 flex-col md:col-start-1 md:row-start-2 lg:contents">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-card shadow-sm dark:border-gray-800/90 dark:bg-card dark:shadow-none lg:col-start-2 lg:row-start-1 lg:h-full lg:min-h-0">
              <SpotOrderbookSection
                quoteAsset={quoteAsset}
                baseAsset={baseAsset}
                pricePrecision={pricePrecision}
                qtyPrecision={qtyPrecision}
                onPriceClick={handlePriceClick}
              />
            </div>
            <div
              id="spot-terminal-activity"
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200/90 bg-card shadow-sm dark:border-gray-800/90 dark:bg-card dark:shadow-none lg:col-span-2 lg:col-start-1 lg:row-start-2 scroll-mt-4"
            >
              <SpotBottomPanel symbol={symbol} isAuth={isAuth} ordersVersion={ordersVersion} tradesVersion={tradesVersion} />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-2 rounded-lg border border-gray-200/90 bg-card shadow-sm dark:border-gray-800/90 dark:bg-card dark:shadow-none md:col-start-2 md:row-start-1 md:row-span-2 lg:col-start-3 lg:row-start-1 lg:row-span-2">
            <div className="min-h-0 shrink-0 overflow-hidden px-2 pt-2">
              <SpotPositionPanel
                symbol={symbol}
                baseAsset={baseAsset}
                quoteAsset={quoteAsset}
                isAuth={isAuth}
                tradesVersion={tradesVersion}
                pricePrecision={pricePrecision}
                qtyPrecision={qtyPrecision}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <SpotOrderEntrySection
                side={side}
                orderType={orderType}
                timeInForce={timeInForce}
                postOnly={postOnly}
                price={price}
                stopPrice={stopPrice}
                trailingDelta={trailingDelta}
                quantity={quantity}
                baseAsset={baseAsset}
                quoteAsset={quoteAsset}
                availableBalance={availableBalance}
                pricePrecision={pricePrecision}
                qtyPrecision={qtyPrecision}
                makerFee={makerFee}
                takerFee={takerFee}
                isAuth={isAuth}
                submitting={submitting}
                handleSideChange={handleSideChange}
                setOrderType={setOrderType}
                setPrice={setPrice}
                setStopPrice={setStopPrice}
                setTrailingDelta={setTrailingDelta}
                setQuantity={setQuantity}
                setTimeInForce={setTimeInForce}
                setPostOnly={setPostOnly}
                handleSubmit={handleSubmit}
                selectedMarket={selectedMarket}
              />
            </div>
          </div>
        </div>
      </div>
      {submitError && (
        <div
          className="flex flex-col gap-2 border-t border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          role="alert"
          aria-live="polite"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-destructive">Could not place order</p>
              <p className="mt-0.5 text-xs leading-snug text-destructive/90">{submitError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSubmitError(null)}
            className="min-h-11 shrink-0 rounded-md px-4 text-sm font-semibold underline underline-offset-2 hover:bg-destructive/10 sm:min-h-10"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
