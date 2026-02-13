# PHASE-13 — Exchange Monitoring, Detection & Forensics

Production-grade observability and anomaly detection. No changes to trading or balance logic; instrumentation only.

---

## SECTION 1 — Metrics & Signals to Capture

### Part 1 — Balance & invariant monitoring

| Signal | Source | Payload |
|--------|--------|---------|
| `invariant_violation` | `lib/monetary-invariants.ts` (after assert failure, before throw) | `label`, `reason`, optional `debit`, `available`, `locked` |
| Counter key | `invariant_violation.{reason}` | e.g. `debit_exceeds_locked`, `debit_exceeds_available`, `negative`, `not_finite`, `invalid_decimal`, `unlock_exceeds_locked` |

**Hook:** Each `assertNonNegative`, `assertValidDecimal`, `assertDebitNotExceedLocked`, `assertUnlockNotExceedLocked`, `assertDebitNotExceedAvailable` calls `recordInvariantViolation(...)` immediately after `logger.error` and before `throw`.

### Part 2 — Escrow & P2P monitoring

| Signal | Source | Payload |
|--------|--------|---------|
| `escrow_event` | `p2p-escrow.service.ts` | `type`: `move_to_escrow`, `release`, `refund`, `release_idempotent`, `refund_idempotent`; `userId`/`sellerId`, `escrowId`, `amount` |
| Counter keys | `escrow.move_to_escrow`, `escrow.release`, `escrow.refund`, `escrow.release_idempotent`, `escrow.refund_idempotent` | — |
| `abuse_event` | `abuse-resilience.service.ts` (on cap/velocity throw) | `type`: `velocity_exceeded`, `escrow_cap_count_exceeded`, `escrow_cap_total_exceeded`; `userId`, `count`/`total`, `limit` |
| Counter keys | `abuse.velocity_exceeded`, `abuse.escrow_cap_count_exceeded`, `abuse.escrow_cap_total_exceeded` | — |

**Hooks:**  
- After `moveToEscrow` insert; after `releaseFromEscrow` / `refundFromEscrow` (both idempotent and non-idempotent branches).  
- Before `throw` in `assertP2PEscrowCapInTransaction`, `assertP2PEscrowCap`, `assertP2POrderVelocityInTransaction`, `assertP2POrderVelocity`.

### Part 3 — Settlement & ledger monitoring

| Signal | Source | Payload |
|--------|--------|---------|
| `settlement_event` | `settlement-worker.ts`, `global-balance-auditor.ts` | `type`: `replay_detected`, `failure_fatal`, `failure_retry`, `failure_max_retries`, `balance_ledger_divergence`; `settlementEventId`, `engineEventId`, `error`, `retryCount`, `userId`, `asset`, `balancesTotal`, `ledgerSum` |
| Counter keys | `settlement.replay_detected`, `settlement.failure_fatal`, `settlement.failure_retry`, `settlement.failure_max_retries`, `settlement.balance_ledger_divergence` | — |

**Hooks:**  
- Start of `processEvent`: when existing ledger entries exist for event → `recordSettlementEvent({ type: 'replay_detected', ... })`.  
- Catch block in `runOnce`: `failure_fatal` when event marked failed; `failure_retry` when retry_count incremented; `failure_max_retries` when retry_count >= MAX_RETRIES.  
- `global-balance-auditor`: on balance ≠ ledger sum → `recordSettlementEvent({ type: 'balance_ledger_divergence', ... })`.

### Part 4 — Risk engine observability

| Signal | Source | Payload |
|--------|--------|---------|
| `risk_decision` | `risk-engine.service.ts` (inside `logRiskEvent` after DB insert) | `scope`, `decision` (allow/challenge/block), `score`, `actorId`, `requestId` |
| Counter keys | `risk.{scope}.allow`, `risk.{scope}.challenge`, `risk.{scope}.block` | e.g. `risk.p2p.block`, `risk.withdrawal.challenge` |

**Hook:** After successful insert into `security_risk_events`, call `recordRiskDecision(...)`.

### Part 5 — Abuse & velocity visibility

Captured via Part 2 `abuse_event` and counter keys `abuse.velocity_exceeded`, `abuse.escrow_cap_count_exceeded`, `abuse.escrow_cap_total_exceeded`. No additional signals; repeated near-threshold behavior can be inferred from time-series of these counters or from `security_risk_events` (risk engine already logs P2P velocity/escrow signals).

### Part 6 — Operational safety signals

| Signal | Source | Payload |
|--------|--------|---------|
| `operational_event` | `trading-halt.ts`, `settlement-circuit.ts`, `settlement-worker.ts` | `type`: `halt_toggle`, `halt_redis_error`, `settlement_worker_start`, `settlement_worker_stop`, `settlement_worker_error`, `circuit_open`; `halted`, `error`, `violation` |
| Counter keys | `operational.halt_toggle`, `operational.halt_redis_error`, `operational.settlement_worker_start`, `operational.settlement_worker_stop`, `operational.settlement_worker_error`, `operational.circuit_open` | — |

