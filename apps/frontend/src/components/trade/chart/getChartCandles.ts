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
 */
export async function getChartCandles(
  pairId: string,
  intervalSeconds: number
): Promise<CandleData[]> {
  const res = await api.get<RawCandle[]>(
    `${CANDLES_ENDPOINT}/${encodeURIComponent(pairId)}?interval=${intervalSeconds}`
  );
  if (!res.success || res.data === undefined) {
    throw new Error(res.error?.message ?? 'Failed to fetch candles');
  }
  const raw = Array.isArray(res.data) ? res.data : [];
  return buildChartCandles(raw, intervalSeconds);
}
