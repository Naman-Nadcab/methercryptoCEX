/**
 * Prometheus metrics for observability.
 * Expose via GET /metrics for Prometheus scraping.
 * Phase E: default label "instance" for multi-node scraping (NODE_ID / INSTANCE_ID).
 */

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

/** Call once at startup to set instance label for multi-node (Phase E). */
export function setPrometheusInstanceId(instanceId: string): void {
  register.setDefaultLabels({ instance: instanceId });
}

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const spotOrderTotal = new Counter({
  name: 'spot_orders_total',
  help: 'Total spot orders placed',
  labelNames: ['side', 'type'],
  registers: [register],
});

export const spotTradesTotal = new Counter({
  name: 'spot_trades_total',
  help: 'Total spot trades executed',
  labelNames: ['market'],
  registers: [register],
});

export const tradingHaltedGauge = new Gauge({
  name: 'trading_halted',
  help: '1 if global trading is halted, 0 otherwise',
  registers: [register],
});

export const settlementCircuitOpenGauge = new Gauge({
  name: 'settlement_circuit_open',
  help: '1 if settlement circuit is open (halted), 0 otherwise',
  registers: [register],
});

// SLO-relevant gauges (updated periodically)
export const settlementPendingGauge = new Gauge({
  name: 'settlement_pending_count',
  help: 'Number of pending settlement events',
  registers: [register],
});

export const withdrawalQueueDepthGauge = new Gauge({
  name: 'withdrawal_queue_depth',
  help: 'Number of withdrawals in signing queue',
  registers: [register],
});

export const spotOrderLatencyP99 = new Gauge({
  name: 'spot_order_latency_p99_ms',
  help: 'P99 order placement latency in ms (rolling 60s)',
  registers: [register],
});

export const spotOrdersPerSecond = new Gauge({
  name: 'spot_orders_per_second',
  help: 'Spot orders per second (rolling 60s)',
  registers: [register],
});

// Observability: DB, errors, queue
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const dbSlowQueriesTotal = new Counter({
  name: 'db_slow_queries_total',
  help: 'Number of queries exceeding slow threshold',
  labelNames: ['operation'],
  registers: [register],
});

export const httpRequestErrorsTotal = new Counter({
  name: 'http_request_errors_total',
  help: 'HTTP 5xx error count',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const queueJobDuration = new Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Queue job processing duration',
  labelNames: ['queue'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});
