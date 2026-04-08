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

/** Toolbar segmented control — app tokens (aligned with markets tabs / primary). */
const TB_SEG_ON = 'bg-primary text-primary-foreground shadow-sm';
const TB_SEG_OFF = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground';
/** Compact toggles (Vol SMA / RSI / studies) — no native checkbox paint. */
const TB_TOGGLE_ON = 'border-primary/50 bg-primary/15 text-foreground';
const TB_TOGGLE_OFF = 'border-border text-muted-foreground hover:bg-accent hover:text-foreground/90';

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
  /** Collapsed by default so the candle canvas gets vertical space; use Studies to expand. */
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
        ? 'text-buy'
        : changeTone24h === 'down'
          ? 'text-sell'
          : 'text-muted-foreground';

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-card"
    >
      {/* Full market strip only when chart is standalone; terminal mode inlines OHLC into toolbar (Option A). */}
      {!hideDuplicatePairSummary && (
      <div className="flex-shrink-0 border-b border-border/90 bg-muted/95 dark:border-border/90 dark:bg-card/95">
          <div className="flex flex-wrap items-start justify-between gap-2 px-2 py-1">
            <div className="flex min-w-0 flex-wrap items-end gap-x-4 gap-y-1">
              <div className="min-w-0">
                <div className="text-label font-bold uppercase tracking-wide text-muted-foreground">Last</div>
                <div className={`numeric text-mid font-bold leading-snug tracking-wide ${lastColor}`}>
                  {quoteAsset === 'USDT' && lastPrice != null && lastPrice !== ''
                    ? `$${formatValueFixedTrim(lastPrice, pricePrecision)}`
                    : formatValueFixedTrim(lastPrice, pricePrecision)}
                </div>
                {quoteAsset === 'USDT' && lastPrice != null && lastPrice !== '' && (
                  <div className="numeric text-label text-muted-foreground">
                    ≈ {formatValueFixedTrim(lastPrice, pricePrecision)} USD
                  </div>
                )}
              </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label">
                <div
                  className="flex min-w-0 max-w-[11rem] items-baseline gap-1 sm:max-w-none"
                  title={changePct != null ? TOOLTIP_24H_CHANGE : TOOLTIP_CHANGE_UNAVAILABLE}
                >
                  <span className="shrink-0 font-semibold text-muted-foreground">24h</span>
                  <span className={`numeric min-w-0 truncate font-bold transition-colors duration-300 ${changeClass24h}`}>
                    {changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </span>
                </div>
                <div className="hidden h-3 w-px bg-border dark:bg-border sm:block" aria-hidden />
                <div className="flex min-w-0 max-w-[5rem] items-baseline gap-1" title={TOOLTIP_24H_HIGH}>
                  <span className="shrink-0 text-muted-foreground">H</span>
                  <span className="numeric min-w-0 truncate font-semibold text-foreground">
                    {(() => {
                      const s = formatValueFixedTrim(high24h, pricePrecision);
                      return s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                    })()}
                  </span>
                </div>
                <div className="flex min-w-0 max-w-[5rem] items-baseline gap-1" title={TOOLTIP_24H_LOW}>
                  <span className="shrink-0 text-muted-foreground">L</span>
                  <span className="numeric min-w-0 truncate font-semibold text-foreground">
                    {(() => {
                      const s = formatValueFixedTrim(low24h, pricePrecision);
                      return s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                    })()}
                  </span>
                </div>
                <div className="hidden min-w-0 max-w-[6rem] items-baseline gap-1 md:flex" title={TOOLTIP_BASE_VOLUME_24H}>
                  <span className="shrink-0 text-muted-foreground">Vol</span>
                  <span className="numeric min-w-0 truncate font-semibold text-foreground">
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
                  <span className="numeric min-w-0 truncate font-semibold text-foreground">
                    {(() => {
                      const s = formatCompactNumber(turnoverQuote24h);
                      const body = s === '—' ? (hasLastTrade ? NO_ACTIVITY_SHORT : NO_TRADES_TINY) : s;
                      return `${body}${s !== '—' && quoteAsset ? ` ${quoteAsset}` : ''}`;
                    })()}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right text-label">
              <div className="numeric font-semibold text-foreground">
                <span className="text-buy">{formatValueFixedTrim(bid, pricePrecision)}</span>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-sell">{formatValueFixedTrim(ask, pricePrecision)}</span>
              </div>
              {spreadInfo && (
                <div className="numeric mt-0.5 text-label text-muted-foreground">
                  Spread {formatValueFixedTrim(String(spreadInfo.spread), pricePrecision)} ({spreadInfo.pct.toFixed(3)}%)
                </div>
              )}
            </div>
          </div>

        {viewMode === 'chart' && (
          <div
            className="px-2 py-1.5 numeric text-xs leading-tight text-muted-foreground sm:text-sm sm:leading-snug border-t border-border"
            title="Crosshair or last candle"
          >
            <span className="font-semibold text-foreground">{pairLabel}</span>
            <span className="text-muted-foreground"> · Spot · {intervalLabel}</span>
            <span className="text-muted-foreground"> · Bar {barEta}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="numeric font-medium text-foreground/95">{ohlcLegend || '—'}</span>
          </div>
        )}
      </div>
      )}

      {/* Single scroll row + fixed actions (Option A); studies row only when expanded */}
      <div className="flex flex-shrink-0 flex-col gap-0.5 border-b border-border bg-card">
        <div className="flex w-full min-w-0 flex-row items-center gap-1 px-1.5 py-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:thin] py-0.5 [&::-webkit-scrollbar]:h-1">
          {hideDuplicatePairSummary && viewMode === 'chart' && (
            <>
              <span
                className="shrink-0 max-w-[min(42vw,320px)] truncate text-label leading-tight text-muted-foreground"
                title={`${pairLabel} · ${intervalLabel} · Bar ${barEta} · ${ohlcLegend || '—'}`}
              >
                <span className="font-semibold text-foreground">{pairLabel}</span>
                <span className="text-muted-foreground"> · {intervalLabel}</span>
                <span className="text-muted-foreground"> · {barEta}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="numeric font-medium text-foreground/90">{ohlcLegend || '—'}</span>
              </span>
              <span className="h-4 w-px shrink-0 bg-border/80" aria-hidden />
            </>
          )}
          {onViewModeChange && (
            <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => onViewModeChange('chart')}
                className={`inline-flex items-center gap-1 px-2 py-1 text-price font-bold transition-colors ${
                  viewMode === 'chart' ? TB_SEG_ON : TB_SEG_OFF
                }`}
              >
                <CandlestickChart className="h-3.5 w-3.5" />
                Chart
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('depth')}
                className={`inline-flex items-center gap-1 border-l border-border px-2 py-1 text-price font-bold transition-colors ${
                  viewMode === 'depth' ? TB_SEG_ON : TB_SEG_OFF
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
                    className={`numeric px-1.5 py-1 text-price font-bold ${
                      i > 0 ? 'border-l border-border' : ''
                    } ${chartPriceScale === id ? TB_SEG_ON : TB_SEG_OFF}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={overlayStudy}
                onChange={(e) => setOverlayStudy(e.target.value as OverlayStudyId)}
                className="max-w-[11rem] shrink-0 cursor-pointer rounded-md border border-border bg-card px-1.5 py-1 text-price font-semibold text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title="Price overlay (SMA, EMA, VWAP, Bollinger)"
              >
                {OVERLAY_OPTIONS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-pressed={showVolumeMa}
                onClick={() => setShowVolumeMa((v) => !v)}
                className={`shrink-0 rounded-md border px-2 py-0.5 text-price font-semibold transition-colors ${
                  showVolumeMa ? TB_TOGGLE_ON : TB_TOGGLE_OFF
                }`}
                title="Volume pane SMA(9)"
              >
                Vol SMA 9
              </button>
              <button
                type="button"
                aria-pressed={showRsi}
                onClick={() => setShowRsi((v) => !v)}
                className={`shrink-0 rounded-md border px-2 py-0.5 text-price font-semibold transition-colors ${
                  showRsi ? TB_TOGGLE_ON : TB_TOGGLE_OFF
                }`}
                title="RSI(14) pane"
              >
                RSI(14)
              </button>
            </>
          )}
          {viewMode === 'chart' && onIntervalSecondsChange && (
            <>
              <span className="h-4 w-px shrink-0 bg-border/60" aria-hidden />
              {INTERVALS.map(({ label, seconds }) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => onIntervalSecondsChange(seconds)}
                  className={`numeric shrink-0 rounded px-2 py-1 text-price font-bold transition-colors ${
                    intervalSeconds === seconds ? TB_SEG_ON : TB_SEG_OFF
                  }`}
                >
                  {label}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-1.5">
          {viewMode === 'chart' && (
            <button
              type="button"
              onClick={() => setExtStackOpen((v) => !v)}
              aria-pressed={extStackOpen}
              aria-expanded={extStackOpen}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-price font-semibold transition-colors ${
                extStackOpen ? TB_SEG_ON : TB_SEG_OFF
              }`}
              title={
                extStackOpen
                  ? 'Hide studies row (EMA stack, VWAP², volume bars, drawings). Overlays & RSI stay in toolbar.'
                  : 'Show studies row: multi-EMA, VWAP², volume bars, drawing tools. Overlay menu = SMA/EMA/VWAP/Bollinger.'
              }
            >
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Studies</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-price font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Fit content"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          <button
            type="button"
            onClick={handleFullscreen}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-price font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Fullscreen"
            aria-pressed={isFullscreen}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleScreenshot}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-price font-semibold text-muted-foreground hover:bg-accent/80 dark:text-muted-foreground dark:hover:bg-accent"
            title="Download chart as PNG"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        </div>
        {viewMode === 'chart' && extStackOpen && (
          <div className="w-full min-w-0 rounded border border-border bg-muted/30 px-1.5 py-1">
            <div className="flex min-h-0 w-full min-w-0 flex-nowrap items-center gap-x-2 gap-y-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1">
              <button
                type="button"
                onClick={() => setExtStackOpen(false)}
                className="shrink-0 rounded px-1 py-0.5 text-label font-bold uppercase tracking-wide text-muted-foreground hover:bg-accent"
                title="Hide toolbar — more chart height"
              >
                ▴ Hide
              </button>
              <span className="shrink-0 text-label font-bold uppercase text-muted-foreground">EMA</span>
              {([7, 20, 50, 200] as const).map((p) => {
                const k = `ema${p}` as keyof ChartExtensionsConfig;
                const on = Boolean(extConfig[k]);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setExtConfig((prev) => ({ ...prev, [k]: !Boolean(prev[k]) }) as ChartExtensionsConfig)
                    }
                    className={`shrink-0 rounded-md border px-1.5 py-0.5 text-label font-semibold leading-tight transition-colors ${
                      on ? TB_TOGGLE_ON : TB_TOGGLE_OFF
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border" aria-hidden />
              <button
                type="button"
                aria-pressed={Boolean(extConfig.modularVwap)}
                onClick={() => setExtConfig((prev) => ({ ...prev, modularVwap: !prev.modularVwap }))}
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-label font-semibold leading-tight transition-colors ${
                  extConfig.modularVwap ? TB_TOGGLE_ON : TB_TOGGLE_OFF
                }`}
              >
                VWAP²
              </button>
              <button
                type="button"
                aria-pressed={extConfig.volumeHistogram !== false}
                onClick={() =>
                  setExtConfig((prev) => ({ ...prev, volumeHistogram: !prev.volumeHistogram }))
                }
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-label font-semibold leading-tight transition-colors ${
                  extConfig.volumeHistogram !== false ? TB_TOGGLE_ON : TB_TOGGLE_OFF
                }`}
              >
                Vol bars
              </button>
              <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border" aria-hidden />
              <span
                className="shrink-0 text-label font-bold uppercase text-muted-foreground"
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
                  className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-label font-bold leading-tight transition-colors ${
                    drawTool === id ? `${TB_SEG_ON} border-transparent` : `${TB_SEG_OFF} border-transparent`
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
                className="inline-flex shrink-0 rounded-md border border-border px-1.5 py-0.5 text-label font-semibold leading-tight text-foreground/80 hover:bg-accent"
              >
                Clr
              </button>
            </div>
          </div>
        )}
      </div>

      {viewMode === 'depth' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card p-px">
          <SpotDepthChart bids={depthBids} asks={depthAsks} className="min-h-[200px] flex-1" />
        </div>
      ) : (
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
          {chartLoading && !chartError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/90 backdrop-blur-[1px]">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
                  aria-hidden
                />
                <span className="text-xs text-muted-foreground">Loading chart…</span>
              </div>
            </div>
          )}
          {chartError && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/95 p-4 backdrop-blur-[1px]">
              <AlertCircle className="h-10 w-10 text-muted-foreground" aria-hidden />
              <p className="max-w-xs text-center text-sm text-muted-foreground">Chart unavailable. {chartError}</p>
              <button
                type="button"
                onClick={retryChart}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
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
          <div className="flex flex-shrink-0 items-center justify-between border-t border-border bg-card px-2 py-0.5 text-label text-muted-foreground numeric">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 opacity-70" aria-hidden />
              {utcNow} UTC
            </span>
            <span>
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
