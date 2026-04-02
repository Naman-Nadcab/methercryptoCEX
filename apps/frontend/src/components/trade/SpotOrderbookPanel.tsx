'use client';

/**
 * Dense order book (Bybit-like layout): RTL depth bars, cumulative totals, icon views, mid strip, diagonal footer.
 * Colors use app theme: price-up / price-down, buy / sell, blue accents — no fixed exchange brand hex.
 */

import { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  LayoutTemplate,
  TrendingDown,
  TrendingUp,
  ArrowDownUp,
} from 'lucide-react';
import { formatFixedTrim, formatValueFixedTrim, formatCompactNumber } from './terminalFormat';

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

export interface RecentTradeRow {
  id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  time: string;
}

interface SpotOrderbookPanelProps {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  quoteAsset: string;
  baseAsset: string;
  lastPrice?: string | null;
  pricePrecision?: number;
  qtyPrecision?: number;
  onPriceClick?: (price: string, quantity: string) => void;
  onTradePriceClick?: (price: string, quantity: string) => void;
  loading?: boolean;
  recentTrades?: RecentTradeRow[];
}

const DEPTH_OPTIONS = [12, 20, 30] as const;
const TICK_PRESETS = [2, 4, 6, 8] as const;

const COL_GRID = 'grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-1';

function qtyToNum(q: string): number {
  const n = parseFloat(q);
  return Number.isFinite(n) ? n : 0;
}

function formatTradeTime(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '—';
  }
}