**Hooks:**  
- `setTradingHalt`: after set/del Redis → `recordOperationalEvent({ type: 'halt_toggle', halted })`.  
- `getTradingHalted` catch → `recordOperationalEvent({ type: 'halt_redis_error' })`.  
- `triggerCircuitIfViolation`: when error is in `CIRCUIT_OPEN_ERRORS` → `recordOperationalEvent({ type: 'circuit_open', violation: errMsg })`.  
- `startSettlementWorker` / `stopSettlementWorker` → `settlement_worker_start` / `settlement_worker_stop`.  
- `runOnce` catch (before rethrow) → `settlement_worker_error` with error message.

---

## SECTION 2 — High-Severity Alert Conditions

Alert immediately (P1) on any of the following. No rate limiting on alerts for these.

| Condition | Detection | Action |
|-----------|-----------|--------|
| **Any invariant violation** | `invariant_violation` event or counter `invariant_violation.*` > 0 | Page; stop further trading if repeated; investigate debit/available/locked context. |
| **Balance–ledger divergence** | `settlement_event` with `type: balance_ledger_divergence` or counter `settlement.balance_ledger_divergence` > 0 | Page; circuit already opened by auditor; investigate user_id/asset and ledger vs balances. |
| **Settlement circuit open** | `operational_event` with `type: circuit_open` or counter `operational.circuit_open` > 0 | Page; trading/settlement already halted in-process; verify cause (hash mismatch, ledger violation, etc.). |
| **Settlement fatal failure** | Counter `settlement.failure_fatal` > 0 | Alert; event marked failed; check last_error and engine consistency. |
| **Settlement replay detected** | Counter `settlement.replay_detected` > 0 | Investigate; indicates prior crash after apply; confirm no double-apply (replay path does not re-apply). |
| **Redis halt check failure** | Counter `operational.halt_redis_error` > 0 | Alert; getTradingHalted failed (fail-closed so trading treated as halted); fix Redis. |
| **Settlement worker crash** | Counter `operational.settlement_worker_error` > 0 | Alert; runOnce threw; worker may have stopped or next tick may continue; check process and DB. |

**High-severity (P2) — review same day:**

| Condition | Detection | Action |
|-----------|-----------|--------|
| **Escrow or velocity cap exceeded** | `abuse.velocity_exceeded` or `abuse.escrow_cap_*` spike | Review user behavior; may be abuse or legitimate high volume. |
| **Risk block/challenge spike** | `risk.{scope}.block` or `risk.{scope}.challenge` spike by scope | Review rules and signals; adjust if needed. |
| **Settlement max retries** | `settlement.failure_max_retries` > 0 | Event permanently failed; investigate payload and engine state. |

---

## SECTION 3 — Monitoring / Dashboard Surfaces

| Surface | Content | Source |
|---------|---------|--------|
| **Structured logs** | All events logged with category `EXCHANGE_MONITOR` and `event` + payload. | `logger.info(LOG_CATEGORY, { event, ...payload })` in `exchange-monitoring.service.ts`. |
| **In-memory counters** | Key-value counts since process start (reset on restart). | `getMonitoringCounters()` from `exchange-monitoring.service.ts`. |
| **Admin API** | `GET /admin/monitoring/counters` (admin auth required). Returns `{ success: true, data: { "invariant_violation.debit_exceeds_locked": 0, "escrow.release": 1, ... } }`. | `routes/admin.fastify.ts`. |
| **Existing risk/audit** | `security_risk_events` (risk decisions), `audit_logs_immutable` (high-risk and critical ops). | No change; use for risk distribution and block/challenge/allow ratios. |

**Dashboard recommendations:**

- **Safety overview:** Counters for `invariant_violation.*`, `settlement.balance_ledger_divergence`, `settlement.failure_fatal`, `operational.circuit_open`, `operational.halt_redis_error`, `operational.settlement_worker_error`.  
- **Escrow/P2P:** Counters for `escrow.*`, `abuse.velocity_exceeded`, `abuse.escrow_cap_*`.  
- **Settlement:** `settlement.replay_detected`, `settlement.failure_retry`, `settlement.failure_max_retries`.  
- **Risk:** Time-series or histograms of `risk.{scope}.allow` / `.challenge` / `.block` (from counters or from `security_risk_events`).  
- **Operational:** `operational.halt_toggle`, `operational.settlement_worker_start` / `settlement_worker_stop`, `operational.circuit_open`.

Export of counters to Prometheus/Datadog: scrape `GET /admin/monitoring/counters` and map keys to gauge metrics, or parse `EXCHANGE_MONITOR` log lines and increment metrics by event type.

---

## SECTION 4 — Drift / Corruption Detection Strategy

