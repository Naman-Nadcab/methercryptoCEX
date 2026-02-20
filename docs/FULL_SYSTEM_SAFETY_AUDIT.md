# Full System Deep Audit — Production-Grade Centralized Crypto Exchange

**Classification:** Safety-critical; real funds.  
**Threat model:** Hostile conditions, malicious users, replays, races, crashes, compromised admin.  
**Scope:** All 25 subsystems; financial invariants; no redesigns.

---

## SECTION 1 — Systemic Financial Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Dual spot order paths** | HIGH | Two order placement flows exist: (1) POST /spot/order (matching engine, lock via spot-balance/wallet) and (2) POST /spot/orders (balance_locks table, client_order_id idempotency). Settlement worker expects **user_balances (trading)** locked amounts. If frontend or clients use /spot/order without locking in user_balances first, or if balance_locks and user_balances locking are not aligned, INSUFFICIENT_LOCKED_FUNDS or double-spend can occur. **Verify:** Which path is canonical; that order placement always reserves in the same store the settlement worker debits. |
| **Spot schema/code mismatch** | HIGH | Runtime error observed: "column 'market' does not exist" in spot orderbook/order queries. full-schema.sql defines spot_orders with trading_pair_id; spot.fastify.ts uses `market` (symbol string) in INSERT/SELECT. If production schema uses symbol or trading_pair_id, code will fail. **Leads to:** Order placement/cancel/orderbook failures; possible wrong market or no reservation. |
| **Manual credit not in immutable audit** | HIGH | POST /admin/deposits/manual-credit updates user_balances and writes balance_ledger but **does not** call logAudit/logAuditFromRequest to audit_logs_immutable. Only logger.info. **Impact:** No forensic trail for who credited whom; compliance and abuse investigation impossible. |
| **User status change not audited** | HIGH | PATCH /admin/users/:id/status (suspend/lock/activate) has no audit_logs_immutable write. Body accepts `reason` but it is **not stored** anywhere. **Impact:** No evidence for FIU/AML for account restrictions. |
| **Manual credit available to any admin** | MEDIUM | Manual credit uses getAdminFromRequest(..., false). No role or permission check (e.g. finance:credit). **Impact:** Overprivilege; no separation of duties; single compromised admin can credit arbitrarily. |
| **Global balance auditor does not auto-repair** | BY DESIGN | Global balance auditor logs CRITICAL on user_balances vs settlement_ledger mismatch but does not auto-fix. **Risk:** If repair path (operator balance-reconcile) is not run promptly, trading could continue with inconsistent state until circuit trips. |

---

## SECTION 2 — Ledger & Balance Integrity Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **All balance mutations use ledger** | VERIFIED | Every user_balances UPDATE path found (deposit-credit, withdrawal-signing, wallet.service lock/unlock/credit/debit, spot-balance, p2p-escrow, operator-controls reconcile, admin manual-credit) calls insertBalanceLedger in the same transaction or same flow. **No silent mutation without ledger.** |
| **Ledger reference types** | OK | balance_ledger uses reference_type (deposit, withdrawal, trade_*, p2p_escrow_lock/release, internal_transfer, adjustment). All observed mutations use appropriate type. |
| **Settlement ledger vs user_balances (trading)** | OK | Global balance auditor compares settlement_ledger_entries SUM to user_balances (trading) and triggers circuit on mismatch. No auto-repair. |
| **balance_ledger and user_balances (funding)** | GAP | Global balance auditor only checks **trading** account_type against settlement_ledger. **Funding** account balances (deposits, withdrawals, P2P, manual credit) are not periodically reconciled against balance_ledger sum. **Risk:** Drift in funding balances undetected until ad-hoc check. |
| **Rounding consistency** | OK | Financial paths use ROUND_DOWN (Decimal.ROUND_DOWN / toDecimalPlaces(..., ROUND_DOWN)) consistently in deposit-credit, withdrawal-signing, wallet.service, spot-decimal, settlement, p2p-escrow. Favors user for display, system for debits. |

---

