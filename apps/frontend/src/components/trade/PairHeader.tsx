'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import {
  NO_TRADES_ACTIONABLE,
  NO_ACTIVITY_24H,
  TOOLTIP_CHANGE_UNAVAILABLE,
  TOOLTIP_LAST_PRICE,
  TOOLTIP_24H_CHANGE,
  TOOLTIP_24H_HIGH,
  TOOLTIP_24H_LOW,
  TOOLTIP_BASE_VOLUME_24H,
  TOOLTIP_QUOTE_VOLUME_24H,
} from '@/lib/marketDataUxCopy';
import type { SpotWsStreamPhase } from '@/hooks/useSpotWs';
import { formatCompactNumber, formatValueFixedTrim } from './terminalFormat';
import { CoinIcon } from '@/components/ui/CoinIcon';

type Market = { symbol: string; base_asset: string; quote_asset: string };

interface PairHeaderProps {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  lastPrice?: string | null;
  lastPriceUsd?: string | null;
  bid?: string | null;
  ask?: string | null;
  pricePrecision?: number;
  changePct24h?: number | null;
  high24h?: string | null;
  low24h?: string | null;
  volume24h?: string | null;
  turnover24h?: string | null;
  markets?: Market[];
  onSymbolChange?: (symbol: string) => void;
  wsConnected?: boolean;
  /** Prefer over `wsConnected` when provided (connecting / live / reconnecting / disconnected). */
  wsStreamPhase?: SpotWsStreamPhase;
  wsLastRttMs?: number | null;
  isFavorite?: (symbol: string) => boolean;
  onToggleFavorite?: (symbol: string) => void;
  tierLevel?: number;
  embedded?: boolean;
}

function MiniStat({
  label,
  children,
  className = '',
  title: titleAttr,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={`flex min-w-0 max-w-full flex-col items-center justify-center gap-px px-1.5 py-0 sm:px-2 ${className}`}
      title={titleAttr}
    >
      <span className="w-full truncate text-center text-label font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="numeric w-full min-w-0 truncate text-center text-book font-semibold leading-tight text-foreground">
        {children}
      </div>
    </div>
  );
}

