# PRE-PHASE-13 SYSTEM VERIFICATION — MECHANICAL SAFETY & FAILURE PROOFING

**Scope:** Strict mechanical verification of runtime safety (failure-mode and invariant correctness only). No feature review or refactor. Real funds, adversarial users, concurrent requests, retries, crashes, partial failures.

---

## SECTION 1 — Verified Safe Mechanisms

### Transactional integrity
- **P2P createOrder:** Single `db.transaction(client)`. Inside: ad `FOR UPDATE`, user `FOR UPDATE`, `assertP2POrderVelocityInTransaction`, `assertP2PEscrowCapInTransaction`, `moveToEscrow(..., client)`, order insert, ad update. Check and mutation are atomic; no TOCTOU.
- **moveToEscrow / releaseFromEscrow / refundFromEscrow:** All accept `client: PoolClient` and perform balance/escrow updates only via that client. No use of `db.query` for mutations.
- **Velocity enforcement:** `assertP2POrderVelocityInTransaction(userId, client)` runs inside the same transaction as order creation and uses `client`. No read-check-write outside tx.
- **Escrow cap enforcement:** `assertP2PEscrowCapInTransaction(sellerId, quantity, client)` locks escrows with `SELECT ... FOR UPDATE`, then checks count/total, then `moveToEscrow` runs in same tx. Atomic.
- **P2P releaseCrypto / cancelOrder / resolveDispute:** Each runs in a single `db.transaction(client)`; order (and dispute where applicable) locked with `FOR UPDATE`; escrow release/refund use `client`. No mutation without invariant protection.
- **Settlement event processing:** `runOnce()` uses a single `client` from `getSettlementClient()`; `BEGIN` → `SELECT ... FOR UPDATE SKIP LOCKED` one pending event → `processEvent(client, row)` → `COMMIT`. All ledger, balance, and trade writes use `client`. No split read/write across connections for one event.
- **getCurrencyIdForToken:** Uses `db.query` (read-only lookup on `tokens`/`currencies`). No balance or escrow mutation; no TOCTOU for monetary state.

### Concurrency and locking
- **P2P createOrder:** Ad and user locked with `FOR UPDATE`; escrow cap locks seller’s locked escrows; velocity uses same tx. Lock scope is minimal and sufficient; ordering is consistent (ad → user → escrows).
- **Concurrent release/refund:** Each flow locks the order (and escrow via escrow service) in one tx; idempotent escrow update (`WHERE status = 'locked' RETURNING`) ensures only one commit applies balance change; replays see `alreadyReleased`/`alreadyRefunded` and no longer mutate escrow.
- **Settlement:** One event per worker loop; `FOR UPDATE SKIP LOCKED` prevents two workers from taking the same event; balance rows locked by `(user_id, asset) IN (...) FOR UPDATE` before any mutation.

### Idempotency and replay safety
- **Escrow release:** `releaseFromEscrow` uses `UPDATE escrows ... WHERE ... AND status = 'locked' RETURNING`; 0 rows → `alreadyReleased`, no balance change. Replays cannot alter balances incorrectly.
- **Escrow refund:** Same pattern; `alreadyRefunded`; double requests produce safe behavior.
- **P2P order status convergence:** On `alreadyReleased`/`alreadyRefunded`, handlers now update order status to `completed`/`cancelled` (with `COALESCE` for timestamps) so crash-after-balance-move converges to consistent state.
- **Settlement replay guard:** At start of `processEvent`, if `settlement_ledger_entries` already has rows for this `settlement_event_id`, the event is treated as already applied; only `status = 'processed'` and `hash` are set; no second ledger/balance/trade write. Replays cannot double-apply.

### Balance and escrow invariants
- **moveToEscrow:** `UPDATE ... WHERE available_balance >= $4`; debit ≤ source balance. `assertNonNegative`/`assertValidDecimal` on amount. available_balance and escrow_balance updated in one statement.
- **releaseFromEscrow / refundFromEscrow:** Debit only from escrow; credit to buyer/seller available; single UPDATE per side. No path bypasses monetary invariants.
- **Settlement:** Non-negative checks (`available.lt(0) || locked.lt(0)` → throw); ledger-first; global ledger vs balance check after updates. Drift from these paths is prevented by transaction atomicity and checks.

