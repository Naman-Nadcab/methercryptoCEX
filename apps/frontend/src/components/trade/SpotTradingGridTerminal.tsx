'use client';

import { Component, memo, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, Loader2, Info, TrendingUp } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import Link from 'next/link';
import { SPOT_TRADE_HREF, loginWithRedirect } from '@/lib/routes';
import { ExchangeHeader } from '@/components/layout/ExchangeHeader';
import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
import { ChartErrorBoundary } from './chart/ChartErrorBoundary';
import { SpotOrderbookPanel } from './SpotOrderbookPanel';
import { SpotBottomPanel } from './SpotBottomPanel';
import { MarketsSidebar, type MarketRow } from '@/components/trading/MarketsSidebar';
import { formatValueFixedTrim } from './terminalFormat';
import {
  useSpotMarketOrderbook,
  useSpotMarketTicker,
  useSpotMarketTrades,
  useSpotMarketStream,
} from './SpotMarketDataContext';

class PanelErrorBoundary extends Component<
  { children: ReactNode; name: string; resetKey?: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[PanelErrorBoundary:${this.props.name}]`, error.message, info.componentStack);
  }
  componentDidUpdate(prevProps: { resetKey?: string }): void {
    if (prevProps.resetKey !== this.props.resetKey) this.setState({ hasError: false });
  }
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[60px] flex-col items-center justify-center gap-2 bg-[#1e2026] px-3 py-4 text-center">
          <p className="text-[11px] font-medium text-[#848e9c]">{this.props.name} hit an error</p>
          <button type="button" onClick={() => this.setState({ hasError: false })}
            className="rounded bg-[#2b2f36] px-3 py-1 text-[10px] font-semibold text-[#eaecef] hover:bg-[#363a45]">
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  last_price?: string | null;
  volume_24h?: string | null;
  open_24h?: string | null;
  high_24h?: string | null;
  low_24h?: string | null;
  change_pct?: number | null;
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

const RecentTradesPanel = memo(function RecentTradesPanel({
  baseAsset,
  quoteAsset,
  pricePrecision,
  qtyPrecision,
}: {
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  qtyPrecision: number;
}) {
  const { recentTrades } = useSpotMarketTrades();
  const { streamPhase } = useSpotMarketStream();

  const trades = recentTrades ?? [];
  const topTrades = trades.slice(0, 30);
  const isInitialLoading = topTrades.length === 0 && streamPhase !== 'live';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-[#2b2f36] px-2 py-1">
        <span className="text-[11px] font-semibold text-[#eaecef]">Market Trades</span>
      </div>
      <div className="flex shrink-0 items-center border-b border-[#2b2f36] px-2 py-0.5">
        <span className="flex-1 text-[10px] font-medium text-[#848e9c]">Price({quoteAsset})</span>
        <span className="flex-1 text-right text-[10px] font-medium text-[#848e9c]">Amount({baseAsset})</span>
        <span className="w-[52px] shrink-0 text-right text-[10px] font-medium text-[#848e9c]">Time</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        {isInitialLoading ? (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={`sk-${i}`} className="flex shrink-0 items-center px-2 py-1">
              <span className="h-2.5 flex-1 rounded bg-[#2b2f36]/70" />
              <span className="ml-2 h-2.5 w-14 rounded bg-[#2b2f36]/70" />
              <span className="ml-2 h-2.5 w-10 rounded bg-[#2b2f36]/70" />
            </div>
          ))
        ) : topTrades.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 py-4 text-center text-[11px] text-[#848e9c]">
            No trades yet
          </div>
        ) : (
          topTrades.map((t, i) => {
            const isBuy = t.side === 'buy';
            const p = parseFloat(t.price);
            const qty = parseFloat(t.quantity);
            const time = t.time ? new Date(t.time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            return (
              <div key={`${t.time}-${i}`} className="flex shrink-0 items-center px-2 py-px font-mono text-[11px] hover:bg-[#2b2f36]/50">
                <span className={`min-w-0 flex-1 truncate ${isBuy ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{p.toFixed(pricePrecision)}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[#b7bdc6]">{qty.toFixed(qtyPrecision)}</span>
                <span className="w-[52px] shrink-0 text-right text-[#848e9c]">{time}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

function RightMarketListSection({
  sortedMarkets,
  symbol,
  onSymbolChange,
  isFavorite,
  onToggleFavorite,
}: {
  sortedMarkets: Market[];
  symbol: string;
  onSymbolChange: (s: string) => void;
  isFavorite: (s: string) => boolean;
  onToggleFavorite: (s: string) => void;
}) {
  const { ticker } = useSpotMarketTicker();

  const enrichedMarkets: MarketRow[] = useMemo(() => {
    return sortedMarkets.map((m) => {
      const isSelected = m.symbol === symbol;
      const price = isSelected && ticker?.last_price ? ticker.last_price : m.last_price ?? null;
      const open = isSelected && ticker?.open_24h ? ticker.open_24h : m.open_24h ?? null;
      const vol = isSelected && ticker?.base_volume_24h ? ticker.base_volume_24h : m.volume_24h ?? null;
      const pNum = price ? parseFloat(price) : NaN;
      const oNum = open ? parseFloat(open) : NaN;
      const change = Number.isFinite(pNum) && Number.isFinite(oNum) && oNum > 0 ? ((pNum - oNum) / oNum) * 100 : (m.change_pct ?? null);
      return {
        symbol: m.symbol,
        base_asset: m.base_asset,
        quote_asset: m.quote_asset,
        last_price: price,
        change_24h: change,
        volume_24h: vol,
      };
    });
  }, [sortedMarkets, symbol, ticker]);

  const favSymbols = useMemo(
    () => sortedMarkets.filter((m) => isFavorite(m.symbol)).map((m) => m.symbol),
    [sortedMarkets, isFavorite]
  );

  return (
    <MarketsSidebar
      variant="terminal"
      markets={enrichedMarkets}
      selectedSymbol={symbol}
      onSelectSymbol={onSymbolChange}
      favorites={favSymbols}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

function TopMoversSection({
  sortedMarkets,
  symbol,
  onSymbolChange,
}: {
  sortedMarkets: Market[];
  symbol: string;
  onSymbolChange: (s: string) => void;
}) {
  const { ticker } = useSpotMarketTicker();

  const movers = useMemo(() => {
    const enriched = sortedMarkets.map((m) => {
      const isSelected = m.symbol === symbol;
      const price = isSelected && ticker?.last_price ? ticker.last_price : m.last_price ?? null;
      const open = isSelected && ticker?.open_24h ? ticker.open_24h : m.open_24h ?? null;
      const pNum = price ? parseFloat(price) : NaN;
      const oNum = open ? parseFloat(open) : NaN;
      const change = Number.isFinite(pNum) && Number.isFinite(oNum) && oNum > 0 ? ((pNum - oNum) / oNum) * 100 : (m.change_pct ?? null);
      return {
        symbol: m.symbol,
        base: m.base_asset,
        quote: m.quote_asset,
        change,
        price,
      };
    });
    return [...enriched]
      .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
      .slice(0, 12);
  }, [sortedMarkets, symbol, ticker]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-[#2b2f36] px-2 py-1">
        <TrendingUp className="h-3 w-3 shrink-0 text-[#f0b90b]" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#848e9c]">Top movers</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {movers.map((m) => {
          const isUp = m.change != null && m.change >= 0;
          const isActive = m.symbol === symbol;
          return (
            <button
              key={m.symbol}
              type="button"
              onClick={() => onSymbolChange(m.symbol)}
              className={`flex w-full items-center justify-between gap-1 px-2 py-0.5 text-left text-[10px] transition-colors hover:bg-[#2b2f36]/50 ${
                isActive ? 'bg-[#2b2f36]/35' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-1">
                <CoinIcon symbol={m.base} size={12} />
                <span className="truncate font-medium text-[#eaecef]">{m.base}</span>
                <span className="shrink-0 text-[9px] text-[#474d57]">/{m.quote}</span>
              </div>
              <span className={`shrink-0 font-mono tabular-nums ${
                m.change != null ? (isUp ? 'text-[#0ecb81]' : 'text-[#f6465d]') : 'text-[#474d57]'
              }`}>
                {m.change != null ? `${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)}%` : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  limit: 'Limit',
  market: 'Market',
  stop_limit: 'Stop Limit',
  stop_loss: 'Stop',
  trailing_stop_market: 'Trailing',
};

const SLIDER_PCTS = [0, 25, 50, 75, 100];

function BinanceInsetField({ label, suffix, children }: { label: string; suffix: string; children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center rounded border border-[#2b2f36] bg-[#2b2f36]/50 px-2 transition-colors hover:border-[#f0b90b]/40">
      <span className="shrink-0 text-[11px] font-medium text-[#848e9c]">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
      <span className="ml-1 shrink-0 text-[10px] font-medium text-[#848e9c]">{suffix}</span>
    </div>
  );
}

function BinanceOrderEntrySection({
  orderType, setOrderType, timeInForce, setTimeInForce, postOnly, setPostOnly,
  price, setPrice, stopPrice, setStopPrice, trailingDelta, setTrailingDelta,
  baseAsset, quoteAsset, pricePrecision, qtyPrecision,
  isAuth, submitting, handleSubmit, handleSideChange, setQuantity, selectedMarket,
  availableBalance, quoteBalance, baseBalance, side,
}: {
  orderType: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market';
  setOrderType: (t: 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market') => void;
  timeInForce: 'gtc' | 'ioc' | 'fok';
  setTimeInForce: (t: 'gtc' | 'ioc' | 'fok') => void;
  postOnly: boolean;
  setPostOnly: (v: boolean) => void;
  price: string;
  setPrice: (v: string) => void;
  stopPrice: string;
  setStopPrice: (v: string) => void;
  trailingDelta: string;
  setTrailingDelta: (v: string) => void;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  qtyPrecision: number;
  isAuth: boolean;
  submitting: boolean;
  handleSubmit: (overrideSide?: 'buy' | 'sell', overrideQty?: string) => Promise<void>;
  handleSideChange: (s: 'buy' | 'sell') => void;
  setQuantity: (v: string) => void;
  selectedMarket: Market | undefined;
  availableBalance: string;
  quoteBalance: string;
  baseBalance: string;
  side: 'buy' | 'sell';
}) {
  const { orderbook } = useSpotMarketOrderbook();
  const { ticker } = useSpotMarketTicker();
  const [buyQty, setBuyQty] = useState('');
  const [sellQty, setSellQty] = useState('');
  const [buySlider, setBuySlider] = useState(0);
  const [sellSlider, setSellSlider] = useState(0);

  const lastPrice =
    ticker?.last_price ??
    (orderbook?.bids?.[0] && orderbook?.asks?.[0]
      ? String((parseFloat(orderbook.bids[0].price) + parseFloat(orderbook.asks[0].price)) / 2)
      : null);

  const priceNum = parseFloat(price) || (lastPrice ? parseFloat(lastPrice) : 0);
  const showPrice = orderType === 'limit' || orderType === 'stop_limit';
  const showStopPrice = orderType === 'stop_loss' || orderType === 'stop_limit';
  const showTrailing = orderType === 'trailing_stop_market';

  const buyQtyNum = parseFloat(buyQty) || 0;
  const sellQtyNum = parseFloat(sellQty) || 0;
  const buyTotal = priceNum > 0 ? (priceNum * buyQtyNum).toFixed(pricePrecision) : '';
  const sellTotal = priceNum > 0 ? (priceNum * sellQtyNum).toFixed(pricePrecision) : '';

  const quoteBal = parseFloat(quoteBalance) || 0;
  const baseBal = parseFloat(baseBalance) || 0;

  const inputCls = 'min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-mono text-[12px] font-medium tabular-nums text-[#eaecef] outline-none focus:ring-0 placeholder:text-[#474d57]';

  const handleBuySlider = (pct: number) => {
    setBuySlider(pct);
    if (priceNum > 0 && quoteBal > 0) {
      const factor = 10 ** qtyPrecision;
      const raw = (quoteBal * (pct / 100)) / priceNum;
      setBuyQty(pct > 0 ? (Math.floor(raw * factor) / factor).toFixed(qtyPrecision) : '');
    }
  };

  const handleSellSlider = (pct: number) => {
    setSellSlider(pct);
    if (baseBal > 0) {
      const factor = 10 ** qtyPrecision;
      setSellQty(pct > 0 ? (Math.floor(baseBal * (pct / 100) * factor) / factor).toFixed(qtyPrecision) : '');
    }
  };

  const doBuy = async () => {
    if (!buyQty.trim()) return;
    handleSideChange('buy');
    setQuantity(buyQty);
    try { await handleSubmit('buy', buyQty); setBuyQty(''); setBuySlider(0); } catch { /* toast */ }
  };

  const doSell = async () => {
    if (!sellQty.trim()) return;
    handleSideChange('sell');
    setQuantity(sellQty);
    try { await handleSubmit('sell', sellQty); setSellQty(''); setSellSlider(0); } catch { /* toast */ }
  };

  const advancedTypes = ['stop_loss', 'stop_limit', 'trailing_stop_market'] as const;
  const isPrimaryType = orderType === 'limit' || orderType === 'market';

  return (
    <div id="spot-order-entry-panel" className="flex h-full min-h-0 flex-col overflow-hidden text-[#eaecef]">
      {/* Product + Order type tabs — compact single bar */}
      <div className="flex h-8 shrink-0 items-center border-b border-[#2b2f36] px-2">
        <span className="mr-3 text-[11px] font-bold text-[#f0b90b]">Spot</span>
        <span className="mx-2 h-3 w-px bg-[#2b2f36]" />
        {(['limit', 'market'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setOrderType(t)}
            className={`px-1.5 text-[11px] font-medium transition-colors ${orderType === t ? 'text-[#eaecef]' : 'text-[#848e9c] hover:text-[#eaecef]'}`}>
            {ORDER_TYPE_LABELS[t]}
          </button>
        ))}
        <select value={isPrimaryType ? '' : orderType}
          onChange={(e) => { if (e.target.value) setOrderType(e.target.value as typeof orderType); }}
          className="ml-1 cursor-pointer appearance-none border-0 bg-transparent text-[11px] font-medium text-[#848e9c] outline-none hover:text-[#eaecef]">
          <option value="" hidden={!isPrimaryType}>▾</option>
          {advancedTypes.map((t) => (<option key={t} value={t}>{ORDER_TYPE_LABELS[t]}</option>))}
        </select>
      </div>

      {/* Side-by-side Buy / Sell — compact layout */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-2.5">
        {/* BUY */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#eaecef]">Buy {baseAsset}</span>
            <span className="font-mono text-[10px] text-[#848e9c]">{formatValueFixedTrim(quoteBalance, pricePrecision)} {quoteAsset}</span>
          </div>
          {showPrice && <BinanceInsetField label="Price" suffix={quoteAsset}><input id="spot-price" type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder={lastPrice ? parseFloat(lastPrice).toFixed(pricePrecision) : '0'} /></BinanceInsetField>}
          {showStopPrice && <BinanceInsetField label="Stop" suffix={quoteAsset}><input type="text" inputMode="decimal" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>}
          {showTrailing && <BinanceInsetField label="Delta" suffix="%"><input type="text" inputMode="decimal" value={trailingDelta} onChange={(e) => setTrailingDelta(e.target.value)} className={inputCls} placeholder="1.0" /></BinanceInsetField>}
          <BinanceInsetField label="Amt" suffix={baseAsset}><input id="spot-quantity" type="text" inputMode="decimal" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>
          <div className="flex items-center gap-1 py-0.5">
            {SLIDER_PCTS.filter(Boolean).map((p) => (
              <button key={p} type="button" onClick={() => handleBuySlider(p)}
                className={`flex-1 rounded-sm py-0.5 text-center text-[9px] font-medium transition-colors ${buySlider >= p ? 'bg-[#0ecb81]/20 text-[#0ecb81]' : 'bg-[#2b2f36] text-[#848e9c] hover:text-[#eaecef]'}`}>
                {p}%
              </button>
            ))}
          </div>
          <BinanceInsetField label="Total" suffix={quoteAsset}><span className={`${inputCls} ${buyTotal ? 'text-[#eaecef]' : 'text-[#474d57]'}`}>{buyTotal || '—'}</span></BinanceInsetField>
          {!isAuth ? (
            <Link href={loginWithRedirect(SPOT_TRADE_HREF)} className="flex h-9 items-center justify-center rounded bg-[#0ecb81] text-[13px] font-bold text-white hover:brightness-110">Log In</Link>
          ) : (
            <button type="button" data-spot-place-order disabled={submitting || !buyQty.trim()} onClick={doBuy}
              className="flex h-9 items-center justify-center gap-1 rounded bg-[#0ecb81] text-[13px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-40">
              {submitting && side === 'buy' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Buy {baseAsset}
            </button>
          )}
        </div>

        {/* SELL */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#eaecef]">Sell {baseAsset}</span>
            <span className="font-mono text-[10px] text-[#848e9c]">{formatValueFixedTrim(baseBalance, qtyPrecision)} {baseAsset}</span>
          </div>
          {showPrice && <BinanceInsetField label="Price" suffix={quoteAsset}><input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} placeholder={lastPrice ? parseFloat(lastPrice).toFixed(pricePrecision) : '0'} /></BinanceInsetField>}
          {showStopPrice && <BinanceInsetField label="Stop" suffix={quoteAsset}><input type="text" inputMode="decimal" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>}
          {showTrailing && <BinanceInsetField label="Delta" suffix="%"><input type="text" inputMode="decimal" value={trailingDelta} onChange={(e) => setTrailingDelta(e.target.value)} className={inputCls} placeholder="1.0" /></BinanceInsetField>}
          <BinanceInsetField label="Amt" suffix={baseAsset}><input type="text" inputMode="decimal" value={sellQty} onChange={(e) => setSellQty(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>
          <div className="flex items-center gap-1 py-0.5">
            {SLIDER_PCTS.filter(Boolean).map((p) => (
              <button key={p} type="button" onClick={() => handleSellSlider(p)}
                className={`flex-1 rounded-sm py-0.5 text-center text-[9px] font-medium transition-colors ${sellSlider >= p ? 'bg-[#f6465d]/20 text-[#f6465d]' : 'bg-[#2b2f36] text-[#848e9c] hover:text-[#eaecef]'}`}>
                {p}%
              </button>
            ))}
          </div>
          <BinanceInsetField label="Total" suffix={quoteAsset}><span className={`${inputCls} ${sellTotal ? 'text-[#eaecef]' : 'text-[#474d57]'}`}>{sellTotal || '—'}</span></BinanceInsetField>
          {!isAuth ? (
            <Link href={loginWithRedirect(SPOT_TRADE_HREF)} className="flex h-9 items-center justify-center rounded bg-[#f6465d] text-[13px] font-bold text-white hover:brightness-110">Log In</Link>
          ) : (
            <button type="button" data-spot-place-order disabled={submitting || !sellQty.trim()} onClick={doSell}
              className="flex h-9 items-center justify-center gap-1 rounded bg-[#f6465d] text-[13px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-40">
              {submitting && side === 'sell' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Sell {baseAsset}
            </button>
          )}
        </div>
      </div>
    </div>
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
  handleSubmit: (overrideSide?: 'buy' | 'sell', overrideQty?: string) => Promise<void>;
  handlePriceClick: (p: string, q: string) => void;
  availableBalance: string;
  quoteBalance: string;
  baseBalance: string;
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
    quoteBalance,
    baseBalance,
  } = props;

  const { reconnectAttempt, streamPhase } = useSpotMarketStream();

  const selectedMarket = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';
  const pricePrecision = selectedMarket?.price_precision ?? 6;
  const qtyPrecision = selectedMarket?.qty_precision ?? 6;
  /** Above-the-fold height: one viewport; mobile subtracts bottom nav padding area from layout. */
  const aboveFoldH =
    'h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom,0px))] md:h-[100dvh]';

  return (
    <div className="relative w-full bg-[#181a20]">
      {/* ── ABOVE THE FOLD: fixed viewport, no page scroll inside this block ── */}
      <div className={`relative flex shrink-0 flex-col overflow-hidden ${aboveFoldH}`}>
        <div
          className="box-border min-h-0 w-full flex-1"
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr 260px',
            gridTemplateRows: '60px 60px minmax(0, 1fr)',
          }}
        >
          {/* HEADER */}
          <div
            className="overflow-hidden border-b border-[#2b2f36] bg-[#181a20]"
            style={{ gridColumn: '1 / -1', gridRow: '1' }}
          >
            <ExchangeHeader showPairSearch currentSymbol={symbol} symbols={markets.map((m) => m.symbol)} onSymbolSelect={setSymbolAndUrl} />
          </div>

          {/* PAIR HEADER (orderbook + center only; sidebar aligns to full main height) */}
          <div
            className="overflow-hidden border-b border-r border-solid border-[#2b2f36] bg-[#1e2026]"
            style={{ gridColumn: '1 / 3', gridRow: '2' }}
          >
            <SpotPairHeaderSection
              symbol={symbol} baseAsset={baseAsset} quoteAsset={quoteAsset} pricePrecision={pricePrecision}
              sortedMarkets={sortedMarkets} onSymbolChange={setSymbolAndUrl}
              isFavorite={isFavorite} onToggleFavorite={toggleFavorite} tierLevel={userTierLevel}
            />
          </div>

          {/* RIGHT SIDEBAR: Binance-style row split — market list / trades / movers (no outer scroll) */}
          <div
            className="grid min-h-0 min-w-0 overflow-hidden border-b border-l border-solid border-[#2b2f36] bg-[#1e2026]"
            style={{
              gridColumn: '3',
              gridRow: '2 / 4',
              gridTemplateRows: '2.2fr 1.5fr 0.8fr',
            }}
          >
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-solid border-[#2b2f36]">
              <RightMarketListSection
                sortedMarkets={sortedMarkets} symbol={symbol} onSymbolChange={setSymbolAndUrl}
                isFavorite={isFavorite} onToggleFavorite={toggleFavorite}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-solid border-[#2b2f36]">
              <RecentTradesPanel baseAsset={baseAsset} quoteAsset={quoteAsset} pricePrecision={pricePrecision} qtyPrecision={qtyPrecision} />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <TopMoversSection sortedMarkets={sortedMarkets} symbol={symbol} onSymbolChange={setSymbolAndUrl} />
            </div>
          </div>

          {/* ORDERBOOK */}
          <div
            className="flex min-w-0 flex-col overflow-hidden border-r border-solid border-[#2b2f36] bg-[#1e2026]"
            style={{ gridColumn: '1', gridRow: '3' }}
          >
            <PanelErrorBoundary name="Order Book" resetKey={symbol}>
              <SpotOrderbookSection quoteAsset={quoteAsset} baseAsset={baseAsset} pricePrecision={pricePrecision} qtyPrecision={qtyPrecision} onPriceClick={handlePriceClick} />
            </PanelErrorBoundary>
          </div>

          {/* CENTER: chart 60% / order form 40% (percent of main row height) */}
          <div
            className="grid min-h-0 min-w-0 overflow-hidden border-b border-solid border-[#2b2f36] bg-[#1e2026]"
            style={{
              gridColumn: '2',
              gridRow: '3',
              gridTemplateRows: '60% 40%',
            }}
          >
            <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-[#2b2f36]">
              <SpotChartSection
                symbol={symbol} baseAsset={baseAsset} quoteAsset={quoteAsset} pricePrecision={pricePrecision}
                chartIntervalSeconds={chartIntervalSeconds} chartTheme={chartTheme} chartViewMode={chartViewMode}
                onIntervalSecondsChange={setChartIntervalSeconds} onViewModeChange={setChartViewMode}
              />
            </div>
            <div
              className="flex min-h-0 flex-col overflow-hidden border-t-2 bg-[#1e2026]"
              style={{ borderTopColor: '#363a45' }}
            >
              <PanelErrorBoundary name="Order Form" resetKey={symbol}>
              <BinanceOrderEntrySection
                orderType={orderType} setOrderType={setOrderType} timeInForce={timeInForce} setTimeInForce={setTimeInForce}
                postOnly={postOnly} setPostOnly={setPostOnly} price={price} setPrice={setPrice}
                stopPrice={stopPrice} setStopPrice={setStopPrice} trailingDelta={trailingDelta} setTrailingDelta={setTrailingDelta}
                baseAsset={baseAsset} quoteAsset={quoteAsset} pricePrecision={pricePrecision} qtyPrecision={qtyPrecision}
                isAuth={isAuth} submitting={submitting} handleSubmit={handleSubmit} handleSideChange={handleSideChange}
                setQuantity={setQuantity} selectedMarket={selectedMarket} availableBalance={availableBalance}
                quoteBalance={quoteBalance} baseBalance={baseBalance} side={side}
              />
              </PanelErrorBoundary>
            </div>
          </div>
        </div>

        {/* Stream status — anchored to above-fold chart band */}
        {streamPhase !== 'live' && (
          <div className={`pointer-events-none absolute left-[260px] right-[260px] top-[120px] z-10 flex items-center gap-2 px-3 py-1 text-[11px] font-medium ${
            streamPhase === 'disconnected' ? 'bg-red-950/90 text-red-200' : 'bg-amber-950/90 text-amber-200'
          }`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${streamPhase === 'disconnected' ? 'bg-[#f6465d]' : 'animate-pulse bg-amber-500'}`} />
            {streamPhase === 'connecting' && 'Connecting…'}
            {streamPhase === 'reconnecting' && `Reconnecting${reconnectAttempt > 0 ? ` (${reconnectAttempt})` : ''}…`}
            {streamPhase === 'disconnected' && 'Stream unavailable'}
          </div>
        )}

        {/* Error banner — bottom of above-fold main area */}
        {submitError && (
          <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-h-16 items-center gap-2 border-t border-[#f6465d]/30 bg-[#f6465d]/15 px-4 py-2 text-[11px] text-[#f6465d] md:left-[260px] md:right-[260px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">{submitError}</span>
            <button type="button" onClick={() => setSubmitError(null)} className="shrink-0 font-semibold underline">Dismiss</button>
          </div>
        )}
      </div>

      {/* ── BELOW THE FOLD: order history — page scrolls here ── */}
      <section className="w-full border-t border-[#2b2f36] bg-[#1e2026]" aria-label="Order history and trading activity">
        <PanelErrorBoundary name="Order History" resetKey={symbol}>
          <SpotBottomPanel symbol={symbol} isAuth={isAuth} ordersVersion={ordersVersion} tradesVersion={tradesVersion} />
        </PanelErrorBoundary>
      </section>
    </div>
  );
}
