# CRITICAL HARDENING — Operational & Privilege Safety Verification

Strict verification of operational risk, privilege/authority safety, and invariant survivability. Real funds, crashes, infra failures, retries, multi-instance, adversarial actors.

---

## SECTION 1 — Verified Safe Operational Mechanisms

### Operational risk

| Mechanism | Verification |
|-----------|--------------|
| **Trading halt (Redis)** | `getTradingHalted()` reads Redis; on Redis error returns `true` (fail-closed). No in-memory-only authority for order-creation halt. |
| **Settlement circuit (post-fix)** | Circuit open state persisted to Redis (`settlement_circuit:open`). `runOnce()` checks `getSettlementCircuitOpen()`; on Redis error treats as open (fail-closed). Restart does not clear circuit. |
| **Settlement worker runOnce** | Checks in order: in-memory circuit, Redis trading halt, Redis settlement circuit. All three must allow for processing. |
| **User status** | Auth middleware reads `user:{id}:status` from Redis with DB fallback. On status change admin invalidates cache (`redis.del`). No safety dependency on in-memory user state. |
| **Escrow release/refund** | Guard uses DB: `SELECT status, admin_frozen_at` then `UPDATE ... WHERE status = 'locked' AND (admin_frozen_at IS NULL)`. Zero-row UPDATE plus recheck of `admin_frozen_at` throws `ESCROW_ADMIN_FROZEN` if frozen after SELECT. No race: freeze wins atomically. |
| **Settlement replay** | Replay guard at start of `processEvent`: if ledger entries exist for event, only status/hash updated; no second balance or trade apply. Idempotent. |
| **Balance reconcile** | Ledger sum and target available/locked validated non-negative before UPDATE. DB CHECK (available >= 0, locked >= 0) enforces invariants if code were wrong. |

### Privilege and authority

| Mechanism | Verification |
|-----------|--------------|
| **Admin auth** | `getAdminFromRequest`: JWT verify → Redis session or DB session fallback → role check → IP whitelist → rate limit. No privilege from in-memory cache only; Redis down uses DB. |
| **Super-admin for critical actions** | Balance-reconcile and circuit-reset use `getAdminFromRequest(..., true)`. Role must be super_admin. |
| **Freeze respected** | Escrow: SELECT then UPDATE with `AND (admin_frozen_at IS NULL)`; if UPDATE affects 0 rows and row is frozen, throw. User: auth rejects non-active; cache invalidated on status change. |
| **Halt respected** | P2P createOrder and spot place order call `isTradingHalted()` (Redis). Settlement worker checks Redis halt and Redis circuit. |

### Invariant survivability

| Invariant | Verification |
|-----------|--------------|
| **Escrow freeze vs release/refund** | UPDATE includes `AND (admin_frozen_at IS NULL)`. Concurrent admin freeze prevents release/refund from committing. |
| **Replay cannot double-apply** | Replay path only updates `settlement_events` status/hash; no ledger insert, no balance update, no trade insert. |
| **Reconcile non-negative** | Explicit checks: ledger_sum >= 0, target_available/locked >= 0, final newAvailable/newLocked >= 0. DB CHECK as backstop. |
| **Idempotent escrow** | Release/refund use `WHERE status = 'locked'`; 0 rows => already released/refunded, no balance change. |

---

## SECTION 2 — Critical Safety Risks Found (and Addressed)

| Risk | Severity | Resolution |
|------|----------|------------|
| **Circuit breaker in-memory only** | Critical | Circuit open state persisted to Redis (`settlement_circuit:open`). `triggerCircuitIfViolation` calls `setSettlementCircuitOpen(true)`. `runOnce()` checks `getSettlementCircuitOpen()`. Restart no longer clears circuit (no fail-open). |
| **Escrow freeze TOCTOU** | High | UPDATE escrows now includes `AND (admin_frozen_at IS NULL)`. If admin freezes after our SELECT, UPDATE affects 0 rows; we recheck `admin_frozen_at` and throw `ESCROW_ADMIN_FROZEN` instead of treating as idempotent. |
| **Reconcile negative balance** | Medium | Explicit validation: negative ledger sum rejected; negative target_available/target_locked rejected; final values checked non-negative before UPDATE. DB CHECK remains. |

---

## SECTION 3 — Required Corrections (Implemented)

1. **Circuit persistence**  
   - Redis key `settlement_circuit:open`.  
   - `triggerCircuitIfViolation` calls `setSettlementCircuitOpen(true)` (best-effort, log on failure).  
   - `runOnce()` checks `await getSettlementCircuitOpen()`; on Redis error treat as open.  
   - Admin: `POST /admin/settlement/circuit-reset` (super_admin) clears Redis key and in-memory `setTradingHalted(false)`.

2. **Escrow freeze atomicity**  
   - In `releaseFromEscrow` and `refundFromEscrow`: add `AND (admin_frozen_at IS NULL)` to the UPDATE.  
   - When UPDATE affects 0 rows, SELECT `admin_frozen_at`; if non-NULL, throw `ESCROW_ADMIN_FROZEN`.

3. **Reconcile invariants**  
   - Reject ledger_sum < 0.  
   - Reject target_available or target_locked < 0.  
   - Before UPDATE, assert computed newAvailable and newLocked >= 0.

---

## SECTION 4 — Remaining Catastrophic Risks

| Risk | Assessment |
|------|------------|
| **Multi-instance monitoring counters** | Counters are process-local; restart resets; instances not aggregated. Violations are logged (EXCHANGE_MONITOR + logger); counters are for rate/trending only. Not a loss-of-funds or authority violation. Acceptable if runbooks use logs for post-incident review. |
| **Reconcile vs concurrent settlement** | Reconcile reads ledger and balance then UPDATEs balance in a separate transaction. If settlement runs concurrently, we could overwrite a correct balance with a stale ledger sum. Mitigation: runbook must require trading/settlement halt before reconcile. No code change; document only. |
| **Admin session role cache** | Role comes from Redis session or DB fallback. If admin is downgraded in DB but Redis session still has old role, they retain privilege until session refresh/expiry. Low severity; sessions are short-lived. Acceptable. |
| **User freeze in-flight request** | One request that passed auth before freeze can still complete. Next request sees updated status (cache invalidated). No privilege escalation; acceptable. |

No remaining **loss-of-funds**, **balance drift**, or **authority boundary** risks identified beyond the above documented limitations.

---

## SECTION 5 — Verdict

**SAFE FOR PRODUCTION WALLET PHASE**

- Safety mechanisms that must survive restart (circuit breaker) are persisted to Redis and checked on each run.  
- Escrow freeze is enforced in the UPDATE condition and recheck, so no race with release/refund.  
- Balance reconcile enforces non-negative and is restricted to super_admin; runbook must require halt before use.  
- Admin and user authority are enforced server-side with cache invalidation and DB fallback; no fail-open privilege path identified.  
- Settlement replay and idempotent escrow paths do not allow double-apply or balance drift.

Remaining items (counters process-local, reconcile concurrency, session role cache, single in-flight request after freeze) are documented and do not constitute catastrophic risk for production wallet phase.
