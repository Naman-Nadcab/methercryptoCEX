# PHASE-17 — Exchange Performance, Latency & Load Survival Simulation

**Context:** Production centralized exchange. Ledger-authoritative accounting, settlement pipeline, P2P escrow, wallet reconciliation, Redis-backed locks, Decimal.js invariants.  
**Objective:** Extreme load and contention failure analysis. No refactor, no micro-optimizations, no stylistic changes. Catastrophic stability and safety under load only.  
**Assumptions:** Burst traffic, sustained high concurrency, DB contention, lock conflicts, queue backlog, slow RPC/Redis, partial infrastructure degradation.

---

## SECTION 1 — Load & Contention Scenarios Evaluated

### PART 1 — Database contention & locking

| Scenario | Evaluation |
|----------|------------|
| **Thousands of concurrent order placements** | Spot order placement: Redis lock `order:lock:${userId}` (5s TTL, 3 retries, 100ms delay); then single `db.transaction` with balance lock and order insert. Per-user serialization; different users do not block each other. Lock miss → "Unable to process order" (no silent failure). **Risk:** Under burst, many users each hold Redis lock + one DB client; pool can be exhausted (bounded by pool max). No deadlock: order path locks one user's balance row(s) in one tx; settlement path locks (taker_base, taker_quote, maker_base, maker_quote) in **sorted** order. Lock ordering is deterministic. |
| **Concurrent balance mutations** | Settlement: one event at a time per worker (`FOR UPDATE SKIP LOCKED LIMIT 1`), then locks up to 4 balance rows in **(user_id, asset)** sorted order. Other balance mutations (withdrawal, P2P, spot) lock by (user_id, asset) or by order/escrow row first. No evidence of circular wait: settlement always takes same global order (uniquePairs sorted); single-user operations take one user's rows. **Risk:** Under high concurrency, lock wait time can grow; no design that amplifies deadlocks. |
| **Settlement + trading + reconciliation overlap** | Settlement worker: 1s interval, one event per tick; uses `getSettlementClient()` (pool.connect()). Reconciliation: 5 min interval, Redis lock (1 attempt, 0 delay); on success holds one client per chain in sequence (releases after each `runWalletReconciliation`). Trading (order/cancel) uses `db.transaction`. All share the same pool. **Risk:** Pool exhaustion under sustained load; settlement and reconciliation do not take the same rows (settlement = balances + settlement_events; reconciliation = read-only snapshot insert + getLiveBalanceReadOnly RPC). No lock conflict between reconciliation and settlement (reconciliation does not FOR UPDATE balances). |
| **Long-running transactions** | Settlement processEvent is one long tx (ledger insert + balance locks + updates + status). If slow, it holds one connection and 4 balance rows. Other requests needing those rows block until timeout or tx end. **Risk:** Latency cascade (blocked requests); no fail-open or balance mutation under timeout—either tx commits or rolls back. |

### PART 2 — Queue & backlog stress

| Scenario | Evaluation |
|----------|------------|
| **Withdrawal spikes** | One row per withdrawal; queue processed one item per `processSigningQueue()` (FOR UPDATE SKIP LOCKED LIMIT 1). Rate limit 2s per chain (RATE_LIMIT_MS_PER_CHAIN). Backlog grows with enqueue rate; processing is bounded (one at a time, then next tick). **Risk:** Backlog is bounded by enqueue rate and processing rate; no duplicate processing (claim is atomic); no reordering (ORDER BY created_at ASC). No infinite retry: `attempts >= max_attempts` → mark failed and refund. |
| **Deposit spikes** | Deposits inserted by indexer with ON CONFLICT DO NOTHING; credit by backend/indexer one row at a time (atomic credit per deposit). Repair paths (`creditOverdueDepositsForUser`) loop over overdue list—list size bounded by DB (no LIMIT in query, so one user with huge overdue list could cause long loop). **Risk:** Latency spike for that user/request, not unbounded memory (each iteration one tx). |
| **Settlement worker lag** | Match poller inserts into `settlement_events`; worker consumes one event per 1s tick. If insert rate > 1/tick, backlog grows. Events are processed in id order (ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED). **Risk:** Backlog bounded by insert rate; no duplicate processing (replay detected by existing ledger); no reordering hazard. After MAX_RETRIES (10) event is marked failed and not retried. |
| **Reconciliation lag** | One cycle per 5 min; lock TTL 4 min. If cycle runs long (many chains + slow RPC), lock expires and another instance can run next cycle. No queue of reconciliation "jobs"—just periodic run. **Risk:** No unbounded backlog; at most one run per instance per interval. |
| **Retry storms** | Settlement: retry_count incremented on error; at 10 events marked failed. Withdrawal queue: attempts incremented; at max_attempts marked failed and refunded. No unbounded retry loop. |

