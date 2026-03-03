'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { api } from '@/lib/api';
import { LightweightChartsAdapter } from './LightweightChartsAdapter';
import { getChartCandles } from './getChartCandles';
import type { ChartTheme } from './ChartAdapter';

const CHART_MOUNT_ID = 'chart-mount';
const TICKER_POLL_MS = 2000;

export function useChartAdapter(
  symbol: string,
  intervalSeconds: number,
  theme: ChartTheme = 'dark'
): RefObject<LightweightChartsAdapter | null> {
  const adapterRef = useRef<LightweightChartsAdapter | null>(null);

  useEffect(() => {
    const el = document.getElementById(CHART_MOUNT_ID);
    if (!el) return;
    if (adapterRef.current) return;
    const adapter = new LightweightChartsAdapter();
    adapterRef.current = adapter;
    adapter.init(el, theme);

    let cancelled = false;
    getChartCandles(symbol, intervalSeconds)
      .then((candles) => {
        if (cancelled || !adapterRef.current) return;
        if (candles.length > 0) {
          adapter.setCandles(candles);
        }
      })
      .catch(() => {});

    api
      .get<{ data?: Array<{ created_at: string; price: string; side: string }> }>(
        `/api/v1/spot/trade-history?market=${encodeURIComponent(symbol)}&limit=50`
      )
      .then((res) => {
        if (cancelled || !adapterRef.current || !res.data?.data?.length) return;
        const trades = res.data.data.map((r) => ({
          time: Math.floor(new Date(r.created_at).getTime() / 1000),
          price: Number(r.price),
          side: (r.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
        }));
        adapterRef.current?.setTradeMarkers?.(trades);
      })
      .catch(() => {});

    let pollId: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (pollId != null) return;
      pollId = setInterval(() => {
        if (!adapterRef.current) return;
        api
          .get<{ last_price: string | null }>(`/api/v1/spot/ticker/${encodeURIComponent(symbol)}`)
          .then((res) => {
            if (!res.success || res.data?.last_price == null) return;
            const price = Number(res.data.last_price);
            if (!Number.isFinite(price)) return;
            const tickTime = Math.floor(Date.now() / 1000);
            adapterRef.current?.updatePrice(tickTime, price);
          })
          .catch(() => {});
      }, TICKER_POLL_MS);
    };
    startPolling();

    return () => {
      cancelled = true;
      if (pollId != null) {
        clearInterval(pollId);
        pollId = null;
      }
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [symbol, intervalSeconds, theme]);

  return adapterRef;
}
