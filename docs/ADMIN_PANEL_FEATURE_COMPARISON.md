# Admin Panel — Feature Comparison vs Top-Tier Exchanges (Binance-style)

**Purpose:** Compare your exchange admin panel with your own feature audit and with what top-tier CEXs (Binance, Coinbase-style) typically offer. Clear view of **what you have**, **what is done**, and **what remains / not done**.

---

## 1. What Top-Tier Exchanges Typically Have (Binance-style)

| Area | Typical CEX Admin Capabilities |
|------|--------------------------------|
| **Dashboard** | Real-time KPIs (users, volume, KYC stats, P2P, referrals), trading halt, AML/withdrawal risk summary, system health |
| **User Management** | List/search users, view profiles, freeze/suspend/lock with **reason stored & audited**, role-based who can suspend |
| **KYC / Identity** | Pending/approved/rejected queues, review/approve/reject with **immutable audit**, KYC settings, document storage |
| **Compliance / AML** | **Alerts list** (filter, sort), **alert detail**, update status, **escalate to STR/CTR**, **STR/CTR reports list** and submit/acknowledge, dashboard metrics |
| **Wallet & Funds** | Deposits/withdrawals lists, manual credit **audited + role-gated**, balance reconcile (Super Admin) **with UI**, escrow list + **freeze/unfreeze UI** |
| **Spot Trading** | Markets, orders, trades, halt, circuit breakers, fees, market control |
| **P2P** | Orders, trades, disputes (resolve), ads, merchants, payment methods, **escrow visibility & freeze/unfreeze** |
| **Finance & Ledger** | Ledger entries, settlement, funds summary, **balance-reconcile form** (Super Admin) |
| **Security & Risk** | AML center, **actionable alerts**, audit logs (immutable), sessions, IP/risk rules, **withdrawal risk/limits view** |
| **Audit & Logs** | **All high-impact actions** in immutable audit: manual credit, user status, KYC, escrow freeze, balance reconcile |
| **Roles & Permissions** | **UI to manage roles**, assign permissions to admins, restrict manual credit / withdrawal approval by role |
| **System Config** | Settings, features, blockchains, tokens, pairs, P2P assets, maintenance, API |
| **Monitoring** | Counters, system health, trading halt |

---

## 2. What Your System Has (Done / Implemented)

### ✅ Dashboard
- **Done:** `/admin/dashboard` — stats (users, KYC, P2P, referrals), trading halt toggle.
- **Backend:** `/admin/dashboard/stats`, trading halt.
- **Gap:** No AML/withdrawal risk summary on dashboard.

### ✅ User Management
- **Done:** `/admin/users`, suspended, `[id]`, banned, verification, tiers; list, get by id, PATCH status (active/suspended/locked); freeze/unfreeze on user detail.
- **Gap:** No role restriction on who can suspend; **reason not stored or audited** (see Section 4).

### ✅ KYC / Identity
- **Done:** `/admin/kyc/pending`, approved, rejected, settings; GET pending/approved/rejected, KYC review/approve/reject.
- **Gap:** **No immutable audit for KYC approve/reject** (see Section 4).

### ⚠️ Compliance / AML (Partial)
- **Done:** `/admin/security/compliance` — **dashboard metrics only** (open alerts, high severity, STR/CTR pending, etc.).
- **Backend:** Full AML APIs: `/admin/aml/dashboard`, `/admin/aml/alerts`, alerts by id, status, escalate; STR/CTR reports.
- **Not done in UI:** Alerts list, alert detail, update status, escalate to STR, STR/CTR report list or submit/acknowledge. **FIU-India workflows are not operator-usable from the panel.**

### ✅ Wallet & Funds
- **Done:** `/admin/wallets/*` — deposits, withdrawals, manual-credit, funds-summary, hot/cold/ledger/settlement, balance-reconcile (Super Admin) in backend.
- **Gap:** Manual credit **not role-restricted**, **not in immutable audit**; **no UI for balance-reconcile**; **no escrow list/freeze-unfreeze in UI** (backend has routes).

### ✅ Spot Trading
- **Done:** `/admin/trading/*` — spot-markets, orders, trade-history, fees, circuit-breakers, market-control. Adequate for control.

### ✅ P2P
- **Done:** `/admin/p2p/*` — trades, orders, disputes (resolve favor_buyer/favor_seller/cancelled), ads, merchants, settings, payment-methods.
- **Gap:** Escrow freeze/unfreeze **backend only** — no admin UI to list escrows or freeze/unfreeze.

### ✅ Finance & Ledger
- **Done:** `/admin/wallets/ledger/balance`, settlement, funds-summary. Reconciliation visibility.
- **Gap:** Balance-reconcile is Super Admin only and **no UI** to trigger it from the panel.

### ✅ Security & Risk (Partial)
- **Done:** `/admin/security/*` — compliance (metrics), fraud, audit-logs, sessions, ip-rules, risk-rules, withdrawals, dashboard.
- **Gap:** No **withdrawal risk/limits** view (token limits, velocity); AML alerts not actionable in UI.

### ✅ Audit & Logs
- **Done:** `/admin/security/audit-logs` — read from `audit_logs_immutable`.
- **Gap:** Many high-impact actions **do not write** to `audit_logs_immutable` (manual credit, user status, KYC, escrow freeze) — see Section 4.

### ⚠️ Roles & Permissions (Partial)
- **Done:** Backend admin auth with role/permissions; withdrawal approve uses `getAdminForWithdrawalApproval`; hot wallet and balance-reconcile use `requireSuperAdmin`.
- **Not done:** **Roles page is placeholder.** No UI to create/edit roles, assign permissions, or view who has what. No restriction of manual credit by role.

