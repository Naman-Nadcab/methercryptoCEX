# CRITICAL HARDENING — Residual Risk & Failure-Mode Safety Report

**Context:** Production centralized exchange backend. Decimal.js invariants, escrow, settlement, Phase-13/14/15.  
**Objective:** Eliminate or structurally bound residual safety risks (loss of funds, balance drift, double-credit/send, authority inconsistencies, observability blind spots).  
**Scope:** Invariant correctness and failure safety only. No trading/accounting rule or cosmetic changes.

---

## SECTION 1 — Residual Risks Identified

### PART 1 — Withdrawal idempotency & double-send

| Risk | Severity | Description |
|------|----------|-------------|
| **Broadcast retry re-sign** | **CATASTROPHIC** | On broadcast failure, `markQueueFailed` set queue status back to `pending` when `attempts < max`. Next run re-claimed the row, **signed again** (new nonce), and broadcast again. If the first broadcast had actually succeeded (tx mined) but RPC returned error/timeout, the second broadcast could send funds again → **double-send**. |
| **No idempotent broadcast anchor** | High | Once `signed_tx_hex` was persisted (status `broadcast`), retries did not re-use it; they reset to `pending` and re-signed. Broadcast was not mathematically idempotent. |

### PART 2 — Reconcile safety isolation

| Risk | Severity | Description |
|------|----------|-------------|
| **Reconcile without halt** | **CATASTROPHIC** | `reconcileBalanceToLedger()` could run while settlement/trading was active. Concurrent balance mutations (settlement, orders) could be overwritten by reconcile or produce inconsistent state → **balance drift / authority inconsistency**. |
| **No mandatory precondition** | High | No code enforced `trading_halted = true` before reconcile; runbook-only mitigation. |

### PART 3 — Monitoring counter persistence

| Risk | Severity | Description |
|------|----------|-------------|
| **In-memory counters only** | Medium | All monitoring counters were in-process `Map`; reset on restart → **observability drift** across restarts and across instances. Not a funds risk but violates “cluster-consistent observability”. |
| **Read-modify-write** | Low | Counters were simple increment; no RMW in financial logic. |

### PART 4 — Failure-mode validation

| Risk | Severity | Description |
|------|----------|-------------|
| **Fail-open on broadcast** | **CATASTROPHIC** | Resetting to `pending` on broadcast failure created a retry path that could double-send (see Part 1). |
| **Reconcile race** | **CATASTROPHIC** | Reconcile without halt could corrupt or overwrite correct balances (see Part 2). |
| **No safety dependency on counters** | OK | Financial logic does not depend on monitoring counters; no additional loss-of-funds vector from in-memory counters. |

---

## SECTION 2 — Corrections Applied

### PART 1 — Withdrawal idempotency & double-send prevention

1. **Claim both `pending` and `broadcast` (with `signed_tx_hex`)**  
   - `processSigningQueue()` now selects rows where `status = 'pending' OR (status = 'broadcast' AND signed_tx_hex IS NOT NULL)` and `attempts < max_attempts`, with `FOR UPDATE SKIP LOCKED`.  
   - Ensures only one worker processes a given row; `broadcast` rows are retried without re-signing.

2. **Retry broadcast with same signed tx**  
   - If claimed row has `status = 'broadcast'` and `signed_tx_hex` is set, skip signing and use stored `signed_tx_hex`; go straight to `provider.broadcastTransaction(signedTx)`.  
   - Broadcasting is now **idempotent**: same signed tx can be submitted again (chain deduplicates); no second signature → no double-send.

3. **Never set status back to `pending` after broadcast**  
   - On broadcast failure: do **not** call `markQueueFailed` (which previously set status to `pending`).  
   - If `attempts >= max_attempts`: call `markQueueFailed` (final failure, refund).  
   - Else: `UPDATE withdrawal_signing_queue SET status = 'broadcast' WHERE id = $1` and return.  
   - Next run re-claims the same row (still `broadcast`) and retries **broadcast only** with the same `signed_tx_hex`.  
   - Crash/restart does not reset broadcast state; `signed_tx_hex` remains the idempotency anchor.

4. **Stable execution identity**  
   - One queue row per withdrawal; claim with `FOR UPDATE SKIP LOCKED`; status progression `pending → signing → broadcast → completed` (or `failed`). No backward transition to `pending` after `signed_tx_hex` is stored.

### PART 2 — Reconcile safety isolation

1. **Mandatory trading halt**  
   - At the start of `reconcileBalanceToLedger()`, `getTradingHalted()` is called.  
   - If `!halted`, return immediately: `{ ok: false, message: 'Reconcile requires trading to be halted. Set trading_halted=true first.' }`.  
   - No balance or ledger mutation is performed when trading is not halted.

2. **Fail closed**  
   - Reconcile does not run unless the precondition is satisfied; no timing-dependent race with settlement/trading from this path.

### PART 3 — Monitoring counter persistence & consistency

