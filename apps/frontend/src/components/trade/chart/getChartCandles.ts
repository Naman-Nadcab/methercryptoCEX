/**
 * Fetches raw candle data from the backend API and returns CandleData[] safe for the chart engine.
 * Pipeline: fetch → normalizeCandleData → validateCandleContinuity(intervalSeconds, fillGaps: true).
 * No websocket, business, or UI logic. TypeScript only. Backend is source of truth.
 */

import { api } from '@/lib/api';
import type { CandleData } from './ChartAdapter';
import type { RawCandle } from './normalizeCandleData';
import { buildChartCandles } from './buildChartCandles';

/** Backend response shape: { success: true, data: RawCandle[] } */
const CANDLES_ENDPOINT = '/api/v1/trading/candles';

/**
 * Fetches raw candles from the backend, then runs:
 *   normalizeCandleData(raw)
 *   validateCandleContinuity(candles, intervalSeconds, { fillGaps: true })
 * Returns CandleData[] safe for the chart engine. Rejects on fetch or API error.
 *
 * Symbol alignment: pairId must be the spot market symbol (e.g. BTC_USDT) as returned by
 * GET /api/v1/spot/markets. The backend candle API uses trading_pairs.symbol; use the same
 * symbol so charts load for all spot markets.
 */
export async function getChartCandles(
  pairId: string,
  intervalSeconds: number,
  opts?: { from?: number; to?: number; cursor?: number; limit?: number; direction?: 'asc' | 'desc' }
): Promise<CandleData[]> {
  const qs = new URLSearchParams();
  qs.set('interval', String(intervalSeconds));
  if (opts?.from != null) qs.set('from', String(opts.from));
  if (opts?.to != null) qs.set('to', String(opts.to));
  if (opts?.cursor != null) qs.set('cursor', String(opts.cursor));
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  if (opts?.direction) qs.set('direction', opts.direction);
  const res = await api.get<RawCandle[]>(`${CANDLES_ENDPOINT}/${encodeURIComponent(pairId)}?${qs.toString()}`, {
    skipAuth: true,
  });
  if (!res.success || res.data === undefined) {
    throw new Error(res.error?.message ?? 'Failed to fetch candles');
  }
  const raw = Array.isArray(res.data) ? res.data : [];
  return buildChartCandles(raw, intervalSeconds);
}
