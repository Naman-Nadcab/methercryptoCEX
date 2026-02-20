# Admin Panel Completeness & Safety Audit
## FIU-India Compliant CEX — Strict Audit Report

**Scope:** Centralized exchange (Spot + P2P). Admin panel as read/control layer only. No direct balance mutation by design.

---

## SECTION 1 — Module Coverage Map

| Required module | Exists (Y/N) | Frontend route(s) | Backend coverage | Notes |
|-----------------|--------------|-------------------|------------------|--------|
| **Dashboard** | Y | `/admin/dashboard` | `/admin/dashboard/stats`, `/admin/trading-halt` | Stats: users, KYC, P2P, referrals. Trading halt toggle. No AML/withdrawal risk summary on dashboard. |
| **User Management** | Y | `/admin/users`, `/admin/users/suspended`, `/admin/users/[id]`, `/admin/users/banned`, `/admin/users/verification`, `/admin/users/tiers` | List, get by id, PATCH status (active/suspended/locked) | Freeze/Unfreeze UI on user detail. No role-based restriction on who can suspend. |
| **KYC / Identity** | Y | `/admin/kyc/pending`, `approved`, `rejected`, `settings` | GET pending/approved/rejected, KYC settings | Review/approve/reject flows exist. **No audit_logs_immutable for KYC approve/reject.** |
| **Compliance / AML** | Partial | `/admin/security/compliance` | `/admin/aml/dashboard`, `/admin/aml/alerts`, `/admin/aml/alerts/:id`, `/admin/aml/alerts/:id/status`, `/admin/aml/alerts/:id/escalate`, STR/CTR reports | **UI: dashboard metrics only.** No alerts list, alert detail, escalate-to-STR, or STR/CTR report list in UI. Backend AML exists. |
| **Wallet & Funds** | Y | `/admin/wallets/*`, `/admin/wallets/withdrawals`, `/admin/wallets/deposits`, `/admin/wallets/adjust`, `/admin/wallets/funds-summary`, hot/cold/ledger/settlement | Deposits, withdrawals, manual-credit, funds summary, escrows list, balance-reconcile (Super Admin) | Control plane present. Manual credit **not** restricted by role; **no audit_logs_immutable for manual credit.** |
| **Spot Trading** | Y | `/admin/trading/*`, spot-markets, orders, trade-history, fees, circuit-breakers, market-control | Markets, orders, halt, circuit breakers, fees | Adequate for control. |
| **P2P Marketplace** | Y | `/admin/p2p/trades`, `/admin/p2p/orders`, `/admin/p2p/disputes`, `/admin/p2p/disputes/[id]`, ads, merchants, settings, payment-methods | Orders, disputes, resolve (favor_buyer/favor_seller/cancelled) | Dispute resolve audited in p2p.service (auditLog). Escrow freeze/unfreeze **backend only** — no admin UI for escrow list/freeze. |
| **Finance & Ledger** | Y | `/admin/wallets/ledger/balance`, `/admin/wallets/ledger/settlement`, `/admin/wallets/funds-summary` | Ledger entries, settlement events, funds summary (ledger vs on-chain) | Reconciliation visibility present. Balance-reconcile is Super Admin only. |
| **Security & Risk** | Y | `/admin/security/compliance`, `fraud`, `audit-logs`, `sessions`, `ip-rules`, `risk-rules`, `withdrawals`, `dashboard` | AML, audit logs, sessions, IP rules, risk rules, security dashboard | Audit logs read from audit_logs_immutable. |
| **Audit & Logs** | Y | `/admin/security/audit-logs` | GET audit_logs_immutable (filtered) | Read-only. **Many high-impact admin actions do not write to audit_logs_immutable** (see Section 3). |
| **Roles & Permissions (RBAC)** | Partial | `/admin/admins/roles` | Admin auth with role/permissions; withdrawal approve uses getAdminForWithdrawalApproval; hot wallet uses requireSuperAdmin; balance-reconcile uses requireSuperAdmin | **Roles page is placeholder only.** No UI to assign roles/permissions. Backend enforces role only for withdrawal approval, hot wallet, balance-reconcile. |
| **System Configuration** | Y | `/admin/settings`, `/admin/settings/features`, blockchains, tokens, trading-pairs, p2p-assets, maintenance, api | Settings, features, blockchain/currencies, trading pairs | Present. |
| **Monitoring & Health** | Y | `/admin/monitoring/counters`, `/admin/system-health` | GET /admin/monitoring/counters (Redis), trading halt, stats | Counters and system health pages exist. |

---

## SECTION 2 — Missing / Incomplete Components

