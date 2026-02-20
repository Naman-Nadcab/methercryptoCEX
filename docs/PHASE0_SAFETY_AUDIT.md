# Phase-0 Safety Audit — Adversarial Invariant Audit

**Context:** Production-grade CEX; Spot + P2P only; ledger & user_balances = single source of truth.  
**Assumption:** Real funds; races, crashes, retries; admin panel is high-risk.  
**Scope:** Tasks 1–4 only; Phase-0 hard safety blockers; minimal corrections, no redesign.

---

## SECTION A — Detected Invariant Risks

### A.1 — Spot reservation vs settlement (CRITICAL)

**Two order placement paths with different reservation authorities:**

| Path | Route | Reservation | Matching | Settlement worker |
|------|--------|-------------|----------|-------------------|
| **A** | POST /spot/order | **user_balances** (trading) via `lockTradingBalance` | In-request `runMatching`; debits/credits via spot-balance.service | **Not used** — runMatching applies balance changes in same tx |
| **B** | POST /spot/orders | **balance_locks** only | None in code (“No matching”) | Consumes **user_balances** (trading) locked |

**Invariant risk:**

- Settlement worker (settlement-worker.ts) processes `settlement_events` and **only** debits/credits **user_balances** (account_type = 'trading') with FOR UPDATE. It expects **locked** balance to exist for taker/maker.
- Path A never produces `settlement_events`; it applies fills synchronously in runMatching via `debitLockedTradingBalance` / `creditTradingBalance`. So Path A is self-consistent: lock in user_balances → match → debit locked / credit in same tx.
- Path B reserves only in **balance_locks**. No code path in the repo matches Path B orders or emits settlement_events for them. **If** any process (current or future) matches Path B orders and inserts settlement_events, the settlement worker will run and will **fail** with `INSUFFICIENT_LOCKED_FUNDS` because user_balances (trading) locked was never increased for Path B orders.
- **Worst case:** If settlement were ever changed to “proceed without checking locked” for certain events, or if a bug created settlement_events for Path B orders and settlement logic were relaxed, **asset creation** (credit without corresponding debit) or **double-spend** could occur. Today, the failure mode is **safe** (settlement fails, circuit can trip) as long as no code path creates settlement_events for Path B orders without first locking user_balances.

**Split-brain:**

- **Reservation authority is split:** Path A = user_balances (trading); Path B = balance_locks. Settlement has a **single** consumption model: user_balances (trading). So Path B reservation is **invisible** to settlement.
- **Cancel Path B:** POST /spot/orders/:orderId/cancel only deletes from balance_locks and updates spot_orders; it does **not** touch user_balances. So Path B is internally consistent (reserve/release both in balance_locks). The risk is only if Path B orders are ever fed into a flow that produces settlement_events.

**Conclusion:** Invariant “no execution without locked funds” is **held** for Path A. For Path B, “no execution” currently holds because nothing matches them; **if** any matching path is ever wired to Path B orders and emits settlement_events without locking user_balances first, the invariant would be violated (settlement would fail or, with a bad change, could create/destroy value). **Phase-0:** Treat as single canonical reservation authority (user_balances) and align Path B or deprecate it.

---

### A.2 — Spot schema / code consistency

**Code (spot.fastify.ts, spot-orderbook-cache.service.ts):**

- All spot_orders / spot_trades queries use column **`market`** (VARCHAR, symbol e.g. BTC_USDT).
- INSERT spot_orders: `(user_id, market, side, type, price, quantity, filled_quantity, status)` or with `client_order_id`.
- SELECT/UPDATE/WHERE use `market = $1`, `o.market`, etc.
- Orderbook cache: `WHERE market = $1 AND side = 'buy'` (and sell).

**Schema:**

