/**
 * External reference prices (multi-source, Binance-compatible ticker API).
 */
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { withTimeout } from '../lib/async-timeout.js';

/** Convert exchange symbol e.g. BTC_USDT → BTCUSDT for Binance spot API. */
export function spotSymbolToBinanceTicker(symbol: string): string {
  return symbol.toUpperCase().replace(/_/g, '');
}

function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/$/, '');
}

export function getExternalPriceSourceBaseUrls(): string[] {
  const urls = config.externalPriceFeed.sourceBaseUrls;
  if (urls.length > 0) return urls.map(normalizeBaseUrl);
  const b = config.externalPriceFeed.baseUrl?.trim();
  return [normalizeBaseUrl(b || 'https://api.binance.com')];
}

export type ExternalPriceSample = {
  price: number;
  /** Round-trip time for this source (ms). */
  latencyMs: number;
  sourceIndex: number;
};

export async function fetchBinanceMidPriceFromBase(symbol: string, baseUrl: string): Promise<number | null> {
  const r = await fetchBinanceMidPriceFromBaseTimed(symbol, baseUrl, 0);
  return r?.price ?? null;
}

export async function fetchBinanceMidPriceFromBaseTimed(
  symbol: string,
  baseUrl: string,
  sourceIndex: number
): Promise<ExternalPriceSample | null> {
  const base = normalizeBaseUrl(baseUrl);
  const sym = spotSymbolToBinanceTicker(symbol);
  const url = `${base}/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`;
  const t0 = Date.now();
  try {
    const res = await withTimeout(
      fetch(url, { headers: { Accept: 'application/json' } }),
      5_000,
      'external.ticker'
    );
    const latencyMs = Math.max(0, Date.now() - t0);
    if (!res.ok) {
      logger.warn('External price feed HTTP error', { base, symbol: sym, status: res.status });
      return null;
    }
    const j = (await res.json()) as { price?: string };
    const p = j?.price != null ? parseFloat(j.price) : NaN;
    if (!Number.isFinite(p) || p <= 0) return null;
    return { price: p, latencyMs, sourceIndex };
  } catch (e) {
    logger.warn('External price fetch failed', { base, symbol: sym, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Legacy single-base fetch (first configured source). */
export async function fetchBinanceMidPrice(symbol: string): Promise<number | null> {
  if (!config.externalPriceFeed.enabled) return null;
  const bases = getExternalPriceSourceBaseUrls();
  return fetchBinanceMidPriceFromBase(symbol, bases[0]!);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Absolute divergence in bps between two positive mids. */
export function midDivergenceBps(internalMid: number, externalMid: number): number {
  if (!Number.isFinite(internalMid) || internalMid <= 0 || !Number.isFinite(externalMid) || externalMid <= 0) return 0;
  return (Math.abs(internalMid - externalMid) / internalMid) * 10_000;
}

function weightedMean(prices: number[], weights: number[]): number | null {
  if (prices.length === 0 || prices.length !== weights.length) return null;
  let num = 0;
  let den = 0;
  for (let i = 0; i < prices.length; i++) {
    const w = weights[i]!;
    if (!Number.isFinite(w) || w <= 0) continue;
    num += prices[i]! * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

function filterOutliers(samples: ExternalPriceSample[], maxBpsFromMedian: number): {
  kept: ExternalPriceSample[];
  dropped: number;
} {
  if (samples.length === 0 || maxBpsFromMedian <= 0) return { kept: samples, dropped: 0 };
  const prices = samples.map((s) => s.price);
  const med = median(prices);
  if (med == null || med <= 0) return { kept: samples, dropped: 0 };
  const kept = samples.filter((s) => midDivergenceBps(med, s.price) <= maxBpsFromMedian);
  const dropped = samples.length - kept.length;
  if (kept.length === 0) return { kept: samples, dropped: 0 };
  return { kept, dropped };
}

/**
 * Parallel fetch from all configured sources; optional outlier drop, then median/mean or latency-inverse-weighted mean.
 */
export async function aggregateExternalMidPrice(symbol: string): Promise<{
  mid: number | null;
  validSources: number;
  samples: number[];
  droppedOutliers: number;
  avgLatencyMs: number | null;
  aggregation: 'median' | 'mean' | 'latency_weighted';
}> {
  if (!config.externalPriceFeed.enabled) {
    return { mid: null, validSources: 0, samples: [], droppedOutliers: 0, avgLatencyMs: null, aggregation: 'median' };
  }
  const bases = getExternalPriceSourceBaseUrls();
  const raw = await Promise.all(bases.map((b, i) => fetchBinanceMidPriceFromBaseTimed(symbol, b, i)));
  const collected = raw.filter((x): x is ExternalPriceSample => x != null && Number.isFinite(x.price) && x.price > 0);
  if (collected.length === 0) {
    return { mid: null, validSources: 0, samples: [], droppedOutliers: 0, avgLatencyMs: null, aggregation: 'median' };
  }

  const outlierBps = config.externalPriceFeed.outlierMaxBps;
  const { kept, dropped } = filterOutliers(collected, outlierBps);
  const use = kept;
  const prices = use.map((s) => s.price);
  const avgLat =
    use.length > 0 ? use.reduce((a, s) => a + s.latencyMs, 0) / use.length : null;

  const latencyOn = config.externalPriceFeed.latencyWeightEnabled;
  const floor = config.externalPriceFeed.latencyWeightFloorMs;
  const mode = config.externalPriceFeed.aggregation;

  let mid: number | null = null;
  let aggregation: 'median' | 'mean' | 'latency_weighted' = mode;

  if (latencyOn && use.length >= 1) {
    const w = use.map((s) => 1 / (s.latencyMs + floor));
    mid = weightedMean(prices, w);
    aggregation = 'latency_weighted';
  } else if (mode === 'mean') {
    mid = mean(prices);
  } else {
    mid = median(prices);
  }

  return {
    mid,
    validSources: use.length,
    samples: prices,
    droppedOutliers: dropped,
    avgLatencyMs: avgLat,
    aggregation,
  };
}
