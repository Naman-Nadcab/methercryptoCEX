# Formal Exchange-Grade Architecture & Safety Audit

**System:** Centralized Crypto Exchange (strict SPOT + P2P)  
**Scope:** Backend (Fastify + TypeScript + PostgreSQL), settlement pipeline, spot risk, locking  
**Date:** 2025-02-11

---

## SECTION 1 — ARCHITECTURE VALIDATION

### Authority boundaries

- **Two distinct balance authorities exist:**
  - **`user_balances`** (currency_id, chain_id, account_type): Used by spot routes (lock/unlock/debit/credit via `spot-balance.service`), wallet, withdrawals. Documented in code as “single source of truth” for main app.
  - **`balances`** (user_id, asset): Used only by settlement pipeline (worker, snapshot, ledger, spot-risk.service) via `db.getSettlementClient()`; normal `db.query` is blocked from touching `balances`.
- **Trust boundary violation (critical):** Spot order placement and in-process matching (`runMatching` in `spot.fastify.ts`) update **user_balances** only. `validateSpotOrderRisk` reads **balances** (settlement table). For in-process spot orders, settlement `balances` are never updated by that path. So risk is validated against one ledger and execution happens on another. This can cause:
  - False rejections if settlement `balances` are empty/stale for users who only use in-process spot.
  - False acceptance if settlement `balances` are populated by another path (e.g. engine) and user_balances are not in sync.
- **Engine vs backend:** Rust engine produces matches → `settlement_events` → settlement worker updates `balances`, `orders` (engine order table), `settlement_ledger_entries`, `trades`. In-process spot uses `spot_orders` / `spot_trades` and `user_balances`. So there are two separate trading stacks (engine+settlement vs in-process spot); only one should be the source of truth for a given order type.

### Engine vs ledger responsibilities

- Settlement worker: ledger-first (append `settlement_ledger_entries`, then update `balances`). Ledger chain and per-event hash enforce determinism. Correct.
- In-process spot: no ledger; direct `user_balances` updates in `runMatching`. No append-only audit trail for spot balance moves in this path.

### Trust model violations

- Spot risk check uses settlement `balances` while execution uses `user_balances` for the same in-process spot flow → **invalid authority boundary**.

---

## SECTION 2 — ACCOUNTING & LEDGER SAFETY

### Ledger invariants (settlement path)

- **Settlement worker:** Ledger entries are written before balance updates. After balance updates, worker asserts `SUM(ledger deltas) = available + locked` per (user_id, asset). Fee invariant `taker_fee + maker_fee <= trade_value` is checked. All use Decimal.js and ROUND_DOWN. **Correct.**
- **Global ledger invariant:** `GLOBAL_LEDGER_INVARIANT_VIOLATION` and circuit breaker prevent continuing after violation. **Correct.**

### Drift risks

- **Dual balance stores:** `user_balances` and `balances` can diverge. No single source of truth across spot (in-process) and settlement (engine). Deposits/withdrawals may only touch `user_balances`; settlement `balances` may only be updated by the worker. **Drift vector.**
- **In-process spot:** No ledger; only `user_balances` and `spot_orders`/`spot_trades`. No recomputable balance from ledger for this path.

### Replay safety

- Settlement: Event insert is `ON CONFLICT (engine_event_id) DO NOTHING`. Worker selects `status = 'pending'`, processes once, then sets `status = 'processed'` and stores hash. Reprocessing same payload would yield same hash; if hash were already stored, `SETTLEMENT_HASH_MISMATCH` would throw. **Idempotent and replay-safe.**
- In-process spot: No event idempotency; each request runs matching once. Replay of same HTTP request would re-run matching and could double-apply if no idempotency key (first flow has no client_order_id; second flow has client_order_id for idempotent create).

---

## SECTION 3 — LOCKING & RISK ENGINE

### Worst-case enforcement

- **Market BUY:** `effective_price = best_ask × (1 + MARKET_ORDER_SLIPPAGE_BUFFER)`, lock and spot risk use this. Decimal.js and ROUND_DOWN in spot.fastify for this path. **Correct.**
- **Limit BUY/SELL:** Lock and risk use same price/qty with Decimal.js and ROUND_DOWN in the first flow. **Correct.**