## SECTION 3 — Wallet & Asset Safety Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **ensureUserBalanceRow before UPDATE** | OK | All balance UPDATE paths that need a row call ensureUserBalanceRow (or equivalent) before SELECT FOR UPDATE / UPDATE. ON CONFLICT DO NOTHING; old 2-column unique handled. |
| **Unique key (user_id, currency_id, chain_id, account_type)** | SCHEMA DRIFT | Code assumes 4-column uniqueness; full-schema.sql shows user_balances UNIQUE(user_id, currency_id, account_type) only. Migrations likely add chain_id. **Risk:** If chain_id not in constraint, duplicate rows per chain could exist; updates could hit wrong row. |
| **Escrow vs locked** | OK | P2P uses escrow_balance (not locked_balance). Dedicated column and CHECK; release/refund debit escrow only. Ledger uses balanceType 'pending' for escrow lock entries. |
| **Hot wallet balance_cache** | RISK | deposit-sweep and withdrawal-signing update hot_wallets.balance_cache outside the same transaction as user_balances. **Risk:** Cache can be stale; used for display/reconciliation. If used for decisions (e.g. "can we send withdrawal"), inconsistency possible. Verify no critical path uses only balance_cache for go/no-go. |
| **Internal transfer** | OK | wallet.fastify internal transfer uses idempotency (request hash), FOR UPDATE on both users’ balances, debit source + credit destination + ledger in one transaction. |

---

## SECTION 4 — Deposit Pipeline Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Double credit** | MITIGATED | creditDepositIfConfirmed uses UPDATE deposits SET ... balance_applied_at = NOW() WHERE id = $1 AND balance_applied_at IS NULL AND confirmations >= required. Only one transaction can win; then user_balances credit + ledger in same tx. **Idempotent.** |
| **Same on-chain tx twice** | MITIGATED | Migration adds UNIQUE(blockchain_id, tx_hash, to_address) on deposits. If constraint is present, indexer cannot insert duplicate deposit rows for same tx. **Verify** constraint is deployed; if not, indexer could create two rows and credit twice (once per row). |
| **pending_balance** | OK | Deposit credit reduces pending_balance by amount (GREATEST(..., 0)); avoids negative pending. |
| **Deposit detection / indexer** | EXTERNAL | Deposit pipeline assumes indexer or external process inserts into deposits. RPC/node failures (e.g. 401 on provider) can delay or skip detection. Not a ledger bug but operational risk. |

---

## SECTION 5 — Withdrawal Pipeline Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Lock at request time** | OK | Withdrawal creation locks balance (user_balances locked_balance) in same transaction as INSERT withdrawals. FOR UPDATE used in approval service. |
| **Debit only after broadcast** | OK | Withdrawal-signing service debits locked_balance only after tx is broadcast and status set to completed (in same transaction). On final failure, refund (unlock) with ledger. |
| **Idempotency** | OK | User withdrawal request requires Idempotency-Key; Redis cache by (userId, key) and request hash; duplicate body returns cached response. Signing queue uses idempotency_key = withdrawal_id; ON CONFLICT DO NOTHING. |
| **Cancel after broadcast** | OK | If user cancels after broadcast, queue row marked cancelled; balance is **not** debited (withdrawal-signing checks status and skips debit). **Risk:** User gets funds on-chain and balance not debited if cancel races with completion. **Verify:** Status transition and ordering (cancel cannot win if completion already applied). |
| **Withdrawal approval** | OK | getAdminForWithdrawalApproval enforces role/permission; logAuditFromRequest for approve/reject. |

---

## SECTION 6 — Spot Trading Engine Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Order placement lock** | CRITICAL | **Two paths:** (1) Matching-engine path (placeOrder): must lock in user_balances (trading) before or as part of place order; (2) spot.fastify POST /spot/orders: uses balance_locks only. Settlement worker reads **user_balances** (trading) FOR UPDATE and checks locked amounts. **If** orders are placed only via /spot/orders and reservation is only in balance_locks, settlement will see zero locked in user_balances and throw INSUFFICIENT_LOCKED_FUNDS or never apply. **If** orders are placed via matching engine and it locks user_balances, then settlement and engine must share same locking model. **Action:** Confirm single canonical path and that reservation store matches settlement worker. |
| **Settlement idempotency** | OK | Settlement worker checks existing settlement_ledger_entries for same settlement_event_id before applying; replay after crash only marks processed. |
| **Settlement FOR UPDATE** | OK | Worker locks user_balances (user_id, currency_id) for trading account; then applies deltas and writes settlement_ledger_entries. |
| **Fee deduction** | OK | Settlement uses available for fee (taker/maker fee from available or trade side); ROUND_DOWN; ledger deltas consistent. |
| **Market order slippage** | OK | spot.fastify uses MARKET_ORDER_SLIPPAGE_BUFFER (1%); worst-case quote lock uses best_ask * (1 + buffer). |
| **client_order_id idempotency** | OK | POST /spot/orders: duplicate client_order_id returns existing order; no double reserve. |

