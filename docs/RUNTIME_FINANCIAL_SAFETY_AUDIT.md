# Runtime Financial Safety Audit

**Scope:** Idempotency violations, missing locks, double-spend scenarios, partial transaction risks, ledger/balance mismatches.

**Date:** 2025-02-13

---

## 1. Idempotency Violations

### 1.1 Convert Instant — HIGH
- **Location:** `convert.fastify.ts` `POST /convert/instant`
- **Risk:** No Idempotency-Key. Retry/network replay can cause same conversion to run twice.
- **Impact:** User debited twice (from balance) and credited twice (to balance) → effective double conversion of from-currency and double credit of to-currency. Net financial loss to exchange.

### 1.2 Convert Limit Place — HIGH
- **Location:** `convert.fastify.ts` `POST /convert/limit`
- **Risk:** No Idempotency-Key. Retry can lock funds twice for the same limit order intent.
- **Impact:** Double lock of from-currency. User’s available balance reduced more than intended.

### 1.3 Convert Limit Cancel — MEDIUM
- **Location:** `convert.fastify.ts` `POST /convert/limit/:orderId/cancel`
- **Risk:** No explicit idempotency. Concurrent cancels may both see `status = 'pending'` before either commits.
- **Mitigation:** Row lock on conversion and single UPDATE for status/refund. Second attempt would fail (already cancelled). Safe due to transaction + FOR UPDATE.

### 1.4 P2P Order Create — LOW
- **Location:** `p2p.service.ts` `createOrder`, `p2p.routes.ts` `POST /p2p/orders`
- **Risk:** No Idempotency-Key on API. Double submit could create two orders and move funds to escrow twice.
- **Mitigation:** Ad-level and seller-level Redis locks reduce race. Not idempotent at request level.

### 1.5 Admin Manual Credit — MEDIUM
- **Location:** `admin.fastify.ts` `POST /admin/deposits/manual-credit`
- **Risk:** No Idempotency-Key. Double submit (e.g. double-click) can credit user twice.
- **Impact:** Double credit; exchange loss.

### 1.6 Spot Order (client_order_id) — PROTECTED
- **Location:** `spot.fastify.ts` `POST /spot/orders`
- **Mitigation:** When `client_order_id` is provided, lookup + UNIQUE index `(user_id, client_order_id)` prevents duplicate inserts. Second INSERT fails with unique violation.

### 1.7 Withdrawal Create — PROTECTED
- **Location:** `wallet.fastify.ts` `POST /withdrawals`
- **Mitigation:** Idempotency-Key required; Redis cache + SET NX EX lock. Duplicate requests return cached response or 409.

### 1.8 Internal Transfer (account-to-account) — PROTECTED
- **Location:** `wallet.fastify.ts` `POST /transfer`
- **Mitigation:** Idempotency-Key required; Redis cache + lock. Duplicate requests handled safely.

---

## 2. Missing Locks

### 2.1 Convert Instant — MEDIUM
- **Location:** `convert.fastify.ts` instant convert flow
- **Risk:** User lock by `(userId, fromCurrencyId)` not enforced across concurrent instant + limit operations.
- **Mitigation:** Single `db.transaction` with SELECT FOR UPDATE on balance rows. No cross-route serialization (e.g. Redis user lock) for convert vs transfer vs spot.

### 2.2 Spot Order (balance_locks) — LOW
- **Location:** `spot.fastify.ts` POST /spot/orders
- **Risk:** Relies on balance_locks; no `order:lock:${userId}` style lock.
- **Note:** Different model from matching-engine (which uses Redis user lock). Potential for different semantics across spot vs trading routes.

### 2.3 Admin Manual Credit — LOW
- **Location:** `admin.fastify.ts` manual credit
- **Mitigation:** FOR UPDATE on balance row inside transaction. No user-level lock; two admins can credit same user concurrently (intended for support).

### 2.4 P2P Confirm Payment / Release — PROTECTED
- **Location:** `p2p.service.ts` `confirmPayment`, `releaseCrypto`
- **Mitigation:** Order row locked with FOR UPDATE; status checks prevent invalid transitions.

---

## 3. Double-Spend Scenarios

