/**
 * Spot trading metrics: orders/sec, trades/sec, order latency.
 * In-memory rolling window (last 60s); suitable for /metrics endpoint.
 */

const WINDOW_MS = 60_000;
const MAX_LATENCY_SAMPLES = 500;

const orderTimestamps: number[] = [];
const tradeTimestamps: number[] = [];
const orderLatencyMs: number[] = [];

function prune(arr: number[], windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  while (arr.length > 0 && arr[0]! < cutoff) arr.shift();
}

export function recordOrder(): void {
  orderTimestamps.push(Date.now());
  prune(orderTimestamps, WINDOW_MS);
}

export function recordTrade(): void {
  tradeTimestamps.push(Date.now());
  prune(tradeTimestamps, WINDOW_MS);
}

export function recordOrderLatencyMs(ms: number): void {
  orderLatencyMs.push(ms);
  if (orderLatencyMs.length > MAX_LATENCY_SAMPLES) orderLatencyMs.shift();
}

export function getSpotMetrics(): {
  ordersLastMinute: number;
  tradesLastMinute: number;
  ordersPerSecond: number;
  tradesPerSecond: number;
  orderLatencyP50Ms: number | null;
  orderLatencyP99Ms: number | null;
} {
  prune(orderTimestamps, WINDOW_MS);
  prune(tradeTimestamps, WINDOW_MS);
  const ordersLastMinute = orderTimestamps.length;
  const tradesLastMinute = tradeTimestamps.length;
  const windowSec = WINDOW_MS / 1000;
  const sorted = [...orderLatencyMs].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)]! : null;
  const p99 = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1]! : null;
  return {
    ordersLastMinute,
    tradesLastMinute,
    ordersPerSecond: windowSec > 0 ? ordersLastMinute / windowSec : 0,
    tradesPerSecond: windowSec > 0 ? tradesLastMinute / windowSec : 0,
    orderLatencyP50Ms: p50 ?? null,
    orderLatencyP99Ms: p99 ?? null,
  };
}
