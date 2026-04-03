'use client';

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Maximize2, RefreshCw, SlidersHorizontal, BarChart3, CandlestickChart, Camera, AlertCircle, Clock } from 'lucide-react';
import { useChartAdapter } from './chart';
import type { ChartTheme } from './chart/ChartAdapter';
import { LightweightChartsAdapter } from './chart/LightweightChartsAdapter';
import { SpotDepthChart } from './SpotDepthChart';
import { formatValueFixedTrim, formatCompactNumber } from './terminalFormat';
import {
  NO_TRADES_ACTIONABLE,
  NO_ACTIVITY_SHORT,
  NO_TRADES_TINY,
  TOOLTIP_CHANGE_UNAVAILABLE,
  TOOLTIP_24H_CHANGE,
  TOOLTIP_24H_HIGH,
  TOOLTIP_24H_LOW,
  TOOLTIP_QUOTE_VOLUME_24H,
  TOOLTIP_BASE_VOLUME_24H,
} from '@/lib/marketDataUxCopy';
import type { OverlayStudyId } from './chart/indicators';
import type { ChartExtensionsConfig, DrawingToolMode, SerializedDrawing } from './chart/extension/types';

const CHART_DRAWINGS_LS_PREFIX = 'exchange.chart.drawings.v1.';

const OVERLAY_OPTIONS: { id: OverlayStudyId; label: string }[] = [
  { id: 'none', label: 'Overlay —' },
  { id: 'sma_7', label: 'SMA 7' },
  { id: 'sma_9', label: 'SMA 9' },
  { id: 'sma_25', label: 'SMA 25' },
  { id: 'sma_99', label: 'SMA 99' },
  { id: 'ema_12', label: 'EMA 12' },
  { id: 'ema_26', label: 'EMA 26' },
  { id: 'vwap', label: 'VWAP (UTC day)' },
  { id: 'bb_20', label: 'Bollinger 20,2' },
];

function formatBarCountdown(sec: number | null): string {
  if (sec == null) return '—';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m > 0) return `${m}m ${r.toString().padStart(2, '0')}s`;
  return `${r}s`;
}

const INTERVALS: { label: string; seconds: number }[] = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '1H', seconds: 3600 },
  { label: '4H', seconds: 14400 },
  { label: '1D', seconds: 86400 },
];

interface ChartPanelProps {
  symbol?: string;
  intervalSeconds?: number;
  theme?: ChartTheme;
  lastPrice?: string | null;
  bid?: string | null;
  ask?: string | null;
  high24h?: string | null;
  low24h?: string | null;
  volume24h?: string | null;
  turnoverQuote24h?: string | null;
  dayChangePct24h?: number | null;
  baseAsset?: string;
  quoteAsset?: string;
  /** Market price decimals — axis + legend precision. */
  pricePrecision?: number;
  livePrice?: string | null;
  liveTrades?: Array<{ id: string; time: string; price: string; side: string; quantity?: string }> | null;
  onIntervalSecondsChange?: (v: number) => void;
  viewMode?: 'chart' | 'depth';
  onViewModeChange?: (mode: 'chart' | 'depth') => void;
  depthBids?: { price: string; quantity: string }[];
  depthAsks?: { price: string; quantity: string }[];
  /** When true, hides the large Last/24h strip (e.g. pair header is shown above this panel). */
  hideDuplicatePairSummary?: boolean;
}

