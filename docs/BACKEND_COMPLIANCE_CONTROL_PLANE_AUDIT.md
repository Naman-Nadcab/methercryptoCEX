# Backend Compliance & Control-Plane Audit

**Exchange type:** Centralized (CEX) — Spot + P2P only  
**Backend:** Fastify + TypeScript + PostgreSQL  
**Single source of truth:** `user_balances`  
**Scope:** FIU-IND compatibility, auditability, admin observability, financial traceability, operator/compliance console completeness.  
**Constraints:** No schema changes, no architectural redesign, no refactors. Findings only.

---

## SECTION 1 — Fund Traceability & Auditability

### 1.1 Deposits

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ✅ PRESENT & SAFE | `deposit-credit.service`: `creditDepositIfConfirmed` / `applyBalanceForOneCompletedDeposit` — single transaction: deposit status + `balance_applied_at` + `user_balances` UPDATE + `insertBalanceLedger` with `referenceType: 'deposit'`, `referenceId: depositId`. |
| Ledger writes always present | ✅ PRESENT & SAFE | Every credited deposit path uses `insertBalanceLedger` in same transaction. |
| Silent balance mutations | ✅ NONE | Credit only after atomic UPDATE ... `balance_applied_at IS NULL`; idempotent. |
| tx_hash / references immutable & queryable | ✅ PRESENT & SAFE | `deposits.tx_hash` stored; admin GET `/admin/deposits` returns `tx_hash`, `credited_at`, status. DB indexes support query by deposit id. |

### 1.2 Withdrawals

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ✅ PRESENT & SAFE | Debit on approve: `withdrawal-approval.service` → wallet lock/debit + `insertBalanceLedger` (withdrawal). Signing/broadcast: `withdrawal-signing.service` sets status failed with `failed_reason`; no second balance mutation (funds already debited on approve). |
| Ledger writes always present | ✅ PRESENT & SAFE | Wallet service `debitLockedBalance` / lock paths use `insertBalanceLedger`. Reject path: `withdrawal-approval.service` does not mutate balance (only status); no ledger needed. |
| Silent balance mutations | ✅ NONE | All withdrawal balance changes go through wallet service + ledger. |
| tx_hash / references immutable & queryable | ✅ PRESENT & SAFE | `withdrawals.tx_hash`, `failed_reason`, `rejection_reason` stored. Admin GET `/admin/withdrawals` returns them. Lifecycle logged via `logWithdrawalLifecycle` (audit_logs). |

### 1.3 Internal Transfers

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ✅ PRESENT & SAFE | `wallet.fastify` internal transfer: debit sender + credit recipient in one transaction; both use wallet service and `insertBalanceLedger` with `referenceType: 'internal_transfer'`, `referenceId` (withdrawal id or transfer ref). |
| Ledger writes always present | ✅ PRESENT & SAFE | Confirmed in wallet flow: ledger inserts for both sides. |
| Silent balance mutations | ✅ NONE | None identified. |

### 1.4 P2P Escrow Flows

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ✅ PRESENT & SAFE | `p2p-escrow.service`: lock/release/refund use wallet service (`lockBalance` / `unlockBalance` / `creditBalance` / `debitLockedBalance`) and `insertBalanceLedger` with `p2p_escrow_lock` / `p2p_escrow_release`. |
| Ledger writes always present | ✅ PRESENT & SAFE | All escrow balance changes go through wallet service + ledger. |
| Silent balance mutations | ✅ NONE | None identified. |

### 1.5 Spot Trades — Matching-Engine Path

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ⚠ PRESENT BUT RISKY | `matching-engine.service`: uses `walletService.debitLockedBalance` / `creditBalance` (trade settlement). Wallet service always calls `insertBalanceLedger`, but **ledger ref not passed**: `ledgerRef` defaults to `referenceType: 'adjustment'` and `referenceId: crypto.randomUUID()`. So balance_ledger has rows for the trade but **not linked to trade id**; forensic link trade ↔ ledger requires correlation by time/user/amount, not by reference_id. |
| Ledger writes always present | ✅ PRESENT & SAFE | Ledger insert present for every credit/debit in wallet service. |
| tx_hash / references immutable & queryable | ⚠ PRESENT BUT RISKY | `transactions` table stores trade reference; `balance_ledger.reference_id` for these entries is random UUID, not trade id. `balance_ledger` has index on `(reference_type, reference_id)` but spot entries use `adjustment` + random UUID. |