### 3.1 Convert Instant Retry — HIGH
- **Scenario:** User retries after timeout; first request already succeeded.
- **Risk:** Second request runs; balance debited and credited again.
- **Mitigation:** None (no Idempotency-Key).

### 3.2 Convert Limit Place Retry — HIGH
- **Scenario:** Same as above for limit order.
- **Risk:** Funds locked twice for same intent.
- **Mitigation:** None.

### 3.3 Withdrawal Cancel vs Signing — PROTECTED
- **Scenario:** User cancels while withdrawal is in signing queue / post-broadcast.
- **Mitigation:** Completion path re-checks `status`; if `cancelled`, does not debit balance. Cancel uses `UPDATE ... WHERE status = 'pending'`; both under FOR UPDATE.

### 3.4 Deposit Double Credit — PROTECTED
- **Location:** `deposit-credit.service.ts`
- **Mitigation:** Single UPDATE with `balance_applied_at IS NULL`; only one caller wins. Idempotent credit per deposit.

### 3.5 P2P Escrow Release/Refund — PROTECTED
- **Location:** `p2p-escrow.service.ts` `releaseFromEscrow`, `refundFromEscrow`
- **Mitigation:** Escrow status check + `UPDATE ... WHERE status = 'locked'`; only one caller wins. Idempotent.

---

## 4. Partial Transaction Risks

### 4.1 creditOverdueDepositsForUser — LOW
- **Location:** `deposit-credit.service.ts`
- **Risk:** Loop over deposits; each `creditDepositIfConfirmed` is its own transaction. Failure on deposit N leaves 1..N-1 credited; N and later not.
- **Impact:** Caller gets exception; retry skips already-credited, processes rest. Eventually consistent.

### 4.2 Withdrawal Fail Refund — MEDIUM
- **Location:** `withdrawal-signing.service.ts` `markQueueFailed` → balance refund
- **Risk:** Refund UPDATE does not enforce `locked_balance >= $1`. If locked was altered, could create negative locked or inconsistent state.
- **Recommendation:** Add `AND locked_balance >= $1::numeric` to refund UPDATE.

### 4.3 Convert Flows — PROTECTED
- **Location:** `convert.fastify.ts` instant and limit
- **Mitigation:** Single `db.transaction`; debit + credit + insert in one transaction.

### 4.4 P2P Create Order — PROTECTED
- **Location:** `p2p.service.ts` `createOrder`
- **Mitigation:** `moveToEscrow` + order insert + ad update in one transaction.

### 4.5 Limit Conversion Fill — UNCLEAR
- **Location:** No dedicated fill worker found in codebase.
- **Risk:** Limit conversion orders remain `pending`. If a fill flow exists elsewhere (cron, worker, external), partial-execution risk depends on that implementation.

---

## 5. Ledger / Balance Mismatches

### 5.1 Ledger Insert Order — LOW
- **Risk:** If `insertBalanceLedger` fails after balance UPDATE, ledger can lag.
- **Mitigation:** All balance mutations checked use same transaction; ledger insert is in same tx. Failure rolls back both.

### 5.2 Cache Invalidation Timing — LOW
- **Location:** `wallet.service.ts`, `convert.fastify.ts` balance cache invalidation
- **Risk:** Invalidation after transaction commit; brief window where cache is stale.
- **Mitigation:** Best-effort; next read repopulates from DB. Acceptable for display.

### 5.3 balance_ledger vs user_balances — LOW
- **Risk:** Ledger is append-only; no automatic reconciliation. Divergence requires manual repair.
- **Note:** Settlement/reconciliation services exist; operational process, not code defect.

---

## Summary: Actions by Priority

| Priority | Item | Action |
|----------|------|--------|
| HIGH | Convert instant idempotency | Add Idempotency-Key; Redis cache + lock |
| HIGH | Convert limit place idempotency | Add Idempotency-Key; Redis cache + lock |
| MEDIUM | Admin manual credit idempotency | Add Idempotency-Key for support flows |
| MEDIUM | Withdrawal fail refund guard | Add `locked_balance >= $1` to refund UPDATE |
| LOW | P2P order create idempotency | Consider Idempotency-Key for API |
| LOW | Limit conversion fill | Verify if/when fill runs; ensure atomicity |

---

*Audit performed without code changes. Report risks only.*