| Risk | Detection | Mitigation |
|------|-----------|------------|
| **Negative or debit > available/locked** | Invariant asserts throw and `recordInvariantViolation` fires; no silent mutation. | Alert on any invariant event; no auto-repair. |
| **Balance vs ledger drift** | `runGlobalBalanceAudit()` compares `balances` to sum of `settlement_ledger_entries`; on mismatch logs CRITICAL and calls `recordSettlementEvent({ type: 'balance_ledger_divergence' })` and `triggerCircuitIfViolation('GLOBAL_BALANCE_INVARIANT_VIOLATION')`. | Run auditor on a schedule; alert on divergence; investigate; do not auto-repair. |
| **Settlement double-apply** | Replay path in `processEvent` detects existing ledger entries and only marks event processed; counter `settlement.replay_detected` increments. | Alert on replay_detected; confirm replay path did not re-apply balances; monitor for anomalous replay rate. |
| **Settlement hash mismatch / ledger chain violation** | Fatal error; event marked failed; circuit may open; `settlement.failure_fatal` and optionally `operational.circuit_open` recorded. | Alert; do not retry same payload without investigation. |
| **Escrow double-release/refund** | Idempotent escrow updates (status guard); `release_idempotent` / `refund_idempotent` events record when no balance move occurred. | Monitor ratio of idempotent to non-idempotent; spike may indicate retries or replay. |

Strategy: **Detect and alert; do not auto-correct.** All monetary mutations remain behind existing transactions and invariants; monitoring only observes and counts.

---

## SECTION 5 — Incident Response Hooks

| Hook | When | Use |
|------|------|-----|
| **Invariant violation** | Any `recordInvariantViolation` | Trigger runbook: capture context (label, reason, debit/available/locked); check recent deployments and balance mutations; consider halt. |
| **Balance–ledger divergence** | `recordSettlementEvent({ type: 'balance_ledger_divergence' })` | Circuit already opened by auditor; runbook: isolate user/asset; compare ledger history vs balance table; no automatic repair. |
| **Circuit open** | `recordOperationalEvent({ type: 'circuit_open', violation })` | Settlement already halted in-process; runbook: identify violation type; fix cause; then clear circuit and resume only after verification. |
| **Halt toggle** | `recordOperationalEvent({ type: 'halt_toggle', halted })` | Audit trail of who/what set halt (from existing admin audit); confirm intended. |
| **Halt Redis error** | `recordOperationalEvent({ type: 'halt_redis_error' })` | Runbook: check Redis; getTradingHalted is fail-closed (returns true), so trading is halted until Redis is back. |
| **Settlement worker error** | `recordOperationalEvent({ type: 'settlement_worker_error', error })` | Runbook: check DB and process; worker may continue on next tick or may need restart. |
| **Settlement fatal / max retries** | `recordSettlementEvent` failure_fatal or failure_max_retries | Runbook: inspect event payload and last_error; resolve engine/state inconsistency before retrying or re-ingesting. |

Integration: Consume `EXCHANGE_MONITOR` log stream or poll `GET /admin/monitoring/counters`; map event types and counter names to P1/P2 runbooks and alerting channels.

---

## SECTION 6 — Remaining Blind Spots

| Blind spot | Reason | Mitigation |
|------------|--------|------------|
| **Spot balance mutations outside settlement** | Lock/unlock in matching-engine or wallet service may not all go through the same invariant recording if they don’t hit monetary-invariants (e.g. only DB constraints). | Ensure all balance-debit paths use `assertDebitNotExceedAvailable` / `assertDebitNotExceedLocked` or equivalent; add recording there if any path was missed. |
| **Withdrawal/deposit balance moves** | Monitoring hooks added for P2P escrow, settlement, and shared invariant layer; withdrawal and deposit flows may log elsewhere without EXCHANGE_MONITOR. | Add `recordInvariantViolation` or dedicated withdrawal/deposit event recording at withdrawal/deposit mutation boundaries if required for full coverage. |
| **Near-cap / near-velocity (no throw)** | We record only when caps are exceeded (throw). Users just under cap are not recorded. | Optional: periodic or sampled read of escrow count/total and order velocity; record `near_escrow_cap` / `near_velocity_threshold` for trend detection. |
| **Risk score distribution over time** | Counters give block/challenge/allow counts per scope; score histogram requires querying `security_risk_events`. | Dashboard can query DB for score distribution and sudden shifts; not in-process counters. |
| **Stale or long-lived escrows** | No dedicated metric for escrow age or time-in-locked. | Optional: scheduled job to compute max/avg age of locked escrows and record or alert if above threshold. |
| **Multi-instance counters** | Counters are in-process; multi-instance deployments have separate counts. | Aggregate via log aggregation (EXCHANGE_MONITOR) or scrape all instances’ `/admin/monitoring/counters` and sum by key. |

---

## Implementation summary

- **`services/exchange-monitoring.service.ts`:** Central recording API and in-memory counters; all events logged with category `EXCHANGE_MONITOR`.  
- **Hooks:** Invariant (monetary-invariants), escrow (p2p-escrow), abuse (abuse-resilience), settlement (settlement-worker, global-balance-auditor), circuit (settlement-circuit), risk (risk-engine logRiskEvent), operational (trading-halt, settlement worker start/stop/error).  
- **Admin:** `GET /admin/monitoring/counters` returns current counters for dashboards and alerting.

No trading logic, balance logic, or core service behavior was changed; only observability was added.
