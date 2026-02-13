# Formal System Audit — Centralized Exchange (Strict Spot + P2P)

**Classification:** Production exchange safety & correctness audit (failure-mode & invariant).  
**Scope:** Backend (Fastify + TypeScript + PostgreSQL), Rust matching engine integration, ledger-authoritative accounting, Decimal.js-only monetary paths, ROUND_DOWN only, strict spot (no margin/positions), P2P escrow.

---

## SECTION 1 — IMPLEMENTED COMPONENTS VERIFIED

| Component | Status | Notes |
|-----------|--------|--------|
| **PHASE-7 Spot lifecycle (in-process)** | Implemented | spot.fastify: place order → lock (user_balances, account_type=trading) via lockTradingBalance → runMatching → debitLockedTradingBalance / creditTradingBalance; cancel → unlockTradingBalance. spot_orders, spot_trades, spot_markets. |
| **PHASE-7 Spot formulas** | Implemented | spot-decimal.ts: lockAmountQuote, lockAmountBase, debitAmountQuote, debitAmountBase, unlockAmountQuote, unlockAmountBase; ROUND_DOWN; used consistently for lock/fill/cancel. |
| **PHASE-8 Settlement (Rust path)** | Implemented | match-poller fetches engine events → INSERT settlement_events ON CONFLICT (engine_event_id) DO NOTHING; settlement-worker: ledger-first (INSERT settlement_ledger_entries then UPDATE balances), chain hash verification, GLOBAL_LEDGER_INVARIANT (SUM delta = available+locked). |
| **PHASE-8 Ledger-first** | Implemented | settlement-worker writes settlement_ledger_entries before any balance update; negative balance check before UPDATE balances. |
| **PHASE-8 Decimal in settlement** | Implemented | tradeValue, takerFee, makerFee, toNumeric; ROUND_DOWN; assertValidDecimal/assertNonNegative on price/qty. |
| **PHASE-9 Snapshot** | Implemented | snapshot-service: createSystemSnapshot reads cursor, orders, balances, ledger_chain_head; SNAPSHOT_CURSOR_MISMATCH if cursor moved; append-only. initializeRecoveryState / loadLatestSnapshot for recovery anchor. |
| **PHASE-9 Poller recovery** | Implemented | When cursor is 0, initializeRecoveryState() returns latest snapshot engine_event_id so poller resumes from anchor. |
| **PHASE-10 Strict spot (no margin)** | Implemented | No margin/position logic in spot or settlement. risk-exposure and spot-risk explicitly state no margin/derivatives. user_positions/margin tables exist in migrations but are not used by spot or P2P paths. |
| **PHASE-11 P2P escrow** | Implemented | createOrder: lock on seller (walletService.lockBalance), INSERT escrows (user_id=seller, amount, status=locked), p2p_orders. Release: UPDATE escrows released → debitLockedBalance(seller) → creditBalance(buyer). Cancel/refund: UPDATE escrows refunded → unlockBalance(seller). Dispute: resolveDispute favor_buyer/favor_seller/cancelled with same balance moves. |
| **Balance authority (funding/withdrawals)** | Implemented | user_balances (currency_id, chain_id, account_type) is single source for deposits, withdrawals, convert, internal transfer; getSpendableBalance, readUserBalances, ensureUserBalanceRow, assertBalanceInvariant. |
| **Monetary invariants (Decimal)** | Implemented | Float-eradication and invariant-shield work: parseFloat/Number forbidden in monetary paths (ESLint + whitelist); runtime assertNonNegative/assertValidDecimal at wallet and settlement boundaries; central monetary-precision (ROUND_DOWN, AMOUNT/PRICE precision). |

---

## SECTION 2 — MISSING / PARTIAL COMPONENTS

| Item | Severity | Description |
|------|----------|-------------|
| **Dual balance stores** | High | Two spot-relevant balance authorities: (1) **user_balances** (account_type=trading) used by spot.fastify and spot-balance.service; (2) **balances** (user_id, asset) used by settlement-worker and snapshot. They are not reconciled. If the Rust engine path is ever used for the same users/markets as the in-process spot path, balances and user_balances can diverge. |
| **Rust engine vs in-process spot** | High | In-process spot uses spot_orders / spot_trades / user_balances (trading). Rust path uses orders / trades / balances and settlement_events. It is unclear whether both paths are live for the same symbols or if one is legacy. If both are active, which store is shown to the user for “trading balance” is critical. |
| **P2P release idempotency** | Medium | releaseCrypto does not enforce escrow status = 'locked' before balance move. UPDATE escrows SET status = 'released' WHERE id = $1 runs unconditionally; then debitLockedBalance/creditBalance. Double-release is prevented only by debitLockedBalance failing (0 rows) and throwing; not by explicit “already released” check. Idempotent release would use WHERE id = $1 AND status = 'locked' RETURNING id and reject if 0 rows. |
| **P2P timeout/expiry** | Unknown | Order has expires_at / payment_deadline. No audit of automatic expiry (unlock/refund on timeout) was confirmed in the reviewed code paths; if missing, stale orders can leave funds locked. |
| **Settlement worker idempotency** | High | Event is marked status = 'processed' only at the end of processEvent. If the process crashes after writing ledger entries but before UPDATE settlement_events SET status = 'processed', the same event remains 'pending' and will be processed again, causing duplicate ledger rows and duplicate balance updates (double-apply). |

