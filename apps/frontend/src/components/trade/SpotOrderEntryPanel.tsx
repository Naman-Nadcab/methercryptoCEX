'use client';

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Info, ArrowRight, ClipboardList, ChevronDown } from 'lucide-react';
import { formatValueFixedTrim } from './terminalFormat';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { SPOT_TRADE_HREF, walletPath, loginWithRedirect } from '@/lib/routes';

export type SpotOrderType = 'limit' | 'market' | 'stop_loss' | 'stop_limit' | 'trailing_stop_market';
export type TimeInForce = 'gtc' | 'ioc' | 'fok';

interface SpotOrderEntryPanelProps {
  side: 'buy' | 'sell';
  orderType: SpotOrderType;
  price: string;
  stopPrice: string;
  trailingDelta?: string;
  quantity: string;
  total: string;
  baseAsset: string;
  quoteAsset: string;
  availableBalance: string;
  pricePrecision?: number;
  qtyPrecision?: number;
  makerFeePercent?: number;
  takerFeePercent?: number;
  timeInForce?: TimeInForce;
  canSubmit: boolean;
  loading: boolean;
  isAuth?: boolean;
  validationMessage?: string;
  estimatedFillPrice?: string | null;
  estimatedSlippagePct?: number | null;
  onSideChange: (side: 'buy' | 'sell') => void;
  onOrderTypeChange: (type: SpotOrderType) => void;
  onPriceChange: (v: string) => void;
  onStopPriceChange: (v: string) => void;
  onTrailingDeltaChange?: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onSetMaxQty: () => void;
  onSetQtyPercent?: (percent: number) => void;
  onTimeInForceChange?: (tif: TimeInForce) => void;
  /** Limit-only: maker-only order; requires GTC (server rejects IOC/FOK). */
  postOnly?: boolean;
  onPostOnlyChange?: (v: boolean) => void;
  onSubmit: () => void | Promise<void>;
  bestBid?: string | null;
  bestAsk?: string | null;
  lastPrice?: string | null;
  instrumentMinQty?: string | null;
  instrumentMinNotional?: string | null;
  /** Quote notional (price × qty) from parent — single source for totals & fees. */
  notionalQuote?: number;
  /** Mid / reference price for % slider & “max buy” hints (parent `priceNum`). */
  referencePrice?: number;
  maxBuyBaseEstimate?: string | null;
  maxSellQuoteEstimate?: string | null;
}

const ORDER_TYPES: { type: SpotOrderType; label: string; sellOnly?: boolean }[] = [
  { type: 'limit', label: 'Limit' },
  { type: 'market', label: 'Market' },
  { type: 'stop_loss', label: 'Stop' },
  { type: 'stop_limit', label: 'Stop Limit' },
  { type: 'trailing_stop_market', label: 'Trailing' },
];

const SLIDER_MARKS = [0, 25, 50, 75, 100];
const PERCENT_QUICK = [25, 50, 75, 100] as const;

const TIF_OPTIONS: { v: TimeInForce; label: string }[] = [
  { v: 'gtc', label: 'Good-Til-Cancelled' },
  { v: 'ioc', label: 'Immediate or Cancel' },
  { v: 'fok', label: 'Fill or Kill' },
];

