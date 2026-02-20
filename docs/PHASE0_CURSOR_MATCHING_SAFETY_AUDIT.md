# Phase-0 Cursor & Matching Safety Audit

**Context:** Production CEX; Spot + P2P; ledger/user_balances = single source of truth. Settlement worker = verified safe (do not modify).  
**Scope:** Cursor contract, matching sequencing, cancel vs fill, crash/retry/replay. No architecture or schema redesign.

**Code audited:**  
- `matching-engine.service.ts` (in-memory orderbook, `orders` table, placeOrder/cancelOrder/matchOrder)  
- `match-poller.ts` (settlement_poller_cursor, settlement_events insert)  
- `snapshot-service.ts` (recovery anchor, initializeRecoveryState)  
- `engine-client.ts` (fetchMatches contract)  
- `spot.fastify.ts` runMatching (DB-only, spot_orders, same-tx)

---

## SECTION A — Cursor / Matching Risks

### A.1 — Matching engine (matching-engine.service.ts): no persistent cursor; in-memory is source of truth

- **Cursor definition:** There is no stored “match cursor.” The live orderbook is in-memory (`orderbooks: Map<pairId, { bids, asks }>`). It is loaded once at startup via `loadOrderbook(pairId)` which runs `SELECT * FROM orders WHERE pair_id = $1 AND status IN ('open', 'partially_filled') ORDER BY created_at ASC` and then `addToOrderbook(order)` for each row.
- **Advancement:** The “cursor” is implicit: after a GTC limit order is placed and committed, `addToOrderbook(matchResult.order)` is called (line 306). After cancel, `removeFromOrderbook(updatedOrder)` is called (line 458). So the book is advanced by these mutations.
- **Risks:**
  - **Rollback leaves in-memory inconsistent:** If `matchOrder` runs and executes one or more trades (so it mutates `level.orders`, `matchingOrder.quantity`, and removes orders from levels), then a later `executeTrade` in the same loop throws (e.g. INSUFFICIENT_LOCKED_FUNDS on a subsequent maker), the whole placeOrder transaction rolls back. The DB correctly rolls back (order insert + all trade/balance/order updates). But in-memory has already been mutated (reduced/removed makers). So after rollback, the in-memory book no longer matches the DB: some orders appear with reduced size or missing. Next placeOrder can then match against “phantom” liquidity (in-memory shows less than DB) or miss liquidity (in-memory was incorrectly reduced). **Financial:** Double-spend (match same maker twice after reload) or failed matches; over time, divergence can cause wrong fills or locked-balance mismatches.
  - **addToOrderbook after commit:** For GTC limit orders that remain open, the order is added to the book only after the transaction commits. If the process crashes after commit but before `addToOrderbook`, the order exists in the DB but not in the book. So the book is missing liquidity; the next reload (restart) would pick it up. Until then, that order cannot be matched. No double-fill from this, but **phantom liquidity in DB** (user sees open order, engine won’t match it until restart).
  - **loadOrderbook column name:** Code uses `order.pairId` (e.g. `this.orderbooks.get(order.pairId)`). PostgreSQL typically returns snake_case (`pair_id`). If there is no row transformer, `order.pairId` is undefined, so `orderbook` is undefined and `addToOrderbook` returns early without adding. So **all orders could fail to load** into the book at startup, yielding an empty book and no matches until new orders are placed (and only those would be in memory). **Uncertainty:** Not verified if a global pg camelCase mapper exists; if not, this is a critical bug.

### A.2 — Match poller cursor (settlement_poller_cursor)