const LevelRow = memo(function LevelRow({
  rawPrice,
  price,
  quantity,
  total,
  side,
  onRowSelect,
  emphasize,
  depthPct,
  quoteAsset,
  variant = 'book',
}: {
  rawPrice: string;
  price: string;
  quantity: string;
  total: string;
  side: 'buy' | 'sell';
  onRowSelect?: (p: string, q: string) => void;
  emphasize?: boolean;
  depthPct: number;
  quoteAsset: string;
  variant?: 'book' | 'ladder';
}) {
  const handleClick = useCallback(() => {
    onRowSelect?.(rawPrice, quantity);
  }, [onRowSelect, rawPrice, quantity]);
  const tip = onRowSelect ? `Set price to ${rawPrice} ${quoteAsset}` : undefined;
  const w = Math.min(100, Math.max(4, depthPct));
  const priceCls = side === 'buy' ? 'text-price-up' : 'text-price-down';
  const rowSize =
    variant === 'ladder'
      ? 'min-h-[36px] py-1.5 text-[13px] leading-tight'
      : 'py-px text-[11px] leading-[1.35]';

  const barGradient =
    side === 'buy'
      ? 'bg-gradient-to-l from-price-up/35 via-price-up/12 to-transparent dark:from-price-up/40 dark:via-price-up/15'
      : 'bg-gradient-to-l from-price-down/35 via-price-down/12 to-transparent dark:from-price-down/40 dark:via-price-down/15';

  return (
    <button
      type="button"
      onClick={onRowSelect ? handleClick : undefined}
      title={tip}
      data-orderbook-row
      className={`group/level relative w-full cursor-pointer overflow-hidden border-b border-border/90 px-2 font-mono tabular-nums transition-all duration-150 last:border-b-0 hover:bg-accent/80 hover:shadow-[inset_0_0_0_1px_rgba(59,130,246,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/35 dark:border-border/50 dark:hover:bg-accent/45 dark:hover:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.28)] ${rowSize} ${
        emphasize ? 'bg-muted/90 dark:bg-card/35' : ''
      }`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 transition-[width] duration-200 ease-out ${barGradient}`}
        style={{ width: `${w}%` }}
      />
      <span className={`relative z-10 ${COL_GRID} items-center`}>
        <span className={`min-w-0 truncate text-left font-semibold ${priceCls} ${emphasize ? 'font-bold' : ''}`}>
          {price}
        </span>
        <span className="truncate text-right text-foreground dark:text-foreground/90">{quantity}</span>
        <span className="truncate text-right text-muted-foreground">{total}</span>
      </span>
    </button>
  );
});

function SkeletonRow() {
  return (
    <div className={`${COL_GRID} items-center gap-1 px-1.5 py-px`}>
      <span className="h-2.5 rounded bg-accent" />
      <span className="h-2.5 rounded bg-accent" />
      <span className="h-2.5 rounded bg-accent" />
    </div>
  );
}

function SentimentFooter({
  buyPct,
  sellPct,
  buyLiquidity,
  sellLiquidity,
  quoteAsset,
}: {
  buyPct: number;
  sellPct: number;
  buyLiquidity: number;
  sellLiquidity: number;
  quoteAsset: string;
}) {
  const b = Math.min(100, Math.max(0, buyPct));
  const s = Math.min(100, Math.max(0, sellPct));
  const sum = b + s || 1;
  const wBuy = (b / sum) * 100;
  const skew = 12;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className="font-medium text-muted-foreground">Buy / Sell</span>
        <span className="font-mono text-muted-foreground">
          {formatCompactNumber(buyLiquidity)} / {formatCompactNumber(sellLiquidity)} {quoteAsset}
        </span>
      </div>
      <div className="flex h-7 w-full min-w-0 overflow-hidden rounded-sm text-[10px] font-bold tabular-nums text-foreground">
        <div
          className="relative flex h-full min-w-0 items-center gap-1 bg-buy pl-2"
          style={{
            width: `${wBuy}%`,
            clipPath: `polygon(0 0, 100% 0, calc(100% - ${skew}px) 100%, 0 100%)`,
          }}
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-card/20 text-[9px]">B</span>
          <span>{b.toFixed(0)}%</span>
        </div>
        <div
          className="flex h-full min-w-0 flex-1 items-center justify-end gap-1 bg-sell pr-2"
          style={{
            marginLeft: `-${skew}px`,
            paddingLeft: `${skew + 4}px`,
          }}
        >
          <span>{s.toFixed(0)}%</span>
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-card/20 text-[9px]">S</span>
        </div>
      </div>
    </div>
  );
}

export function SpotOrderbookPanel({
  bids,
  asks,
  quoteAsset,
  baseAsset,
  lastPrice,
  pricePrecision = 6,
  qtyPrecision = 6,
  onPriceClick,
  onTradePriceClick,
  loading = false,
  recentTrades = [],
}: SpotOrderbookPanelProps) {
  const [tab, setTab] = useState<'orderbook' | 'ladder' | 'trades'>('orderbook');
  const [bookView, setBookView] = useState<'both' | 'asks' | 'bids'>('both');
  const [flipVertical, setFlipVertical] = useState(false);
  const [displayPricePrecision, setDisplayPricePrecision] = useState(pricePrecision);
  const [depthLimit, setDepthLimit] = useState<(typeof DEPTH_OPTIONS)[number]>(20);
  const [lastMove, setLastMove] = useState<'up' | 'down' | null>(null);
  const prevLastRef = useRef<string | null>(null);

  useEffect(() => setDisplayPricePrecision(pricePrecision), [pricePrecision]);

  useEffect(() => {
    const cur = lastPrice ?? null;
    const prev = prevLastRef.current;
    if (prev != null && cur != null && prev !== cur) {
      const a = parseFloat(prev);
      const b = parseFloat(cur);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        setLastMove(b > a ? 'up' : 'down');
        const t = setTimeout(() => setLastMove(null), 500);
        prevLastRef.current = cur;
        return () => clearTimeout(t);
      }
    }
    prevLastRef.current = cur;
  }, [lastPrice]);

  const effectivePricePrecision = Math.min(10, Math.max(0, displayPricePrecision));
  const totalPrecision = Math.min(10, Math.max(2, effectivePricePrecision));

  const bidRows = useMemo(() => bids.slice(0, depthLimit), [bids, depthLimit]);
  const askRowsAsc = useMemo(() => asks.slice(0, depthLimit), [asks, depthLimit]);
  const askRows = useMemo(() => [...askRowsAsc].reverse(), [askRowsAsc]);

  const bidTotals = useMemo(() => {
    let cum = 0;
    return bidRows.map((r) => {
      const p = parseFloat(r.price) || 0;
      const q = parseFloat(r.quantity) || 0;
      cum += p * q;
      return cum;
    });
  }, [bidRows]);

  const askTotalsAsc = useMemo(() => {
    let cum = 0;
    return askRowsAsc.map((r) => {
      const p = parseFloat(r.price) || 0;
      const q = parseFloat(r.quantity) || 0;
      cum += p * q;
      return cum;
    });
  }, [askRowsAsc]);

  const maxBidCum = Math.max(...bidTotals, 1e-12);
  const maxAskCum = Math.max(...askTotalsAsc, 1e-12);
  const depthPctBid = (i: number) => Math.min(100, ((bidTotals[i] ?? 0) / maxBidCum) * 100);
  const depthPctAsk = (ascIndex: number) => Math.min(100, ((askTotalsAsc[ascIndex] ?? 0) / maxAskCum) * 100);

  const bestBid = bidRows[0];
  const bestAsk = askRowsAsc[0];
  const bestBidPx = bestBid ? parseFloat(bestBid.price) : NaN;
  const bestAskPx = bestAsk ? parseFloat(bestAsk.price) : NaN;
  const spreadAbs =
    Number.isFinite(bestBidPx) && Number.isFinite(bestAskPx) && bestAskPx > bestBidPx ? bestAskPx - bestBidPx : 0;
  const mid =
    Number.isFinite(bestBidPx) && Number.isFinite(bestAskPx) ? (bestBidPx + bestAskPx) / 2 : 0;
  const spreadBps = mid > 0 && spreadAbs > 0 ? (spreadAbs / mid) * 10000 : 0;
  const spreadPctMid = mid > 0 && spreadAbs > 0 ? (spreadAbs / mid) * 100 : 0;

  const buyLiquidityFull = bidRows.reduce((sum, r) => sum + parseFloat(r.price || '0') * parseFloat(r.quantity || '0'), 0);
  const sellLiquidityFull = askRowsAsc.reduce((sum, r) => sum + parseFloat(r.price || '0') * parseFloat(r.quantity || '0'), 0);
  const buyLiquidity = bookView === 'asks' ? 0 : buyLiquidityFull;
  const sellLiquidity = bookView === 'bids' ? 0 : sellLiquidityFull;
  const totalLiquidity = buyLiquidity + sellLiquidity;
  const buyPct = totalLiquidity > 0 ? (buyLiquidity / totalLiquidity) * 100 : bookView === 'bids' ? 100 : bookView === 'asks' ? 0 : 50;
  const sellPct = totalLiquidity > 0 ? (sellLiquidity / totalLiquidity) * 100 : bookView === 'asks' ? 100 : bookView === 'bids' ? 0 : 50;

  const lastDisplay =
    lastPrice ??
    (bestBid && bestAsk && Number.isFinite(mid) && mid > 0 ? String(mid) : null);

  const tickOptions = useMemo(() => {
    const maxP = Math.min(8, Math.max(2, pricePrecision));
    return TICK_PRESETS.filter((p) => p <= maxP);
  }, [pricePrecision]);

  const tickLabel = (p: number) =>
    p === 2 ? '0.01' : p === 4 ? '0.0001' : p === 6 ? '0.000001' : '0.00000001';

  const tabBtn = (active: boolean) =>
    `min-h-9 flex-1 px-2 py-2 text-[11px] font-bold transition-colors ${
      active
        ? 'border-b-2 border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
        : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground/90'
    }`;

  const iconToggle = (active: boolean) =>
    `flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors ${
      active
        ? 'border-blue-500/70 bg-blue-50 text-blue-700 dark:border-blue-400/80 dark:bg-blue-950/50 dark:text-blue-300'
        : 'border-border bg-card text-muted-foreground hover:border-border hover:text-foreground dark:border-border dark:bg-background dark:text-muted-foreground dark:hover:border-border'
    }`;

  const midPriceClass =
    lastMove === 'up'
      ? 'text-price-up'
      : lastMove === 'down'
        ? 'text-price-down'
        : 'text-foreground';

  const handleBookLevelSelect = useCallback(
    (p: string, q: string) => {
      onPriceClick?.(p, q);
    },
    [onPriceClick]
  );

  const renderAsks = (variant: 'book' | 'ladder' = 'book') =>
    bookView !== 'bids' && askRows.length > 0 ? (
      <div className="border-b border-dashed border-border/80 dark:border-border/60">
        {askRows.map((row, i) => {
          const ascIndex = askRowsAsc.length - 1 - i;
          const tot = askTotalsAsc[ascIndex] ?? 0;
          return (
            <LevelRow
              key={`sell-${row.price}-${variant}`}
              rawPrice={row.price}
              price={formatValueFixedTrim(row.price, effectivePricePrecision)}
              quantity={formatValueFixedTrim(row.quantity, qtyPrecision)}
              side="sell"
              total={tot > 0 ? formatFixedTrim(tot, totalPrecision) : '—'}
              emphasize={i === askRows.length - 1}
              depthPct={depthPctAsk(ascIndex)}
              quoteAsset={quoteAsset}
              variant={variant}
              onRowSelect={onPriceClick ? handleBookLevelSelect : undefined}
            />
          );
        })}
      </div>
    ) : null;

  const midContent = (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`flex items-center gap-0.5 font-mono text-xl font-bold tabular-nums leading-none sm:text-2xl ${midPriceClass}`}>
        {lastMove === 'up' && <ChevronUp className="h-6 w-6 shrink-0" strokeWidth={2.5} aria-hidden />}
        {lastMove === 'down' && <ChevronDown className="h-6 w-6 shrink-0" strokeWidth={2.5} aria-hidden />}
        <span>{formatValueFixedTrim(lastDisplay, effectivePricePrecision)}</span>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        ≈{formatValueFixedTrim(lastDisplay, effectivePricePrecision)} {quoteAsset}
      </p>
      {(spreadAbs > 0 || spreadBps > 0) && (
        <p className="text-[10px] font-mono tabular-nums text-muted-foreground dark:text-muted-foreground">
          Spread {spreadAbs > 0 ? formatFixedTrim(spreadAbs, Math.min(6, effectivePricePrecision)) : '—'}
          {spreadPctMid > 0 ? ` (${spreadPctMid >= 0.0001 ? spreadPctMid.toFixed(3) : '<0.001'}%)` : ''}
          {spreadBps >= 0.01 ? ` · ${spreadBps.toFixed(1)} bps` : ''}
        </p>
      )}
    </div>
  );

  const renderMid = () => (
    <div className="border-y border-border/90 bg-accent/50 px-2 py-1.5 dark:border-border/90 dark:bg-card/50">
      {onPriceClick && lastDisplay ? (
        <button
          type="button"
          title={`Set order price to ${lastDisplay} ${quoteAsset}`}
          onClick={() => onPriceClick(String(lastDisplay), '')}
          className="w-full cursor-pointer rounded-md border-0 bg-transparent p-0 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/35 dark:hover:bg-accent/50"
        >
          {midContent}
        </button>
      ) : (
        midContent
      )}
    </div>
  );

  const renderBids = (variant: 'book' | 'ladder' = 'book') =>
    bookView !== 'asks' && bidRows.length > 0 ? (
      <div>
        {bidRows.map((row, i) => (
          <LevelRow
            key={`buy-${row.price}-${variant}`}
            rawPrice={row.price}
            price={formatValueFixedTrim(row.price, effectivePricePrecision)}
            quantity={formatValueFixedTrim(row.quantity, qtyPrecision)}
            side="buy"
            total={(bidTotals[i] ?? 0) > 0 ? formatFixedTrim(bidTotals[i] ?? 0, totalPrecision) : '—'}
            emphasize={i === 0}
            depthPct={depthPctBid(i)}
            quoteAsset={quoteAsset}
            variant={variant}
            onRowSelect={onPriceClick ? handleBookLevelSelect : undefined}
          />
        ))}
      </div>
    ) : null;

  const bookBody = flipVertical ? (
    <>
      {renderBids('book')}
      {renderMid()}
      {renderAsks('book')}
    </>
  ) : (
    <>
      {renderAsks('book')}
      {renderMid()}
      {renderBids('book')}
    </>
  );

  const ladderBody = flipVertical ? (
    <>
      {renderBids('ladder')}
      {renderMid()}
      {renderAsks('ladder')}
    </>
  ) : (
    <>
      {renderAsks('ladder')}
      {renderMid()}
      {renderBids('ladder')}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-[11px] dark:bg-card">
      <div className="flex flex-shrink-0 border-b border-border/90 dark:border-border/90">
        <button type="button" onClick={() => setTab('orderbook')} className={tabBtn(tab === 'orderbook')}>
          Order Book
        </button>
        <button type="button" onClick={() => setTab('ladder')} className={tabBtn(tab === 'ladder')}>
          Ladder
        </button>
        <button type="button" onClick={() => setTab('trades')} className={tabBtn(tab === 'trades')}>
          Recent Trades
        </button>
      </div>

      {tab === 'ladder' && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/90 px-2 py-1.5 dark:border-border/90">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            DOM · click row to set price
          </p>
          <select
            value={depthLimit}
            onChange={(e) => setDepthLimit(Number(e.target.value) as (typeof DEPTH_OPTIONS)[number])}
            title="Rows per side"
            className="h-7 min-w-[3rem] cursor-pointer rounded border border-border bg-card px-1.5 text-[10px] font-bold text-foreground dark:border-border dark:bg-background dark:text-foreground"
          >
            {DEPTH_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      {tab === 'orderbook' && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/90 px-2 py-1.5 dark:border-border/90">
          <div className="flex items-center gap-1" role="group" aria-label="Order book view">
            <button
              type="button"
              title="All"
              className={iconToggle(bookView === 'both')}
              onClick={() => setBookView('both')}
            >
              <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              title="Sell orders only"
              className={iconToggle(bookView === 'asks')}
              onClick={() => setBookView('asks')}
            >
              <TrendingDown className={`h-3.5 w-3.5 ${bookView === 'asks' ? 'text-price-down' : ''}`} aria-hidden />
            </button>
            <button
              type="button"
              title="Buy orders only"
              className={iconToggle(bookView === 'bids')}
              onClick={() => setBookView('bids')}
            >
              <TrendingUp className={`h-3.5 w-3.5 ${bookView === 'bids' ? 'text-price-up' : ''}`} aria-hidden />
            </button>
            <button
              type="button"
              title="Flip order (bids above / below)"
              className={iconToggle(flipVertical)}
              onClick={() => setFlipVertical((v) => !v)}
            >
              <ArrowDownUp className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <select
              value={effectivePricePrecision}
              onChange={(e) => setDisplayPricePrecision(Number(e.target.value))}
              title="Price grouping"
              className="h-7 min-w-[5rem] cursor-pointer rounded border border-border bg-card px-1.5 text-[10px] font-mono font-semibold text-foreground dark:border-border dark:bg-background dark:text-foreground"
            >
              {tickOptions.map((p) => (
                <option key={p} value={p}>
                  {tickLabel(p)}
                </option>
              ))}
            </select>
            <select
              value={depthLimit}
              onChange={(e) => setDepthLimit(Number(e.target.value) as (typeof DEPTH_OPTIONS)[number])}
              title="Rows per side"
              className="h-7 min-w-[3rem] cursor-pointer rounded border border-border bg-card px-1.5 text-[10px] font-bold text-foreground dark:border-border dark:bg-background dark:text-foreground"
            >
              {DEPTH_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tab === 'ladder' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border/90 bg-background/80 px-2 py-1 dark:border-border/90 dark:bg-card/40">
            <div className={`${COL_GRID} font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground`}>
              <span className="text-left">Asks ↑ · Price({quoteAsset})</span>
              <span className="text-right">Qty({baseAsset})</span>
              <span className="text-right">Σ {quoteAsset}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="space-y-px p-1">
                {Array.from({ length: 10 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            ) : (
              <>
                {ladderBody}
                {bidRows.length === 0 && askRows.length === 0 && !loading && (
                  <p className="px-4 py-10 text-center text-[11px] text-muted-foreground">No order book data</p>
                )}
              </>
            )}
          </div>
        </div>
      ) : tab === 'trades' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border/90 bg-background/80 px-2 py-1 dark:border-border/90 dark:bg-card/40">
            <div className={`${COL_GRID} font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground`}>
              <span className="text-left">Price({quoteAsset})</span>
              <span className="text-right">Qty({baseAsset})</span>
              <span className="text-right">Time</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {recentTrades.length === 0 ? (
              <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">No recent trades</p>
            ) : (
              recentTrades.slice(0, 48).map((t) => {
                const px = parseFloat(t.price) || 0;
                const q = parseFloat(t.quantity) || 0;
                const val = px * q;
                const priceCls = t.side === 'buy' ? 'text-price-up' : 'text-price-down';
                const row = (
                  <div
                    className={`${COL_GRID} items-center border-b border-border px-1.5 py-px font-mono tabular-nums dark:border-border/50`}
                  >
                    <span
                      className={`min-w-0 truncate text-left font-semibold ${priceCls}`}
                      title={val > 0 ? `${formatFixedTrim(val, totalPrecision)} ${quoteAsset}` : undefined}
                    >
                      {formatValueFixedTrim(t.price, pricePrecision)}
                    </span>
                    <span className="truncate text-right text-foreground dark:text-foreground/90">
                      {formatValueFixedTrim(t.quantity, qtyPrecision)}
                    </span>
                    <span className="text-right text-[10px] text-muted-foreground">{formatTradeTime(t.time)}</span>
                  </div>
                );
                if (!onTradePriceClick) return <div key={t.id}>{row}</div>;
                return (
                  <button
                    key={t.id}
                    type="button"
                    title="Use this price in the order form"
                    className="block w-full border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/30"
                    onClick={() => onTradePriceClick(t.price, t.quantity)}
                  >
                    {row}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-border/90 bg-background/80 px-2 py-1 dark:border-border/90 dark:bg-card/40">
            <div className={`${COL_GRID} items-center font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground`}>
              <span className="text-left">Price({quoteAsset})</span>
              <span className="text-right">Qty({baseAsset})</span>
              <span className="inline-flex items-center justify-end gap-0.5 text-right">
                Total({quoteAsset})
                <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
              </span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="space-y-px p-1">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))}
                </div>
              ) : (
                <>
                  {bookBody}
                  {bidRows.length === 0 && askRows.length === 0 && !loading && (
                    <p className="px-4 py-10 text-center text-[11px] text-muted-foreground">No order book data</p>
                  )}
                </>
              )}
            </div>

            <div className="flex-shrink-0 border-t border-border/90 px-2 py-1.5 dark:border-border/90">
              <SentimentFooter
                buyPct={buyPct}
                sellPct={sellPct}
                buyLiquidity={buyLiquidity}
                sellLiquidity={sellLiquidity}
                quoteAsset={quoteAsset}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