- **migrate.ts** (canonical migrations): Creates `spot_orders` with **`market VARCHAR(30) NOT NULL`** and `spot_trades` with **`order_id`**, **`user_id`**, **`market`**. So **migrate.ts is consistent with code.**
- **full-schema.sql**: Defines `spot_orders` with **`trading_pair_id`** and different structure; `spot_trades` with **`maker_order_id`**, **`taker_order_id`**, etc. If a deployment was created from full-schema.sql (or an older branch), **runtime would throw** “column market does not exist” (or “order_id” / “user_id” missing in spot_trades).

**Risks:**

- **Cross-deployment:** Any DB created from full-schema.sql (or schema with trading_pair_id / maker_order_id) will cause spot routes and orderbook cache to fail at runtime. Order placement, cancel, orderbook, trade history would all 500.
- **Cross-market contamination:** If both `market` and `trading_pair_id` existed and were populated differently, queries filtering by `market` could return wrong set. With current code there is no such dual column; risk is from schema drift.
- **Cache:** Orderbook cache key is `spot:orderbook:${symbol}`; DB uses `market`. If symbol and market ever diverged, cache could be wrong. Currently they are the same value (e.g. BTC_USDT).

**Conclusion:** With **migrate.ts-applied** schema, code and schema are consistent. With **full-schema.sql** (or trading_pair_id-only) schema, code is **broken** at runtime. **Phase-0:** Confirm deployed DB has `spot_orders.market` and `spot_trades.order_id`/`user_id`/`market`; if not, apply migrations that add/align these columns (no redesign).

---

### A.3 — Immutable audit coverage

**Verified from admin.fastify.ts and audit-log.service.ts:**

| Flow | Writes to audit_logs_immutable? | Notes |
|------|--------------------------------|--------|
| Withdrawal approve | **Yes** | logAuditFromRequest after approve |
| Withdrawal reject | **Yes** | logAuditFromRequest after reject |
| **Manual credit** | **No** | Only logger.info; no logAudit / logAuditFromRequest |
| **User status change** (PATCH users/:id/status) | **No** | No logAudit; reason in body not stored |
| Balance reconcile (settlement) | **Yes** | operator-controls.service logAudit |
| Hot wallet / withdrawal signing | Separate tables (hot_wallet_audit_log, audit_logs) | Not audit_logs_immutable |
| KYC approve/reject | **Uncertain** | Not verified in this pass; flag for explicit check |

**Risks:**

- **Manual credit:** No immutable forensic trail. Who credited whom, amount, reason, and when cannot be proven from audit_logs_immutable. Insider abuse or mistake cannot be reconstructed; compliance/fraud investigations impaired.
- **User status change:** Suspend/lock/activate not in audit_logs_immutable; reason accepted but not stored. FIU/AML justification for restriction cannot be proven.

**Conclusion:** **Missing immutable audit** for manual credit and user status change. Phase-0: add logAuditFromRequest (or equivalent) and, for status change, store or log reason.

---

### A.4 — Manual credit permission hardening

**Current:**

- POST /admin/deposits/manual-credit uses `getAdminFromRequest(app, request, reply, **false**)`. So **any** authenticated admin can call it. No role or permission check (e.g. super_admin, or finance:credit).
- Withdrawal approve uses `getAdminForWithdrawalApproval` (role withdrawal_approver / super_admin or permission withdrawals:approve). Manual credit has **no** equivalent.

**Risks:**

- **Overprivilege:** Single compromised admin account can credit any user, any amount, any currency. No separation of duties.
- **Governance:** No way to restrict “who can credit” without code change.

**Conclusion:** **Overprivilege.** Phase-0: enforce a dedicated role or permission for manual credit (e.g. require super_admin or permission like balance:credit) using existing getAdminFromRequest(..., true) or a new helper that checks a specific permission.

---

## SECTION B — Confirmed Safe Areas