### ✅ System Configuration
- **Done:** `/admin/settings`, features, blockchains, tokens, trading-pairs, p2p-assets, maintenance, api.

### ✅ Monitoring & Health
- **Done:** `/admin/monitoring/counters`, `/admin/system-health`; trading halt, stats.

### ✅ Additional Areas in Your Panel
- **Done:** Notifications (SMS, email, push, announcements), Fees (trading, withdrawal, promotions, tiers), Referrals (campaigns, relationships, codes, commissions), Support (tickets, responses), Reports (users, trading, financial, P2P, custom), Deposits/Withdrawals (pending, completed, flagged, manual-credit, pending-approval, etc.).

---

## 3. What Is REMAINING / NOT DONE (Prioritized)

### P0 — Critical (Compliance / Audit)
| Item | Status | Notes |
|------|--------|------|
| **Manual credit → immutable audit** | ❌ Not done | Add `logAuditFromRequest` (or `logAudit`) to manual credit route (actor, amount, currency, user id, reason). |
| **User status change → immutable audit** | ❌ Not done | Add audit to PATCH users/:id/status; **store and log reason**. |
| **AML alerts list + detail + escalate to STR in UI** | ❌ Not done | Build UI over existing `/admin/aml/*` APIs so operators can list alerts, open detail, update status, escalate to STR. |
| **KYC approve/reject → immutable audit** | ❌ Not done | Log KYC decisions to `audit_logs_immutable` (actor, application id, decision, timestamp). |

### P1 — High (Compliance & RBAC)
| Item | Status | Notes |
|------|--------|------|
| **STR/CTR reports list and submit/acknowledge in UI** | ❌ Not done | Completes FIU reporting workflow in admin. |
| **Roles & Permissions UI** | ❌ Not done | List roles, assign permissions to admins, restrict manual credit (e.g. only "finance" or "balance:credit"). |
| **Manual credit restricted by role** | ❌ Not done | Today any admin can credit; should require e.g. finance role or permission. |

### P2 — Medium (Operational Visibility & Control)
| Item | Status | Notes |
|------|--------|------|
| **Escrow list + freeze/unfreeze UI** | ❌ Not done | Backend has GET escrows, POST freeze/unfreeze; add admin pages and buttons. |
| **Store and audit "reason" for user suspend/freeze** | ❌ Not done | Persist reason (column or audit payload) and ensure it is in audit log. |
| **Balance reconcile form (Super Admin)** | ❌ Not done | UI: user_id, asset, reason; call POST balance-reconcile. |
| **Escrow freeze/unfreeze in audit_logs_immutable** | ⚠️ Verify | Confirm admin routes call `logAudit`/`logAuditFromRequest` for freeze/unfreeze. |

### P3 — Nice to Have
| Item | Status | Notes |
|------|--------|------|
| **Multi-approval (4-eyes)** for manual credit or large withdrawals | ❌ Not done | Policy + second approver. |
| **Withdrawal risk view** | ❌ Not done | Token limits, per-user or velocity summary from AML data. |
| **Consolidate Deposits/Withdrawals nav** | ❌ Not done | Single "Wallet & Funds" with sub-items; remove/redirect duplicate top-level Deposits/Withdrawals. |
| **AML/withdrawal risk summary on dashboard** | ❌ Not done | Surface key risk metrics on main dashboard. |

---

## 4. Summary Table — Your Audit vs Binance-style

| Module | Your audit says | vs Binance-style | Main gap |
|--------|-----------------|------------------|----------|
| Dashboard | Y, no AML/withdrawal risk on dashboard | Expected: risk summary | Add AML/withdrawal risk widgets |
| User Management | Y, no role restriction, no reason stored/audited | Expected: reason + audit | Audit + store reason; optional role restriction |
| KYC | Y, no audit_logs_immutable for approve/reject | Expected: full audit | Log KYC decisions to immutable audit |
| Compliance/AML | **Partial** — metrics only in UI | Expected: alerts list, detail, escalate, STR/CTR | **Build full AML center UI** |
| Wallet & Funds | Y, manual credit not audited, no reconcile UI, no escrow UI | Expected: audit, reconcile form, escrow control | Audit manual credit; add reconcile + escrow UIs |
| Spot / P2P | Y | Match | Minor: escrow freeze/unfreeze in UI |
| Security & Audit | Y, but many actions not in audit | Expected: all high-impact in audit | **Extend audit to manual credit, user status, KYC, escrow** |
| Roles & Permissions | **Partial** — placeholder UI | Expected: manage roles & permissions in UI | **Implement RBAC admin UI** |
| System / Monitoring | Y | Match | — |

---

## 5. One-Line Summary

**Done:** Dashboard, user list/status, KYC flows, wallet operations (deposits, withdrawals, manual credit, funds summary, hot/cold, ledger), spot control, P2P (including dispute resolve), security pages (audit logs, sessions, IP, risk rules), settings, monitoring, notifications, fees, referrals, reports, support.

**Not done / remaining:**  
(1) **Immutable audit** for manual credit, user status change, and KYC approve/reject;  
(2) **Full AML center in UI** (alerts list, detail, escalate to STR, STR/CTR reports);  
(3) **Roles & Permissions UI** and role-gating of manual credit;  
(4) **Escrow list + freeze/unfreeze UI**;  
(5) **Balance-reconcile form** (Super Admin);  
(6) **Store and audit reason** for user suspend/freeze;  
(7) Optional: withdrawal risk view, 4-eyes approval, nav consolidation, dashboard risk summary.

This document aligns with `docs/ADMIN_PANEL_AUDIT.md` and adds the Binance-style comparison and a single place to track what is done vs remaining.