- **Definition:** Single row `settlement_poller_cursor (id = 1, last_engine_event_id)`. `getLastEngineEventId()` reads it; `setLastEngineEventId(lastId)` updates it.
- **Advancement:** After fetching `{ last_id, events } = await fetchMatches(afterId)`, the poller inserts each event with `ON CONFLICT (engine_event_id) DO NOTHING`, then calls `setLastEngineEventId(last_id)`. So the cursor is set to `last_id` returned by the engine.
- **Risks:**
  - **Contract of last_id:** `engine-client.ts` does not enforce that `events` are exactly the contiguous segment `(afterId, last_id]` or that `last_id` is the max `event_id` in `events`. If the engine returns `events = [5,6,7]` and `last_id = 10`, the poller inserts 5,6,7 and sets cursor to 10. Events 8 and 9 would never be fetched or inserted. **Financial:** Permanent loss of match events → balances and ledger out of sync with engine, insolvency or incorrect positions.
  - **Cursor advance without transaction:** `pollOnce` does: getLastEngineEventId(); fetchMatches(afterId); for each event INSERT (separate statements); setLastEngineEventId(last_id). There is no single transaction wrapping the inserts and the cursor update. If the process crashes after some inserts but before `setLastEngineEventId`, on restart the cursor is still the old value. The poller will re-fetch the same range; `ON CONFLICT (engine_event_id) DO NOTHING` prevents duplicate rows. So no duplicate settlement_events. But if the engine’s `after_id` semantics are “return events with event_id > after_id” and it does not return the same set on retry (e.g. engine side cursor moved), we could skip events. **Uncertainty:** Depends on engine’s idempotency and contract; document and test.

### A.3 — Recovery (snapshot-service.initializeRecoveryState)

- When `getLastEngineEventId()` returns 0, the poller calls `initializeRecoveryState()`, which loads the latest snapshot and returns `snapshot.engine_event_id` (or 0). It throws `RECOVERY_INVARIANT_VIOLATION` if `snapshot.engine_event_id > cursor` (cursor ahead of snapshot).
- So on first run or after cursor reset, we resume from the snapshot’s engine_event_id and avoid replaying from 0. If there is no snapshot, we resume from 0; engine must then return events from the beginning or accept gaps. **Risk:** If cursor is explicitly set to 0 while the engine has already emitted events, and no snapshot exists, we might never process those events. Rely on operational discipline and snapshot creation.

### A.4 — Spot runMatching (spot.fastify.ts): no cursor

- Matching is DB-only in the same transaction as order insert. Candidates are selected with `ORDER BY price ASC/DESC, created_at ASC` and iterated. No persistent cursor; no in-memory book. Deterministic within the transaction. No cursor-related risk for spot path.

---

## SECTION B — Deterministic Safety Properties

### B.1 — Spot runMatching

- **Price-time:** Enforced by `ORDER BY price ASC, created_at ASC` (buy) or `price DESC, created_at ASC` (sell). Same tx as insert, so no concurrent insert of same market/side between read and write.
- **Rounding:** All quantities and prices use `Decimal` with `ROUND_DOWN` (spot-decimal, qtyPrecision/pricePrecision from market). Trade value and fees rounded consistently.
- **Partial fill:** `filledIncoming` and `otherFilled` updated in loop; order rows updated with `filled_quantity` and status (OPEN/PARTIALLY_FILLED/FILLED). Remaining = quantity - filled_quantity; no float.

### B.2 — Matching engine (in-memory)

- **Price-time within level:** Levels sorted by price (asc for buy, desc for sell). Within a level, `level.orders` is an array; iteration order is insertion order (FIFO). Insertion order at load is `ORDER BY created_at ASC`; when adding after placeOrder, a single order is pushed. So FIFO per level is preserved when no rollback.
- **After rollback:** In-memory state is mutated (makers reduced/removed) while DB rolls back, so FIFO and level quantities are no longer consistent with DB until next full reload (restart). So determinism is lost across that rollback.

### B.3 — Settlement pipeline cursor

- **Idempotent insert:** `ON CONFLICT (engine_event_id) DO NOTHING` ensures each engine event_id appears at most once. Settlement worker processes by event id and is verified safe; replay of the same event is handled by worker’s replay logic.
- **Determinism:** Cursor only moves forward (`setLastEngineEventId(last_id)`). Same `afterId` always yields same fetch from engine (engine contract assumed). No reordering of events in the poller.

