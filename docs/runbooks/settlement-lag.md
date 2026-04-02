# Runbook: Settlement lag above threshold

**Symptoms:** `settlement_lag_seconds` or `settlement_pending_count` high; Alertmanager fires `SettlementLagSecondsHigh` or `SettlementPendingCountHigh`; SLO endpoint may show degraded settlement.

## Principles

- **Do not silently “fix” user balances** from dashboards. Use existing admin/operator flows with audit trails only after root cause is understood.
- Scale consumers and fix bottlenecks before tuning thresholds to hide the problem.

## Steps

1. **Confirm scope**  
   Check `/metrics` for `settlement_pending_count`, `settlement_lag_seconds`, `settlement_match_stream_lag_sequences`, and per-partition lag if exposed.

2. **Check workers**  
   Ensure settlement worker processes are running and not crash-looping. Inspect logs for DB errors, NATS/JetStream consumer stalls, or poison messages.

3. **Check downstream**  
   Database connection pool saturation, slow queries on settlement tables, and NATS stream backlog (`pending`, `consumer lag`).

4. **DLQ**  
   If `settlement_match_stream_dlq_published_total` increases, treat as critical: inspect payloads, fix code/config, then replay per internal procedures (never replay blindly).

5. **Scale**  
   Increase `MATCH_EVENTS` partition consumer capacity or worker count; verify idempotency so duplicates do not double-apply.

6. **Communicate**  
   If user-visible delays exceed SLA, use status page / incident channel; consider controlled trading halt only per policy.

7. **Post-incident**  
   Capture lag timeline, root cause, and whether Tier-1 reconciliation (`tier1_*` metrics) stayed green after recovery.
