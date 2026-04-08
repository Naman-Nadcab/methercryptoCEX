'use client';

/**
 * Dense order book (Bybit-like layout): RTL depth bars, cumulative totals, icon views, mid strip, diagonal footer.
 * Colors use app theme: price-up / price-down, buy / sell, blue accents — no fixed exchange brand hex.
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  memo,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  LayoutTemplate,
  TrendingDown,
  TrendingUp,
  ArrowDownUp,
} from 'lucide-react';
import { formatFixedTrim, formatValueFixedTrim, formatCompactNumber } from './terminalFormat';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';

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

const DEPTH_OPTIONS = [15, 20, 30] as const;
const MIN_ORDERBOOK_ROWS = 15;
const TICK_PRESETS = [2, 4, 6, 8] as const;

function tickOptionsForInstrument(pricePrecision: number): number[] {
  const maxP = Math.min(8, Math.max(2, pricePrecision));
  return [...TICK_PRESETS.filter((p) => p <= maxP)];
}

/** Default dropdown: 0.01 (2 dp). Falls back to coarsest allowed option if 2 is unavailable. */
function defaultDisplayPricePrecision(pricePrecision: number): number {
  const opts = tickOptionsForInstrument(pricePrecision);
  if (opts.includes(2)) return 2;
  return opts[0] ?? 2;
}

/** Price (left); qty & total — numeric columns right-aligned, monospace */
const COL_GRID =
  'grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)] gap-x-1';

function padAskSlots(ascRows: OrderbookLevel[], minRows: number): (OrderbookLevel | null)[] {
  const rev = [...ascRows].reverse();
  const out: (OrderbookLevel | null)[] = rev.map((r) => r);
  while (out.length < minRows) out.unshift(null);
  return out;
}

function padBidSlots(rows: OrderbookLevel[], minRows: number): (OrderbookLevel | null)[] {
  const out: (OrderbookLevel | null)[] = rows.map((r) => r);
  while (out.length < minRows) out.push(null);
  return out;
}

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

const BOOK_ROW =
  'relative flex min-h-[24px] w-full items-center overflow-hidden px-2 py-0.5 text-label numeric leading-snug';

const depthGradientStyle = (side: 'buy' | 'sell', w: number, variant: 'book' | 'ladder'): React.CSSProperties => {
  const token = side === 'buy' ? 'var(--exchange-buy)' : 'var(--exchange-sell)';
  const grad =
    variant === 'book'
      ? `linear-gradient(to left, hsl(${token} / 0.32), hsl(${token} / 0.1), transparent 94%)`
      : `linear-gradient(to left, hsl(${token} / 0.26), hsl(${token} / 0.06), transparent)`;
  return { width: `${w}%`, background: grad };
};

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
  const w = Math.min(100, Math.max(0, depthPct));
  const priceCls = side === 'buy' ? 'text-buy' : 'text-sell';
  const rowSize =
    variant === 'ladder'
      ? 'min-h-[38px] py-2 text-label numeric leading-snug'
      : BOOK_ROW;

  return (
    <button
      type="button"
      onClick={onRowSelect ? handleClick : undefined}
      title={tip}
      data-orderbook-row
      className={`group/level border-b border-border/50 text-left transition-colors duration-75 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40 dark:border-border/40 ${
        variant === 'book'
          ? `${BOOK_ROW} cursor-pointer`
          : `relative ${rowSize} w-full cursor-pointer px-2`
      } ${emphasize && variant === 'book' ? 'bg-muted/30' : ''} ${emphasize && variant === 'ladder' ? 'bg-muted/35' : ''}`}
    >
      {variant === 'book' && w > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 transition-[width] duration-150 ease-out"
          style={depthGradientStyle(side, w, 'book')}
        />
      )}
      {variant === 'ladder' && w > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 transition-[width] duration-200 ease-out"
          style={depthGradientStyle(side, w, 'ladder')}
        />
      )}
      <span className={`relative z-10 w-full ${COL_GRID} items-center`}>
        <span className={`min-w-0 truncate text-left font-semibold ${priceCls} ${emphasize ? 'font-bold' : ''}`}>
          {price}
        </span>
        <span className="truncate text-right text-foreground">{quantity}</span>
        <span className="truncate text-right text-muted-foreground">{total}</span>
      </span>
    </button>
  );
});

