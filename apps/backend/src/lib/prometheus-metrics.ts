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

/** Age in seconds of the oldest pending settlement_events row (0 if none). */
export const settlementOldestPendingAgeSeconds = new Gauge({
  name: 'settlement_oldest_pending_age_seconds',
  help: 'Seconds since created_at of oldest pending settlement event',
  registers: [register],
});

/** Same value as settlement_oldest_pending_age_seconds; alias for dashboards expecting `settlement_lag`. */
export const settlementLagSeconds = new Gauge({
  name: 'settlement_lag_seconds',
  help: 'Settlement queue lag: seconds since created_at of oldest pending settlement event',
  registers: [register],
});

/** Rows newly inserted into settlement_events from engine (not idempotent skips). */
export const matchEventsPersistedTotal = new Counter({
  name: 'engine_match_events_persisted_total',
  help: 'Engine match events inserted into settlement_events (new rows only)',
  labelNames: ['source'],
  registers: [register],
});

export const matchEventsPersistFailedTotal = new Counter({
  name: 'engine_match_events_persist_failed_total',
  help: 'Failed attempts to persist engine match events to Postgres',
  labelNames: ['source'],
  registers: [register],
});

/** SQL matcher path still used (post-only, FOK, stops, etc.); should trend to zero when Rust covers all. */
export const spotSqlMatcherInvocationsTotal = new Counter({
  name: 'spot_sql_matcher_invocations_total',
  help: 'Spot orders matched via Postgres/SQL matcher (not Rust)',
  labelNames: ['reason'],
  registers: [register],
});

export const liquidityBotRunsTotal = new Counter({
  name: 'liquidity_bot_runs_total',
  help: 'Liquidity bot cycles completed',
  labelNames: ['result'],
  registers: [register],
});

export const liquidityBotErrorsTotal = new Counter({
  name: 'liquidity_bot_errors_total',
  help: 'Liquidity bot errors (per-symbol or cycle failures)',
  labelNames: ['reason'],
  registers: [register],
});

/** Seconds since MM bot last confirmed quotes OK; 0 if never refreshed this process. */
export const liquidityBotQuoteAgeSeconds = new Gauge({
  name: 'liquidity_bot_quote_age_seconds',
  help: 'Seconds since last MM quote refresh (resting OK or placed); 0 if none yet',
  registers: [register],
});

/** 0=ok, 1=degraded, 2=critical (MM intelligence layer). */
export const mmHealthLevelGauge = new Gauge({
  name: 'mm_health_level',
  help: 'Market-maker health level: 0 ok, 1 degraded, 2 critical',
  registers: [register],
});

export const withdrawalQueueDepthGauge = new Gauge({
  name: 'withdrawal_queue_depth',
  help: 'Number of withdrawals in signing queue',
  registers: [register],
});