export function PairHeader({
  symbol,
  baseAsset,
  quoteAsset,
  lastPrice,
  lastPriceUsd,
  bid,
  ask,
  pricePrecision = 6,
  changePct24h,
  high24h,
  low24h,
  volume24h,
  turnover24h,
  markets,
  onSymbolChange,
  wsConnected,
  wsStreamPhase,
  wsLastRttMs,
  isFavorite,
  onToggleFavorite,
  tierLevel,
  embedded = false,
}: PairHeaderProps) {
  const sym = symbol ?? 'BTC_USDT';
  const base = baseAsset ?? 'BTC';
  const quote = quoteAsset ?? 'USDT';
  const mkt = markets ?? [];
  const pairLabel = base && quote ? `${base}/${quote}` : sym;
  const onChange = onSymbolChange ?? (() => {});

  /** Only server-provided 24h % — no client-side proxy (institutional data integrity). */
  const officialChangePct =
    typeof changePct24h === 'number' && Number.isFinite(changePct24h) ? changePct24h : null;
  const changeTone: 'up' | 'down' | 'flat' | 'none' =
    officialChangePct == null ? 'none' : officialChangePct > 0 ? 'up' : officialChangePct < 0 ? 'down' : 'flat';

  const spreadTooltip = (() => {
    if (bid == null || bid === '' || ask == null || ask === '') return undefined;
    const b = Number(bid);
    const a = Number(ask);
    if (!Number.isFinite(b) || !Number.isFinite(a) || a <= b) return undefined;
    const spread = a - b;
    const mid = (a + b) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    return `Spread ${formatValueFixedTrim(String(spread), pricePrecision)} (${spreadPct.toFixed(3)}%)`;
  })();

  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<string | null>(null);

  useEffect(() => {
    const current = lastPrice ?? null;
    const prev = prevPriceRef.current;
    if (prev != null && current != null && prev !== current) {
      const pPrev = parseFloat(prev);
      const pCur = parseFloat(current);
      if (Number.isFinite(pPrev) && Number.isFinite(pCur)) {
        setPriceFlash(pCur > pPrev ? 'up' : 'down');
        const t = setTimeout(() => setPriceFlash(null), 400);
        prevPriceRef.current = current;
        return () => clearTimeout(t);
      }
    }
    prevPriceRef.current = current;
  }, [lastPrice]);

  const hasLastTrade = lastPrice != null && lastPrice !== '';

  const lastDisplay = !hasLastTrade
    ? NO_TRADES_ACTIONABLE
    : quote === 'USDT'
      ? `$${formatValueFixedTrim(lastPrice, pricePrecision)}`
      : formatValueFixedTrim(lastPrice, pricePrecision);

  const lastSub =
    lastPriceUsd != null && lastPriceUsd !== '' && quote !== 'USDT'
      ? `≈ ${formatValueFixedTrim(lastPriceUsd, pricePrecision)} USDT`
      : undefined;

  const changeColor =
    changeTone === 'none'
      ? 'text-muted-foreground'
      : changeTone === 'up'
        ? 'text-buy'
        : changeTone === 'down'
          ? 'text-sell'
          : 'text-muted-foreground';

  const lastColor =
    priceFlash === 'up'
      ? 'text-buy'
      : priceFlash === 'down'
        ? 'text-sell'
        : 'text-foreground';

  const streamPhaseResolved: SpotWsStreamPhase | null =
    wsStreamPhase ?? (wsConnected === true ? 'live' : wsConnected === false ? 'reconnecting' : null);
  const showStreamBadge = streamPhaseResolved != null || wsConnected !== undefined;
  const phaseForBadge: SpotWsStreamPhase =
    streamPhaseResolved ?? (wsConnected === false ? 'reconnecting' : 'connecting');
  const streamDotClass =
    phaseForBadge === 'live'
      ? 'bg-buy'
      : phaseForBadge === 'disconnected'
        ? 'bg-sell'
        : 'animate-pulse bg-amber-500';
  const streamLabel =
    phaseForBadge === 'live' ? 'Live' : phaseForBadge === 'disconnected' ? 'Off' : phaseForBadge === 'reconnecting' ? 'Sync' : '…';
  const rttSuffix =
    phaseForBadge === 'live' && wsLastRttMs != null && wsLastRttMs >= 0 ? `${wsLastRttMs}ms` : null;
  const streamTitle =
    phaseForBadge === 'live'
      ? rttSuffix
        ? `Stream connected · RTT ~${rttSuffix}`
        : 'Stream connected'
      : phaseForBadge === 'disconnected'
        ? 'Stream disconnected'
        : phaseForBadge === 'reconnecting'
          ? 'Reconnecting to market stream'
          : 'Connecting to market stream';

  return (
    <header
      className={`flex h-11 min-h-11 shrink-0 border-b border-border bg-card ${
        embedded ? 'rounded-t-lg' : ''
      }`}
    >
      <div className="flex h-full shrink-0 items-center gap-1 border-r border-border bg-muted/50 px-1.5 sm:gap-1.5 sm:px-2">
        <CoinIcon symbol={base} size={22} />
        {mkt.length > 1 ? (
          <select
            value={sym}
            onChange={(e) => onChange(e.target.value)}
            className="numeric h-7 max-w-[7.5rem] min-w-0 shrink cursor-pointer truncate rounded border border-border bg-card py-0 pl-1.5 pr-6 text-book font-bold leading-7 text-foreground shadow-sm outline-none focus:ring-1 focus:ring-primary/30 sm:max-w-[9.5rem]"
          >
            {mkt.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.base_asset}/{m.quote_asset}
              </option>
            ))}
          </select>
        ) : (
          <span className="numeric max-w-[7.5rem] truncate text-book font-bold leading-tight tracking-tight text-foreground sm:max-w-[9.5rem]">
            {pairLabel}
          </span>
        )}
        <span className="inline-flex h-5 shrink-0 items-center rounded border border-border bg-muted px-1 text-label font-bold uppercase text-muted-foreground">
          Spot
        </span>
        {onToggleFavorite && sym && (
          <button
            type="button"
            onClick={() => onToggleFavorite(sym)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary"
            title={isFavorite?.(sym) ? 'Remove from favorites' : 'Add to favorites'}
            aria-label="Toggle favorite"
          >
            <Star className={`h-3.5 w-3.5 ${isFavorite?.(sym) ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
        )}
        {tierLevel != null && tierLevel > 0 && (
          <span
            className="hidden h-5 shrink-0 items-center rounded border border-primary/30 bg-primary/10 px-1 text-label font-bold text-primary sm:inline-flex"
            title="Withdrawal tier"
          >
            T{tierLevel}
          </span>
        )}
        {showStreamBadge && (
          <span
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border bg-muted px-1 text-label font-bold uppercase text-muted-foreground"
            title={streamTitle}
          >
            <span className={`h-1 w-1 shrink-0 rounded-full ${streamDotClass}`} aria-hidden />
            <span className="hidden sm:inline">
              {streamLabel}
              {rttSuffix ? (
                <span className="numeric ml-0.5 normal-case opacity-80">{rttSuffix}</span>
              ) : null}
            </span>
          </span>
        )}
      </div>

      {/* Content-sized columns, centered; dividers only between stats */}
      <div className="flex min-w-0 flex-1 items-stretch justify-evenly divide-x divide-border px-0.5 sm:px-1">
        <MiniStat label="Last" title={lastSub ?? TOOLTIP_LAST_PRICE}>
          <span className={`font-bold ${hasLastTrade ? lastColor : 'text-muted-foreground'}`}>{lastDisplay}</span>
        </MiniStat>
        <MiniStat label="24h" title={officialChangePct != null ? TOOLTIP_24H_CHANGE : TOOLTIP_CHANGE_UNAVAILABLE}>
          <span className={`${changeColor} max-w-[4.5rem] truncate sm:max-w-none`}>
            {officialChangePct != null
              ? `${officialChangePct > 0 ? '+' : ''}${officialChangePct.toFixed(2)}%`
              : '—'}
          </span>
        </MiniStat>
        <MiniStat label="High" title={TOOLTIP_24H_HIGH}>
          <span className="max-w-[3.5rem] truncate sm:max-w-none">
            {(() => {
              const s = formatValueFixedTrim(high24h, pricePrecision);
              return s === '—' ? (hasLastTrade ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE) : s;
            })()}
          </span>
        </MiniStat>
        <MiniStat label="Low" title={TOOLTIP_24H_LOW}>
          <span className="max-w-[3.5rem] truncate sm:max-w-none">
            {(() => {
              const s = formatValueFixedTrim(low24h, pricePrecision);
              return s === '—' ? (hasLastTrade ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE) : s;
            })()}
          </span>
        </MiniStat>
        <MiniStat label={`V·${base.slice(0, 4)}`} title={TOOLTIP_BASE_VOLUME_24H}>
          <span className="max-w-[3rem] truncate sm:max-w-none">
            {(() => {
              const s = formatCompactNumber(volume24h);
              return s === '—' ? (hasLastTrade ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE) : s;
            })()}
          </span>
        </MiniStat>
        <MiniStat label={`T·${quote.slice(0, 4)}`} title={TOOLTIP_QUOTE_VOLUME_24H}>
          <span className="max-w-[3rem] truncate sm:max-w-none">
            {(() => {
              const s = formatCompactNumber(turnover24h);
              return s === '—' ? (hasLastTrade ? NO_ACTIVITY_24H : NO_TRADES_ACTIONABLE) : s;
            })()}
          </span>
        </MiniStat>
        <MiniStat label="B/A" title={spreadTooltip} className="max-w-[min(100%,9.5rem)]">
          <div className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-center">
            <span className="text-buy">{formatValueFixedTrim(bid, pricePrecision)}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-sell">{formatValueFixedTrim(ask, pricePrecision)}</span>
          </div>
        </MiniStat>
      </div>
    </header>
  );
}