const EmptyBookRow = memo(function EmptyBookRow() {
  return (
    <div
      className={`${BOOK_ROW} border-b border-border/50 text-muted-foreground`}
      aria-hidden
    >
      <span className={`${COL_GRID} w-full items-center`}>
        <span className="text-left">—</span>
        <span className="text-right">—</span>
        <span className="text-right">—</span>
      </span>
    </div>
  );
});

function SkeletonRow() {
  return (
    <div className={`${COL_GRID} min-h-6 items-center border-b border-border/40 px-2 py-0.5`}>
      <span className="h-2 rounded bg-muted" />
      <span className="ml-auto h-2 w-10 rounded bg-muted" />
      <span className="ml-auto h-2 w-10 rounded bg-muted" />
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

  const tooltipLines = [
    `Bids: ${b.toFixed(1)}% of visible depth`,
    `Asks: ${s.toFixed(1)}% of visible depth`,
    `Bid notional: ${formatCompactNumber(buyLiquidity)} ${quoteAsset}`,
    `Ask notional: ${formatCompactNumber(sellLiquidity)} ${quoteAsset}`,
  ].join('\n');

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-label text-muted-foreground">
        <span className="font-medium">B / S ratio</span>
        <span className="numeric font-semibold">
          <span className="text-buy">{b.toFixed(1)}%</span>
          <span className="text-muted-foreground/60"> · </span>
          <span className="text-sell">{s.toFixed(1)}%</span>
        </span>
      </div>
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <div
            className="flex h-6 w-full min-w-0 cursor-help overflow-hidden rounded-sm text-label font-semibold numeric tracking-wide"
            aria-label={`Bid depth ${b.toFixed(1)} percent, Ask depth ${s.toFixed(1)} percent`}
          >
            <div
              className="relative flex h-full min-w-0 items-center gap-1 bg-buy/35 pl-2 text-buy dark:bg-buy/25"
              style={{
                width: `${wBuy}%`,
                clipPath: `polygon(0 0, 100% 0, calc(100% - ${skew}px) 100%, 0 100%)`,
              }}
            >
              <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm bg-foreground/10 text-label font-bold leading-none text-buy">
                B
              </span>
              <span>{b.toFixed(0)}%</span>
            </div>
            <div
              className="flex h-full min-w-0 flex-1 items-center justify-end gap-1 bg-sell/35 pr-2 text-sell dark:bg-sell/25"
              style={{
                marginLeft: `-${skew}px`,
                paddingLeft: `${skew + 4}px`,
              }}
            >
              <span>{s.toFixed(0)}%</span>
              <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-sm bg-foreground/10 text-label font-bold leading-none text-sell">
                S
              </span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[240px] whitespace-pre-line border-border bg-popover px-2.5 py-2 text-label leading-snug text-popover-foreground"
        >
          {tooltipLines}
        </TooltipContent>
      </Tooltip>
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
  const [displayPricePrecision, setDisplayPricePrecision] = useState(() =>
    defaultDisplayPricePrecision(pricePrecision)
  );
  const [depthLimit, setDepthLimit] = useState<(typeof DEPTH_OPTIONS)[number]>(20);
  const [lastMove, setLastMove] = useState<'up' | 'down' | null>(null);
  const prevLastRef = useRef<string | null>(null);

  useEffect(() => {
    setDisplayPricePrecision((prev) => {
      const opts = tickOptionsForInstrument(pricePrecision);
      if (opts.includes(prev)) return prev;
      return defaultDisplayPricePrecision(pricePrecision);
    });
  }, [pricePrecision]);

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

  /** Single derived snapshot avoids TDZ / hook-order issues and keeps paddings in sync. */
  const {
    bidRows,
    askRowsAsc,
    askRows,
    askSlotsBook,
    bidSlotsBook,
    askPadTopCount,
  } = useMemo(() => {
    const br = bids.slice(0, depthLimit);
    const ar = asks.slice(0, depthLimit);
    return {
      bidRows: br,
      askRowsAsc: ar,
      askRows: [...ar].reverse(),
      askSlotsBook: padAskSlots(ar, MIN_ORDERBOOK_ROWS),
      bidSlotsBook: padBidSlots(br, MIN_ORDERBOOK_ROWS),
      askPadTopCount: Math.max(0, MIN_ORDERBOOK_ROWS - ar.length),
    };
  }, [bids, asks, depthLimit]);

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

  const tickOptions = useMemo(() => tickOptionsForInstrument(pricePrecision), [pricePrecision]);

  const tickLabel = (p: number) =>
    p === 2 ? '0.01' : p === 4 ? '0.0001' : p === 6 ? '0.000001' : '0.00000001';

  const tabBtn = (active: boolean) =>
    `min-h-8 flex-1 px-1.5 py-2 text-label font-semibold tracking-wide transition-colors ${
      active
        ? 'border-b-2 border-primary text-foreground'
        : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
    }`;

  const iconToggle = (active: boolean) =>
    `flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors ${
      active
        ? 'border-primary/50 bg-primary/10 text-primary'
        : 'border-border bg-muted text-muted-foreground hover:text-foreground'
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

  const renderLadderAsks = (variant: 'ladder') =>
    bookView !== 'bids' && askRows.length > 0 ? (
      <div className="border-b border-dashed border-border/70 dark:border-border/50">
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
              total={tot > 0 ? formatFixedTrim(tot, effectivePricePrecision) : '—'}
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
    <div className="flex flex-col items-center gap-0.5 py-0.5">
      <div
        className={`flex items-center justify-center gap-1 text-lg font-bold leading-tight tracking-tight numeric sm:text-xl ${midPriceClass}`}
      >
        {lastMove === 'up' && <ChevronUp className="h-4 w-4 shrink-0 text-buy" strokeWidth={2.5} aria-hidden />}
        {lastMove === 'down' && <ChevronDown className="h-4 w-4 shrink-0 text-sell" strokeWidth={2.5} aria-hidden />}
        <span>{formatValueFixedTrim(lastDisplay, effectivePricePrecision)}</span>
        <span className="text-sm font-semibold text-muted-foreground sm:text-base">{quoteAsset}</span>
      </div>
      {(spreadAbs > 0 || spreadBps > 0) && (
        <p className="text-center text-[11px] leading-tight numeric text-muted-foreground sm:text-label">
          <span className="font-medium text-muted-foreground/85">Spread</span>{' '}
          <span className="font-semibold text-foreground/85">
            {spreadAbs > 0 ? formatFixedTrim(spreadAbs, Math.min(6, effectivePricePrecision)) : '—'}
            {spreadPctMid > 0 ? ` · ${spreadPctMid >= 0.0001 ? spreadPctMid.toFixed(3) : '<0.001'}%` : ''}
            {spreadBps >= 0.01 ? ` · ${spreadBps.toFixed(1)} bps` : ''}
          </span>
        </p>
      )}
    </div>
  );

  const renderMid = () => (
    <div className="shrink-0 border-y border-solid border-border bg-muted/80 px-2 py-1 dark:bg-muted/55">
      {onPriceClick && lastDisplay ? (
        <button
          type="button"
          title={`Set order price to ${lastDisplay} ${quoteAsset}`}
          onClick={() => onPriceClick(String(lastDisplay), '')}
          className="w-full cursor-pointer rounded-md border-0 bg-transparent p-0 text-center transition-colors hover:bg-muted/80 active:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
        >
          {midContent}
        </button>
      ) : (
        midContent
      )}
    </div>
  );

  const renderLadderBids = (variant: 'ladder') =>
    bookView !== 'asks' && bidRows.length > 0 ? (
      <div>
        {bidRows.map((row, i) => (
          <LevelRow
            key={`buy-${row.price}-${variant}`}
            rawPrice={row.price}
            price={formatValueFixedTrim(row.price, effectivePricePrecision)}
            quantity={formatValueFixedTrim(row.quantity, qtyPrecision)}
            side="buy"
            total={(bidTotals[i] ?? 0) > 0 ? formatFixedTrim(bidTotals[i] ?? 0, effectivePricePrecision) : '—'}
            emphasize={i === 0}
            depthPct={depthPctBid(i)}
            quoteAsset={quoteAsset}
            variant={variant}
            onRowSelect={onPriceClick ? handleBookLevelSelect : undefined}
          />
        ))}
      </div>
    ) : null;

  const renderBookAskRows = () => (
    <>
      {askSlotsBook.map((row, i) => {
        if (!row) return <EmptyBookRow key={`ask-pad-${i}`} />;
        const ascIndex = askRowsAsc.length - 1 - (i - askPadTopCount);
        const tot = ascIndex >= 0 ? (askTotalsAsc[ascIndex] ?? 0) : 0;
        const bestAskRowIndex = askPadTopCount + askRowsAsc.length - 1;
        return (
          <LevelRow
            key={`sell-book-${row.price}-${i}`}
            rawPrice={row.price}
            price={formatValueFixedTrim(row.price, effectivePricePrecision)}
            quantity={formatValueFixedTrim(row.quantity, qtyPrecision)}
            side="sell"
            total={tot > 0 ? formatFixedTrim(tot, effectivePricePrecision) : '—'}
            emphasize={askRowsAsc.length > 0 && i === bestAskRowIndex}
            depthPct={ascIndex >= 0 ? depthPctAsk(ascIndex) : 0}
            quoteAsset={quoteAsset}
            variant="book"
            onRowSelect={onPriceClick ? handleBookLevelSelect : undefined}
          />
        );
      })}
    </>
  );

  const renderBookBidRows = () => (
    <>
      {bidSlotsBook.map((row, i) => {
        if (!row) return <EmptyBookRow key={`bid-pad-${i}`} />;
        const tot = bidTotals[i] ?? 0;
        return (
          <LevelRow
            key={`buy-book-${row.price}-${i}`}
            rawPrice={row.price}
            price={formatValueFixedTrim(row.price, effectivePricePrecision)}
            quantity={formatValueFixedTrim(row.quantity, qtyPrecision)}
            side="buy"
            total={tot > 0 ? formatFixedTrim(tot, effectivePricePrecision) : '—'}
            emphasize={bidRows.length > 0 && i === 0}
            depthPct={depthPctBid(i)}
            quoteAsset={quoteAsset}
            variant="book"
            onRowSelect={onPriceClick ? handleBookLevelSelect : undefined}
          />
        );
      })}
    </>
  );

  const asksScrollPane = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {loading ? (
          <div className="flex flex-col">
            {Array.from({ length: MIN_ORDERBOOK_ROWS }).map((_, i) => (
              <SkeletonRow key={`ask-sk-${i}`} />
            ))}
          </div>
        ) : (
          renderBookAskRows()
        )}
      </div>
    </div>
  );

  const bidsScrollPane = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {loading ? (
          <div className="flex flex-col">
            {Array.from({ length: MIN_ORDERBOOK_ROWS }).map((_, i) => (
              <SkeletonRow key={`bid-sk-${i}`} />
            ))}
          </div>
        ) : (
          renderBookBidRows()
        )}
      </div>
    </div>
  );

  let orderBookGrid: ReactNode;
  if (bookView === 'asks') {
    orderBookGrid = (
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        {asksScrollPane}
        {renderMid()}
      </div>
    );
  } else if (bookView === 'bids') {
    orderBookGrid = (
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        {renderMid()}
        {bidsScrollPane}
      </div>
    );
  } else if (flipVertical) {
    orderBookGrid = (
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden">
        {bidsScrollPane}
        {renderMid()}
        {asksScrollPane}
      </div>
    );
  } else {
    orderBookGrid = (
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden">
        {asksScrollPane}
        {renderMid()}
        {bidsScrollPane}
      </div>
    );
  }

  const ladderBody = flipVertical ? (
    <>
      {renderLadderBids('ladder')}
      {renderMid()}
      {renderLadderAsks('ladder')}
    </>
  ) : (
    <>
      {renderLadderAsks('ladder')}
      {renderMid()}
      {renderLadderBids('ladder')}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-label text-foreground">
      <div className="flex flex-shrink-0 border-b border-border">
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
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1">
          <p className="text-label font-semibold uppercase tracking-wide text-muted-foreground">
            DOM · click row to set price
          </p>
          <select
            value={depthLimit}
            onChange={(e) => setDepthLimit(Number(e.target.value) as (typeof DEPTH_OPTIONS)[number])}
            title="Rows per side"
            className="h-7 min-w-[3rem] cursor-pointer rounded border border-border bg-muted px-1.5 text-label font-bold text-foreground"
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
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-2 py-1">
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
              className="h-7 min-w-[5rem] cursor-pointer rounded border border-border bg-muted px-1.5 text-label font-mono font-semibold text-foreground"
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
              className="h-7 min-w-[3rem] cursor-pointer rounded border border-border bg-muted px-1.5 text-label font-bold text-foreground"
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
          <div className="border-b border-border bg-muted/60 px-2 py-0.5 dark:bg-muted/40">
            <div className={`${COL_GRID} numeric text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:text-label`}>
              <span className="text-left">Asks ↑ · Price({quoteAsset})</span>
              <span className="text-right">Amount({baseAsset})</span>
              <span className="text-right">Σ {quoteAsset}</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
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
                  <p className="px-4 py-10 text-center text-label text-muted-foreground">No order book data</p>
                )}
              </>
            )}
          </div>
        </div>
      ) : tab === 'trades' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border bg-muted/60 px-2 py-0.5 dark:bg-muted/40">
            <div className={`${COL_GRID} numeric text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:text-label`}>
              <span className="text-left">Price({quoteAsset})</span>
              <span className="text-right">Amount({baseAsset})</span>
              <span className="text-right">Time</span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            {recentTrades.length === 0 ? (
              <p className="px-3 py-8 text-center text-label text-muted-foreground">No recent trades</p>
            ) : (
              recentTrades.slice(0, 48).map((t) => {
                const px = parseFloat(t.price) || 0;
                const q = parseFloat(t.quantity) || 0;
                const val = px * q;
                const priceCls = t.side === 'buy' ? 'text-buy' : 'text-sell';
                const row = (
                  <div
                    className={`${COL_GRID} items-center border-b border-border px-1.5 py-0.5 numeric dark:border-border/50`}
                  >
                    <span
                      className={`min-w-0 truncate text-left font-semibold ${priceCls}`}
                      title={val > 0 ? `${formatFixedTrim(val, effectivePricePrecision)} ${quoteAsset}` : undefined}
                    >
                      {formatValueFixedTrim(t.price, effectivePricePrecision)}
                    </span>
                    <span className="truncate text-right text-foreground dark:text-foreground/90">
                      {formatValueFixedTrim(t.quantity, qtyPrecision)}
                    </span>
                    <span className="text-right text-label text-muted-foreground">{formatTradeTime(t.time)}</span>
                  </div>
                );
                if (!onTradePriceClick) return <div key={t.id}>{row}</div>;
                return (
                  <button
                    key={t.id}
                    type="button"
                    title="Use this price in the order form"
                    className="block w-full border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
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
          <div className="border-b border-border bg-muted/60 px-2 py-0.5 dark:bg-muted/40">
            <div className={`${COL_GRID} items-center numeric text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:text-label`}>
              <span className="text-left">Price({quoteAsset})</span>
              <span className="text-right">Amount({baseAsset})</span>
              <span className="text-right">Total({quoteAsset})</span>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {orderBookGrid}
            <div className="shrink-0 border-t border-solid border-border px-2 py-1">
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
