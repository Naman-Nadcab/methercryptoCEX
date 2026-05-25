'use client';

import {
  Component,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Info, TrendingUp } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SPOT_TRADE_HREF, loginWithRedirect } from '@/lib/routes';
import { ExchangeHeader } from '@/components/layout/ExchangeHeader';
import { PairHeader } from './PairHeader';
import { ChartPanel } from './ChartPanel';
import { ChartErrorBoundary } from './chart/ChartErrorBoundary';
import { SpotOrderbookPanel } from './SpotOrderbookPanel';
import { SpotBottomPanel } from './SpotBottomPanel';
import { MarketsSidebar, type MarketRow } from '@/components/trading/MarketsSidebar';
import { formatFixedTrim, formatValueFixedTrim } from './terminalFormat';
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
        <div className="flex h-full min-h-[60px] flex-col items-center justify-center gap-2 bg-card px-3 py-4 text-center">
          <p className="text-label font-medium text-muted-foreground">{this.props.name} hit an error</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded bg-muted px-3 py-1 text-label font-semibold text-foreground hover:bg-accent"
          >
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
    return null;
  }, [ticker?.last_price, ticker?.open_24h]);
}

const SPOT_CHART_SPLIT_STORAGE_KEY = 'spotTerminal.chartSplitChartGrowPct';

function clampChartSplitPct(n: number): number {
  if (!Number.isFinite(n)) return 75;
  return Math.min(82, Math.max(38, n));
}

