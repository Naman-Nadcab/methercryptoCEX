# Critical Hardening — Exchange Consistency & Abuse Resilience

Production crypto exchange; real funds under adversarial conditions and distributed failures. Failure-mode, race-condition, and bypass analysis only. No style/refactor suggestions.

---

# PART 1 — VELOCITY WINDOW INTEGRITY

## SECTION 1 — Velocity Integrity Risks

| Risk | Location | Severity |
|------|----------|----------|
| **P2P order velocity TOCTOU** | `assertP2POrderVelocity(userId)` was called outside the order-creation transaction using `db.query`. Two concurrent createOrder calls for the same user could both read count=19, both pass, both insert → 21 orders in window. | **HIGH** |
| **Rate limit fail-open on Redis error** | `rate-limit-fastify.ts` `checkLimit()`: on catch returns `{ allowed: true }`. Under Redis failure, all rate-limited requests are allowed. Availability vs strict enforcement trade-off. | **MEDIUM** (documented) |
| **No client timestamps in velocity** | All velocity/rate logic uses server time (Date.now(), NOW(), Redis time). No client-supplied timestamps in limits. | **OK** |

**Redis rate limit (redis.rateLimit):** Uses MULTI with zremrangebyscore, zadd(now, member), zcard, expire. Add-then-count: count includes current request. MULTI/EXEC is atomic; no read-then-write race. **OK.**

**incrementWithLimit (OTP):** Lua script INCR → EXPIRE if first → DECR and fail if over limit. Atomic. **OK.**

**Withdrawal/AML velocity:** DB COUNT over withdrawals in window; used for risk scoring, not a hard gate in a single transaction. **OK for signal.**

---

## SECTION 2 — Concurrency Attack Analysis

- **P2P velocity:** Concurrent requests same user: both read count, both pass, both write → limit bypass. **Fixed** by moving velocity check inside transaction after `SELECT id FROM users WHERE id = $userId FOR UPDATE`, so order creation for that user is serialized and count is stable before insert.
- **Replay/retry:** Redis rate limit adds a new member per request; replay adds another member and can hit limit. No reset by replay. **OK.**
- **Counters:** Redis ZCARD and Lua INCR are atomic; no corrupt counters from concurrent updates.

---

## SECTION 3 — Corrections Applied

1. **P2P order velocity concurrency-safe**
   - Added `assertP2POrderVelocityInTransaction(userId, client)` in `abuse-resilience.service.ts`. Caller must hold lock on user row in same transaction.
   - In `p2p.service` createOrder: inside the transaction, after determining buyer/seller, run `SELECT id FROM users WHERE id = $1 FOR UPDATE` for the order creator (`userId`), then `assertP2POrderVelocityInTransaction(userId, client)`, then escrow cap, then moveToEscrow and order insert.
   - Removed the external `assertP2POrderVelocity(userId)` call from the enforcement path. Velocity is now evaluated against transactionally locked state; concurrent requests for same user block on the user row and see the updated count after commit.

---

## SECTION 4 — Remaining Risks (Velocity)

| Risk | Status |
|------|--------|
| Velocity bypass under concurrency | **NONE.** P2P velocity enforced inside tx with user row lock. |
| Non-atomic counter updates | **NONE.** Redis rate limit and INCR script are atomic. |
| Window reset vulnerability | **NONE.** Windows are server-side (Redis TTL, DB interval); no client-controlled reset. |
| Rate limit fail-open when Redis down | **ACCEPTED.** Documented trade-off; changing to fail-closed would allow Redis outage to block all rate-limited traffic. Not changed. |

---

# PART 2 — TRADING HALT CACHE CONSISTENCY

## SECTION 1 — Halt Consistency Risks

| Risk | Status |
|------|--------|
| **Redis failure** | `getTradingHalted()` catch block returns `true` (halted). Fail-closed. **OK.** |
| **Stale/local cache** | No in-memory or process-local cache of halt state. Every check calls `redis.get(HALT_KEY)`. **OK.** |
| **Race set/unset vs request** | Each request does a fresh read. Admin sets halt; next request sees new value. No lock required for read. **OK.** |
| **Key not set** | `redis.get` returns null; `v === '1'` and `String(v).toLowerCase() === 'true'` are false → return false (not halted). So default when key missing = trading allowed. Intended. |