1. **Redis-backed atomic counters**  
   - Each `increment(key)` calls `redis.incr(REDIS_PREFIX + key)` (fire-and-forget).  
   - Keys are `monitoring:*` (e.g. `monitoring:settlement.processed`).  
   - Restart-safe and cluster-consistent across instances.

2. **Redis failure must not break financial logic**  
   - `increment()` never throws. On Redis error, `.catch()` falls back to in-memory `counters.set(...)` and logs a warning.  
   - No financial or safety logic depends on monitoring counters; observability degrades to log + in-memory fallback only.

3. **No safety logic on counters**  
   - Verified: no code uses counter values for balance, settlement, or withdrawal decisions.  
   - No read-modify-write counter logic in critical paths.

4. **getMonitoringCounters**  
   - Now async: reads from Redis (`KEYS monitoring:*`, then `GET` each).  
   - On Redis failure, returns in-memory fallback and logs.  
   - Admin route `/monitoring/counters` updated to `await getMonitoringCounters()`.

### PART 4 — Failure-mode validation (addressed by Sections 2.1–2.3)

- Double-send: eliminated by broadcast idempotency and no reset to `pending`.  
- Reconcile race: eliminated by trading-halt precondition.  
- Counter persistence: Redis-backed with fail-safe fallback; no impact on funds.

---

## SECTION 3 — Invariant & Concurrency Proof

### Withdrawal

- **Single processor per row:** `SELECT ... FOR UPDATE SKIP LOCKED` + `UPDATE status = 'signing'` (and `attempts + 1`) in one transaction. Only one worker can hold a given row.  
- **No double-send:** After `signed_tx_hex` is stored (status `broadcast`), retries only re-broadcast the same tx. Chain treats duplicate broadcast idempotently. Status never reverts to `pending` after broadcast.  
- **Crash after broadcast, before completion:** Row stays `broadcast` or `signing`; no second broadcast (same signed tx on retry). Completion tx either commits (debit + tx_hash) or does not; no double-debit.  
- **Stable execution identity:** Queue row id + `signed_tx_hex` (once set) uniquely identify the broadcast attempt.

### Reconcile

- **Isolation:** Reconcile runs only when `getTradingHalted() === true`. Settlement worker and trading paths check the same halt flag; with halt set, no concurrent balance mutations from those paths.  
- **Fail closed:** If halt check fails (e.g. Redis error), `getTradingHalted()` returns `true` (trading-halt is fail-closed), so reconcile is still blocked when Redis is unhealthy.

### Monitoring

- **Financial logic:** No branch in deposit, withdrawal, settlement, or reconcile uses monitoring counter values.  
- **Redis failure:** Only affects observability (counts); fallback to in-memory + log; no throw, no impact on funds.

---

## SECTION 4 — Remaining Risks (explicitly bounded)

| Risk | Bound | Mitigation |
|------|--------|------------|
| **Wallet reconciliation not scheduled** | Drift detectable only when `runWalletReconciliation` is invoked (e.g. by operator or cron). | Documented in Phase-15. Operator must schedule reconciliation for production; circuit + events fire when run and drift exceeds tolerance. |
| **Crash after broadcast, before completion** | Ledger shows withdrawal still pending; balance not debited; tx may be on-chain. | No double-send (retry re-uses same tx). Drift is one-sided (user received funds; ledger not updated until completion runs). Reconciliation, when run, can detect; operator recovery. |
| **Redis down for monitoring** | Counters fall back to in-memory; restarts lose counts. | Acceptable: observability degradation only; no funds or balance logic depends on counters. |
| **Reconcile uses `balances` table** | If the codebase uses both `balances` and `user_balances`, reconcile only touches the table it was written for. | No change to accounting rules; reconcile remains ledger-authoritative for the balance store it updates. |

**No unbounded catastrophic risks** identified for: double-credit, double-send, balance drift from reconcile race, or fail-open safety mechanisms, under the stated assumptions (multi-instance, crashes, retries, Redis/RPC failures, races).

---

## SECTION 5 — Verdict

**SAFE FOR PRODUCTION WALLET OPERATIONS** under the following conditions:

1. **Withdrawal:** Broadcast is idempotent; duplicate RPC or retries do not double-send. Crash/restart does not reset broadcast state; `signed_tx_hex` is the idempotency anchor.  
2. **Reconcile:** Reconcile does not run unless trading is halted; no concurrent mutation race.  
3. **Monitoring:** Counters are Redis-backed with fail-safe fallback; no safety logic depends on them.  
4. **Remaining risks** are documented and bounded (reconciliation scheduling, post-broadcast crash recovery); no open catastrophic vectors for loss of funds, double-credit, double-send, or authority inconsistency from the hardened paths.

**Operator requirements:**

- Set `trading_halted = true` before running balance reconcile to ledger.  
- Schedule `runWalletReconciliation` for production wallets so drift is detected and circuit/events can fire.

---

*Report generated from critical hardening task. No trading/accounting rules or cosmetic changes.*