### 1.6 Spot Trades — Settlement-Worker Path

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ✅ PRESENT & SAFE (separate ledger) | `settlement-worker.ts`: updates `user_balances` (account_type = `trading`) from `settlement_ledger_entries`. **No writes to `balance_ledger`**. Traceability is via **settlement domain only**: `settlement_events` (with hash), `settlement_ledger_entries` (hash chain), `settlement_trades`. Ledger-first: entries written before balance update. |
| Silent balance mutations | ✅ NONE | All mutations driven by settlement_ledger_entries; replay detection and idempotency by engine_event_id. |
| tx_hash / references immutable & queryable | ✅ PRESENT & SAFE | Event hash and entry hashes stored; reconciliation and global auditor use settlement_ledger_entries. |

### 1.7 Conversions (Convert Flow)

| Check | Result | Notes |
|-------|--------|--------|
| Balance mutation traced to event | ✅ PRESENT & SAFE | Convert flow uses wallet lock/credit/debit + `insertBalanceLedger` (ref type and id from conversion). |
| Ledger writes always present | ✅ PRESENT & SAFE | Confirmed in convert.fastify + wallet service. |

### 1.8 Admin Manual Credit & Operator Reconcile

| Check | Result | Notes |
|-------|--------|--------|
| Ledger writes always present | ✅ PRESENT & SAFE | Admin manual credit: `admin.fastify` uses transaction, FOR UPDATE, assertBalanceInvariant, `insertBalanceLedger` (referenceType `'adjustment'`, UUID refId). Operator reconcile: `operator-controls.service` updates `user_balances` and calls `insertBalanceLedger` (adjustment) + `logAudit`. |

### 1.9 Summary — Traceability Gaps

| Gap | Classification |
|-----|----------------|
| **Spot (matching-engine):** Ledger rows not tied to trade id (reference_id = random UUID, reference_type = adjustment) | ⚠ PRESENT BUT RISKY — traceability by correlation only. |
| **Settlement path:** Uses separate ledger (`settlement_ledger_entries`) not `balance_ledger` — two ledger models for spot | ✅ Documented; traceability present but in settlement domain. |
| **No admin API to query `balance_ledger` or `settlement_ledger_entries`** for forensic reconstruction | ❌ MISSING / NOT OBSERVABLE — see Section 3. |

---

## SECTION 2 — Compliance & Monitoring Signals

### 2.1 Suspicious Activity & Risk Detection

| Mechanism | Result | Notes |
|-----------|--------|--------|
| Risk engine | ✅ PRESENT & SAFE | `risk-engine.service`: `evaluateAndLogRisk` — computes score from signals (velocity, P2P order velocity, etc.), writes to `security_risk_events`; high-risk (challenge/block) also to `audit_logs_immutable`. |
| AML transaction monitoring | ⚠ PRESENT BUT RISKY | `aml-transaction-monitor.service`: `recordTransaction` → `aml_transaction_logs`; `evaluateTransactionForAlerts` → velocity, large fiat INR, large crypto withdrawal, high-risk country → `aml_alerts`. **Not wired at runtime:** `recordAndEvaluate` is **not called** from any route (withdrawal/deposit handlers). Comment in code says "import and call from withdrawal/deposit handlers" but no such calls. So `aml_transaction_logs` and velocity/large-txn alerts are **not populated** by live flows. |
| Velocity (withdrawals) | ⚠ PRESENT BUT RISKY | AML velocity rule exists (N withdrawals in 24h → alert) but depends on `recordAndEvaluate` being called on withdrawal — currently not. Risk engine has `getWithdrawalVelocity` and uses it in signals; risk decisions are logged to `security_risk_events`. So **withdrawal velocity affects risk score** but **AML velocity alerts are not fed** because AML log is not written on withdrawal. |
| P2P abuse / velocity | ✅ PRESENT & SAFE | `abuse-resilience.service`: P2P order velocity (max orders per user per hour), escrow cap; calls `evaluateAndLogRisk`; `exchange-monitoring.service`: `recordAbuseEvent` (velocity_exceeded, escrow_cap, etc.) — Redis counters + log emit. |
| Trade manipulation indicators | ❓ UNVERIFIABLE FROM CONTEXT | No dedicated trade-manipulation (wash, spoofing) detection module found; matching engine and settlement record trades but no backend logic for manipulation flags. |

### 2.2 Where Risk / Monitoring Data Lives