---

## SECTION 3 — INVARIANT VIOLATIONS (IF ANY)

| Invariant | Status | Notes |
|-----------|--------|--------|
| Single source of truth per flow | **Violation (by design)** | Spot: user_balances (trading). Settlement (Rust): balances. Funding/withdrawals: user_balances. So “single source” holds per flow but not globally across spot vs settlement. |
| Ledger = balance (Rust path) | **Held** | settlement-worker enforces SUM(ledger delta) = available + locked per (user_id, asset) and throws GLOBAL_LEDGER_INVARIANT_VIOLATION otherwise. |
| No negative balances | **Held** | user_balances: assertBalanceInvariant; settlement: explicit check before UPDATE balances. |
| Lock/debit/unlock same formula (in-process spot) | **Held** | lockAmountQuote/lockAmountBase used for lock; debitAmountQuote/debitAmountBase for fill; unlockAmountQuote/unlockAmountBase for cancel. |

---

## SECTION 4 — PRECISION / DECIMAL RISKS

| Risk | Status | Notes |
|------|--------|--------|
| parseFloat/Number in monetary paths | **Mitigated** | Post float-eradication and ESLint shield; remaining Number/parseFloat are whitelisted (counts, pagination, port, latency, Redis score). |
| Decimal → Number coercion | **None found** | No .toNumber() in backend financial logic. |
| Inconsistent rounding | **None** | ROUND_DOWN and central monetary-precision used; spot-decimal and settlement decimal-utils use ROUND_DOWN. |
| Precision drift (lock vs fill vs cancel) | **Low** | Same spot-decimal helpers used for lock, debit, unlock with same precision args; settlement uses deterministic formulas and toNumeric. |
| Market order 1.01 buffer (matching-engine.service) | **Note** | matching-engine.service (alternate path) uses `estimatedPrice * 1.01` for market buy lock; not used by spot.fastify which uses spot-decimal and slippage buffer in spot.fastify. |

---

## SECTION 5 — LEDGER / BALANCE SAFETY

| Check | Result |
|-------|--------|
| Ledger-first in settlement-worker | Yes. Ledger entries inserted, then chain verified, then balances updated. |
| Cross-store mismatch | Yes. user_balances (trading) vs balances are separate; no single cross-store validation. Spot-risk.service documents both: validateSpotOrderRisk (balances) vs validateSpotOrderRiskUserBalances (user_balances). |
| Balance drift across subsystems | Possible. If Rust engine settles into balances while UI/API shows user_balances (trading), displayed “trading balance” can diverge from balances. |

---

## SECTION 6 — LOCKING SAFETY

| Check | Result |
|-------|--------|
| Lock/fill/cancel same formula (in-process spot) | Yes. lockAmountQuote/Base, debitAmountQuote/Base, unlockAmountQuote/Base from spot-decimal. |
| Residual locked funds (spot cancel) | Cancel uses remaining qty and unlockAmountQuote/Base; same formula as lock. No obvious residual. |
| Debit > locked (spot fill) | Fill uses debitLockedTradingBalance with WHERE locked_balance >= $4; assertUserBalanceUpdated throws if 0 rows. |
| Settlement path | Worker checks locked >= tradeVal/qty before building updates; throws INSUFFICIENT_LOCKED_FUNDS otherwise. |
| P2P | Lock via wallet.service.lockBalance (user_balances); release/cancel use debitLockedBalance or unlockBalance with same amount. Double-release prevented by balance update failing (0 rows), not by escrow status check. |

---

## SECTION 7 — SETTLEMENT & REPLAY SAFETY

| Check | Result |
|-------|--------|
| Ledger-first | Held. |
| Replay / idempotency at insert | Poller: ON CONFLICT (engine_event_id) DO NOTHING — same event not inserted twice. |
| Replay / idempotency at process | **Not held.** Event status set to 'processed' only at end of processEvent. Crash after ledger write but before status update leaves event 'pending'; next run reprocesses → duplicate ledger rows and duplicate balance updates. |
| Double-apply scenario | Possible: worker crash after ledger insert, before UPDATE settlement_events SET status = 'processed'. |
| Hash mismatch on retry | Hash is set only when status is set to 'processed'; on retry hash is null so no SETTLEMENT_HASH_MISMATCH. Hash does not prevent double-apply. |

---

## SECTION 8 — SNAPSHOT / RECOVERY SAFETY