---

## SECTION 2 — Failure Mode Simulation

| Scenario | Behavior |
|----------|----------|
| **Redis timeout** | get() throws → catch → return true (halted). **Fail-closed.** |
| **Redis partial failure** | get() may throw or hang; on throw, fail-closed. On success, return value from Redis. |
| **Network partition** | Backend cannot reach Redis → get() throws → return true (halted). **Fail-closed.** |
| **Process restart** | No local state; first request after restart calls Redis. No stale halt in process. **OK.** |
| **Redis returns stale value after partition** | No TTL on halt key; value is authoritative until overwritten. After partition heals, next set by admin updates. Read-your-writes not required for halt. **OK.** |

---

## SECTION 3 — Corrections Applied

- No code change. Halt logic already: (1) fail-closed on Redis error, (2) no local caching, (3) single key, (4) every check hits Redis.

---

## SECTION 4 — Remaining Risks (Halt)

| Risk | Status |
|------|--------|
| Trading while halted due to Redis/stale/cache | **NONE.** Fail-closed on error; no cache. |
| Unsafe fallback | **NONE.** Fallback is “halted” on error. |
| Stale halt read | **NONE.** No caching; each check is a fresh read. |

---

# PART 3 — SELF-TRADE EDGE CASE HARDENING

## SECTION 1 — Self-Trade Edge Cases Found

| Edge case | Location | Mitigation |
|-----------|----------|------------|
| **Same user, different UUID string form** | Engine might send taker_user_id and maker_user_id as same logical user but with different formatting (e.g. with/without dashes, case). Strict `===` could miss. | **Fixed:** Normalize both with `String(s).toLowerCase().replace(/-/g, '')` before equality check. |
| **Subaccounts / shared identity** | No subaccount model in scope; one user id per account. | **NONE** if no subaccounts. |
| **Balance mutation after rejection** | If self-trade check passed but later logic failed, could we have partial balance update? | **No.** Rejection throws before any balance UPDATE; transaction rolls back. |

---

## SECTION 2 — Exploit Scenarios

- **Engine sends same id in two formats:** Without normalization, backend could treat as different users and apply balance changes (self-trade). **Fixed** by normalized comparison.
- **Duplicate events:** Settlement idempotency is separate (event status processed at end); self-trade rejection does not insert trades or update balances, so no double-apply from duplicate event.
- **Race match vs cancel:** Self-trade check is per event; no cross-event race that would allow a self-trade to be applied.

---

## SECTION 3 — Corrections Applied

1. **Settlement worker**  
   Before comparing taker and maker, normalize IDs: `const norm = (s: string) => String(s).toLowerCase().replace(/-/g, '');` then `if (norm(takerId) === norm(makerId)) throw new Error('SELF_TRADE_REJECTED');`. Original `takerId`/`makerId` still used for all DB writes (balances, ledger). No balance mutation after rejection; throw is before any balance UPDATE.

---

## SECTION 4 — Remaining Risks (Self-Trade)

| Risk | Status |
|------|--------|
| Self-trade bypass via UUID format | **NONE.** Normalized comparison. |
| Balance mutation after self-trade rejection | **NONE.** Throw before any balance update. |
| Engine allows self-match, backend applies | **NONE.** Backend rejects and does not apply. |

---

# PART 4 — ABUSE SIGNAL GAMING & BYPASS ANALYSIS

## SECTION 1 — Abuse/Bias Attack Models

| Attack | Vector |
|--------|--------|
| **Slow-rate abuse** | Stay under per-minute limits but maximize total over time. Mitigated by per-user velocity (P2P orders/hour) and escrow cap; now enforced in transaction with lock. |
| **Multi-account** | Distribute volume across accounts to evade per-user velocity and escrow cap. No cross-account aggregation; detection/AML concern, not a single-account invariant fix. |
| **Timing manipulation** | Client cannot set server time; windows use server/Redis time. No client timestamp in limits. |
| **Repeated create/cancel** | Spot cancel and create are rate-limited per user. P2P velocity counts orders (created) in window; cancel does not remove from count (order row exists). So create-then-cancel still consumes velocity slot. **OK.** |
| **Escrow fragmentation** | Many small orders to stay under per-order cap but over total exposure. Escrow total cap (sum of amounts) and count cap enforced in same transaction with lock; no bypass. |
| **Risk scoring oscillation** | User alternates behavior to stay under threshold. Risk engine is heuristic; no guarantee against gaming. Documented as detection/operational concern. |