1. **Compliance / AML Center (UI)**  
   - **Missing in UI:** Alerts list (GET `/admin/aml/alerts`), alert detail, update alert status, escalate alert to STR, STR/CTR reports list and submit/acknowledge.  
   - Compliance page only shows dashboard metrics and a note to “use backend AML endpoints.” **FIU/AML workflows are not operator-usable from the panel.**

2. **Roles & Permissions (RBAC)**  
   - **Missing:** Any UI to create/edit admin roles, assign permissions, or view who has what.  
   - Backend has roles (e.g. super_admin, withdrawal_approver) and permissions (e.g. withdrawals:approve) but no admin panel to manage them.

3. **Escrow freeze / unfreeze**  
   - Backend: `POST /admin/escrows/:id/freeze`, `POST /admin/escrows/:id/unfreeze`.  
   - **Missing:** Admin UI to list escrows (GET `/admin/escrows` exists) and to freeze/unfreeze from the panel. High-risk operational action with no UI.

4. **Withdrawal risk controls (visibility)**  
   - Token-level withdrawal limits exist in backend (PATCH tokens/:id/withdrawal-limits).  
   - **Missing:** No dedicated “Withdrawal risk” or “Limits” view in admin (e.g. per-user or global limits, velocity). AML velocity rules exist in backend but no admin view of configured rules or thresholds.

5. **Finance & Ledger — balance reconcile UI**  
   - Backend: `POST /admin/settlement/balance-reconcile` (Super Admin only).  
   - **Missing:** No admin form to trigger balance reconcile (user_id, asset, reason). Operators cannot run reconciliation from the panel.

6. **Deposits / Withdrawals as top-level sections**  
   - Duplicated in sidebar: “Deposits” and “Withdrawals” vs “Wallets” (Withdrawals Control, Deposits Operations).  
   - “Deposits” and “Withdrawals” link to legacy pages; control plane lives under Wallets. Redundant and can cause confusion.

---

## SECTION 3 — Dangerous Patterns / Risks

1. **Manual credit: no immutable audit trail**  
   - **Risk:** POST `/admin/deposits/manual-credit` updates `user_balances` and writes ledger, but **does not** call `logAuditFromRequest` or `logAudit` to `audit_logs_immutable`.  
   - Only `logger.info` is used. **Impact:** No immutable record of who credited whom, amount, reason, or when. Compliance and forensics gap.

2. **User status change (freeze/suspend/lock): no audit**  
   - **Risk:** PATCH `/admin/users/:id/status` (active/suspended/locked) has **no** call to `logAuditFromRequest` or `logAudit`.  
   - Body accepts `reason` but it is **not stored** and not logged. **Impact:** No trace of who suspended which user or why.

3. **Manual credit: any admin can perform**  
   - **Risk:** Manual credit uses `getAdminFromRequest(..., false)` — any authenticated admin can credit.  
   - No separate role or permission (e.g. “finance:manual_credit”). **Impact:** Overprivilege; no separation of duties.

4. **Balance-reconcile: Super Admin only but no UI**  
   - **Mitigation:** Balance-reconcile correctly requires Super Admin.  
   - **Risk:** No UI to run it; operators may call API directly without consistent process or documentation.

5. **Escrow freeze/unfreeze: no audit in admin route**  
   - `freezeEscrow` / `unfreezeEscrow` in operator-controls.service are used by admin routes.  
   - **Verify:** Whether these functions or the route call `logAudit`/`logAuditFromRequest`. If not, escrow freeze/unfreeze is not in `audit_logs_immutable`.

6. **KYC approve/reject: no audit_logs_immutable**  
   - **Risk:** KYC approval/rejection is compliance-critical. If admin KYC routes do not call `logAudit`/`logAuditFromRequest`, FIU traceability is incomplete.

7. **Only two admin routes use logAuditFromRequest**  
   - Confirmed: **only** withdrawal approve and withdrawal reject call `logAuditFromRequest`.  
   - Manual credit, user status, KYC decisions, (and possibly escrow freeze, balance reconcile) are not consistently written to `audit_logs_immutable` from admin routes.

---

## SECTION 4 — Compliance Gaps (FIU / AML / KYC)

1. **STR/CTR workflow not in admin UI**  
   - Backend has STR/CTR (pending counts, escalate, reports).  
   - Admin panel has no alerts list, no “escalate to STR” action, no STR/CTR report list or submit/acknowledge. **FIU-India reporting cannot be done from the panel.**

2. **AML alerts not actionable in UI**  
   - Compliance page shows open/high severity and pending STR/CTR counts only.  
   - Operators cannot list, filter, or act on alerts (e.g. dismiss, escalate) from the panel.

3. **KYC actions not in immutable audit**  
   - If KYC approve/reject are not logged to `audit_logs_immutable`, regulator cannot rely on the admin panel for a full audit trail of identity decisions.