/** Vertical split between chart and order form; persisted in sessionStorage. */
function useChartOrderVerticalSplit() {
  const [chartGrowPct, setChartGrowPct] = useState(75);
  const chartGrowRef = useRef(75);
  const splitRootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startPct: number; height: number } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SPOT_CHART_SPLIT_STORAGE_KEY);
      if (raw != null) {
        const pct = clampChartSplitPct(parseFloat(raw));
        setChartGrowPct(pct);
        chartGrowRef.current = pct;
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    chartGrowRef.current = chartGrowPct;
  }, [chartGrowPct]);

  const onSplitPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = splitRootRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    dragRef.current = {
      startY: e.clientY,
      startPct: chartGrowRef.current,
      height: Math.max(h, 1),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onSplitPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const delta = (-dy / d.height) * 100;
    setChartGrowPct(clampChartSplitPct(d.startPct + delta));
  }, []);

  const onSplitPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current == null) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.setItem(SPOT_CHART_SPLIT_STORAGE_KEY, String(chartGrowRef.current));
    } catch {
      /* ignore */
    }
  }, []);

  return {
    chartGrowPct,
    splitRootRef,
    splitBarProps: {
      onPointerDown: onSplitPointerDown,
      onPointerMove: onSplitPointerMove,
      onPointerUp: onSplitPointerUp,
      onPointerCancel: onSplitPointerUp,
    } as const,
  };
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

  const tapeLast = recentTrades[0]?.price?.trim() || null;
  const displayLastPrice = tapeLast || ticker?.last_price || null;

  return (
    <ChartErrorBoundary resetKey={`${symbol}-${chartIntervalSeconds}-${chartViewMode}`}>
      <ChartPanel
        symbol={symbol}
        baseAsset={baseAsset}
        quoteAsset={quoteAsset}
        pricePrecision={pricePrecision}
        intervalSeconds={chartIntervalSeconds}
        theme={chartTheme}
        lastPrice={displayLastPrice}
        bid={ticker?.bid ?? orderbook?.bids?.[0]?.price ?? null}
        ask={ticker?.ask ?? orderbook?.asks?.[0]?.price ?? null}
        high24h={ticker?.high_24h ?? null}
        low24h={ticker?.low_24h ?? null}
        volume24h={ticker?.base_volume_24h ?? null}
        turnoverQuote24h={ticker?.volume_24h ?? null}
        dayChangePct24h={dayChangePct24h}
        onIntervalSecondsChange={onIntervalSecondsChange}
        livePrice={displayLastPrice}
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
  const { recentTrades } = useSpotMarketTrades();
  const { streamPhase, lastRttMs } = useSpotMarketStream();
  const dayChangePct24h = useDayChangePct24h(ticker);

  /** Prefer public tape (same as chart trade marks); then WS ticker; then book mid — avoids stale oracle vs candle close. */
  const tapeLast = recentTrades[0]?.price?.trim() || null;
  const lastPrice =
    tapeLast ||
    (ticker?.last_price ??
      (orderbook?.bids?.[0] && orderbook?.asks?.[0]
        ? String((parseFloat(orderbook.bids[0].price) + parseFloat(orderbook.asks[0].price)) / 2)
        : orderbook?.asks?.[0]?.price ?? orderbook?.bids?.[0]?.price ?? null));

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
    <div className="exchange-ui flex h-full min-h-0 flex-col overflow-hidden antialiased">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-label font-semibold tracking-tight text-foreground">Market Trades</span>
      </div>
      <div className="flex shrink-0 items-center border-b border-border/90 px-3 py-1.5">
        <span className="flex-1 text-label font-semibold uppercase tracking-wider text-muted-foreground">
          Price({quoteAsset})
        </span>
        <span className="flex-1 text-right text-label font-semibold uppercase tracking-wider text-muted-foreground">
          Amount({baseAsset})
        </span>
        <span className="w-[52px] shrink-0 text-right text-label font-semibold uppercase tracking-wider text-muted-foreground">
          Time
        </span>
      </div>
      <div className="spot-rail-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pr-0.5">
        {isInitialLoading ? (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={`sk-${i}`} className="flex shrink-0 items-center px-3 py-1.5">
              <span className="h-2.5 flex-1 rounded bg-muted" />
              <span className="ml-2 h-2.5 w-14 rounded bg-muted" />
              <span className="ml-2 h-2.5 w-10 rounded bg-muted" />
            </div>
          ))
        ) : topTrades.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-6 text-center text-label leading-relaxed text-muted-foreground">
            No trades yet
          </div>
        ) : (
          topTrades.map((t, i) => {
            const isBuy = t.side === 'buy';
            const time = t.time
              ? new Date(t.time).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '';
            return (
              <div
                key={`${t.id || t.time || 'trade'}-${i}`}
                className="flex shrink-0 items-center px-3 py-1.5 text-label numeric hover:bg-muted/50"
              >
                <span className={`min-w-0 flex-1 truncate font-semibold ${isBuy ? 'text-buy' : 'text-sell'}`}>
                  {formatValueFixedTrim(t.price, pricePrecision)}
                </span>
                <span className="min-w-0 flex-1 truncate text-right font-medium text-foreground/90">
                  {formatValueFixedTrim(t.quantity, qtyPrecision)}
                </span>
                <span className="w-[52px] shrink-0 text-right font-medium text-muted-foreground">{time}</span>
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
        price_precision: m.price_precision,
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
  expanded,
  onToggleExpand,
}: {
  sortedMarkets: Market[];
  symbol: string;
  onSymbolChange: (s: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
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

  const top = movers[0];

  const renderRow = (m: (typeof movers)[0], compact: boolean) => {
    const isUp = m.change != null && m.change >= 0;
    const isActive = m.symbol === symbol;
    return (
      <button
        key={m.symbol}
        type="button"
        onClick={() => onSymbolChange(m.symbol)}
        className={`flex w-full items-center justify-between gap-2 px-3 text-left text-label transition-colors hover:bg-muted/50 ${
          compact ? 'py-1.5' : 'py-2'
        } ${isActive ? 'bg-muted/45' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <CoinIcon symbol={m.base} size={compact ? 13 : 14} />
          <span className="truncate font-semibold tracking-tight text-foreground">{m.base}</span>
          <span className="shrink-0 font-medium text-muted-foreground">/{m.quote}</span>
        </div>
        <span
          className={`shrink-0 numeric text-label font-semibold ${
            m.change != null ? (isUp ? 'text-buy' : 'text-sell') : 'text-muted-foreground'
          }`}
        >
          {m.change != null ? `${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)}%` : '—'}
        </span>
      </button>
    );
  };

  return (
    <div className="exchange-ui flex h-full min-h-0 flex-col overflow-hidden antialiased">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        aria-controls="spot-top-movers-list"
        id="spot-top-movers-heading"
        className="flex w-full shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-muted/35"
      >
        <span className="flex min-w-0 items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Top movers</span>
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {expanded ? (
        <div
          id="spot-top-movers-list"
          role="region"
          aria-labelledby="spot-top-movers-heading"
          className="spot-rail-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5"
        >
          {movers.length === 0 ? (
            <div className="px-3 py-2 text-label text-muted-foreground">No data</div>
          ) : (
            movers.map((m) => renderRow(m, false))
          )}
        </div>
      ) : (
        <div id="spot-top-movers-list" className="shrink-0" role="region" aria-labelledby="spot-top-movers-heading">
          {top ? (
            renderRow(top, true)
          ) : (
            <div className="px-3 py-2 text-label text-muted-foreground">No data</div>
          )}
        </div>
      )}
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
    <div className="flex min-h-[2.625rem] items-center gap-2 rounded-lg border border-border/90 bg-muted/45 px-3 py-2.5 transition-colors hover:border-primary/35 hover:bg-muted/55 dark:border-border dark:bg-card/85 dark:hover:bg-muted/45">
      <span className="shrink-0 text-label font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
      <span className="shrink-0 pl-0.5 text-label font-semibold text-muted-foreground">{suffix}</span>
    </div>
  );
}

function BinanceOrderEntrySection({
  orderType, setOrderType, timeInForce, setTimeInForce, postOnly, setPostOnly,
  price, setPrice, stopPrice, setStopPrice, trailingDelta, setTrailingDelta,
  baseAsset, quoteAsset, pricePrecision, qtyPrecision,
  isAuth, submitting, handleSubmit, handleSideChange, setQuantity, selectedMarket,
  availableBalance, quoteBalance, baseBalance, side,
  requireOrderConfirmation, tradingEnabled,
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
  requireOrderConfirmation: boolean;
  tradingEnabled: boolean;
}) {
  const { orderbook } = useSpotMarketOrderbook();
  const { ticker } = useSpotMarketTicker();
  const [buyQty, setBuyQty] = useState('');
  const [sellQty, setSellQty] = useState('');
  const [buySlider, setBuySlider] = useState(0);
  const [sellSlider, setSellSlider] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<{ side: 'buy' | 'sell'; qty: string } | null>(null);

  const lastPrice =
    ticker?.last_price ??
    (orderbook?.bids?.[0] && orderbook?.asks?.[0]
      ? String((parseFloat(orderbook.bids[0].price) + parseFloat(orderbook.asks[0].price)) / 2)
      : null);

  const priceNum = parseFloat(price) || (lastPrice ? parseFloat(lastPrice) : 0);
  const showPrice = orderType === 'limit' || orderType === 'stop_limit';
  const showStopPrice = orderType === 'stop_loss' || orderType === 'stop_limit';
  const showTrailing = orderType === 'trailing_stop_market';

  /** Quote-side display (balance, total, placeholder): max 0.01 step; submission still uses full `price` / qty strings. */
  const quoteFormDisplayDp = Math.min(2, Math.max(0, pricePrecision));
  const lastPxNum = lastPrice != null && String(lastPrice).trim() !== '' ? parseFloat(String(lastPrice)) : NaN;
  const pricePlaceholder = Number.isFinite(lastPxNum) ? formatFixedTrim(lastPxNum, quoteFormDisplayDp) : '';

  const buyQtyNum = parseFloat(buyQty) || 0;
  const sellQtyNum = parseFloat(sellQty) || 0;
  const buyTotal =
    priceNum > 0 && buyQtyNum > 0 ? formatFixedTrim(priceNum * buyQtyNum, quoteFormDisplayDp) : '';
  const sellTotal =
    priceNum > 0 && sellQtyNum > 0 ? formatFixedTrim(priceNum * sellQtyNum, quoteFormDisplayDp) : '';

  const quoteBal = parseFloat(quoteBalance) || 0;
  const baseBal = parseFloat(baseBalance) || 0;

  const inputCls =
    'numeric min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-price font-semibold tabular-nums tracking-tight text-foreground outline-none focus:ring-0 placeholder:text-muted-foreground/50';

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

  const submitOrder = async (orderSide: 'buy' | 'sell', qty: string) => {
    if (!tradingEnabled) return;
    handleSideChange(orderSide);
    setQuantity(qty);
    try {
      await handleSubmit(orderSide, qty);
      if (orderSide === 'buy') {
        setBuyQty('');
        setBuySlider(0);
      } else {
        setSellQty('');
        setSellSlider(0);
      }
    } catch {
      /* error toasts handled upstream */
    } finally {
      setPendingOrder(null);
      setConfirmOpen(false);
    }
  };

  const doBuy = async () => {
    if (!buyQty.trim()) return;
    if (requireOrderConfirmation) {
      setPendingOrder({ side: 'buy', qty: buyQty.trim() });
      setConfirmOpen(true);
      return;
    }
    await submitOrder('buy', buyQty.trim());
  };

  const doSell = async () => {
    if (!sellQty.trim()) return;
    if (requireOrderConfirmation) {
      setPendingOrder({ side: 'sell', qty: sellQty.trim() });
      setConfirmOpen(true);
      return;
    }
    await submitOrder('sell', sellQty.trim());
  };

  const advancedTypes = ['stop_loss', 'stop_limit', 'trailing_stop_market'] as const;
  const isPrimaryType = orderType === 'limit' || orderType === 'market';

  return (
    <div
      id="spot-order-entry-panel"
      className="exchange-ui flex h-full min-h-0 flex-col overflow-hidden antialiased text-foreground"
    >
      {/* Product + order type — Binance-style underline on active */}
      <div className="flex h-10 shrink-0 items-end gap-0 border-b border-border px-2">
        <span className="mr-2 pb-2.5 text-label font-bold tracking-wide text-primary">Spot</span>
        <span className="mb-2.5 h-3 w-px shrink-0 bg-border" aria-hidden />
        {(['limit', 'market'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setOrderType(t)}
            className={`relative px-2.5 pb-2.5 pt-1.5 text-label font-semibold transition-colors ${
              orderType === t
                ? 'text-foreground after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:rounded-sm after:bg-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {ORDER_TYPE_LABELS[t]}
          </button>
        ))}
        <select
          value={isPrimaryType ? '' : orderType}
          onChange={(e) => {
            if (e.target.value) setOrderType(e.target.value as typeof orderType);
          }}
          className="ml-0.5 cursor-pointer appearance-none border-0 bg-transparent pb-2.5 pl-1 pr-0 pt-1.5 text-label font-semibold text-muted-foreground outline-none hover:text-foreground"
        >
          <option value="" hidden={!isPrimaryType}>▾</option>
          {advancedTypes.map((t) => (<option key={t} value={t}>{ORDER_TYPE_LABELS[t]}</option>))}
        </select>
      </div>

      {/* Side-by-side Buy / Sell */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-3 sm:gap-4 sm:px-3.5 sm:py-3.5">
        {/* BUY */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-price font-semibold tracking-tight text-foreground">Buy {baseAsset}</span>
            <span className="numeric text-label text-muted-foreground">
              {formatValueFixedTrim(quoteBalance, quoteFormDisplayDp)} {quoteAsset}
            </span>
          </div>
          {showPrice && (
            <BinanceInsetField label="Price" suffix={quoteAsset}>
              <input
                id="spot-price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputCls}
                placeholder={pricePlaceholder || '0'}
              />
            </BinanceInsetField>
          )}
          {showStopPrice && <BinanceInsetField label="Stop" suffix={quoteAsset}><input type="text" inputMode="decimal" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>}
          {showTrailing && <BinanceInsetField label="Delta" suffix="%"><input type="text" inputMode="decimal" value={trailingDelta} onChange={(e) => setTrailingDelta(e.target.value)} className={inputCls} placeholder="1.0" /></BinanceInsetField>}
          <BinanceInsetField label="Amt" suffix={baseAsset}><input id="spot-quantity" type="text" inputMode="decimal" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>
          <div className="flex items-center gap-1 py-0.5">
            {SLIDER_PCTS.filter(Boolean).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleBuySlider(p)}
                className={`flex-1 rounded-sm py-1 text-center text-label font-medium tracking-wide transition-colors active:scale-[0.98] ${
                  buySlider >= p ? 'bg-buy/12 text-buy' : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
          <BinanceInsetField label="Total" suffix={quoteAsset}>
            <span className={`${inputCls} ${buyTotal ? 'text-foreground' : 'text-muted-foreground'}`}>{buyTotal || '—'}</span>
          </BinanceInsetField>
          {!isAuth ? (
            <Link
              href={loginWithRedirect(SPOT_TRADE_HREF)}
              className="flex h-10 min-h-[40px] items-center justify-center rounded-lg bg-buy/90 text-price font-semibold tracking-wide text-neutral-950 shadow-sm transition-all hover:bg-buy active:scale-[0.99] active:brightness-95"
            >
              Log In
            </Link>
          ) : (
            <button
              type="button"
              data-spot-place-order
              disabled={submitting || !buyQty.trim() || !tradingEnabled}
              onClick={doBuy}
              className="flex h-10 min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-buy/90 text-price font-semibold tracking-wide text-neutral-950 shadow-sm transition-all hover:bg-buy active:scale-[0.99] active:brightness-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {submitting && side === 'buy' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Buy {baseAsset}
            </button>
          )}
        </div>

        {/* SELL */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-price font-semibold tracking-tight text-foreground">Sell {baseAsset}</span>
            <span className="numeric text-label text-muted-foreground">
              {formatValueFixedTrim(baseBalance, qtyPrecision)} {baseAsset}
            </span>
          </div>
          {showPrice && (
            <BinanceInsetField label="Price" suffix={quoteAsset}>
              <input
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputCls}
                placeholder={pricePlaceholder || '0'}
              />
            </BinanceInsetField>
          )}
          {showStopPrice && <BinanceInsetField label="Stop" suffix={quoteAsset}><input type="text" inputMode="decimal" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className={inputCls} placeholder="0" /></BinanceInsetField>}
          {showTrailing && <BinanceInsetField label="Delta" suffix="%"><input type="text" inputMode="decimal" value={trailingDelta} onChange={(e) => setTrailingDelta(e.target.value)} className={inputCls} placeholder="1.0" /></BinanceInsetField>}
          <BinanceInsetField label="Amt" suffix={baseAsset}>
            <input
              type="text"
              inputMode="decimal"
              value={sellQty}
              onChange={(e) => setSellQty(e.target.value)}
              className={inputCls}
              placeholder="0"
            />
          </BinanceInsetField>
          <div className="flex items-center gap-1.5 py-0.5">
            {SLIDER_PCTS.filter(Boolean).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleSellSlider(p)}
                className={`flex-1 rounded-md py-1.5 text-center text-label font-semibold tracking-wide transition-colors active:scale-[0.98] ${
                  sellSlider >= p ? 'bg-sell/14 text-sell' : 'bg-muted/85 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
          <BinanceInsetField label="Total" suffix={quoteAsset}>
            <span className={`${inputCls} ${sellTotal ? 'text-foreground' : 'text-muted-foreground'}`}>{sellTotal || '—'}</span>
          </BinanceInsetField>
          {!isAuth ? (
            <Link
              href={loginWithRedirect(SPOT_TRADE_HREF)}
              className="flex h-10 min-h-[40px] items-center justify-center rounded-lg bg-sell/90 text-price font-semibold tracking-wide text-neutral-950 shadow-sm transition-all hover:bg-sell active:scale-[0.99] active:brightness-95"
            >
              Log In
            </Link>
          ) : (
            <button
              type="button"
              data-spot-place-order
              disabled={submitting || !sellQty.trim() || !tradingEnabled}
              onClick={doSell}
              className="flex h-10 min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-sell/90 text-price font-semibold tracking-wide text-neutral-950 shadow-sm transition-all hover:bg-sell active:scale-[0.99] active:brightness-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {submitting && side === 'sell' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Sell {baseAsset}
            </button>
          )}
        </div>
      </div>
      {!tradingEnabled && (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          Live market feed is unavailable. Order placement is paused to prevent stale execution.
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm order</DialogTitle>
            <DialogDescription>Review order details before placing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 text-sm">
            <p>
              <span className="text-muted-foreground">Side:</span>{' '}
              <span className={pendingOrder?.side === 'buy' ? 'text-buy font-semibold' : 'text-sell font-semibold'}>
                {(pendingOrder?.side ?? side).toUpperCase()}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Type:</span> {ORDER_TYPE_LABELS[orderType]}
            </p>
            {(orderType === 'limit' || orderType === 'stop_limit') && (
              <p>
                <span className="text-muted-foreground">Price:</span> {price || '—'} {quoteAsset}
              </p>
            )}
            {(orderType === 'stop_loss' || orderType === 'stop_limit') && (
              <p>
                <span className="text-muted-foreground">Trigger:</span> {stopPrice || '—'} {quoteAsset}
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Quantity:</span> {pendingOrder?.qty || '—'} {baseAsset}
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              className="rounded border border-border px-3 py-2 text-sm"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !pendingOrder}
              className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => {
                if (!pendingOrder) return;
                void submitOrder(pendingOrder.side, pendingOrder.qty);
              }}
            >
              {submitting ? 'Placing...' : 'Confirm'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  requireOrderConfirmation: boolean;
  requireCancelAllConfirmation: boolean;
  preferencesSyncIssue?: boolean;
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
    requireOrderConfirmation,
    requireCancelAllConfirmation,
    preferencesSyncIssue = false,
  } = props;

  const { reconnectAttempt, streamPhase, privateChannelsReady, bootstrapIssue } = useSpotMarketStream();
  const { chartGrowPct, splitRootRef, splitBarProps } = useChartOrderVerticalSplit();
  const [topMoversExpanded, setTopMoversExpanded] = useState(false);

  const selectedMarket = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const baseAsset = selectedMarket?.base_asset ?? '';
  const quoteAsset = selectedMarket?.quote_asset ?? '';
  const pricePrecision = selectedMarket?.price_precision ?? 6;
  const qtyPrecision = selectedMarket?.qty_precision ?? 6;
  /** Above-the-fold height: one viewport; mobile subtracts bottom nav padding area from layout. */
  const aboveFoldH =
    'h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom,0px))] md:h-[100dvh]';

  return (
    <div className="relative w-full bg-background">
      {/* ── ABOVE THE FOLD: fixed viewport, no page scroll inside this block ── */}
      <div className={`relative flex shrink-0 flex-col overflow-hidden ${aboveFoldH}`}>
        <div
          className="box-border min-h-0 w-full flex-1"
          style={{
            display: 'grid',
            gridTemplateColumns: 'var(--spot-terminal-rail-width) 1fr var(--spot-terminal-rail-width)',
            gridTemplateRows: '60px auto minmax(0, 1fr)',
          }}
        >
          {/* HEADER */}
          <div
            className="border-b border-border bg-card"
            style={{ gridColumn: '1 / -1', gridRow: '1' }}
          >
            <ExchangeHeader showPairSearch currentSymbol={symbol} symbols={markets.map((m) => m.symbol)} onSymbolSelect={setSymbolAndUrl} />
          </div>

          {/* PAIR HEADER (orderbook + center only; sidebar aligns to full main height) */}
          <div
            className="flex min-h-0 min-w-0 items-stretch overflow-hidden border-b border-r border-solid border-border bg-card"
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
            data-spot-rail
            className="grid min-h-0 min-w-0 overflow-hidden border-b border-l border-solid border-border bg-card"
            style={{
              gridColumn: '3',
              gridRow: '2 / 4',
              gridTemplateRows: topMoversExpanded
                ? 'minmax(0, 1.85fr) minmax(0, 1.05fr) minmax(0, 2.55fr)'
                : 'minmax(0, 2.45fr) minmax(0, 1.65fr) auto',
            }}
          >
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-solid border-border">
              <RightMarketListSection
                sortedMarkets={sortedMarkets} symbol={symbol} onSymbolChange={setSymbolAndUrl}
                isFavorite={isFavorite} onToggleFavorite={toggleFavorite}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-solid border-border">
              <RecentTradesPanel baseAsset={baseAsset} quoteAsset={quoteAsset} pricePrecision={pricePrecision} qtyPrecision={qtyPrecision} />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
              <TopMoversSection
                sortedMarkets={sortedMarkets}
                symbol={symbol}
                onSymbolChange={setSymbolAndUrl}
                expanded={topMoversExpanded}
                onToggleExpand={() => setTopMoversExpanded((v) => !v)}
              />
            </div>
          </div>

          {/* ORDERBOOK */}
          <div
            data-spot-rail
            className="flex min-w-0 flex-col overflow-hidden border-r border-solid border-border bg-card"
            style={{ gridColumn: '1', gridRow: '3' }}
          >
            <PanelErrorBoundary name="Order Book" resetKey={symbol}>
              <SpotOrderbookSection quoteAsset={quoteAsset} baseAsset={baseAsset} pricePrecision={pricePrecision} qtyPrecision={qtyPrecision} onPriceClick={handlePriceClick} />
            </PanelErrorBoundary>
          </div>

          {/* CENTER: resizable vertical split — chart vs order form (ratio persisted per session) */}
          <div
            ref={splitRootRef}
            className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-solid border-border bg-card"
            style={{ gridColumn: '2', gridRow: '3' }}
          >
            <div
              className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-border"
              style={{
                flexGrow: chartGrowPct,
                flexShrink: 1,
                flexBasis: 0,
                minHeight: 120,
              }}
            >
              <SpotChartSection
                symbol={symbol} baseAsset={baseAsset} quoteAsset={quoteAsset} pricePrecision={pricePrecision}
                chartIntervalSeconds={chartIntervalSeconds} chartTheme={chartTheme} chartViewMode={chartViewMode}
                onIntervalSecondsChange={setChartIntervalSeconds} onViewModeChange={setChartViewMode}
              />
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize chart and order form"
              className="relative z-[1] h-2 shrink-0 cursor-row-resize touch-none border-y border-border bg-muted/35 hover:bg-muted/60"
              {...splitBarProps}
            />
            <div
              className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-card"
              style={{
                flexGrow: 100 - chartGrowPct,
                flexShrink: 1,
                flexBasis: 0,
                minHeight: 248,
              }}
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
                requireOrderConfirmation={requireOrderConfirmation}
                tradingEnabled={streamPhase === 'live'}
              />
              </PanelErrorBoundary>
            </div>
          </div>
        </div>

        {/* Stream status — anchored to above-fold chart band */}
        {streamPhase !== 'live' && (
          <div
            className={`pointer-events-none absolute left-[var(--spot-terminal-rail-width)] right-[var(--spot-terminal-rail-width)] top-[calc(60px+2.75rem)] z-10 flex items-center gap-2 px-3 py-1 text-label font-medium ${
            streamPhase === 'disconnected' ? 'bg-red-950/90 text-red-200' : 'bg-amber-950/90 text-amber-200'
          }`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${streamPhase === 'disconnected' ? 'bg-sell' : 'animate-pulse bg-amber-500'}`} />
            {streamPhase === 'connecting' && 'Connecting…'}
            {streamPhase === 'reconnecting' && `Reconnecting${reconnectAttempt > 0 ? ` (${reconnectAttempt})` : ''}…`}
            {streamPhase === 'disconnected' && 'Stream unavailable'}
          </div>
        )}

        {streamPhase === 'live' && isAuth && !privateChannelsReady && (
          <div className="pointer-events-none absolute left-[var(--spot-terminal-rail-width)] right-[var(--spot-terminal-rail-width)] top-[calc(60px+2.75rem)] z-10 flex items-center gap-2 bg-amber-950/90 px-3 py-1 text-label font-medium text-amber-200">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
            Account updates are reconnecting. Order/trade status may lag briefly.
          </div>
        )}
        {streamPhase === 'live' && isAuth && preferencesSyncIssue && privateChannelsReady && (
          <div className="pointer-events-none absolute left-[var(--spot-terminal-rail-width)] right-[var(--spot-terminal-rail-width)] top-[calc(60px+2.75rem)] z-10 flex items-center gap-2 bg-blue-950/90 px-3 py-1 text-label font-medium text-blue-200">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            Preference sync delayed. Default confirmation rules are active for now.
          </div>
        )}
        {streamPhase === 'live' && bootstrapIssue && privateChannelsReady && !preferencesSyncIssue && (
          <div className="pointer-events-none absolute left-[var(--spot-terminal-rail-width)] right-[var(--spot-terminal-rail-width)] top-[calc(60px+2.75rem)] z-10 flex items-center gap-2 bg-violet-950/90 px-3 py-1 text-label font-medium text-violet-200">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
            {bootstrapIssue}
          </div>
        )}

        {/* Error banner — bottom of above-fold main area */}
        {submitError && (
          <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-h-16 items-center gap-2 border-t border-sell/30 bg-sell/15 px-4 py-2 text-label text-sell md:left-[var(--spot-terminal-rail-width)] md:right-[var(--spot-terminal-rail-width)]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">{submitError}</span>
            <button type="button" onClick={() => setSubmitError(null)} className="shrink-0 font-semibold underline">Dismiss</button>
          </div>
        )}
      </div>

      {/* ── BELOW THE FOLD: order history — page scrolls here ── */}
      <section className="w-full border-t border-border bg-card" aria-label="Order history and trading activity">
        <PanelErrorBoundary name="Order History" resetKey={symbol}>
          <SpotBottomPanel
            symbol={symbol}
            isAuth={isAuth}
            ordersVersion={ordersVersion}
            tradesVersion={tradesVersion}
            promptCancelAllConfirmation={requireCancelAllConfirmation}
            markets={markets.map((m) => ({
              symbol: m.symbol,
              price_precision: m.price_precision,
              qty_precision: m.qty_precision,
            }))}
          />
        </PanelErrorBoundary>
      </section>
    </div>
  );
}