- **Path A (POST /spot/order):** Lock in user_balances (trading) via lockTradingBalance; runMatching in same tx debits locked and credits via spot-balance.service; insertBalanceLedger for all balance changes. Cancel unlocks via unlockTradingBalance. **Single reservation authority for this path; no settlement_events; consistent.**
- **Deposit credit:** Atomic UPDATE deposits WHERE balance_applied_at IS NULL; FOR UPDATE user_balances; credit + ledger in one tx. Idempotent; no double credit.
- **Withdrawal:** Lock at request (user_balances); debit only after broadcast in same tx as status=completed; refund on final failure with ledger. Idempotency-Key and FOR UPDATE in approval/reject.
- **Manual credit:** Idempotency-Key required; Redis cache and lock; balance update + insertBalanceLedger in one transaction. **Ledger and balance consistent;** only audit and permission are weak.
- **Settlement worker:** Consumes settlement_events; FOR UPDATE user_balances (trading); applies deltas and writes settlement_ledger_entries; replay-safe by settlement_event_id. No settlement path in codebase produces events for Path B orders.
- **P2P:** Escrow in user_balances (escrow_balance); lock/release with ledger; idempotency on create/release; FOR UPDATE on order/dispute.
- **Balance ledger:** Every user_balances mutation path audited uses insertBalanceLedger in same flow (deposit, withdrawal, spot-balance, p2p-escrow, operator-controls, admin manual-credit).

---

## SECTION C — Catastrophic Failure Scenarios

**C.1 — Path B orders matched by a process that emits settlement_events**

- **Scenario:** An external or future matching engine reads spot_orders (including those created by Path B), produces trades and inserts into settlement_events.
- **Failure mode:** Settlement worker runs, expects user_balances (trading) locked for taker/maker. Path B never locked user_balances → INSUFFICIENT_LOCKED_FUNDS; event fails and can be retried or marked failed. **No asset creation today** because settlement does not proceed without sufficient locked balance.
- **If** someone changed settlement to “proceed without locked check” or to “create balance” for missing lock: **insolvency / asset creation** (credit without debit). So the catastrophic case is **future bad change**, not current code. **Mitigation:** Do not wire any matching to Path B orders until Path B uses user_balances (trading) lock, or deprecate Path B.

**C.2 — Schema from full-schema.sql (trading_pair_id, no market)**

- **Scenario:** Production DB created from full-schema.sql or equivalent (spot_orders has trading_pair_id, no market; spot_trades has maker_order_id/taker_order_id, no order_id/user_id/market).
- **Failure mode:** Every spot route and orderbook cache query throws (e.g. “column market does not exist”). Spot appears broken; no order placement, cancel, or orderbook. **Financial:** Users cannot trade; no silent wrong balance, but total outage.

**C.3 — Manual credit abuse with no audit**

- **Scenario:** Compromised or malicious admin credits large amounts to an account; no immutable log.
- **Failure mode:** Funds are created (ledger-consistent but unrecorded in audit_logs_immutable). Discovery and attribution after the fact are not possible from immutable audit. **Compliance and fraud risk**, not double-spend of existing balance.

**C.4 — User status change (freeze) with no audit / no stored reason**

- **Scenario:** Admin suspends a user for “FIU investigation”; reason not stored; no immutable log.
- **Failure mode:** Regulator or internal review cannot prove who froze whom or why. **Compliance risk.**

---

## SECTION D — Minimal Required Corrections (Phase-0 Only)

**D.1 — Spot reservation vs settlement (single reservation authority)**

- **Option A (preferred):** Make Path B use the same reservation as settlement. In POST /spot/orders: **replace** balance_locks reservation with **lockTradingBalance** (user_balances, account_type = 'trading'). On POST /spot/orders/:orderId/cancel: **add** unlockTradingBalance for the order’s currency and remaining amount; **keep** DELETE FROM balance_locks so any existing balance_locks row is removed (or remove balance_locks use for spot entirely so only user_balances is used). Ensure remaining quantity and currency for unlock are computed the same way as in Path A cancel (side, price, remaining qty → unlock amount).
- **Option B:** Deprecate Path B (e.g. return 410 or 400 with “Use POST /spot/order”) and document that only Path A is supported. Then no Path B orders can ever be matched; no reservation split.
- **Do not** change settlement worker or introduce a second consumption model (e.g. balance_locks) without a full design.