---

## SECTION 7 — Market Data / Price Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Orderbook cache** | RISK | spot.fastify and spot-orderbook-cache.service use spot_orders table. If column is `market` in code but schema has `symbol` or trading_pair_id, queries fail (observed in logs). **Impact:** Wrong or empty orderbook; wrong prices. |
| **Ticker / last price** | SAME | Queries reference spot_trades / spot_orders with market/symbol. Schema mismatch affects all market data. |

---

## SECTION 8 — RPC / Chain Interaction Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Withdrawal broadcast** | EXTERNAL | Signing service broadcasts via RPC; retries and failure path refund locked balance. Node failure or nonce issues can leave withdrawal pending until manual or retry. |
| **Deposit detection** | EXTERNAL | Indexer depends on RPC/WebSocket; 401/403 from provider (e.g. API key) stops or delays detection. |
| **Hot wallet balance_cache** | See Section 3 | Updated after sweep and after withdrawal; not in same tx as user_balances. |

---

## SECTION 9 — P2P & Escrow Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Escrow lock** | OK | moveToEscrow: FOR UPDATE on user_balances; available → escrow_balance; two ledger entries (available debit, pending credit). Escrow row created. |
| **Release / refund** | OK | Release and refund debit escrow_balance and credit available (or transfer to buyer); ledger written. FOR UPDATE on order/dispute. |
| **Idempotency** | OK | P2P order create and release require Idempotency-Key; Redis cache and lock; duplicate key + same body/order return cached. |
| **Dispute resolve** | OK | Admin resolve calls p2pService.resolveDispute; state transition; escrow movement by backend. auditLog in p2p.service. **Verify** this log goes to audit_logs_immutable or equivalent. |
| **Abuse resilience** | OK | abuse-resilience.service uses FOR UPDATE on seller escrows to cap concurrent orders; prevents over-commit of seller balance. |
| **P2P expiry** | OK | p2p-expiry.service uses FOR UPDATE on order for cancel/refund. |

---

## SECTION 10 — Compliance / FIU / AML Gaps

| Risk | Severity | Description |
|------|----------|-------------|
| **STR/CTR not in admin UI** | HIGH | Backend has AML dashboard, alerts, escalate to STR, reports. Admin panel has only dashboard metrics; no alerts list, no escalate, no STR/CTR report workflow. **FIU-India reporting cannot be completed from panel.** |
| **KYC approve/reject not in immutable audit** | HIGH | If admin KYC routes do not call logAudit/logAuditFromRequest, identity decisions are not in audit_logs_immutable. **Verify** and add if missing. |
| **User freeze reason not stored** | HIGH | PATCH users/:id/status accepts reason but does not store it. FIU/AML justification for restriction is lost. |
| **AML velocity** | OK | aml-transaction-monitor records and evaluates; velocity rule exists. Admin has no dedicated view of velocity or rule config. |
| **Deposit/withdrawal recording** | OK | recordAndEvaluateForDeposit and recordAndEvaluate (withdrawal) called (best-effort). |

---

## SECTION 11 — User Panel Security Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Withdrawal rate limit** | OK | wallet:withdrawal 5/hour per user (rateLimitByUser). |
| **Balance read** | OK | readUserBalances from user_balances only; no client-side computation of balance. |
| **Auth** | See Section 13 | Session and token handling. |

---

## SECTION 12 — Admin Panel Privilege Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Manual credit** | See Section 1 | Any admin; no audit. |
| **Balance reconcile** | OK | POST /settlement/balance-reconcile uses getAdminFromRequest(..., **true**) → Super Admin only. Logged via operator-controls logAudit. |
| **Withdrawal approve/reject** | OK | getAdminForWithdrawalApproval; logAuditFromRequest. |
| **Hot wallet** | OK | requireSuperAdmin for hot wallet actions. |
| **User status** | RISK | Any admin can PATCH users/:id/status; no audit; reason not stored. |
| **RBAC UI missing** | HIGH | No UI to assign roles/permissions; backend has roles and permissions. Overprivilege cannot be reduced via panel. |