4. **User freeze/suspend: reason not stored or audited**  
   - Suspend/freeze is a strong compliance action (e.g. suspicion of fraud). Reason in request body is not persisted and not in audit log. **FIU/AML justification for account restriction is not recorded.**

5. **No explicit “compliance hold” or “FIU freeze”**  
   - User status is generic (active/suspended/locked). No distinct compliance/fraud flag or hold type for reporting (e.g. “suspended for FIU investigation”).

---

## SECTION 5 — Financial Safety Risks

1. **Manual credit path is ledger-consistent but not audit-visible**  
   - Backend correctly: (1) updates `user_balances`, (2) inserts balance ledger. So **financial invariant (balance = ledger) is maintained.**  
   - **Risk:** Lack of immutable audit means misuse or error cannot be proven or disproven from logs. Operational and regulatory risk.

2. **No admin debit path**  
   - Only credit exists (manual-credit). No admin “debit” or “adjust down” in the panel.  
   - **Assessment:** Reduces risk of arbitrary balance reduction; acceptable if by design. Document that debit is intentionally not offered.

3. **Balance-reconcile is ledger-authoritative**  
   - `reconcileBalanceToLedger` sets `user_balances` to ledger sum (with reason and audit). Correct and safe.  
   - Only Super Admin can call it. **Risk:** No UI and no second-approval or maker-checker for this critical action.

4. **Withdrawal approval: correctly gated and audited**  
   - Uses `getAdminForWithdrawalApproval` (role or permission) and `logAuditFromRequest`.  
   - **No multi-approval (4-eyes)** for large or high-risk withdrawals. Single approver can approve any withdrawal within policy.

5. **P2P dispute resolve: state transition only**  
   - Resolution (favor_buyer / favor_seller / cancelled) is a state transition; backend moves escrow. No direct balance edit from admin.  
   - P2P service logs dispute resolution. **Verify** that this log goes to `audit_logs_immutable` (or equivalent) and is queryable from Security > Audit Logs.

6. **No withdrawal velocity or limit visibility in admin**  
   - AML velocity rules exist in backend. Admin cannot see “withdrawals last 24h” or velocity alerts per user in one place.  
   - Increases risk of missing suspicious patterns before or after STR filing.

---

## SECTION 6 — Priority Fix Order

| Priority | Item | Rationale |
|----------|------|------------|
| **P0** | Add `logAuditFromRequest` (or `logAudit`) to **manual credit** route — actor, amount, currency, user id, reason, idempotency key reference. | Financial and compliance: every balance-changing admin action must be in immutable audit. |
| **P0** | Add `logAuditFromRequest` to **user status change** (PATCH users/:id/status) — actor, user id, old/new status, reason (store reason in DB or in audit payload). | Compliance and dispute resolution; FIU may require justification for freezes. |
| **P0** | Add **AML alerts list + detail + escalate to STR** (and optionally status update) in Compliance UI, backed by existing `/admin/aml/*` APIs. | FIU-India: STR/CTR and alert handling must be doable from the panel. |
| **P1** | Add **STR/CTR reports list and submit/acknowledge** (or link to process) in Compliance UI. | Completes FIU reporting workflow in admin. |
| **P1** | Implement **Roles & Permissions** UI: list roles, assign permissions to admins, restrict manual credit (e.g. only role “finance” or permission “balance:credit”). | Reduces overprivilege and supports separation of duties. |
| **P1** | Add **KYC approve/reject** to immutable audit (logAudit with actor, application id, decision, timestamp). | Required for identity/AML audit trail. |
| **P2** | Add **Escrow list + freeze/unfreeze** UI (list escrows, action buttons calling existing backend). | High-impact control exists in API but not in panel. |
| **P2** | **Store and audit** “reason” for user suspend/freeze (e.g. new column or audit payload). | Needed for regulatory and internal review. |
| **P2** | Add **Balance reconcile** form (Super Admin only): user_id, asset, reason; call POST balance-reconcile. | Makes critical remediation action visible and auditable from panel. |
| **P3** | Consider **multi-approval (4-eyes)** for manual credit and/or large withdrawal approval (policy + second approver). | Reduces single-operator fraud/error risk. |
| **P3** | **Withdrawal risk** view: token limits, optional per-user or velocity summary from AML data. | Better visibility for risk and STR decisions. |
| **P3** | Consolidate **Deposits/Withdrawals** nav: single “Wallet & Funds” entry with sub-items; remove or redirect duplicate top-level items. | Clarity and consistency. |

---

**Audit complete.**  
**Assumption:** Real exchange, real money. Gaps in audit logging and AML UI are treated as P0/P1. No schema or balance logic redesign proposed; only additive audit calls and UI over existing APIs.