### Race conditions

- **Place order (first flow):** Risk check runs on settlement `balances` (separate connection), then transaction locks and updates `user_balances`. Between risk check and lock, another request could consume `user_balances`; risk check did not see that. **TOCTOU:** risk uses one store, lock uses another.
- **Settlement worker:** `FOR UPDATE SKIP LOCKED` on one pending event per run; no double-processing of same row. **Safe.**
- **Poller:** Inserts events then advances cursor. If process dies after insert but before cursor update, restart re-fetches same range; `ON CONFLICT DO NOTHING` avoids duplicate rows; cursor eventually advances. **Acceptable.**

### Unlock correctness

- **Cancel:** Unlock amount = `remaining × price` (buy) or `remaining` (sell). Computed with **parseFloat** and `.toFixed(18)`. Lock was placed with Decimal.js and ROUND_DOWN (first flow). Unlock using float can differ from lock amount → **lock residual or over-unlock** over many cancels.
- **Partial fill:** Debit locked = `(matchQty * tradePrice).toFixed(18)` (float). If float rounding makes this exceed what was locked for that slice, `debitLockedTradingBalance` (locked_balance >= amount) can fail or leave negative locked if not guarded. **Precision mismatch between lock and debit.**

---

## SECTION 4 — SETTLEMENT PIPELINE

### Determinism

- Settlement worker: Prices, qty, trade value, fees from event payload; all rounded with Decimal.js ROUND_DOWN and market precision. Hash includes canonical payload + ledger lines. **Deterministic.**

### Idempotency

- One row per `engine_event_id` (poller). Worker processes each row once (status → 'processed'). Hash check prevents applying different interpretation of same event. **Idempotent.**

### Failure recovery

- Fatal errors mark event `status = 'failed'` and do not retry. Retriable errors increment retry_count; after MAX_RETRIES event marked failed. Circuit breaker halts worker on invariant violations. **Correct.**
- **Poller cursor:** If cursor is updated after inserting events, and worker has not yet processed them, restart can resume from cursor; events are already in DB. If cursor were updated before insert (it is not), events could be skipped. **Current order is correct.**

---

## SECTION 5 — PRECISION & DECIMAL SAFETY

### Rounding correctness

- **Settlement worker, spot-risk.service, first-flow place order (lock/risk):** Decimal.js and ROUND_DOWN. **Correct.**
- **runMatching (in-process spot):** All numeric operations use **parseFloat** and float arithmetic: `matchQty`, `tradePrice`, `quoteAmount`, `feeAmount`, `buyerReceivesQty`, `sellerReceivesQuote`, `newOtherFilled`, `filledIncoming`. Amounts passed to DB as `.toFixed(18)`. **Incorrect:** float is forbidden for financial calculations; rounding mode is undefined; precision loss and non-determinism.

### Precision loss vectors

- **runMatching:** `Math.min(remaining - ..., otherRemaining)` and repeated `parseFloat`/float add can accumulate error. `matchQty` can be a float; multiplying by price and passing to debit/credit can over-debit or under-credit.
- **Cancel/cancel-all:** `remaining * parseFloat(o.price || '0')` and `.toFixed(18)` — float path; can disagree with Decimal-based lock.
- **POST /spot/orders (second flow):** `quantity * price`, `parseFloat(balanceRow...)`, `parseFloat(lockAmount)` for spendable check — float. Lock amount for limit buy uses `(quantity * price).toFixed(18)`.

---

## SECTION 6 — SNAPSHOT & RECOVERY MODEL

### Divergence risks

- **Recovery:** `initializeRecoveryState()` throws `RECOVERY_INVARIANT_VIOLATION` if poller cursor is ahead of snapshot engine_event_id. Prevents advancing cursor past last consistent snapshot. **Correct.**
- **Snapshot:** Reads cursor, balances, orders in a single transaction; snapshot is append-only. Cursor check after read ensures no concurrent advance. **Correct.**

### Corruption scenarios