### PART 3 — Redis / lock / cache latency

| Scenario | Evaluation |
|----------|------------|
| **Redis latency spikes** | Trading halt and circuit: `getTradingHalted()` / `getSettlementCircuitOpen()` await redis.get(); on throw return true (halted / circuit open). So slow Redis → slow response → no safety inversion. Reconciliation lock: acquireLock with 1 try, 0 delay; slow Redis → slow acquire → null on miss → skip cycle (fail closed). Order lock: 3 retries, 100ms delay; slow Redis → order fails after 3 attempts. Withdrawal idempotency: redis.getJson/setNxEx; on timeout/error request can fail or throw → fail closed. |
| **Lock acquisition delays** | acquireLock retries at most 3 times (or 1 for reconciliation). No busy-wait forever. After retries, returns null and caller skips or fails request. |
| **Temporary Redis unavailability** | Same as above: halt/circuit treat as true; lock miss → skip or fail. No trading/settlement when Redis is down (getTradingHalted/getSettlementCircuitOpen throw → return true). |

### PART 4 — Latency cascade & timeout chaos

| Scenario | Evaluation |
|----------|------------|
| **Slow DB responses** | Pool has max connections; when exhausted, new requests block on connect or fail. Long-running tx (e.g. settlement) holds one client; others wait. No retry amplification: settlement does not retry on success; on error it rolls back and increments retry_count (bounded by MAX_RETRIES). |
| **Slow RPC responses** | getLiveBalanceReadOnly has 15s timeout; returns null on timeout. Reconciliation skips that chain (no snapshot with stale/cache). Withdrawal broadcast: no timeout around provider.broadcastTransaction; could hang until TCP/application timeout. **Risk:** One withdrawal could block the signing loop until timeout; other queue items wait. Not a safety inversion—no double-send or balance mutation from timeout. |
| **Slow Redis responses** | As in Part 3; fail closed. Rate limiter uses Redis; slow Redis → slow rate limit check → request latency increase; no bypass of rate limit by design. |
| **Partial timeouts** | DB transaction timeout (if configured at pool or PG level) would rollback tx; no partial commit. No evidence of double-apply from partial timeout in settlement (one tx for ledger + balances + status). |

### PART 5 — High-frequency user behavior

| Scenario | Evaluation |
|----------|------------|
| **Rapid order placement/cancel** | Spot: rate limit 30 orders/60s per user; cancel 60/60s. Redis rateLimit used. Under burst, excess requests get 429. Order lock is per user (order:lock:${userId}); rapid same-user orders serialize; no lock thrashing across users. |
| **Rapid P2P order creation/cancel** | P2P rate limiters applied; Redis lock per ad/order for state transitions. FOR UPDATE on p2p_orders/p2p_ads; one tx per operation. |
| **Rapid withdrawals** | Withdrawal rate limit 5/3600 per user. Idempotency key + Redis lock (setNxEx) prevent duplicate submission. Queue processes one at a time; rapid submissions enqueue and wait. |
| **Adversarial timing** | Rate limits and idempotency keys limit blast radius. No identified invariant bypass from timing (e.g. double-spend requires two successful debits; debit is in one tx with status update). |

### PART 6 — Resource exhaustion & degraded state

| Scenario | Evaluation |
|----------|------------|
| **CPU pressure** | No infinite loops identified. Workers use setInterval (fixed period); no spin. Under CPU pressure, tick may run late; backlog grows but processing remains one-at-a-time and bounded. |
| **Memory pressure** | Settlement loads one event payload; reconciliation loads hot wallet list (bounded by number of chains). No unbounded accumulation of in-memory queue in code paths reviewed. |
| **Worker lag** | Settlement worker lag → events accumulate; processed in order. No skip or reorder that could cause double-apply or wrong order. Reconciliation lag → next cycle runs when lock available; no state corruption. |
| **Partial service slowdown** | Slow DB → pool exhaustion → new requests block or fail. Slow Redis → halt/circuit treated as on; lock miss → skip/fail. No fail-open: we do not proceed with "assume false" when we cannot read halt/circuit. |

---

## SECTION 2 — Stability Mechanisms That Hold

| Mechanism | Holds under load |
|-----------|-------------------|
| **Settlement lock order** | Balance rows locked in (user_id, asset) sorted order; one event per worker; FOR UPDATE SKIP LOCKED so different workers take different events. |
| **Retry bounds** | Settlement MAX_RETRIES=10; withdrawal queue attempts < max_attempts; no unbounded retry. |
| **Redis lock retries** | acquireLock retryCount 1 (reconciliation) or 3 (order, P2P); then return null; no spin forever. |
| **Rate limits** | Spot order/cancel, withdrawal, auth, P2P use Redis-based rate limit; excess → 429. |
| **Idempotency** | Withdrawal idempotency key + cache; duplicate key returns cached response or 409. |
| **Queue processing** | One item per tick (settlement, withdrawal); ORDER BY created_at/id ASC; FOR UPDATE SKIP LOCKED. |
| **Reconciliation** | Single attempt lock; no lock → skip cycle; no balance mutation. |