---

## SECTION C — Catastrophic Failure Scenarios

### C.1 — Matching engine: rollback after partial match

- **Scenario:** PlaceOrder A matches with maker B (executeTrade commits in tx), then matches with maker C; debitLockedBalance for C fails (e.g. C was just cancelled and balance unlocked). placeOrder tx rolls back.
- **Effect:** DB: A never inserted; B’s fill and trade row rolled back. In-memory: B’s quantity was already reduced and possibly removed from the book. So in-memory shows B as partially filled or gone; DB shows B full size. Next order can match against B again (in-memory still has B with reduced qty or missing; if missing, next load would need a restart). If the process stays up and no reload happens, the next placeOrder might use the wrong B quantity (e.g. still in level with reduced qty) and executeTrade(B) would update B in DB again — so we could double-fill B (once rolled back, once committed). **Financial:** Maker B’s locked balance debited once (rolled back) then again (second match) while they receive base only once → value creation; or taker pays twice for one fill → value destruction.

### C.2 — Matching engine: empty book on startup (if pairId undefined)

- **Scenario:** loadOrderbook runs with DB returning `pair_id`; code uses `order.pairId`. If undefined, every order is skipped. Book stays empty.
- **Effect:** All matches happen only for orders placed in this process run. Resting orders from DB are never matched until restart with a working mapper or schema. **Financial:** Users’ limit orders never fill; complaints and possible liability.

### C.3 — Match poller: last_id skips event ids

- **Scenario:** Engine returns `events = [5,6,7]`, `last_id = 10`. Poller inserts 5,6,7 and sets cursor to 10. Events 8,9 never fetched.
- **Effect:** Settlement worker never sees 8,9. Balances and ledger diverge from engine state. **Financial:** Insolvency or incorrect positions depending on engine state.

### C.4 — Cancel vs fill (matching engine)

- **Scenario:** PlaceOrder A is in matchOrder and is about to executeTrade(A, B). Cancel B runs: FOR UPDATE B, set cancelled, unlock B’s balance, commit, removeFromOrderbook(B).
- **Effect:** executeTrade(A, B) then runs: debitLockedBalance(B) fails (B’s balance already unlocked). Throw INSUFFICIENT_LOCKED_FUNDS; placeOrder A tx rolls back. So we do not double-unlock or fill after cancel. **Confirmed safe** for this path.

---

## SECTION D — Minimal Safe Corrections

### D.1 — Matching engine: in-memory consistency on rollback

- **Minimal correction:** Before the loop in `matchOrder` that iterates over levels and makers, take a **deep copy** of the affected side of the orderbook (or at least the levels/orders that will be mutated). Do not mutate the live book during the loop. Only after the full match cycle and DB updates succeed (no throw), apply the same mutations to the live book (reduce/remove makers, update level quantities). If the transaction rolls back, the live book was never mutated, so it stays in sync with DB.
- **Alternative (more invasive):** On any throw from matchOrder/executeTrade, reload the orderbook for that pair from DB before rethrowing. That restores consistency after rollback but adds DB load and a possible race window; prefer the copy-then-apply approach.

### D.2 — Matching engine: addToOrderbook only after commit (crash window)

- **Minimal correction:** Keep current semantics (add after commit). Document that on crash after commit and before addToOrderbook, the order is in DB but not in the book until the next process restart (when loadOrderbook runs). Optionally, after commit, before addToOrderbook, re-read the order from DB by id and then add; that avoids adding a stale in-memory order if something else updated it (rare). The main fix is D.1 so that rollback does not corrupt the book.

### D.3 — loadOrderbook / Order type (pair_id vs pairId)

- **Minimal correction:** Ensure orders from DB are read with the key used by the book. If pg returns `pair_id`, use `order.pair_id` when calling `this.orderbooks.get(...)` and when passing to addToOrderbook, or add a single mapping at load: `const pairId = order.pairId ?? order.pair_id;`. Same for any other snake_case columns used in the matching path (e.g. remainingQuantity / remaining_quantity). No schema change; code-only consistency.