/** Bybit-style dense field: micro-label inside container, value row + unit on the right. */
function InsetField({
  label,
  suffix,
  headerRight,
  children,
}: {
  label: string;
  suffix: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-gray-200/95 bg-gray-50/95 px-2 pb-1.5 pt-1 dark:border-border/90 dark:bg-background">
      <div className="mb-0 flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        {headerRight}
      </div>
      <div className="flex min-h-[28px] items-center gap-1.5">
        {children}
        <span className="shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

const insetInputClass =
  'min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[15px] font-semibold tabular-nums text-foreground outline-none focus:ring-0 dark:text-foreground';

const fieldInputClass =
  'h-9 w-full min-w-0 rounded-md border border-border bg-card px-2.5 font-mono text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary/25 dark:border-border dark:bg-background dark:text-foreground';

function SummaryRow({
  label,
  value,
  valueClassName = '',
  mono = true,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] leading-tight">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 truncate text-right ${mono ? 'font-mono tabular-nums' : 'font-sans'} ${valueClassName}`}
      >
        {value}
      </span>
    </div>
  );
}

export function SpotOrderEntryPanel({
  side,
  orderType,
  price,
  stopPrice,
  trailingDelta,
  quantity,
  total,
  baseAsset,
  quoteAsset,
  availableBalance,
  pricePrecision = 6,
  qtyPrecision = 6,
  makerFeePercent,
  takerFeePercent,
  timeInForce,
  canSubmit,
  loading,
  isAuth = true,
  validationMessage,
  estimatedFillPrice,
  estimatedSlippagePct,
  onSideChange,
  onOrderTypeChange,
  onPriceChange,
  onStopPriceChange,
  onTrailingDeltaChange,
  onQuantityChange,
  onSetMaxQty,
  onSetQtyPercent,
  onTimeInForceChange,
  postOnly = false,
  onPostOnlyChange,
  onSubmit,
  bestBid,
  bestAsk,
  lastPrice,
  instrumentMinQty,
  instrumentMinNotional,
  notionalQuote = 0,
  referencePrice = 0,
  maxBuyBaseEstimate,
  maxSellQuoteEstimate,
}: SpotOrderEntryPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  useEffect(() => {
    if (!confirmOpen) setConfirmLoading(false);
  }, [confirmOpen]);
  const showPrice = orderType === 'limit' || orderType === 'stop_limit';
  const showStopPrice = orderType === 'stop_loss' || orderType === 'stop_limit';
  const showTrailingDelta = orderType === 'trailing_stop_market';
  const showTif = orderType === 'limit' || orderType === 'stop_limit';
  const tif = timeInForce ?? 'gtc';

  const qtyNum = parseFloat(quantity || '0') || 0;
  const availNum = parseFloat(availableBalance || '0') || 0;
  const fillPrice = orderType === 'market' && estimatedFillPrice ? parseFloat(estimatedFillPrice) : referencePrice;
  const notional =
    notionalQuote > 0
      ? notionalQuote
      : orderType === 'market' && Number.isFinite(fillPrice) && fillPrice > 0
        ? fillPrice * qtyNum
        : referencePrice * qtyNum;
  const maker = makerFeePercent ?? 0.001;
  const taker = takerFeePercent ?? 0.001;
  const feeMeta = useMemo(() => {
    if (orderType === 'market') return { rate: taker, kind: 'taker' as const };
    if (orderType === 'limit') {
      if (postOnly) return { rate: maker, kind: 'maker' as const };
      const tif = timeInForce ?? 'gtc';
      if (tif === 'ioc' || tif === 'fok') return { rate: taker, kind: 'taker' as const };
      return { rate: maker, kind: 'maker' as const };
    }
    if (orderType === 'stop_limit') {
      const tif = timeInForce ?? 'gtc';
      if (tif === 'ioc' || tif === 'fok') return { rate: taker, kind: 'taker' as const };
      return { rate: maker, kind: 'maker' as const };
    }
    if (orderType === 'stop_loss' || orderType === 'trailing_stop_market') {
      return { rate: taker, kind: 'taker' as const };
    }
    return { rate: Math.max(maker, taker), kind: 'worst' as const };
  }, [orderType, postOnly, timeInForce, maker, taker]);
  const feeRate = feeMeta.rate;
  const estimatedFee = notional > 0 ? (notional * feeRate).toFixed(8) : '0';
  /** Buy: fee typically paid in quote; you receive full base. Sell: proceeds less fee in quote. */
  const netReceived =
    notional > 0
      ? side === 'buy'
        ? formatValueFixedTrim(String(qtyNum), qtyPrecision)
        : formatValueFixedTrim(String(notional * (1 - feeRate)), Math.min(10, Math.max(2, pricePrecision)))
      : '0';
  const netReceivedAsset = side === 'buy' ? baseAsset : quoteAsset;
  const slippageWarning = orderType === 'market' && estimatedSlippagePct != null && estimatedSlippagePct > 0.5;

  const refPx = referencePrice > 0 ? referencePrice : fillPrice > 0 && Number.isFinite(fillPrice) ? fillPrice : 0;
  const currentPercent = useMemo(() => {
    if (!onSetQtyPercent || availNum <= 0) return 0;
    if (side === 'buy') {
      const orderValue = refPx * qtyNum;
      if (orderValue <= 0) return 0;
      const pct = (orderValue / availNum) * 100;
      return SLIDER_MARKS.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
    }
    const pct = availNum > 0 ? (qtyNum / availNum) * 100 : 0;
    return SLIDER_MARKS.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
  }, [side, refPx, qtyNum, availNum, onSetQtyPercent]);

  const [sliderValue, setSliderValue] = useState(currentPercent);
  useEffect(() => setSliderValue(currentPercent), [currentPercent]);

  const handleSliderChange = (pct: number) => {
    setSliderValue(pct);
    onSetQtyPercent?.(pct / 100);
  };

  const displayBalance = availableBalance ? formatValueFixedTrim(availableBalance, side === 'buy' ? pricePrecision : qtyPrecision) : '0';
  const balanceUnit = side === 'buy' ? quoteAsset : baseAsset;
  const visibleOrderTypes = ORDER_TYPES.filter((t) => !t.sellOnly || side === 'sell');

  const rulesLine = useMemo(() => {
    const parts: string[] = [];
    if (instrumentMinQty != null && instrumentMinQty !== '') {
      parts.push(`Min qty ${formatValueFixedTrim(instrumentMinQty, Math.min(12, Math.max(0, qtyPrecision)))} ${baseAsset}`);
    }
    if (instrumentMinNotional != null && instrumentMinNotional !== '') {
      parts.push(
        `Min notional ${formatValueFixedTrim(instrumentMinNotional, Math.min(10, Math.max(2, pricePrecision)))} ${quoteAsset}`
      );
    }
    return parts.join(' · ');
  }, [instrumentMinQty, instrumentMinNotional, baseAsset, quoteAsset, qtyPrecision, pricePrecision]);

  const advancedOrderTypes = visibleOrderTypes.filter((t) => t.type !== 'limit' && t.type !== 'market');
  const isPrimaryType = orderType === 'limit' || orderType === 'market';

  return (
    <div id="spot-order-entry-panel" className="flex h-full min-h-0 flex-col bg-card">
      {/* Header — Bybit-style: title + activity shortcut (theme: blue) */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200/90 px-2.5 py-2 dark:border-border/90">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight text-foreground">Trade</span>
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            Spot
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="#spot-terminal-activity"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-blue-400"
            title="Open orders & history"
            aria-label="Scroll to orders and history"
          >
            <ClipboardList className="h-4 w-4" />
          </Link>
          <Link
            href={walletPath.convert}
            className="rounded-md px-2 py-1 text-[10px] font-bold text-primary hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
          >
            Convert
          </Link>
        </div>
      </div>

      {/* Buy / Sell — pill segment (theme colors) */}
      <div className="flex-shrink-0 px-2 pb-1.5 pt-0.5">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-gray-200/90 p-0.5 dark:bg-accent/90">
          <button
            type="button"
            onClick={() => onSideChange('buy')}
            aria-pressed={side === 'buy'}
            className={`rounded-full py-1.5 text-sm font-bold transition-all ${
              side === 'buy'
                ? 'bg-buy text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                : 'text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-gray-200'
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => onSideChange('sell')}
            aria-pressed={side === 'sell'}
            className={`rounded-full py-1.5 text-sm font-bold transition-all ${
              side === 'sell'
                ? 'bg-sell text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                : 'text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-gray-200'
            }`}
          >
            Sell
          </button>
        </div>
      </div>

      {/* Order type — Limit | Market tabs + More… (precision layout) */}
      <div className="flex-shrink-0 border-b border-gray-200/90 px-2.5 pb-0 dark:border-border/90">
        <div className="flex items-stretch gap-0">
          {(['limit', 'market'] as const).map((t) => {
            const label = t === 'limit' ? 'Limit' : 'Market';
            const active = orderType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onOrderTypeChange(t)}
                className={`relative flex-1 pb-2.5 pt-1 text-center text-[11px] font-bold transition-colors ${
                  active
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-gray-200'
                }`}
              >
                {label}
                {active ? (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" aria-hidden />
                ) : null}
              </button>
            );
          })}
          <div className="relative flex min-w-[5.25rem] flex-1 border-l border-border">
            <select
              aria-label="More order types"
              title="Stop, trailing…"
              value={isPrimaryType ? '' : orderType}
              onChange={(e) => {
                const v = e.target.value as SpotOrderType;
                if (v) onOrderTypeChange(v);
              }}
              className="h-full min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent py-2.5 pl-2 pr-9 text-left text-[11px] font-bold leading-none text-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/30 dark:text-foreground/80 dark:focus-visible:ring-blue-400/25"
            >
              {/* Placeholder when Limit/Market; hidden from list when an advanced type is selected */}
              <option value="" hidden={!isPrimaryType}>
                More
              </option>
              {advancedOrderTypes.map(({ type, label }) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>
              <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>

      {rulesLine ? (
        <div className="flex-shrink-0 border-b border-gray-200/90 px-2.5 py-1 dark:border-border/90">
          <p className="text-[10px] font-mono leading-snug text-muted-foreground">{rulesLine}</p>
        </div>
      ) : null}

      {/* Scrollable form — dense stack (tier-1 terminal) */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-muted-foreground">Available</span>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-xs font-bold tabular-nums text-foreground">
                {displayBalance} {balanceUnit}
              </span>
              <Link
                href={walletPath.depositCrypto}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/85 dark:bg-blue-600"
                aria-label="Deposit"
              >
                <Plus className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {showTrailingDelta && (
            <InsetField label="Callback %" suffix="%">
              <input
                id="spot-trailing-delta"
                type="text"
                inputMode="decimal"
                value={trailingDelta ?? ''}
                onChange={(e) => onTrailingDeltaChange?.(e.target.value)}
                className={insetInputClass}
                placeholder="0.1 – 100"
                aria-label="Trailing callback percent"
              />
            </InsetField>
          )}

          {showStopPrice && (
            <InsetField label="Trigger" suffix={quoteAsset}>
              <input
                id="spot-trigger-price"
                type="text"
                inputMode="decimal"
                value={stopPrice}
                onChange={(e) => onStopPriceChange(e.target.value)}
                className={insetInputClass}
                placeholder="0"
                aria-label="Trigger price"
              />
            </InsetField>
          )}

          {showPrice && (
            <div className="space-y-1">
              <InsetField
                label="Price"
                suffix={quoteAsset}
                headerRight={
                  (bestBid != null || bestAsk != null || lastPrice != null) ? (
                    <span className="flex flex-wrap justify-end gap-0.5">
                      {bestBid != null && bestBid !== '' && (
                        <button
                          type="button"
                          onClick={() => onPriceChange(bestBid!)}
                          className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold text-price-up hover:bg-gray-200/80 dark:hover:bg-accent"
                        >
                          B
                        </button>
                      )}
                      {lastPrice != null && lastPrice !== '' && (
                        <button
                          type="button"
                          onClick={() => onPriceChange(lastPrice!)}
                          className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold text-foreground/80 hover:bg-gray-200/80 dark:text-foreground/80 dark:hover:bg-accent"
                        >
                          L
                        </button>
                      )}
                      {bestAsk != null && bestAsk !== '' && (
                        <button
                          type="button"
                          onClick={() => onPriceChange(bestAsk!)}
                          className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold text-price-down hover:bg-gray-200/80 dark:hover:bg-accent"
                        >
                          A
                        </button>
                      )}
                    </span>
                  ) : undefined
                }
              >
                <input
                  id="spot-price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => onPriceChange(e.target.value)}
                  className={insetInputClass}
                  placeholder="0"
                  aria-label={`Price (${quoteAsset})`}
                />
              </InsetField>
            </div>
          )}

          <InsetField
            label="Quantity"
            suffix={baseAsset}
            headerRight={
              <button
                type="button"
                onClick={onSetMaxQty}
                className={`text-[10px] font-bold hover:underline ${side === 'buy' ? 'text-buy' : 'text-sell'}`}
              >
                Max
              </button>
            }
          >
            <input
              id="spot-quantity"
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              className={insetInputClass}
              placeholder="0"
              aria-label={`Quantity in ${baseAsset}`}
            />
          </InsetField>

          {onSetQtyPercent && (
            <div className="space-y-1">
              <div className="flex justify-between gap-1">
                {PERCENT_QUICK.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleSliderChange(pct)}
                    className={`min-h-[30px] flex-1 rounded-md border text-center text-[10px] font-bold transition-colors ${
                      sliderValue === pct
                        ? side === 'buy'
                          ? 'border-buy bg-buy-light text-buy dark:border-buy dark:bg-buy-light dark:text-buy'
                          : 'border-sell bg-sell-light text-sell dark:border-sell dark:bg-sell-light dark:text-sell'
                        : 'border-border bg-card text-muted-foreground dark:border-border dark:bg-background dark:text-muted-foreground'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="relative pt-0.5">
                <div className="mb-1 flex justify-between text-[9px] font-medium tabular-nums text-muted-foreground dark:text-muted-foreground">
                  <span>0</span>
                  <span>100%</span>
                </div>
                <div className="relative h-2 rounded-full bg-accent">
                  <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[6%]">
                    {[25, 50, 75].map((m) => (
                      <span key={m} className="h-1.5 w-px bg-gray-400/50 dark:bg-gray-600" aria-hidden />
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={25}
                    value={sliderValue}
                    onChange={(e) => handleSliderChange(Number(e.target.value))}
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                    aria-label="Balance percentage"
                  />
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                      side === 'buy' ? 'bg-buy/90 dark:bg-buy/85' : 'bg-sell/90 dark:bg-sell/85'
                    }`}
                    style={{ width: `${sliderValue}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="font-semibold">Max. {side === 'buy' ? 'buying amount' : 'proceeds (est.)'}</span>
            <span className="truncate font-mono font-bold tabular-nums text-foreground">
              {side === 'buy'
                ? maxBuyBaseEstimate != null
                  ? `${maxBuyBaseEstimate} ${baseAsset}`
                  : '—'
                : maxSellQuoteEstimate != null
                  ? `${maxSellQuoteEstimate} ${quoteAsset}`
                  : '—'}
            </span>
          </div>

          <InsetField label={orderType === 'market' ? 'Order value (est.)' : 'Total'} suffix={quoteAsset}>
            {notionalQuote > 0 && total && total !== '0' ? (
              <span className={`${insetInputClass} text-foreground`} aria-label={`Total ${quoteAsset}`}>
                {total}
              </span>
            ) : (
              <span className={`${insetInputClass} text-muted-foreground dark:text-gray-600`} aria-label={`Total ${quoteAsset}`}>
                —
              </span>
            )}
          </InsetField>

          {(showTif && onTimeInForceChange) || (orderType === 'limit' && onPostOnlyChange) ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-gray-200/90 bg-card px-2 py-1.5 dark:border-border/90 dark:bg-background/80">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {orderType === 'limit' && onPostOnlyChange && (
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={postOnly}
                      onChange={(e) => onPostOnlyChange(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border text-buy accent-buy focus:ring-2 focus:ring-buy/25 dark:border-gray-600 dark:accent-buy"
                    />
                    <span className="text-[10px] font-semibold text-foreground dark:text-gray-200">Post-only</span>
                  </label>
                )}
                {showTif && onTimeInForceChange && (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:min-w-[12rem]">
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                      TIF
                    </span>
                    <div className="relative min-w-0 flex-1">
                      <select
                        value={tif}
                        disabled={orderType === 'limit' && postOnly}
                        onChange={(e) => onTimeInForceChange(e.target.value as TimeInForce)}
                        className="h-8 w-full cursor-pointer appearance-none rounded-md border border-border bg-muted py-1.5 pl-2 pr-7 text-[10px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border dark:bg-card dark:text-foreground"
                        aria-label="Time in force"
                      >
                        {TIF_OPTIONS.map(({ v, label }) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {orderType === 'market' && estimatedFillPrice && qtyNum > 0 && (
            <div className="rounded-lg border border-dashed border-border bg-card/90 px-2.5 py-2 dark:border-gray-600 dark:bg-background/90">
              <SummaryRow label="Est. avg fill" value={estimatedFillPrice} valueClassName="text-foreground" />
              {estimatedSlippagePct != null && (
                <div className="mt-1">
                  <SummaryRow
                    label="Est. slippage"
                    value={`${estimatedSlippagePct.toFixed(2)}%`}
                    valueClassName={slippageWarning ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky action + summary (always visible) */}
      <div className="flex-shrink-0 border-t border-gray-200/90 bg-card px-2 pb-1.5 pt-1.5 dark:border-border/90 dark:bg-card">
        {slippageWarning && (
          <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
            High slippage — consider a limit order.
          </div>
        )}
        {validationMessage && (
          <p className="mb-2 text-[11px] font-medium text-amber-600 dark:text-amber-400" role="alert">
            {validationMessage}
          </p>
        )}

        {!isAuth ? (
          <Link
            href={loginWithRedirect(SPOT_TRADE_HREF)}
            className="flex min-h-[48px] h-12 w-full items-center justify-center rounded-md bg-primary text-sm font-bold text-white transition-colors hover:bg-primary/85 sm:h-11 sm:min-h-0"
          >
            Sign in to trade
          </Link>
        ) : (
          <button
            type="button"
            data-spot-place-order
            disabled={!canSubmit || loading}
            onClick={() => setConfirmOpen(true)}
            aria-busy={loading}
            className={`flex min-h-[48px] h-12 w-full items-center justify-center gap-2 rounded-md text-sm font-bold text-white shadow-sm ring-1 ring-black/10 transition-[transform,opacity,background-color] duration-200 active:scale-[0.99] dark:ring-white/10 sm:h-11 sm:min-h-0 ${
              side === 'buy'
                ? 'bg-buy hover:bg-buy-hover disabled:saturate-50'
                : 'bg-sell hover:bg-sell-hover disabled:saturate-50'
            } disabled:pointer-events-none disabled:opacity-45`}
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {side === 'buy' ? 'Buy' : 'Sell'} {baseAsset}
          </button>
        )}

        <div className="space-y-1 rounded-md bg-gray-50/90 px-2.5 py-2 dark:bg-card/50">
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              Maker {(maker * 100).toFixed(3)}% · Taker {(taker * 100).toFixed(3)}%
              {notional > 0 ? (
                <span className="text-muted-foreground dark:text-muted-foreground">
                  {' '}
                  · Est. @ {feeMeta.kind === 'maker' ? 'maker' : feeMeta.kind === 'taker' ? 'taker' : 'worst-case'}
                </span>
              ) : null}
            </span>
          </div>
          {notional > 0 && (
            <>
              <SummaryRow
                label={`Est. fee (${feeMeta.kind === 'maker' ? 'maker' : feeMeta.kind === 'taker' ? 'taker' : 'worst'})`}
                value={`${formatValueFixedTrim(estimatedFee, Math.min(8, Math.max(2, pricePrecision)))} ${quoteAsset}`}
                valueClassName="font-semibold text-foreground"
              />
              <SummaryRow
                label="Net"
                value={`${formatValueFixedTrim(netReceived, side === 'buy' ? qtyPrecision : Math.min(10, Math.max(2, pricePrecision)))} ${netReceivedAsset}`}
                valueClassName="font-bold text-foreground"
              />
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-gray-200/90 bg-gray-100/60 px-2.5 py-2.5 dark:border-border/90 dark:bg-black/20">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Account</p>
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={walletPath.depositCrypto}
            className="inline-flex min-h-9 items-center justify-center rounded-full bg-primary px-4 py-2 text-center text-[10px] font-bold text-white transition-colors hover:bg-primary/85 sm:min-h-0 sm:px-3 sm:py-1.5"
          >
            Deposit
          </Link>
          <Link
            href={walletPath.transfer}
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-[10px] font-bold text-foreground transition-colors hover:bg-muted dark:border-gray-600 dark:bg-background dark:text-gray-200 dark:hover:bg-accent sm:min-h-0 sm:px-3 sm:py-1.5"
          >
            Transfer
          </Link>
          <Link
            href={walletPath.depositCrypto}
            className="inline-flex min-h-9 items-center justify-center gap-0.5 rounded-full border border-border px-4 py-2 text-[10px] font-bold text-primary transition-colors hover:bg-muted dark:border-gray-600 dark:text-blue-400 dark:hover:bg-accent/50 sm:min-h-0 sm:px-3 sm:py-1.5"
          >
            Buy crypto
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm border-border">
          <DialogHeader>
            <DialogTitle>Confirm {side === 'buy' ? 'buy' : 'sell'}</DialogTitle>
            <DialogDescription>Review before placing</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1 text-sm">
            <SummaryRow
              label="Type"
              value={
                <span className="font-semibold capitalize">
                  {orderType.replace(/_/g, ' ')}
                  {orderType === 'limit' && postOnly ? ' · post-only' : ''}
                </span>
              }
              mono={false}
              valueClassName="text-foreground"
            />
            {showPrice && <SummaryRow label="Price" value={`${price || '—'} ${quoteAsset}`} />}
            {showStopPrice && stopPrice ? <SummaryRow label="Trigger" value={`${stopPrice} ${quoteAsset}`} /> : null}
            <SummaryRow label="Qty" value={`${quantity} ${baseAsset}`} />
            <SummaryRow label="Total" value={`${total} ${quoteAsset}`} />
            {orderType === 'market' && estimatedFillPrice ? <SummaryRow label="Est. fill" value={estimatedFillPrice} /> : null}
            {notional > 0 && (
              <div className="space-y-1 border-t border-border pt-2 dark:border-border">
                <SummaryRow
                  label={`Est. fee (${feeMeta.kind === 'maker' ? 'maker' : feeMeta.kind === 'taker' ? 'taker' : 'worst'})`}
                  value={`${formatValueFixedTrim(estimatedFee, Math.min(8, Math.max(2, pricePrecision)))} ${quoteAsset}`}
                />
                <SummaryRow label="Net" value={`${formatValueFixedTrim(netReceived, side === 'buy' ? qtyPrecision : Math.min(10, Math.max(2, pricePrecision)))} ${netReceivedAsset}`} />
              </div>
            )}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="min-h-11 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted dark:border-border dark:hover:bg-accent sm:min-h-10 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading || confirmLoading}
              onClick={async () => {
                setConfirmLoading(true);
                try {
                  await Promise.resolve(onSubmit());
                  setConfirmOpen(false);
                } catch {
                  /* submitError set by parent */
                } finally {
                  setConfirmLoading(false);
                }
              }}
              className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-sm ring-1 ring-black/10 transition-opacity disabled:opacity-60 dark:ring-white/10 sm:min-h-10 sm:w-auto ${
                side === 'buy' ? 'bg-buy hover:bg-buy-hover' : 'bg-sell hover:bg-sell-hover'
              }`}
            >
              {(loading || confirmLoading) && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