| Check | Result |
|-------|--------|
| Cursor vs snapshot invariant | Snapshot creation verifies cursor unchanged (SNAPSHOT_CURSOR_MISMATCH). initializeRecoveryState throws RECOVERY_INVARIANT_VIOLATION if snapshot.engine_event_id > cursor. |
| Snapshot read-only | createSystemSnapshot only reads cursor, orders, balances, ledger head; no writes to ledger or balances. |
| Replay divergence | Poller resumes from snapshot anchor when cursor is 0. If worker double-applies (Section 7), balances can diverge from ledger sum; snapshot taken after that would capture inconsistent state. |
| Corruption scenario | If settlement_events is reprocessed after crash (double-apply), balances and ledger both grow incorrectly; snapshot would record that corrupted state. |

---

## SECTION 9 — P2P ESCROW SAFETY VERDICT

| Requirement | Status | Notes |
|-------------|--------|--------|
| Dedicated escrow accounting | Partial | Escrow row (escrows table) tracks lock; actual funds are seller’s locked balance in user_balances. No separate escrow ledger; escrow is logical. |
| Escrow isolated from wallet/spot | Yes | P2P uses user_balances (funding) via wallet.service; spot uses user_balances (trading). Same store, different account_type. |
| State machine strict | Partial | Order status and escrow status updated; release/cancel/refund check order status. Escrow status is not checked before balance move on release (double-release only fails when debitLockedBalance returns 0 rows). |
| Release idempotent | No | Second release attempt: escrow already 'released', debitLockedBalance fails → throw. Safe (no double credit) but not idempotent. |
| Refund debits escrow only | Yes | Refund path: UPDATE escrows refunded, unlockBalance(seller). No debit of available. |
| Dispute freezes funds | Yes | Dispute resolution runs in transaction; favor_buyer/favor_seller/cancelled perform release or refund as above. |
| Timeout logic | Not verified | Expiry/auto-refund on timeout not confirmed in reviewed code. |
| Double-release | Prevented by balance update (debitLockedBalance 0 rows → throw). Not by escrow status. |
| Escrow leakage | No evidence. Release/cancel/dispute all move or unlock correct amounts. |
| Unlock-from-available bug | No. Unlock only on cancel/refund; debit only on release. |

**Verdict:** P2P escrow is functionally implemented and prevents double-credit on double-release via balance update failure. Gaps: release not idempotent (no explicit escrow status = 'locked' guard), timeout/expiry logic not confirmed.

---

## SECTION 10 — CATASTROPHIC RISKS ONLY

1. **Settlement double-apply (loss/drift)**  
   If the settlement worker crashes after writing ledger entries but before marking the event 'processed', the same event is processed again: ledger entries duplicated, balances updated again → users receive double fills or double debits. **Required fix:** Make processEvent idempotent (e.g. mark event 'processing' at start and only write ledger/balance if not already processed, or use a unique constraint / guard so ledger/balance updates for the same settlement_event_id are applied once).

2. **Dual balance stores (spot vs settlement)**  
   In-process spot uses user_balances (trading); Rust settlement uses balances. If both paths can affect the same user/market, balances and user_balances will diverge and “trading balance” can be wrong or double-spent. **Required fix:** Unify authority (single store for spot) or strictly separate: either only in-process spot with user_balances, or only Rust engine with balances and no in-process spot for the same symbols.

3. **P2P double-release (mitigated but not idempotent)**  
   Double-release does not double-credit because debitLockedBalance fails. Risk is low; for robustness, release should be idempotent (e.g. UPDATE escrows SET status = 'released' WHERE id = $1 AND status = 'locked' RETURNING id; if 0 rows return success “already released” without balance move).

---

## SECTION 11 — REQUIRED FIXES ONLY

1. **Settlement worker idempotency**  
   Ensure each settlement_events row is applied at most once. Options: (a) Set status = 'processing' at start of processEvent and only proceed if status was 'pending'; after full success set 'processed'. On retry, skip rows already 'processing' or 'processed'. (b) Or: make ledger insert and balance update conditional on “first time” (e.g. unique on (settlement_event_id, user_id, asset) for ledger deltas, or check existing ledger rows for this event before applying). No change to business logic or schema semantics beyond adding idempotency.

2. **Balance authority clarity**  
   Decide and enforce: either (a) in-process spot is the only spot path and Rust/settlement is disabled or for different use, or (b) Rust engine is canonical and in-process spot is deprecated, with a single balance store for spot. Document and enforce so that no user can trade the same market via both paths.

3. **P2P release idempotency**  
   In releaseCrypto (and dispute favor_buyer): update escrow only when status = 'locked', e.g. `UPDATE escrows SET status = 'released', released_at = NOW() WHERE id = $1 AND status = 'locked' RETURNING id`. If 0 rows, treat as “already released” and return success without performing balance move.

---

**Audit complete.** No style or refactor recommendations; only failure-mode and invariant findings and required fixes as above.