### D.4 — Match poller: cursor and event contract

- **Minimal correction (poller):** Do not advance the cursor past the highest `event_id` actually inserted. After the loop, set `cursorToSet = events.length > 0 ? Math.max(...events.map(e => e.event_id)) : last_id`. Then `setLastEngineEventId(cursorToSet)`. So if the engine returns a `last_id` that skips ids, we only advance to the max id we actually received. **Caveat:** If the engine’s contract is “events are [afterId+1..last_id] and you must advance to last_id,” then advancing only to max(events) could cause the next fetch to re-return the same range. So the correction must match the engine’s API contract; document the contract and add a test that asserts contiguous events or explicit skip handling.
- **Documentation:** Document in code and runbook: “Engine MUST return events such that event_id is contiguous from (afterId, last_id] or we only advance to max(event_id) of returned events.” If the engine guarantees contiguity, the current “set to last_id” is correct and no code change; otherwise use the max(events) advance above.

### D.5 — Poller cursor update in a transaction (optional)

- To make “insert events + advance cursor” atomic, run in a single transaction: BEGIN; insert all rows; UPDATE settlement_poller_cursor SET last_engine_event_id = $1 WHERE id = 1; COMMIT. So after crash we never have “events inserted but cursor not advanced.” Requires that the poller use a single client/transaction for the batch. Minimal and recommended.

---

## SECTION E — Verification & Stress Tests

### E.1 — Cursor / matching

- **Matching engine rollback:** In a test, stub the second maker’s debitLockedBalance to throw. Place an order that would match two makers. Assert: (1) no trade rows for the second maker; (2) in-memory orderbook for that pair still matches DB (all open/partially_filled orders with same remaining_quantity as in DB).
- **loadOrderbook key:** With DB returning snake_case, assert that after loadOrderbook(pairId), the in-memory book has the same number of orders and same total quantity per side as `SELECT COUNT(*), SUM(remaining_quantity) FROM orders WHERE pair_id = $1 AND status IN (...)`.
- **Poller cursor:** (1) Insert events with event_id 5,6,7; set cursor to 7. Next poll with after_id=7 must not re-insert 5,6,7 (ON CONFLICT). (2) If engine returns events [5,6,7] and last_id=10, either assert we only advance to 7, or assert engine contract that 8,9 do not exist.

### E.2 — Determinism

- **Spot:** Same order payload and same DB state (same open orders) must produce the same match count and same fill quantities in two consecutive runs (e.g. in a test with a single client and deterministic ORDER BY).
- **Matching engine:** With a fixed orderbook snapshot (copy), run matchOrder twice with the same incoming order; assert identical trades and identical updated quantities (no floating point, use Decimal throughout).

### E.3 — Cancel vs fill

- **Matching engine:** Concurrent test: thread 1 placeOrder (limit buy), thread 2 cancel the best ask order. Run many times. Assert: either the order fills (trade exists, maker updated) or it is cancelled (no trade for that maker); never both (no double unlock, no fill of an already-cancelled order). Assert balance: total locked + available for maker unchanged across the two operations.
- **Spot:** Same idea: concurrent place (market/limit) and cancel for the same resting order; assert no double unlock and no fill after cancel.

### E.4 — Crash / retry / replay

- **Poller:** Simulate crash after inserting event 5 and 6 but before setLastEngineEventId. Restart; assert cursor eventually advances and events 5 and 6 are processed exactly once (check settlement_events and settlement_ledger_entries or worker logs).
- **Matching engine:** After a rollback (forced throw in executeTrade), assert next placeOrder for the same pair still sees correct book state (no phantom liquidity, no missing liquidity) — enforced by D.1.

---

**End of audit.**  
Findings are from the listed files only. No redesign; minimal corrections only. Settlement worker unchanged.