### Failure-mode safety
- **Server crash mid-transaction:** DB transaction rolls back; no partial balance or escrow commit. Settlement: either full apply + status=processed, or replay guard prevents double-apply.
- **Redis failure:** Halt check may fail open/closed; P2P/spot use Redis halt. Settlement now also checks `getTradingHalted()` (Redis) in addition to in-memory circuit breaker, so admin halt can stop settlement.
- **Retry storms:** Idempotent escrow release/refund and settlement replay guard ensure no double-apply of monetary effects.

---

## SECTION 2 — Critical Mechanical Risks Found (and Addressed)

1. **Settlement double-apply on crash:** Status was set to `processed` only at the end of `processEvent`. A crash after ledger/balance/trade writes but before that UPDATE left the event `pending`, causing reprocessing and duplicate ledger rows, balance updates, and trades. **Addressed:** Replay guard at start of `processEvent`: if ledger entries exist for the event, only set `status = 'processed'` and `hash`; no second apply.
2. **Settlement worker ignoring Redis halt:** `runOnce()` used only in-memory `isTradingHalted()` (circuit breaker). Admin halt via Redis did not stop settlement. **Addressed:** `runOnce()` now also calls `await getTradingHalted()` and returns without processing when Redis halt is set.
3. **P2P idempotent path not converging order state:** When `releaseFromEscrow`/`refundFromEscrow` returned `alreadyReleased`/`alreadyRefunded`, the order was not updated to `completed`/`cancelled`. After a crash that applied escrow but did not update the order, a replay left order and escrow state inconsistent. **Addressed:** On `alreadyReleased`/`alreadyRefunded`, handlers still run `UPDATE p2p_orders SET status = 'completed'|'cancelled' ...` (with `COALESCE` for timestamps) so state converges. Same applied in `resolveDispute` (always update order status after release/refund).

---

## SECTION 3 — Required Corrections (Implemented)

1. **Settlement idempotency:** At the start of `processEvent(client, row)`, if `SELECT ... FROM settlement_ledger_entries WHERE settlement_event_id = $1` returns any row, treat as replay: compute hash from existing ledger lines and payload, set `settlement_events.status = 'processed'`, `hash`, `processed_at`, then return without writing ledger, balances, or trades again.
2. **Settlement halt consistency:** In `runOnce()`, after `isTradingHalted()`, add `if (await getTradingHalted()) return;` so Redis-backed admin halt stops settlement processing.
3. **P2P order status convergence:** In releaseCrypto, cancelOrder, and resolveDispute, when escrow service returns `alreadyReleased` or `alreadyRefunded`, still run the corresponding `UPDATE p2p_orders SET status = 'completed'|'cancelled' ...` so that crash-after-escrow-move converges to correct order status; in resolveDispute, always update order status after release/refund (remove the `if (!releaseResult.alreadyReleased)` / `if (!refundResult.alreadyRefunded)` guards so status is always set).

---

## SECTION 4 — Remaining Drift / Double-Apply Vectors

- **None.** After the above corrections:
  - All critical monetary and escrow mutations are inside a single transaction and, where applicable, protected by idempotency (escrow status guard, settlement replay guard).
  - Order status is updated on both first-time and replay paths so escrow and order state cannot diverge.
  - Settlement cannot double-apply after crash because replay is detected via existing ledger entries and only status/hash are updated.
  - No remaining identified path allows balance drift or double-apply of funds.

---

## SECTION 5 — Verdict

**SAFE FOR PHASE-13**

All critical flows use proper DB transactions; check and mutation are atomic; escrow and settlement are idempotent and replay-safe; settlement respects Redis halt and circuit breaker; and P2P order status converges on replay. No outstanding high-severity correctness or loss-of-funds risks identified for the audited paths under the stated assumptions (production, real funds, adversarial users, concurrency, retries, crashes, partial failures).