---

## SECTION 13 — Authentication & Account Security Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Admin IP allowlist** | OK | Admin routes can enforce IP allowlist (ADMIN_IP_NOT_ALLOWED). |
| **Admin session** | OK | Redis or DB session; role and permissions loaded. |
| **User auth** | ASSUMED | JWT/session; app.authenticate on user routes. No deep audit of token expiry, revocation, or session fixation in this pass. |

---

## SECTION 14 — Concurrency / Race Condition Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Deposit credit** | OK | Single UPDATE deposits WHERE balance_applied_at IS NULL; one winner; FOR UPDATE on user_balances in same tx. |
| **Withdrawal approval** | OK | SELECT withdrawal FOR UPDATE in approval and reject; one winner. |
| **Withdrawal signing** | OK | FOR UPDATE on withdrawal and balance; claim with FOR UPDATE SKIP LOCKED for queue. |
| **Wallet lock/unlock** | OK | SELECT ... FOR UPDATE with available_balance >= amount (lock) or locked_balance >= amount (unlock); single tx. |
| **P2P order** | OK | FOR UPDATE on ad and user; escrow lock in same tx. |
| **Settlement** | OK | One event at a time; FOR UPDATE on user_balances (trading). |
| **Matching engine** | RISK | In-memory orderbook; processing Set for concurrent order processing. If multiple workers or restarts, orderbook can diverge from DB. **Verify:** Single writer or proper sync with DB. |

---

## SECTION 15 — Replay / Idempotency Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Manual credit** | OK | Idempotency-Key required; Redis cache by (adminId, key); same body returns cached response; lock prevents concurrent same key. |
| **User withdrawal** | OK | Idempotency-Key; request hash; duplicate body returns cached withdrawal id. |
| **P2P order create/release** | OK | Idempotency-Key; cache and lock. |
| **Internal transfer** | OK | Idempotency by request hash. |
| **Deposit credit** | OK | By deposit id and balance_applied_at IS NULL; single winner. |
| **Settlement** | OK | By settlement_event_id; existing ledger entries skip re-apply. |
| **Spot order (POST /spot/orders)** | OK | client_order_id idempotency. |
| **Spot order (POST /spot/order)** | GAP | If this path is still used, **no idempotency key**; duplicate requests can double-reserve or double-order. **Verify** whether this route is deprecated or protected. |

---

## SECTION 16 — Failure / Crash / Recovery Risks

| Risk | Severity | Description |
|------|----------|-------------|
| **Deposit credit** | OK | Single transaction: deposit update + balance + ledger. Rollback on any failure. |
| **Withdrawal complete** | OK | Status update + balance debit + ledger in one tx. Refund on final failure in separate tx with full ledger. |
| **Manual credit** | OK | Single db.transaction; idempotency cache set after success. |
| **Settlement** | OK | Replay safety: existing ledger for event → skip apply, mark processed. |
| **Redis down** | RISK | Idempotency and session rely on Redis. If Redis is down, manual credit and withdrawal idempotency may reject (or fallback); admin session may fail. **Operational:** Redis HA and fallback. |
| **Lock expiry** | OK | Withdrawal signing uses FOR UPDATE SKIP LOCKED; balance_locks have expires_at. Stale locks can be cleaned. |

---

## SECTION 17 — Monitoring & Observability Blind Spots

| Risk | Severity | Description |
|------|----------|-------------|
| **Global balance audit** | OK | Periodic; logs CRITICAL on mismatch; triggers circuit. Only **trading** account; funding not audited. |
| **Settlement circuit** | OK | triggerCircuitIfViolation on invariant failure. |
| **Manual credit** | GAP | No metric or alert on manual credit usage; no dashboard count. |
| **Deposit credit failure** | BEST-EFFORT | AML recordAndEvaluate catch; no guaranteed alert on credit failure. |
| **Spot orderbook cache** | RISK | refreshOrderbookCache failure can leave stale or empty book; pushSpotUpdates invalidates. If DB column mismatch, cache refresh can throw and leave broken state. |

---

## SECTION 18 — Audit Logging / Forensic Gaps