function ChartPanelInner({
  symbol = 'BTC_USDT',
  intervalSeconds = 60,
  theme = 'dark',
  lastPrice,
  bid,
  ask,
  high24h,
  low24h,
  volume24h,
  turnoverQuote24h,
  dayChangePct24h,
  baseAsset = '',
  quoteAsset = '',
  pricePrecision = 6,
  livePrice,
  liveTrades,
  onIntervalSecondsChange,
  viewMode = 'chart',
  onViewModeChange,
  depthBids = [],
  depthAsks = [],
  hideDuplicatePairSummary = false,
}: ChartPanelProps) {
  const { adapterRef, chartError, chartLoading, retryChart } = useChartAdapter(
    symbol,
    intervalSeconds,
    theme,
    viewMode,
    pricePrecision
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [overlayStudy, setOverlayStudy] = useState<OverlayStudyId>('none');
  const [showRsi, setShowRsi] = useState(false);
  /** Bybit-style volume pane: SMA on histogram scale */
  const [showVolumeMa, setShowVolumeMa] = useState(true);
  /** Main pane price scale: linear / log / % from first visible */
  const [chartPriceScale, setChartPriceScale] = useState<'normal' | 'log' | 'percent'>('normal');
  const [ohlcLegend, setOhlcLegend] = useState('');
  const [utcNow, setUtcNow] = useState(() => new Date().toISOString().slice(11, 19));
  const [barEta, setBarEta] = useState('—');

  /** Phase 2–4 modular extensions (EMA stack, extra VWAP, volume visibility). */
  const [extConfig, setExtConfig] = useState<ChartExtensionsConfig>({
    ema7: false,
    ema20: false,
    ema50: false,
    ema200: false,
    modularVwap: false,
    volumeHistogram: true,
  });
  const [drawTool, setDrawTool] = useState<DrawingToolMode>('none');
  /** Collapsed by default so chart keeps vertical space; expand for EMA / VWAP² / draw. */
  const [extStackOpen, setExtStackOpen] = useState(false);
  const drawOverlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading) return;
    const t = window.setTimeout(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.setOverlayStudy(overlayStudy);
    }, 0);
    return () => clearTimeout(t);
  }, [overlayStudy, viewMode, chartLoading, chartError, symbol, intervalSeconds]);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading) return;
    const t = window.setTimeout(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.setRsiEnabled(showRsi);
    }, 0);
    return () => clearTimeout(t);
  }, [showRsi, viewMode, chartLoading, chartError, symbol, intervalSeconds]);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading) return;
    const t = window.setTimeout(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.setVolumeMaEnabled(showVolumeMa);
    }, 0);
    return () => clearTimeout(t);
  }, [showVolumeMa, viewMode, chartLoading, chartError, symbol, intervalSeconds]);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading) return;
    const t = window.setTimeout(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.setPriceScaleMode(chartPriceScale);
    }, 0);
    return () => clearTimeout(t);
  }, [chartPriceScale, viewMode, chartLoading, chartError, symbol, intervalSeconds]);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading || chartError) return;
    const t = window.setTimeout(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.applyExtensions(extConfig);
    }, 0);
    return () => clearTimeout(t);
  }, [extConfig, viewMode, chartLoading, chartError, symbol, intervalSeconds]);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading || chartError) return;
    const t = window.setTimeout(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.setDrawingToolMode(drawTool);
    }, 0);
    return () => clearTimeout(t);
  }, [drawTool, viewMode, chartLoading, chartError, symbol, intervalSeconds]);

  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading || chartError) {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.detachDrawingOverlay();
      return undefined;
    }
    const el = drawOverlayRef.current;
    const ad = adapterRef.current;
    if (!el || !(ad instanceof LightweightChartsAdapter)) return undefined;
    const id = requestAnimationFrame(() => {
      ad.attachDrawingOverlay(el);
    });
    return () => {
      cancelAnimationFrame(id);
      ad.detachDrawingOverlay();
    };
  }, [viewMode, chartLoading, chartError, symbol, intervalSeconds, theme]);

  /** Per-symbol drawing persistence (localStorage). */
  useEffect(() => {
    if (viewMode !== 'chart' || chartLoading || chartError) return undefined;
    const ad = adapterRef.current;
    if (!(ad instanceof LightweightChartsAdapter)) return undefined;
    const key = `${CHART_DRAWINGS_LS_PREFIX}${symbol}`;
    let debounceId: ReturnType<typeof setTimeout> | null = null;

    const persist = () => {
      try {
        const data = ad.exportDrawings();
        if (data.length === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(data));
      } catch {
        /* quota / private mode */
      }
    };

    const schedulePersist = () => {
      if (debounceId != null) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        debounceId = null;
        persist();
      }, 200);
    };

    const loadId = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        ad.importDrawings(parsed as SerializedDrawing[]);
      } catch {
        /* ignore corrupt */
      }
    }, 120);

    ad.setDrawingMutateListener(schedulePersist);

    return () => {
      clearTimeout(loadId);
      if (debounceId != null) clearTimeout(debounceId);
      persist();
      ad.setDrawingMutateListener(null);
    };
  }, [viewMode, chartLoading, chartError, symbol, intervalSeconds, theme]);

  useEffect(() => {
    if (viewMode !== 'chart') {
      setBarEta('—');
      return;
    }
    const id = window.setInterval(() => {
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) {
        setBarEta(formatBarCountdown(ad.getSecondsToBarClose()));
      }
    }, 250);
    return () => clearInterval(id);
  }, [viewMode, chartLoading, intervalSeconds, symbol, livePrice]);

  const lastTradeIdRef = useRef<string | null>(null);
  const prevMarkersSigRef = useRef<string>('');

  useEffect(() => {
    prevMarkersSigRef.current = '';
    lastTradeIdRef.current = null;
  }, [symbol]);

  const changePct = useMemo(() => {
    if (dayChangePct24h != null && Number.isFinite(dayChangePct24h)) return dayChangePct24h;
    return null;
  }, [dayChangePct24h]);

  const spreadInfo = useMemo(() => {
    const b = bid != null && bid !== '' ? Number(bid) : NaN;
    const a = ask != null && ask !== '' ? Number(ask) : NaN;
    if (!Number.isFinite(b) || !Number.isFinite(a) || a <= b) return null;
    const sp = a - b;
    const mid = (a + b) / 2;
    const pct = mid > 0 ? (sp / mid) * 100 : 0;
    return { spread: sp, pct };
  }, [bid, ask]);

  const pairLabel = baseAsset && quoteAsset ? `${baseAsset}/${quoteAsset}` : symbol.replace(/_/g, '/');
  const intervalLabel = INTERVALS.find((i) => i.seconds === intervalSeconds)?.label ?? `${Math.round(intervalSeconds / 60)}m`;

  useEffect(() => {
    const id = window.setInterval(() => setUtcNow(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (viewMode !== 'chart') {
      setOhlcLegend('');
      return;
    }
    const run = () => {
      const ad = adapterRef.current;
      if (!ad || !(ad instanceof LightweightChartsAdapter)) return;
      ad.setLegendCallback((text) => setOhlcLegend(text));
    };
    const t = window.setTimeout(run, 0);
    return () => {
      clearTimeout(t);
      const ad = adapterRef.current;
      if (ad instanceof LightweightChartsAdapter) ad.setLegendCallback(null);
    };
  }, [viewMode, symbol, intervalSeconds, chartLoading, chartError]);

  const livePriceRafRef = useRef<number | null>(null);
  const pendingLivePriceRef = useRef<string | null>(null);
  const lastTradeAppliedTsRef = useRef<number>(0);
  useEffect(() => {
    if (!livePrice) return;
    pendingLivePriceRef.current = livePrice;
    if (livePriceRafRef.current != null) return;
    livePriceRafRef.current = requestAnimationFrame(() => {
      livePriceRafRef.current = null;
      const ad = adapterRef.current;
      const lp = pendingLivePriceRef.current;
      if (!ad || !lp) return;
      const p = Number(lp);
      if (!Number.isFinite(p) || p <= 0) return;
      const now = Math.floor(Date.now() / 1000);
      if (now === lastTradeAppliedTsRef.current) return;
      ad.updatePrice(now, p);
    });
    return () => {
      if (livePriceRafRef.current != null) {
        cancelAnimationFrame(livePriceRafRef.current);
        livePriceRafRef.current = null;
      }
    };
  }, [livePrice, adapterRef]);

  useEffect(() => {
    if (!adapterRef.current || !Array.isArray(liveTrades) || liveTrades.length === 0) return;
    const latest = liveTrades[0];
    const markersSig = liveTrades.slice(0, 40).map((t) => t.id).join('|');
    const latestUnchanged = latest?.id === lastTradeIdRef.current;
    if (markersSig === prevMarkersSigRef.current && latestUnchanged) return;
    prevMarkersSigRef.current = markersSig;

    const markers = liveTrades.slice(0, 40).map((t) => ({
      time: Math.floor(new Date(t.time).getTime() / 1000),
      price: Number(t.price),
      side: (t.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
    })).filter((m) => Number.isFinite(m.time) && Number.isFinite(m.price));
    adapterRef.current.setTradeMarkers?.(markers);

    if (!latest || latest.id === lastTradeIdRef.current) return;
    lastTradeIdRef.current = latest.id;
    const tt = Math.floor(new Date(latest.time).getTime() / 1000);
    const p = Number(latest.price);
    const q = Number(latest.quantity ?? 0);
    if (Number.isFinite(tt) && Number.isFinite(p)) {
      lastTradeAppliedTsRef.current = tt;
      adapterRef.current.updateTrade?.(tt, p, Number.isFinite(q) ? q : 0);
    }
  }, [liveTrades, adapterRef]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // ignore
    }
  };

  const handleReset = () => {
    adapterRef.current?.fitContent?.();
  };

  const handleScreenshot = () => {
    const ad = adapterRef.current;
    if (ad instanceof LightweightChartsAdapter) {
      ad.exportChartPng(`${symbol}_${intervalLabel}`.replace(/\s/g, ''));
    }
  };

  const zoomScrollHint = useMemo(() => {
    if (typeof navigator === 'undefined') return 'Scroll wheel: zoom';
    return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? '⌘ + scroll: zoom chart' : 'Ctrl + scroll: zoom chart';
  }, []);

  const lastColor = 'text-foreground';

  const hasLastTrade = lastPrice != null && lastPrice !== '';

  const changeTone24h =
    changePct == null ? 'none' : changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';
  const changeClass24h =
    changeTone24h === 'none'
      ? 'text-muted-foreground'
      : changeTone24h === 'up'
        ? 'text-price-up'
        : changeTone24h === 'down'
          ? 'text-price-down'
          : 'text-muted-foreground';

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-card"
    >
      {/* Tier-1 market strip — optional when pair header is outside; OHLC row only in chart mode */}
      {(!hideDuplicatePairSummary || viewMode === 'chart') && (
      <div className="flex-shrink-0 border-b border-border/90 bg-muted/95 dark:border-border/90 dark:bg-card/95">
        {!hideDuplicatePairSummary && (
          <div className="flex flex-wrap items-start justify-between gap-2 px-2 py-1">
            <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-1">
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Last</div>
                <div className={`font-mono text-lg font-bold leading-tight tabular-nums sm:text-xl ${lastColor}`}>
                  {quoteAsset === 'USDT' && lastPrice != null && lastPrice !== ''
                    ? `$${formatValueFixedTrim(lastPrice, pricePrecision)}`
                    : formatValueFixedTrim(lastPrice, pricePrecision)}
                </div>
                {quoteAsset === 'USDT' && lastPrice != null && lastPrice !== '' && (
                  <div className="text-[10px] font-mono tabular-nums text-muted-foreground">
                    ≈ {formatValueFixedTrim(lastPrice, pricePrecision)} USD
                  </div>
                )}
              </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px]">
                <div
                  className="flex min-w-0 max-w-[11rem] items-baseline gap-1 sm:max-w-none"
                  title={changePct != null ? TOOLTIP_24H_CHANGE : TOOLTIP_CHANGE_UNAVAILABLE}
                >
                  <span className="shrink-0 font-semibold text-muted-foreground">24h</span>
                  <span className={`min-w-0 truncate font-mono font-bold tabular-nums transition-colors duration-300 ${changeClass24h}`}>
                    {changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </span>
                </div>
                <div className="hidden h-3 w-px bg-border dark:bg-border sm:block" aria-hidden />
                <div className="flex min-w-0 max-w-[5rem] items-baseline gap-1" title={TOOLTIP_24H_HIGH}>
                  <span className="shrink-0 text-muted-foreground">H</span>
                  <span className="min-w-0 truncate font-mono font-semibold tabular-nums text-foreground">
                    {(() => {
                      const s = formatValueFixedTrim(high24h, pricePrecision);
                      return s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                    })()}
                  </span>
                </div>
                <div className="flex min-w-0 max-w-[5rem] items-baseline gap-1" title={TOOLTIP_24H_LOW}>
                  <span className="shrink-0 text-muted-foreground">L</span>
                  <span className="min-w-0 truncate font-mono font-semibold tabular-nums text-foreground">
                    {(() => {
                      const s = formatValueFixedTrim(low24h, pricePrecision);
                      return s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                    })()}
                  </span>
                </div>
                <div className="hidden min-w-0 max-w-[6rem] items-baseline gap-1 md:flex" title={TOOLTIP_BASE_VOLUME_24H}>
                  <span className="shrink-0 text-muted-foreground">Vol</span>
                  <span className="min-w-0 truncate font-mono font-semibold tabular-nums text-foreground">
                    {(() => {
                      const s = formatCompactNumber(volume24h);
                      const body = s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                      return `${body}${s !== '—' && baseAsset ? ` ${baseAsset}` : ''}`;
                    })()}
                  </span>
                </div>
                <div
                  className="hidden min-w-0 max-w-[6rem] items-baseline gap-1 lg:flex"
                  title={TOOLTIP_QUOTE_VOLUME_24H}
                >
                  <span className="shrink-0 text-muted-foreground">Turn.</span>
                  <span className="min-w-0 truncate font-mono font-semibold tabular-nums text-foreground">
                    {(() => {
                      const s = formatCompactNumber(turnoverQuote24h);
                      const body = s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                      return `${body}${s !== '—' && quoteAsset ? ` ${quoteAsset}` : ''}`;
                    })()}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right text-[10px] sm:text-[11px]">
              <div className="font-mono font-semibold tabular-nums text-foreground">
                <span className="text-price-up">{formatValueFixedTrim(bid, pricePrecision)}</span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-price-down">{formatValueFixedTrim(ask, pricePrecision)}</span>
              </div>
              {spreadInfo && (
                <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  Spread {formatValueFixedTrim(String(spreadInfo.spread), pricePrecision)} ({spreadInfo.pct.toFixed(3)}%)
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'chart' && (
          <div
            className={`px-2 py-1 font-mono text-[10px] leading-snug text-muted-foreground ${
              !hideDuplicatePairSummary ? 'border-t border-border' : ''
            }`}
            title="Crosshair or last candle"
          >
            <span className="font-semibold text-foreground/80">{pairLabel}</span>
            <span className="text-muted-foreground"> · Spot · {intervalLabel}</span>
            <span className="text-muted-foreground"> · Bar {barEta}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="tabular-nums">{ohlcLegend || '—'}</span>
          </div>
        )}
      </div>
      )}

      {/* Toolbar: row 1 = modes + overlay/indicators + intervals; row 2 = optional compact stack (collapsed by default) */}
      <div className="flex flex-shrink-0 flex-col gap-0.5 border-b border-border/90 bg-background/80 px-2 py-0.5 dark:border-border/90 dark:bg-card/40">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {onViewModeChange && (
            <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => onViewModeChange('chart')}
                className={`inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold transition-colors sm:text-[11px] ${
                  viewMode === 'chart'
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-muted-foreground hover:bg-accent dark:text-muted-foreground dark:hover:bg-accent'
                }`}
              >
                <CandlestickChart className="h-3.5 w-3.5" />
                Chart
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('depth')}
                className={`inline-flex items-center gap-1 border-l border-border px-2 py-1.5 text-[10px] font-bold transition-colors dark:border-border sm:text-[11px] ${
                  viewMode === 'depth'
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-muted-foreground hover:bg-accent dark:text-muted-foreground dark:hover:bg-accent'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Depth
              </button>
            </div>
          )}
          {viewMode === 'chart' && (
            <>
              <div
                className="flex shrink-0 overflow-hidden rounded-md border border-border"
                title="Price scale (main pane)"
              >
                {(
                  [
                    { id: 'normal' as const, label: 'Auto' },
                    { id: 'percent' as const, label: '%' },
                    { id: 'log' as const, label: 'Log' },
                  ] as const
                ).map(({ id, label }, i) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChartPriceScale(id)}
                    className={`px-2 py-1.5 text-[10px] font-bold tabular-nums sm:text-[11px] ${
                      i > 0 ? 'border-l border-border' : ''
                    } ${
                      chartPriceScale === id
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                        : 'text-muted-foreground hover:bg-accent dark:text-muted-foreground dark:hover:bg-accent/80'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={overlayStudy}
                onChange={(e) => setOverlayStudy(e.target.value as OverlayStudyId)}
                className="max-w-[11rem] shrink-0 cursor-pointer rounded-md border border-border bg-card px-1.5 py-1 text-[10px] font-semibold text-foreground dark:border-border dark:bg-background dark:text-foreground/90"
                title="Price overlay (SMA, EMA, VWAP, Bollinger)"
              >
                {OVERLAY_OPTIONS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-foreground/80">
                <input
                  type="checkbox"
                  checked={showVolumeMa}
                  onChange={(e) => setShowVolumeMa(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-amber-600 dark:border-border"
                />
                Vol SMA 9
              </label>
              <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-foreground/80">
                <input
                  type="checkbox"
                  checked={showRsi}
                  onChange={(e) => setShowRsi(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-blue-600 dark:border-border"
                />
                RSI(14)
              </label>
            </>
          )}
          {viewMode === 'chart' && onIntervalSecondsChange && (
            <div className="flex min-w-0 max-w-full flex-1 items-center gap-0.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-w-[min(100%,52rem)]">
              {INTERVALS.map(({ label, seconds }) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => onIntervalSecondsChange(seconds)}
                  className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold tabular-nums transition-colors sm:text-[11px] ${
                    intervalSeconds === seconds
                      ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Indicators (coming soon)"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Indicators</span>
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Fit content"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Fullscreen"
            aria-pressed={isFullscreen}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleScreenshot}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Download chart as PNG"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        </div>
        {viewMode === 'chart' && !extStackOpen && (
          <button
            type="button"
            onClick={() => setExtStackOpen(true)}
            className="flex w-full min-w-0 items-center justify-between gap-2 rounded border border-dashed border-border/90 bg-card/60 px-2 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-accent/90 dark:border-border dark:bg-card/50 dark:text-muted-foreground dark:hover:bg-accent/80"
            title="Multi-EMA, extra VWAP, volume bar toggle, drawing tools"
          >
            <span className="truncate">▸ Multi-EMA · VWAP² · Vol · Draw</span>
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Open</span>
          </button>
        )}
        {viewMode === 'chart' && extStackOpen && (
          <div className="w-full min-w-0 rounded border border-border/90 bg-card/80 px-1.5 py-1 dark:border-border/80 dark:bg-card/55">
            <div className="flex min-h-0 w-full min-w-0 flex-nowrap items-center gap-x-2 gap-y-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1">
              <button
                type="button"
                onClick={() => setExtStackOpen(false)}
                className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
                title="Hide toolbar — more chart height"
              >
                ▴ Hide
              </button>
              <span className="shrink-0 text-[9px] font-bold uppercase text-muted-foreground">EMA</span>
              {([7, 20, 50, 200] as const).map((p) => (
                <label
                  key={p}
                  className="flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold leading-none text-foreground dark:text-foreground/90"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(extConfig[`ema${p}`])}
                    onChange={(e) =>
                      setExtConfig((prev) => ({ ...prev, [`ema${p}`]: e.target.checked }) as ChartExtensionsConfig)
                    }
                    className="h-3.5 w-3.5 rounded border-border accent-orange-600 dark:border-border"
                  />
                  {p}
                </label>
              ))}
              <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border dark:bg-border" aria-hidden />
              <label className="flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold leading-none text-foreground dark:text-foreground/90">
                <input
                  type="checkbox"
                  checked={Boolean(extConfig.modularVwap)}
                  onChange={(e) => setExtConfig((prev) => ({ ...prev, modularVwap: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-border accent-sky-600 dark:border-border"
                />
                VWAP²
              </label>
              <label className="flex shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold leading-none text-foreground dark:text-foreground/90">
                <input
                  type="checkbox"
                  checked={extConfig.volumeHistogram !== false}
                  onChange={(e) => setExtConfig((prev) => ({ ...prev, volumeHistogram: e.target.checked }))}
                  className="h-3.5 w-3.5 rounded border-border accent-gray-600 dark:border-border"
                />
                Vol bars
              </label>
              <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border dark:bg-border" aria-hidden />
              <span
                className="shrink-0 text-[9px] font-bold uppercase text-muted-foreground"
                title="Draw: H / V / ∠ / Fib. Esc: cancel or deselect. Del removes. Drawings save per symbol (this browser)."
              >
                Draw
              </span>
              {(
                [
                  { id: 'none' as const, label: 'Off' },
                  { id: 'hline' as const, label: 'H' },
                  { id: 'vline' as const, label: 'V' },
                  { id: 'trend' as const, label: '∠' },
                  { id: 'fib' as const, label: 'Fib' },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  title={
                    id === 'none'
                      ? 'Drawing off'
                      : id === 'hline'
                        ? 'Horizontal line'
                        : id === 'vline'
                          ? 'Vertical line'
                          : id === 'trend'
                            ? 'Trendline (2 clicks)'
                            : 'Fibonacci retracement (2 clicks: swing high/low)'
                  }
                  onClick={() => setDrawTool(id)}
                  className={`inline-flex shrink-0 rounded border border-transparent px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                    drawTool === id
                      ? 'border-border bg-zinc-200 text-zinc-900 dark:border-border dark:bg-zinc-600 dark:text-zinc-100'
                      : 'text-foreground/80 hover:border-border hover:bg-accent dark:text-foreground/80 dark:hover:border-border dark:hover:bg-accent'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                title="Clear all drawings"
                onClick={() => {
                  const ad = adapterRef.current;
                  if (ad instanceof LightweightChartsAdapter) ad.clearDrawings();
                }}
                className="inline-flex shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold leading-none text-foreground/80 hover:bg-accent dark:border-border dark:text-foreground/80 dark:hover:bg-accent"
              >
                Clr
              </button>
            </div>
          </div>
        )}
      </div>

      {viewMode === 'depth' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background p-px">
          <SpotDepthChart bids={depthBids} asks={depthAsks} className="min-h-[200px] flex-1" />
        </div>
      ) : (
        <div
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            theme === 'dark' ? 'bg-background' : 'bg-background'
          }`}
        >
          {chartLoading && !chartError && (
            <div
              className={`absolute inset-0 z-10 flex items-center justify-center ${
                theme === 'dark' ? 'bg-background/90' : 'bg-background/95'
              }`}
            >
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" aria-hidden />
                <span className={`text-xs ${theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'}`}>Loading chart…</span>
              </div>
            </div>
          )}
          {chartError && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/95 p-4">
              <AlertCircle className="h-10 w-10 text-muted-foreground" aria-hidden />
              <p className="max-w-xs text-center text-sm text-muted-foreground">Chart unavailable. {chartError}</p>
              <button
                type="button"
                onClick={retryChart}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-foreground hover:bg-primary/85"
              >
                Retry
              </button>
            </div>
          )}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden w-full">
            <div
              id="chart-mount"
              className="absolute inset-0 overflow-hidden"
              aria-label="Price chart"
            />
            <div
              ref={drawOverlayRef}
              className="absolute inset-0 z-[5]"
              aria-hidden={drawTool === 'none'}
            />
          </div>
          <div
            className={`flex flex-shrink-0 items-center justify-between border-t px-2 py-0.5 text-[10px] font-mono ${
              theme === 'dark'
                ? 'border-border/90 bg-background text-muted-foreground'
                : 'border-border/90 bg-background text-muted-foreground'
            }`}
          >
            <span className="flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3 opacity-70" aria-hidden />
              {utcNow} UTC
            </span>
            <span className={theme === 'dark' ? 'text-muted-foreground' : 'text-muted-foreground'}>
              <span className="hidden sm:inline">{zoomScrollHint} · </span>
              Volume{showVolumeMa ? ' · SMA 9' : ''}
              {showRsi ? ' · RSI(14)' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export const ChartPanel = memo(ChartPanelInner);
ChartPanelInner.displayName = 'ChartPanelInner';