| Store | Result | Notes |
|-------|--------|--------|
| `security_risk_events` | ✅ PRESENT & SAFE | Persisted; admin can query (e.g. withdrawal review uses latest risk decision per user). |
| `aml_alerts` | ✅ PRESENT & SAFE | Table and AML admin API exist; **populated only if** `recordAndEvaluate` (or equivalent) is called on txn — currently not for deposit/withdrawal. |
| `aml_transaction_logs` | ⚠ PRESENT BUT RISKY | Table and STR/CTR reporting use it; **not populated** for deposits/withdrawals (no handler calls). |
| Exchange monitoring (invariant, escrow, settlement, abuse, operational) | ⚠ PRESENT BUT RISKY | Redis counters + logger emit only; **no persistent DB table**. Admin cannot query "count of invariant_violation" or "velocity_exceeded" from API; only via Redis or log aggregation. |

### 2.3 Admin-Queryable Compliance Signals

| Signal | Result | Notes |
|--------|--------|--------|
| AML dashboard & alerts | ✅ PRESENT & SAFE | `admin-aml.fastify`: dashboard, list/filter alerts, get alert, update status, escalate to STR. |
| STR/CTR reports | ✅ PRESENT & SAFE | `aml-reporting.service` + admin AML routes: list reports, get report, submit, acknowledge. |
| Risk decisions (block/challenge) | ✅ PRESENT & SAFE | `admin-security.fastify`: dashboard uses `security_risk_events` (block/challenge counts); withdrawal detail includes latest risk decision. |
| Velocity / abuse counters | ❌ MISSING / NOT OBSERVABLE | Exchange-monitoring writes to Redis + logs only; no admin API to read these counters. |

---

## SECTION 3 — Admin / Operator Observability

### 3.1 Deposit States & Visibility

| Item | Result | Notes |
|------|--------|--------|
| Deposit states (pending / confirming / completed / failed / cancelled) | ✅ PRESENT & SAFE | Admin GET `/admin/deposits`: status, confirmations, required_confirmations, credited, credited_at, tx_hash, from_address, to_address, block_number, block_timestamp, is_flagged. |
| Swept state | ✅ PRESENT & SAFE | GET `/admin/deposit-sweeps`, eligibility, run; sweep status and error_message in deposit_sweeps. |

### 3.2 Withdrawal States & Failure Reasons

| Item | Result | Notes |
|------|--------|--------|
| Withdrawal status & failure/rejection reasons | ✅ PRESENT & SAFE | Admin GET `/admin/withdrawals`: status, tx_hash, completed_at, failed_reason, processed_at, approved_by, rejected_by, rejection_reason. |
| Withdrawal lifecycle audit | ✅ PRESENT & SAFE | `logWithdrawalLifecycle` used at create, approve, reject, sign, internal complete, sweep; stored in `audit_logs`. |

### 3.3 Wallet / Treasury State

| Item | Result | Notes |
|------|--------|--------|
| Funds summary (ledger totals vs on-chain) | ✅ PRESENT & SAFE | GET `/admin/funds/summary`: ledger_totals (from user_balances SUM by chain/token), on_chain_totals (hot/cold), reconciliation status. |
| User balances | ✅ PRESENT & SAFE | GET `/admin/users/:id/balances`. |
| Hot wallet state & history | ✅ PRESENT & SAFE | GET `/admin/hot-wallets`, balances, history; hot wallet audit in `hot_wallet_audit_log`. |

### 3.4 User Risk State & History

| Item | Result | Notes |
|------|--------|--------|
| Latest risk decision per user (e.g. for withdrawal) | ✅ PRESENT & SAFE | Withdrawal review endpoint returns `latest_risk_decision` from `security_risk_events`. |
| Risk events list (admin) | ✅ PRESENT & SAFE | GET `/admin/security/audit-logs` (audit_logs_immutable); security dashboard uses security_risk_events counts. |
| AML alerts per user | ✅ PRESENT & SAFE | AML alerts API filterable by user; alert detail includes user_id. |

### 3.5 Escrow State & Disputes

| Item | Result | Notes |
|------|--------|--------|
| P2P disputes (open / under_review) | ✅ PRESENT & SAFE | GET `/admin/p2p/disputes`: disputes with order, buyer, seller, amounts. |
| Dispute resolve | ✅ PRESENT & SAFE | PATCH `/admin/p2p/disputes/:id/resolve`; p2pService resolves and releases/refunds escrow; P2P_DISPUTE_RESOLVED audit. |
| Escrow state per order | ❓ UNVERIFIABLE FROM CONTEXT | P2P order status visible via admin P2P orders; explicit "escrow state" API not enumerated. |

### 3.6 Trade Activity Audit Trails