---

## SECTION 3 — Catastrophic Performance Risks Identified

| Risk | Severity | Notes |
|------|----------|--------|
| **Pool exhaustion under burst** | **Medium** | All DB access shares one pool (poolMax). Many concurrent transactions (orders, withdrawals, settlement, reconciliation) can exhaust connections; new requests block on connect or fail. **Stability:** Latency spike or 5xx; no fund safety impact (no mutation without connection). Bounded by pool size. |
| **Withdrawal broadcast hang** | **Medium** | provider.broadcastTransaction() has no application-level timeout. Slow or stuck RPC can block the signing loop for one item until TCP/library timeout. **Stability:** Other queue items wait; no double-send or balance corruption. |
| **Large overdue deposit list** | **Low** | creditOverdueDepositsForUser selects all overdue for user (no LIMIT). User with thousands of overdue deposits could cause long-running request (many sequential tx). **Stability:** Request latency; no unbounded memory; each credit is one tx. |
| **Match poller burst** | **Low** | Poller fetches events and inserts in a loop; no batching limit in code. Very large fetch could insert many rows in one go. **Stability:** Bounded by engine response size; worker still processes one event per tick. |

**No catastrophic risk identified** that causes systemic stall (e.g. deadlock), unbounded backlog (infinite growth), or fund safety impact (double-apply, mutation under degraded authority). Identified risks are latency/exhaustion under extreme load, with bounded impact.

---

## SECTION 4 — Required Corrections ONLY (if any)

**None.** No change is required for catastrophic stability or safety under load:

- Lock ordering is deterministic; retries and queue processing are bounded.
- Redis and DB failure modes are fail closed; no safety mechanism inversion.
- Backlog growth is bounded by input rate and processing rate; no infinite retry or unbounded memory growth identified.

Optional hardening (out of scope): application-level timeout around withdrawal broadcast to avoid long block of the signing loop; and LIMIT on overdue deposit repair query to cap per-request work.

---

## SECTION 5 — Unbounded Backlog / Stall / Drift Vectors

| Vector | Unbounded? | Notes |
|--------|------------|--------|
| **Settlement event backlog** | No | Grows if insert rate > 1/tick; processed in order; no drop or reorder. Bounded by insert rate and time. |
| **Withdrawal queue backlog** | No | Grows with enqueue rate; processed one per run; rate limit 2s/chain. Bounded. |
| **Deadlock** | No | Lock order is deterministic; FOR UPDATE SKIP LOCKED avoids head-of-line blocking between workers. |
| **Lock starvation** | No | Redis lock: limited retries then null. DB: SKIP LOCKED so other rows can progress. |
| **Reconciliation drift** | No | Uses live RPC; skip on failure. No backlog of "reconciliation jobs"; periodic run only. |
| **Memory/CPU runaway** | No | No unbounded in-memory queue or infinite loop in evaluated paths. |

**Unbounded backlog / stall / drift vectors: NONE** identified. All backlogs are rate- and time-bounded; stalls are due to resource exhaustion (pool, Redis) and fail closed.

---

## SECTION 6 — Verdict

**SAFE UNDER EXTREME LOAD CONDITIONS** with the following understanding:

1. **DB contention:** Lock order is deterministic; no deadlock amplification. Pool exhaustion under burst can cause latency or failure but not fund corruption or unsafe state transition.
2. **Queue & backlog:** Processing is one-at-a-time and bounded; retries are capped; no duplicate processing or reordering hazard.
3. **Redis/lock/cache:** Fail closed on error or lock miss; no blocking loops (limited retries); no safety inversion under latency or unavailability.
4. **Latency cascade:** No design that amplifies retries into unbounded load; timeouts and retry caps bound impact. Withdrawal broadcast can block one worker until RPC timeout without causing double-send or balance error.
5. **High-frequency behavior:** Rate limits and per-user locking constrain throughput; no identified invariant bypass from timing.
6. **Resource exhaustion:** Degraded state leads to pool/Redis exhaustion and request failure or skip; no fail-open or balance mutation under degraded authority.

**Conditions:** Pool size and Redis capacity must be sized for expected concurrency; under sustained load beyond that, the system degrades (latency, 429, 5xx) rather than corrupting state. No catastrophic systemic risk identified from load or contention alone.

---

*Report: adversarial, strict, paranoid. No style or perf tuning. Exchange-scale traffic assumed. Catastrophic systemic risks only.*