- If settlement worker commits balance updates but crashes before marking event processed, event stays pending; on retry, processEvent runs again. Hash is still null on first run; after commit hash is set. So second run would see same row with status still pending (if we didn’t update in same transaction). Actually status is updated inside the same transaction as balance updates, so only one commit. **No double-apply.**
- Ledger compaction: Must only delete after verifying balances match ledger-derived state; otherwise replay from ledger could diverge. (Not fully audited here.)

---

## SECTION 7 — CRITICAL RISKS

1. **Dual balance authority:** Spot risk validates `balances` (settlement) while in-process spot executes against `user_balances`. Either risk must use `user_balances` for in-process spot, or in-process spot must be removed and all orders go through engine + settlement so one balance store is used.
2. **runMatching uses floats:** Entire match loop uses parseFloat/float. Enables precision loss, non-determinism, and lock/debit mismatch. Must be rewritten to Decimal.js and ROUND_DOWN only.
3. **Lock vs debit/unlock mismatch:** Lock uses Decimal (first flow); debit in runMatching and unlock on cancel use float. Can cause residual locked balance or failed debits.
4. **Buyer fee inconsistency (in-process spot):** Risk reserves `required_quote + fee` for buyer; runMatching credits buyer full `matchQty` and only charges seller a fee. Buyer locked quote is debited `matchQty * tradePrice` only. So fee is never taken from buyer; either take taker fee from buyer in runMatching or stop reserving for it in risk (and document).
5. **No ledger for in-process spot:** Balance moves in runMatching are not append-only; cannot reconstruct balances from a log. Audit and dispute resolution are weaker.
6. **Dead schema:** `user_positions` and `risk_metrics_cache` exist in migrations; no runtime code uses them. Low operational risk but confusing and should be removed or clearly deprecated if system is strict spot-only.

---

## SECTION 8 — REQUIRED FIXES / HARDENING

### High-severity (must fix)

1. **Unify balance authority for spot**
   - Either: Use **user_balances** for spot risk when the order is fulfilled via in-process matching (e.g. validate and lock the same store: `user_balances` available vs required_quote+fee / qty), and keep settlement `balances` only for engine-settled flow.
   - Or: Remove in-process spot matching and have all spot orders go through the engine so settlement `balances` are the single execution store and spot-risk is correct.
   - Document which path is canonical for spot and ensure one balance store per path.

2. **Remove all float from spot matching and cancel**
   - **runMatching:** Replace every parseFloat/float op with Decimal.js; use ROUND_DOWN and market/quote precision for trade value and fees; pass string amounts to debit/credit/unlock. Compute matchQty with Decimal and round to qty_precision (ROUND_DOWN).
   - **Cancel / cancel-all:** Compute remaining and unlock amount with Decimal.js and ROUND_DOWN; use same precision as lock (e.g. 8 or market quote_precision).

3. **Align lock, debit, and unlock**
   - Ensure lock amount = f(price, qty) with Decimal ROUND_DOWN. Debit on fill = same formula with filled qty and execution price (Decimal, ROUND_DOWN). Unlock on cancel = same formula with remaining qty and order price. Use one shared helper so all three are consistent.

4. **Buyer fee in in-process spot**
   - Either debit taker fee from buyer’s locked quote in runMatching (and credit fee account or reduce credit) with Decimal/ROUND_DOWN, or explicitly document that only maker pays fee and stop reserving buyer fee in risk for this path.

### Medium-severity (should fix)

5. **POST /spot/orders (balance_locks flow):** Replace float spendable/required math with Decimal.js and ROUND_DOWN; align with first flow’s precision and risk rules if both paths remain.
6. **Idempotency for first place-order flow:** Add client_order_id (or equivalent) and reject duplicate submissions to avoid double execution on replay.
7. **Margin/equity naming in wallet API:** wallet.fastify exposes totalEquity, marginBalance, unrealizedPnl (all zero/equivalent). Rename or document as display-only to avoid implying margin/derivatives support.

---

*End of audit. No settlement formula, ledger, or balance mutation logic was changed in the settlement worker; findings are limited to architecture, risk/lock consistency, and precision.*