| Item | Result | Notes |
|------|--------|--------|
| Trades (spot) | ✅ PRESENT & SAFE | Admin trading endpoints; settlement_trades / orders / transactions tables. |
| Balance ledger (canonical) | ❌ MISSING / NOT OBSERVABLE | **No admin API** that returns rows from `balance_ledger` (by user, date, reference_type, etc.). Forensic reconstruction of user balance history from the single source of truth ledger is **not** exposed to admin/compliance. |
| Settlement ledger | ❌ MISSING / NOT OBSERVABLE | **No admin API** that returns `settlement_ledger_entries` or settlement event detail for spot path; reconciliation/auditor use it internally but not exposed as operator API. |

### 3.7 Operator / Admin Action Traceability

| Item | Result | Notes |
|------|--------|--------|
| Immutable audit log | ✅ PRESENT & SAFE | `audit_logs_immutable`; admin GET `/admin/security/audit-logs` with filters (actorType, actorId, action, etc.). |
| Admin activity (withdrawal approve/reject, manual credit, etc.) | ✅ PRESENT & SAFE | logAuditFromRequest / logAdminActivity used on approve, reject, manual credit; stored in audit_logs_immutable / activity monitor. |

### 3.8 Backend Logic Not Observable via Admin APIs

| Logic | Result |
|-------|--------|
| Balance ledger (all funding-account mutations) | ❌ NOT OBSERVABLE — no admin endpoint for balance_ledger. |
| Settlement ledger entries (trading-account spot mutations) | ❌ NOT OBSERVABLE — no admin endpoint for settlement_ledger_entries. |
| Exchange monitoring counters (invariant, escrow, abuse, settlement events) | ❌ NOT OBSERVABLE — Redis + log only; no DB or API. |

---

## SECTION 4 — State Machine & Forensic Safety

### 4.1 Withdrawal State Machine

| Item | Result | Notes |
|------|--------|--------|
| Allowed transitions | ✅ PRESENT & SAFE | Code: `pending_approval` → `pending` (approve) or `failed` (reject); `pending` → enqueue → signing → broadcast → `completed` / `failed`. DB trigger: only `status = 'pending'` can be inserted into `withdrawal_signing_queue`. |
| Illegal transitions | ✅ NONE FOUND | Approval only from `pending_approval`; reject same; signing service validates pending. |
| State changes audited | ✅ PRESENT & SAFE | `logWithdrawalLifecycle` at create, approve, reject, signed, internal complete; audit_logs. |

### 4.2 Deposit Credit Idempotency

| Item | Result | Notes |
|------|--------|--------|
| Idempotency | ✅ PRESENT & SAFE | `creditDepositIfConfirmed`: UPDATE ... WHERE `balance_applied_at IS NULL` and confirmations met; single winner. `applyBalanceForOneCompletedDeposit` for legacy: same idea. |
| Double-credit prevention | ✅ PRESENT & SAFE | Atomic update + single transaction with balance and ledger. |

### 4.3 Dispute Resolution Flows

| Item | Result | Notes |
|------|--------|--------|
| Resolution outcomes | ✅ PRESENT & SAFE | favor_buyer, favor_seller, cancelled (split not in allowed list in route). P2P service performs escrow release/refund. |
| Audit | ✅ PRESENT & SAFE | P2P_DISPUTE_RESOLVED with admin id; dispute resolve in admin route. |

### 4.4 Wallet State Transitions

| Item | Result | Notes |
|------|--------|--------|
| Lock/unlock/credit/debit | ✅ PRESENT & SAFE | All via wallet service with ledger; assertBalanceInvariant used. |
| Hot wallet / sweep | ✅ PRESENT & SAFE | Hot wallet audit log; sweep lifecycle logged. |

### 4.5 Trading Halt / Risk Controls

| Item | Result | Notes |
|------|--------|--------|
| Trading halt | ✅ PRESENT & SAFE | `getTradingHalted()` / `isTradingHalted()`; settlement worker skips when halted. |
| Settlement circuit | ✅ PRESENT & SAFE | `getSettlementCircuitOpen()`; settlement worker skips when circuit open; recordOperationalEvent for circuit_open. |

### 4.6 Non-Auditable State Changes / Missing Forensic Metadata

| Item | Result |
|------|--------|
| Spot trade ledger ref (matching-engine) | ⚠ Ledger row exists but reference_id is random UUID, not trade id — weak forensic link. |
| Settlement path | ✅ Hash chain and event hash stored; replay and integrity enforced. |

---

## SECTION 5 — FIU-IND / Regulatory Readiness Check

### 5.1 Transaction History Reconstruction

| Capability | Result | Notes |
|------------|--------|--------|
| Per-user transaction list (deposits, withdrawals, transfers, trades) | ✅ PRESENT & SAFE | Admin deposits/withdrawals lists; user ledger (aggregated); trades via admin trading. |
| Single canonical ledger for all balance mutations | ⚠ DUAL LEDGER | Funding: `balance_ledger`; trading (settlement path): `settlement_ledger_entries`. Both are consistent with `user_balances` but two models. |
| Reconstruction of balance history from ledger only | ❌ MISSING | No admin API to query `balance_ledger` (or settlement ledger) by user/date/type — required for full forensic reconstruction without direct DB access. |