/** Age in seconds of latest indexer_state.updated_at (deposit indexer heartbeat). -1 if no row or query failed. */
export const indexerStateLagSeconds = new Gauge({
  name: 'indexer_state_lag_seconds',
  help: 'Seconds since indexer_state.updated_at (newest row); -1 when empty/unreadable',
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

/** NATS orderbook writer: end-to-end apply + fan-out (seconds). */
export const spotOrderbookWriterProcessSeconds = new Histogram({
  name: 'spot_orderbook_writer_process_seconds',
  help: 'Orderbook writer message processing time',
  labelNames: ['shard'],
  buckets: [0.000_05, 0.000_1, 0.000_25, 0.000_5, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [register],
});

export const spotOrderbookWriterLagMs = new Gauge({
  name: 'spot_orderbook_writer_lag_ms',
  help: 'Writer apply lag (ms): idle since last message only when JetStream pending > 0; 0 when backlog is empty',
  labelNames: ['shard'],
  registers: [register],
});

export const spotOrderbookWriterPending = new Gauge({
  name: 'spot_orderbook_writer_pending_messages',
  help: 'JetStream consumer num_pending (estimated)',
  labelNames: ['shard'],
  registers: [register],
});

/** MATCH_EVENTS stream → settlement durable consumer (settlement_group). */
export const settlementMatchStreamPending = new Gauge({
  name: 'settlement_match_stream_consumer_pending',
  help: 'JetStream settlement_group num_pending (MATCH_EVENTS)',
  registers: [register],
});

export const settlementMatchStreamAckTotal = new Counter({
  name: 'settlement_match_stream_messages_acked_total',
  help: 'Match event stream messages settled and acked',
  registers: [register],
});

export const settlementMatchStreamTermTotal = new Counter({
  name: 'settlement_match_stream_messages_terminated_total',
  help: 'Match event stream messages terminated (poison / bad payload)',
  registers: [register],
});

export const settlementMatchStreamDlqTotal = new Counter({
  name: 'settlement_match_stream_dlq_published_total',
  help: 'Fatal / poison match events published to MATCH_SETTLEMENT_DLQ',
  registers: [register],
});

export const settlementMatchStreamNakTotal = new Counter({
  name: 'settlement_match_stream_messages_naked_total',
  help: 'Match event stream messages nak for retry',
  registers: [register],
});

export const settlementMatchStreamLagSequences = new Gauge({
  name: 'settlement_match_stream_lag_sequences',
  help: 'Approx stream lag: stream last_seq minus consumer delivered (best-effort)',
  registers: [register],
});

export const settlementMatchStreamPartitionLag = new Gauge({
  name: 'settlement_match_stream_partition_lag_sequences',
  help: 'Per-partition stream lag (settlement_group_pN vs MATCH_EVENTS last_seq)',
  labelNames: ['partition'],
  registers: [register],
});

export const settlementMatchStreamPartitionPending = new Gauge({
  name: 'settlement_match_stream_partition_pending',
  help: 'JetStream num_pending per settlement partition consumer',
  labelNames: ['partition'],
  registers: [register],
});

export const spotOrderbookWriterResyncTotal = new Counter({
  name: 'spot_orderbook_writer_resync_total',
  help: 'orderbook_resync emitted after writer_seq gap',
  labelNames: ['shard', 'symbol'],
  registers: [register],
});

export const spotOrderbookWriterDroppedTotal = new Counter({
  name: 'spot_orderbook_writer_dropped_total',
  help: 'Messages terminated or skipped as duplicate (dedup)',
  labelNames: ['shard', 'reason'],
  registers: [register],
});

export const spotWsForwarderDecodeMs = new Gauge({
  name: 'spot_ws_forwarder_decode_ms',
  help: 'Last UTF-8 decode time for forwarder path (ms)',
  labelNames: ['instance'],
  registers: [register],
});

export const spotWsDisconnectsTotal = new Counter({
  name: 'spot_ws_disconnects_total',
  help: 'Spot /spot/ws connections closed (unregister)',
  registers: [register],
});

/** 0 = normal (all priorities), 1 = drop_low (ticker), 2 = drop_medium+low (orderbook only). */
export const spotWsForwarderMode = new Gauge({
  name: 'spot_ws_forwarder_mode',
  help: 'WS NATS forwarder shedding mode (0=normal, 1=drop_low, 2=drop_medium)',
  labelNames: ['instance'],
  registers: [register],
});

export const spotWsForwarderMessagesDroppedTotal = new Counter({
  name: 'spot_ws_forwarder_messages_dropped_total',
  help: 'JetStream messages acked without WS broadcast due to load shedding',
  labelNames: ['priority'],
  registers: [register],
});

export const spotWsForwarderPendingSum = new Gauge({
  name: 'spot_ws_forwarder_pending_sum',
  help: 'Sum of num_pending across forwarder JetStream consumers (SPOT_ORDERBOOK)',
  labelNames: ['instance'],
  registers: [register],
});

export const spotWsWriterLocalMode = new Gauge({
  name: 'spot_ws_writer_local_mode',
  help: 'Writer colocated WS shedding mode (0=all, 1=no ticker, 2=orderbook only)',
  labelNames: ['instance'],
  registers: [register],
});

export const spotWsLocalTickerCoalesceFlushTotal = new Counter({
  name: 'spot_ws_local_ticker_coalesce_flush_total',
  help: 'Writer-local ticker coalesce flush cycles (symbols flushed)',
  registers: [register],
});

export const spotWsLocalTradesBatchFlushTotal = new Counter({
  name: 'spot_ws_local_trades_batch_flush_total',
  help: 'Writer-local batched trades flushes',
  registers: [register],
});

export const spotWsLocalPerConnSkippedTotal = new Counter({
  name: 'spot_ws_local_per_conn_skipped_total',
  help: 'Ticker/trades skipped for a connection due to socket buffer backpressure',
  labelNames: ['tier', 'stream'],
  registers: [register],
});

export const spotWsLocalOrderbookBurstMergedTotal = new Counter({
  name: 'spot_ws_local_orderbook_burst_merged_total',
  help: 'Writer-local orderbook burst coalescing flushes that merged 2+ wires',
  registers: [register],
});

export const spotWsAdaptiveModeBroadcastTotal = new Counter({
  name: 'spot_ws_adaptive_mode_broadcast_total',
  help: 'adaptive_mode control messages sent to spot WS clients',
  registers: [register],
});

/** Tier-1 periodic reconciliation (settlement ledger, balances, replay). Observability only. */
export const tier1ReconciliationRunsTotal = new Counter({
  name: 'tier1_reconciliation_runs_total',
  help: 'Tier-1 reconciliation job executions (single round may include multiple checks)',
  registers: [register],
});

export const tier1ReconciliationMismatchTotal = new Counter({
  name: 'tier1_reconciliation_mismatch_total',
  help: 'Tier-1 reconciliation detected a mismatch (no auto-fix applied)',
  labelNames: ['check'],
  registers: [register],
});

/** 1 = last global settlement-ledger vs user_balances audit passed; 0 = failed or not yet run. */
export const tier1SettlementBalanceInvariantOk = new Gauge({
  name: 'tier1_settlement_balance_invariant_ok',
  help: '1 if settlement ledger totals match user_balances (trading) after last Tier-1 run',
  registers: [register],
});

/** 1 = last balance_ledger vs user_balances (spot integrity) passed. */
export const tier1SpotBalanceLedgerInvariantOk = new Gauge({
  name: 'tier1_spot_balance_ledger_invariant_ok',
  help: '1 if balance_ledger sums match user_balances for trading after last Tier-1 run',
  registers: [register],
});

/** 1 = last settlement hash replay check passed. */
export const tier1SettlementReplayOk = new Gauge({
  name: 'tier1_settlement_replay_ok',
  help: '1 if settlement replay integrity check found no hash mismatches',
  registers: [register],
});

/** Processed settlement_events rows with zero ledger rows (should always be 0). */
export const tier1LedgerOrphanProcessedEvents = new Gauge({
  name: 'tier1_ledger_orphan_processed_events',
  help: 'Count of processed settlement_events missing settlement_ledger_entries',
  registers: [register],
});

export const tier1LastReconciliationTimestampSeconds = new Gauge({
  name: 'tier1_last_reconciliation_timestamp_seconds',
  help: 'Unix seconds of last completed Tier-1 reconciliation round',
  registers: [register],
});

/** Spot POST /order terminal failures (4xx/5xx) for SLO alerting; increment at route layer. */
export const spotOrderPlacementFailedTotal = new Counter({
  name: 'spot_order_placement_failed_total',
  help: 'Spot order placement rejected or failed (HTTP error response)',
  labelNames: ['code'],
  registers: [register],
});

export const settlementEventsDlqTotal = new Counter({
  name: 'settlement_events_dlq_total',
  help: 'Settlement events moved to DLQ after fatal failure or max retries',
  labelNames: ['reason'],
  registers: [register],
});

export const balanceIntegrityMismatchTotal = new Counter({
  name: 'balance_integrity_mismatch_total',
  help: 'Balance consistency engine detected integrity issues',
  labelNames: ['kind'],
  registers: [register],
});

export const balanceIntegrityUsersFrozenTotal = new Counter({
  name: 'balance_integrity_users_frozen_total',
  help: 'Users suspended for spot trading due to balance integrity',
  registers: [register],
});

export const engineRequestDurationMs = new Histogram({
  name: 'engine_request_duration_ms',
  help: 'Rust matching engine HTTP request latency (ms)',
  labelNames: ['endpoint'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

export const orderbookStaleResponsesTotal = new Counter({
  name: 'orderbook_stale_responses_total',
  help: 'Public orderbook responses where snapshot age exceeded MAX_ORDERBOOK_AGE_MS',
  labelNames: ['symbol'],
  registers: [register],
});

export const auditExportFailureTotal = new Counter({
  name: 'audit_export_failure_total',
  help: 'Audit NDJSON export failures after retries',
  labelNames: ['reason'],
  registers: [register],
});

export const auditExportChecksumMismatchTotal = new Counter({
  name: 'audit_export_checksum_mismatch_total',
  help: 'Exported row entry_hash verification mismatches',
  registers: [register],
});

export const chaosScheduledTestTotal = new Counter({
  name: 'chaos_scheduled_test_total',
  help: 'Scheduled chaos drill runs',
  labelNames: ['scenario'],
  registers: [register],
});

export const treasuryOnchainMismatchTotal = new Counter({
  name: 'treasury_onchain_mismatch_total',
  help: 'Treasury hot wallet on-chain vs recorded mismatch detections',
  labelNames: ['chain_id'],
  registers: [register],
});

export const treasuryTokenMismatchTotal = new Counter({
  name: 'treasury_token_mismatch_total',
  help: 'Treasury ERC-20 hot wallet on-chain vs cache mismatch',
  labelNames: ['chain_id', 'symbol'],
  registers: [register],
});

export const balanceIntegrityMinorMismatchTotal = new Counter({
  name: 'balance_integrity_minor_mismatch_total',
  help: 'Sell-lock delta within tolerance (logged, no freeze)',
  registers: [register],
});