---

## SECTION 2 — Identified Weaknesses

| Weakness | Severity | Addressed |
|----------|----------|-----------|
| P2P velocity bypass under concurrency | High | Yes — velocity in tx with user lock. |
| Escrow cap bypass under concurrency | High | Yes — already fixed (FOR UPDATE on escrows, cap in same tx as moveToEscrow). |
| Self-trade via UUID format | Medium | Yes — normalized comparison. |
| Rate limit fail-open on Redis error | Medium | Accepted trade-off; documented. |
| Multi-account distribution | Lower | Operational/AML; not a single-account invariant. |

---

## SECTION 3 — Corrections/Defenses

- **Velocity:** P2P order velocity enforced inside order-creation transaction after locking the order creator user row; no concurrent bypass.
- **Escrow cap:** Already transactional with FOR UPDATE on seller’s locked escrows; no change in this audit.
- **Self-trade:** Normalized taker/maker id comparison in settlement-worker.
- **Halt:** No code change; already fail-closed and uncached.

---

## SECTION 4 — Remaining Blind Spots

| Item | Status |
|------|--------|
| Multi-account velocity/escrow evasion | **Accepted.** Requires identity/AML controls; not solved by per-user invariants. |
| Rate limit bypass when Redis is down | **Accepted.** Fail-open for availability; documented. |
| Risk score threshold gaming | **Accepted.** Heuristic; no guarantee; operational monitoring. |
| Economically feasible single-account bypass of velocity/escrow/halt/self-trade | **NONE** after corrections. |

---

# FINAL OUTPUT

## SECTION A — Confirmed Safe Mechanisms

- **Redis rate limit:** Atomic MULTI (zrem, zadd, zcard, expire); add-then-count; server time; no client timestamps.
- **OTP incrementWithLimit:** Lua INCR + EXPIRE + conditional DECR; atomic.
- **Trading halt:** Fail-closed on Redis error; no local cache; fresh read every time.
- **Escrow cap:** Enforced in same transaction as moveToEscrow with FOR UPDATE on seller’s locked escrows.
- **P2P order velocity (after fix):** Enforced inside transaction after `SELECT id FROM users WHERE id = $1 FOR UPDATE`; serialized per user.
- **Self-trade:** Reject when normalized taker id === normalized maker id; throw before any balance update; no partial apply.

---

## SECTION B — Critical Risks Found

1. **P2P order velocity TOCTOU:** Velocity check was outside transaction; concurrent requests could exceed limit. **Fixed.**
2. **Self-trade UUID representation:** Same user in different string forms could be treated as different. **Fixed.**

---

## SECTION C — Corrections Applied

1. **P2P velocity:** Added `assertP2POrderVelocityInTransaction(userId, client)`. In createOrder, lock order creator with `SELECT id FROM users WHERE id = $1 FOR UPDATE`, then call velocity check in same transaction, then escrow cap, then moveToEscrow and insert. Removed external `assertP2POrderVelocity` from enforcement path.
2. **Self-trade:** In settlement-worker, compare `norm(takerId) === norm(makerId)` with `norm(s) = String(s).toLowerCase().replace(/-/g, '')`; throw SELF_TRADE_REJECTED before any balance mutation.

---

## SECTION D — Remaining Exploit Vectors

| Vector | Status |
|--------|--------|
| Concurrent bypass of P2P velocity | **NONE.** Enforced in tx with user lock. |
| Concurrent bypass of escrow cap | **NONE.** Enforced in tx with escrow FOR UPDATE. |
| Trading while halted (Redis down/stale/cache) | **NONE.** Fail-closed; no cache. |
| Self-trade (same user, any format) | **NONE.** Normalized comparison; no balance update on reject. |
| Single-account economically feasible abuse of velocity/escrow/halt/self-trade | **NONE.** |

Multi-account distribution and rate-limit fail-open under Redis failure are accepted and documented; not classified as remaining exploit vectors for single-account invariant correctness.