### 5.2 User ↔ Funds Relationship Clarity

| Capability | Result | Notes |
|------------|--------|--------|
| User → balances | ✅ PRESENT & SAFE | user_balances; admin user balances API. |
| User → deposits/withdrawals with tx_hash and status | ✅ PRESENT & SAFE | Admin APIs return tx_hash, status, failure reasons. |
| User → ledger entries (every balance change with ref) | ❌ MISSING | Not exposed to admin; balance_ledger has reference_type/reference_id but no API. |

### 5.3 Operator Action Traceability

| Capability | Result | Notes |
|------------|--------|--------|
| Admin actions (approve, reject, manual credit, dispute resolve, KYC, etc.) | ✅ PRESENT & SAFE | audit_logs_immutable + logAuditFromRequest / logAdminActivity; GET `/admin/security/audit-logs`. |
| Operator reconcile | ✅ PRESENT & SAFE | logAudit + insertBalanceLedger (adjustment). |

### 5.4 AML / Forensic Investigation Workflows

| Capability | Result | Notes |
|------------|--------|--------|
| STR/CTR generation and submission tracking | ✅ PRESENT & SAFE | aml_str_ctr_logs; admin list reports, submit, acknowledge. |
| AML alerts and escalation | ✅ PRESENT & SAFE | aml_alerts; admin list, update status, escalate to STR. |
| AML transaction log (per-txn) | ⚠ PRESENT BUT RISKY | Tables and logic exist; **not populated** for deposit/withdrawal (recordAndEvaluate not called). So velocity/large-txn alerts and STR/CTR data from aml_transaction_logs are incomplete. |
| Risk events (block/challenge) queryable | ✅ PRESENT & SAFE | security_risk_events; dashboard and withdrawal review. |

### 5.5 Missing Capabilities / Blind Spots / Audit Limitations

| Item | Classification |
|------|----------------|
| **balance_ledger** not exposed to admin/compliance API | ❌ MISSING — full funding-account forensic trail not queryable via backend API. |
| **settlement_ledger_entries** not exposed to admin API | ❌ MISSING — settlement spot trail not queryable via backend API. |
| **AML transaction log** not fed by deposit/withdrawal handlers | ❌ MISSING — FIU-IND transaction monitoring and velocity/large-txn alerts not driven by live flows. |
| **Exchange monitoring** (invariant, abuse, velocity counts) only in Redis/logs | ❌ MISSING — no persistent, admin-queryable store for these signals. |
| **Spot (matching-engine)** ledger rows not tied to trade id | ⚠ RISKY — traceability by correlation only. |
| **Dual ledger** (balance_ledger vs settlement_ledger_entries) for spot | ✅ Documented — both auditable internally; consolidation/query not in scope (no schema change). |

---

## Summary Table

| Category | ✅ Present & safe | ⚠ Present but risky | ❌ Missing / not observable | ❓ Unverifiable |
|----------|-------------------|----------------------|-----------------------------|-----------------|
| **Section 1** (Traceability) | Deposits, withdrawals, internal transfer, P2P, convert, manual/operator, settlement path | Spot matching-engine ledger ref; dual ledger (documented) | Admin API for balance_ledger / settlement_ledger | — |
| **Section 2** (Monitoring) | Risk engine, security_risk_events, AML alerts/reports API, P2P abuse | AML log/velocity not wired; monitoring Redis-only | Admin-queryable velocity/abuse/invariant counters | Trade manipulation detection |
| **Section 3** (Observability) | Deposits, withdrawals, funds summary, user balances, hot wallets, disputes, audit logs, admin actions | — | balance_ledger API, settlement_ledger API, monitoring API | Escrow state API detail |
| **Section 4** (State machine) | Withdrawal, deposit idempotency, dispute, wallet, halt/circuit | Spot ledger ref not trade id | — | — |
| **Section 5** (FIU-IND) | User↔funds, operator traceability, STR/CTR, risk events | AML txn log not fed; dual ledger | Ledger APIs; AML feed; monitoring persistence | — |

---

*Audit performed against the codebase with no schema changes or redesign proposed. Classifications: ✅ PRESENT & SAFE | ⚠ PRESENT BUT RISKY | ❌ MISSING / NOT OBSERVABLE | ❓ UNVERIFIABLE FROM CONTEXT.*
