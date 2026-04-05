/**
 * Exchange-specific Prometheus metrics service.
 *
 * Complements the base metrics in lib/prometheus-metrics.ts with exchange-domain
 * gauges/counters/histograms. Provides `collectExchangeMetrics()` which should be
 * called on each /metrics scrape to refresh gauge values from DB / Redis / runtime.
 */

import { Counter, Gauge, Histogram } from 'prom-client';
import { register } from '../lib/prometheus-metrics.js';
import { db } from '../lib/database.js';
import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

export const httpRequestsTotal = new Counter({
  name: 'exchange_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const spotOrdersTotal = new Counter({
  name: 'exchange_spot_orders_total',
  help: 'Total spot orders by side and status',
  labelNames: ['side', 'status'] as const,
  registers: [register],
});

export const spotTradesTotal = new Counter({
  name: 'exchange_spot_trades_total',
  help: 'Total spot trades executed by market',
  labelNames: ['market'] as const,
  registers: [register],
});

export const settlementEventsProcessedTotal = new Counter({
  name: 'exchange_settlement_events_processed_total',
  help: 'Settlement events processed to completion',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Histograms
// ---------------------------------------------------------------------------

export const httpRequestDurationSeconds = new Histogram({
  name: 'exchange_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const settlementLatencySeconds = new Histogram({
  name: 'exchange_settlement_latency_seconds',
  help: 'Time from settlement event creation to completion (seconds)',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

export const matchingEngineLatencySeconds = new Histogram({
  name: 'exchange_matching_engine_latency_seconds',
  help: 'Matching engine round-trip latency (seconds)',
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Gauges
// ---------------------------------------------------------------------------

export const wsConnectionsActive = new Gauge({
  name: 'exchange_ws_connections_active',
  help: 'Active WebSocket connections by type',
  labelNames: ['type'] as const,
  registers: [register],
});

export const settlementEventsPending = new Gauge({
  name: 'exchange_settlement_events_pending',
  help: 'Number of pending settlement events',
  registers: [register],
});

export const settlementCircuitOpen = new Gauge({
  name: 'exchange_settlement_circuit_open',
  help: '1 if settlement circuit breaker is open, 0 otherwise',
  registers: [register],
});

export const hotWalletBalance = new Gauge({
  name: 'exchange_hot_wallet_balance',
  help: 'Hot wallet balance by chain and currency',
  labelNames: ['chain', 'currency'] as const,
  registers: [register],
});

export const depositsPendingCount = new Gauge({
  name: 'exchange_deposits_pending_count',
  help: 'Number of deposits in pending state',
  registers: [register],
});

export const withdrawalsPendingCount = new Gauge({
  name: 'exchange_withdrawals_pending_count',
  help: 'Number of withdrawals in pending / signing / broadcast state',
  registers: [register],
});

export const dbPoolActive = new Gauge({
  name: 'exchange_db_pool_active',
  help: 'Active (in-use) database pool connections',
  registers: [register],
});

export const dbPoolIdle = new Gauge({
  name: 'exchange_db_pool_idle',
  help: 'Idle database pool connections',
  registers: [register],
});

export const dbPoolWaiting = new Gauge({
  name: 'exchange_db_pool_waiting',
  help: 'Clients waiting for a database pool connection',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Collector — called on each /metrics scrape to refresh gauge values
// ---------------------------------------------------------------------------

export async function collectExchangeMetrics(): Promise<void> {
  try {
    const pool = db.getPool();
    dbPoolActive.set(pool.totalCount - pool.idleCount);
    dbPoolIdle.set(pool.idleCount);
    dbPoolWaiting.set(pool.waitingCount);
  } catch { /* best effort */ }

  try {
    const [pendingSettlement, pendingDeposits, pendingWithdrawals] = await Promise.all([
      db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`)
        .then((r) => parseInt(r.rows[0]?.n ?? '0', 10) || 0)
        .catch(() => 0),
      db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM deposits WHERE status = 'pending'`)
        .then((r) => parseInt(r.rows[0]?.n ?? '0', 10) || 0)
        .catch(() => 0),
      db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM withdrawal_signing_queue WHERE status IN ('pending', 'signing', 'broadcast')`
      )
        .then((r) => parseInt(r.rows[0]?.n ?? '0', 10) || 0)
        .catch(() => 0),
    ]);

    settlementEventsPending.set(pendingSettlement);
    depositsPendingCount.set(pendingDeposits);
    withdrawalsPendingCount.set(pendingWithdrawals);
  } catch { /* best effort */ }

  try {
    const rows = await db.query<{ chain: string; currency: string; balance: string }>(
      `SELECT chain, currency, balance::text FROM hot_wallets WHERE balance IS NOT NULL`
    ).catch(() => ({ rows: [] as { chain: string; currency: string; balance: string }[] }));

    for (const row of rows.rows) {
      hotWalletBalance.labels(row.chain, row.currency).set(parseFloat(row.balance) || 0);
    }
  } catch { /* best effort */ }

  try {
    const circuitKey = 'settlement:circuit_breaker_open';
    const { redis } = await import('../lib/redis.js');
    const val = await redis.get(circuitKey).catch(() => null);
    settlementCircuitOpen.set(val === '1' || val === 'true' ? 1 : 0);
  } catch { /* best effort */ }
}