**D.2 — Spot schema / code consistency**

- **Verify** deployed DB: `spot_orders` has column `market`; `spot_trades` has `order_id`, `user_id`, `market`. If not, apply migrations that add/align these columns so they match migrate.ts and current code. Do **not** change code to trading_pair_id unless the whole codebase and migrations are aligned to that model.

**D.3 — Immutable audit for manual credit and user status**

- **Manual credit:** After successful credit (before reply), call `logAuditFromRequest(request, { actorType: 'admin', actorId: admin.adminId, action: 'admin_manual_credit', resourceType: 'user', resourceId: userId, newValue: { currency, amount, reason: reason ?? null, idempotencyKeyRef: idempotencyKey.slice(0, 32) } })`. Do not log full idempotency key if it contains sensitive data; a short ref is enough.
- **User status change:** After successful PATCH users/:id/status, call `logAuditFromRequest` with action e.g. `admin_user_status_change`, resourceId = user id, oldValue = previous status, newValue = { status, reason }. **Store reason:** Add optional column on users (e.g. status_change_reason) or store reason in a separate audit payload; if not stored in DB, include in newValue so it is in audit_logs_immutable.

**D.4 — Manual credit permission**

- **Minimal:** Require Super Admin for manual credit. Replace `getAdminFromRequest(app, request, reply, false)` with `getAdminFromRequest(app, request, reply, **true**)` for POST /admin/deposits/manual-credit so that only super_admin can call it. Alternatively, introduce a dedicated helper that checks permission (e.g. balance:credit or role finance) and use it for this route only.

---

## SECTION E — Verification Checklist (Post-Fix Tests)

**E.1 — Spot reservation**

- [ ] **Path B place:** Place order via POST /spot/orders (with Idempotency-Key/client_order_id). Query user_balances for that user and currency (account_type = 'trading'); locked_balance should increase by the reserved amount. If Path B was changed to use lockTradingBalance, balance_locks should not hold that reservation (or should be removed for spot).
- [ ] **Path B cancel:** Cancel the same order. user_balances locked_balance should decrease by the unlocked amount.
- [ ] **Path A unchanged:** Place via POST /spot/order; verify lock; cancel; verify unlock. runMatching still applies in same tx.
- [ ] **Settlement:** If any settlement_events exist (from an engine), run settlement worker; it should succeed when locked balance is present and fail with INSUFFICIENT_LOCKED_FUNDS when lock is missing (e.g. after reverting Path B to balance_locks-only and wiring a test event).

**E.2 — Schema**

- [ ] **DB columns:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'spot_orders'` — must include `market`. Same for spot_trades: `order_id` or maker/taker columns per schema; code must match.
- [ ] **Orderbook:** GET orderbook for a market; no 500; response has bids/asks. Place order; orderbook updates (or cache invalidates).

**E.3 — Audit**

- [ ] **Manual credit:** After one manual credit, query audit_logs_immutable for action = 'admin_manual_credit' (or chosen action); one row with actor_id, resource_id, new_value containing amount/currency/reason ref.
- [ ] **User status:** After PATCH users/:id/status with reason, query audit_logs_immutable for admin_user_status_change; reason present in old_value/new_value or stored elsewhere and referenced.

**E.4 — Permission**

- [ ] **Manual credit as non–super_admin:** With admin that is not super_admin, POST manual-credit; expect 403.
- [ ] **Manual credit as super_admin:** Expect 200 and balance + ledger updated.

---

**End of Phase-0 audit.**  
All findings are from actual code (spot.fastify.ts, spot-balance.service.ts, settlement-worker.ts, admin.fastify.ts, migrate.ts, spot-orderbook-cache.service.ts). No redesign; only minimal corrections to restore invariant safety and audit/privilege hardening.
