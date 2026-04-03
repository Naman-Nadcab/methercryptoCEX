'use client';

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from 'react';
import { LightweightChartsAdapter } from './LightweightChartsAdapter';
import { getChartCandles } from './getChartCandles';
import type { ChartTheme, CandleData } from './ChartAdapter';

const CHART_MOUNT_ID = 'chart-mount';

export function useChartAdapter(
  symbol: string,
  intervalSeconds: number,
  theme: ChartTheme = 'dark',
  viewMode: 'chart' | 'depth' = 'chart',
  pricePrecision: number = 6
): {
  adapterRef: RefObject<LightweightChartsAdapter | null>;
  chartError: string | null;
  chartLoading: boolean;
  retryChart: () => void;
} {
  const adapterRef = useRef<LightweightChartsAdapter | null>(null);
  const inflightRef = useRef(0);
  const [dataError, setDataError] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const chartError = useMemo(() => dataError ?? initError ?? null, [dataError, initError]);
  const [chartLoading, setChartLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  /** Latest fetched candles for current symbol/interval; applied when adapter is created (fixes init race). */
  const lastCandlesRef = useRef<CandleData[] | null>(null);

  const retryChart = useCallback(() => {
    setDataError(null);
    setInitError(null);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    if (viewMode === 'depth') {
      adapterRef.current?.destroy();
      adapterRef.current = null;
      return;
    }
    const el = document.getElementById(CHART_MOUNT_ID);
    if (!el) return;

    const syncAdapter = () => {
      if (!el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const hasSize = rect.width >= 2 && rect.height >= 2;
      if (!adapterRef.current) {
        if (!hasSize) return;
        try {
          const adapter = new LightweightChartsAdapter();
          adapterRef.current = adapter;
          adapter.init(el, theme);
          adapter.setPricePrecision(pricePrecision);
          adapter.setLegendPrecision(pricePrecision);
          if (lastCandlesRef.current?.length) {
            adapter.setCandles(lastCandlesRef.current);
            adapter.fitContent?.();
          }
          setInitError(null);
        } catch (err) {
          try {
            adapterRef.current?.destroy();
          } catch {
            /* ignore */
          }
          adapterRef.current = null;
          setInitError(err instanceof Error ? err.message : 'Chart could not start');
        }
      } else {
        try {
          adapterRef.current.updateTheme?.(theme);
          adapterRef.current.setPricePrecision(pricePrecision);
          adapterRef.current.setLegendPrecision(pricePrecision);
        } catch (err) {
          console.error('[useChartAdapter] theme/precision update failed', err);
        }
      }
    };

    syncAdapter();
    const ro = new ResizeObserver(() => syncAdapter());
    ro.observe(el);

    return () => {
      ro.disconnect();
    };
  }, [theme, viewMode, pricePrecision, retryCount]);

  useEffect(() => {
    return () => {
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'depth') {
      setChartLoading(false);
      setDataError(null);
      setInitError(null);
      return;
    }
    if (!symbol?.trim()) {
      setChartLoading(false);
      setDataError(null);
      lastCandlesRef.current = null;
      return;
    }
    setChartLoading(true);
    setDataError(null);
    setInitError(null);
    let cancelled = false;
    const reqId = ++inflightRef.current;

    const now = Math.floor(Date.now() / 1000);
    const sixMonthsSeconds = 60 * 60 * 24 * 30 * 6;
    const from = now - sixMonthsSeconds;
    /** First HTTP response only — smaller payload for fast first paint (backend min limit 50). */
    const INITIAL_CHART_LIMIT = 900;
    const BACKFILL_PAGE_LIMIT = 4000;
    const HARD_CAP = 300000;

    const yieldToMain = () =>
      new Promise<void>((resolve) => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(() => resolve(), { timeout: 750 });
        } else {
          setTimeout(resolve, 4);
        }
      });

    const run = async () => {
      try {
        const recent = await getChartCandles(symbol, intervalSeconds, {
          from,
          to: now,
          limit: INITIAL_CHART_LIMIT,
          direction: 'desc',
        });
        if (cancelled || inflightRef.current !== reqId) return;
        setDataError(null);
        lastCandlesRef.current = recent;
        const adapter = adapterRef.current;
        if (adapter) {
          try {
            adapter.setCandles(recent);
            adapter.fitContent?.();
          } catch (err) {
            console.error('[useChartAdapter] setCandles failed', err);
            setInitError(err instanceof Error ? err.message : 'Chart failed to render candles');
          }
        }
        if (!cancelled && inflightRef.current === reqId) {
          setChartLoading(false);
        }

        try {
          let oldest = recent[0]?.time;
          let total = recent.length;
          const backfillPages: CandleData[][] = [];
          while (oldest && oldest > from && total < HARD_CAP) {
            if (cancelled || inflightRef.current !== reqId) return;
            await yieldToMain();
            const older = await getChartCandles(symbol, intervalSeconds, {
              from,
              to: now,
              cursor: oldest,
              limit: BACKFILL_PAGE_LIMIT,
              direction: 'desc',
            });
            if (cancelled || inflightRef.current !== reqId) return;
            if (!older.length) break;
            backfillPages.push(older);
            oldest = older[0]?.time;
            total += older.length;
            if (older.length < BACKFILL_PAGE_LIMIT) break;
          }
          if (backfillPages.length && adapterRef.current) {
            try {
              const allOlder = backfillPages.flat();
              adapterRef.current.prependCandles?.(allOlder);
            } catch (err) {
              console.error('[useChartAdapter] prependCandles failed', err);
            }
          }
        } catch (backfillErr) {
          console.warn('[useChartAdapter] history backfill stopped', backfillErr);
        }
      } catch (err) {
        if (cancelled || inflightRef.current !== reqId) return;
        const message = err instanceof Error ? err.message : 'Failed to load chart data';
        setDataError(message);
      } finally {
        if (!cancelled && inflightRef.current === reqId) setChartLoading(false);
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [symbol, intervalSeconds, viewMode, retryCount]);

  return { adapterRef, chartError, chartLoading, retryChart };
}