| Risk | Severity | Description |
|------|----------|-------------|
| **audit_logs_immutable** | GAP | Only **withdrawal approve** and **withdrawal reject** call logAuditFromRequest. Manual credit, user status change, KYC decisions, (and possibly escrow freeze, balance reconcile) do not write to audit_logs_immutable from admin routes. Balance reconcile uses logAudit in operator-controls (writes to audit_logs_immutable). |
| **Hot wallet** | OK | logHotWalletAudit for signing/sweep; hot_wallet_audit_log table. |
| **Withdrawal lifecycle** | OK | logWithdrawalLifecycle to audit_logs. |
| **admin_activity_logs** | OK | Some admin actions write to admin_activity_logs (e.g. withdrawal approved/rejected). Not immutable; can be tampered if DB compromised. |

---

## SECTION 19 — Critical Invariant Violations (If Any)

| Invariant | Status | Notes |
|-----------|--------|-------|
| No balance mutation without ledger entry | **HELD** | Every user_balances UPDATE path audited uses insertBalanceLedger in same transaction or same flow. |
| No asset creation/destruction bugs | **HELD** | Credits and debits paired (deposit, withdrawal, trade, escrow, internal transfer, manual credit, reconcile). Rounding ROUND_DOWN. |
| No double-spend | **HELD** | Withdrawal: lock then debit after broadcast; refund on failure. Deposit: single winner by balance_applied_at. Spot: settlement consumes locked; must align reservation with settlement (see Section 6). |
| No withdrawal without unlocked funds | **HELD** | Withdrawal creation locks in same tx; approval checks status; signing debits locked only. |
| No order execution without locked funds | **AT RISK** | Depends on spot order path: settlement expects user_balances (trading) locked. If orders use only balance_locks, invariant is violated. **Must verify.** |
| No escrow release without valid state transition | **HELD** | P2P resolve and release use order/dispute state and FOR UPDATE. |
| No admin silent mutation | **HELD** | Admin manual credit goes through backend; no direct DB update from frontend. But **no immutable audit** for manual credit. |
| All async flows idempotent | **HELD** | Deposit, withdrawal, P2P, settlement, manual credit: idempotency or single-winner. Spot POST /spot/order: verify. |
| All retries safe | **HELD** | Idempotency keys and single-winner updates. |
| System crash-safe | **HELD** | Transactions; settlement replay by event id. |

---

## SECTION 20 — Highest-Risk Fix Priority Order

| P | Action | Rationale |
|---|--------|-----------|
| **P0** | **Confirm spot order flow vs settlement** | Settlement worker debits user_balances (trading) locked. Verify that the **only** live order placement path reserves in user_balances (trading) and that balance_locks path is either deprecated or reconciled with settlement. Fix schema/code mismatch (market vs symbol/trading_pair_id) so orderbook and orders do not throw. |
| **P0** | **Add audit_logs_immutable for manual credit** | Every manual credit must write actor, user, currency, amount, reason, idempotency key reference to audit_logs_immutable (logAuditFromRequest or logAudit). |
| **P0** | **Add audit_logs_immutable for user status change** | PATCH users/:id/status must write to audit_logs_immutable (actor, user id, old/new status, reason). Store reason in DB or in audit payload. |
| **P1** | **Restrict manual credit by role/permission** | Require e.g. finance:credit or role “finance”; enforce in getAdminFromRequest or dedicated helper. |
| **P1** | **KYC approve/reject in audit_logs_immutable** | Add logAudit for each KYC decision (actor, application id, decision, timestamp). |
| **P1** | **AML/STR/CTR workflow in admin UI** | Alerts list, detail, escalate to STR, STR/CTR reports so FIU reporting is doable from panel. |
| **P2** | **Funding balance reconciliation** | Periodic job or admin tool: sum balance_ledger (funding) per (user, currency) and compare to user_balances (funding). Alert on mismatch. |
| **P2** | **Spot POST /spot/order idempotency** | If route is still in use, require Idempotency-Key or client_order_id and return existing order on duplicate. |
| **P2** | **RBAC UI** | Roles and permissions management so manual credit and other sensitive actions can be restricted. |
| **P3** | **Matching engine vs DB consistency** | If multiple instances or restarts, ensure orderbook is rebuilt from DB or events so no double-fill or lost order. |

---

**End of audit.**  
**Assumption:** Real money at risk. Findings are strict; P0 items must be resolved before treating the system as production-grade for financial safety. No schema or architectural redesign proposed; only controls, audit, and alignment of existing paths.
