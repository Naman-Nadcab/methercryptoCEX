# Admin Panel — Operational Data Completeness Audit

**Purpose:** Verify that each admin page shows complete and well-organized operational data for a Tier-1 crypto exchange.  
**Scope:** Information completeness and structure only. No UI redesign or code changes.

---

## Step 1 — Sidebar Navigation Map

Every sidebar section and page, with **page file** and **API endpoints** used.

| Section | Page (sidebar label) | Route | Page file | API endpoints used |
|--------|------------------------|-------|-----------|---------------------|
| **Dashboard** | Dashboard | `/admin/dashboard` | `(protected)/dashboard/page.tsx` | `GET /api/v1/admin/dashboard/stats`, `GET /api/v1/admin/trading-halt`, `GET /health`; WebSocket metrics |
| **Analytics** | Analytics Hub | `/admin/analytics` | `(protected)/analytics/page.tsx` | None (hub of links only) |
| **Users** | User List | `/admin/users` | `(protected)/users/page.tsx` | `GET /api/v1/admin/users` (via admin-users-api) |
| | User API Keys | `/admin/users/api-keys` | `(protected)/users/api-keys/page.tsx` | `GET /api/v1/admin/users/:userId/api-keys`, `DELETE /api/v1/admin/api-keys/:id/revoke` |
| | User Detail | `/admin/users/detail` | `(protected)/users/detail/page.tsx` | None (landing: “Go to User List”) |
| | User Risk Profile | `/admin/users/risk` | `(protected)/users/risk/page.tsx` | Fetches risk/analytics |
| | User Activity / Sessions | `/admin/security/sessions` | `(protected)/security/sessions/page.tsx` | `securityApi` (sessions, devices) |
| **Users (by ID)** | (from list click) | `/admin/users/[id]` | `(protected)/users/[id]/page.tsx` | `GET /api/v1/admin/users/:id`, `GET .../users/:id/balances`, `GET .../deposits?user=`, `GET .../withdrawals?user=`, `PATCH .../users/:id/status` |
| **KYC** | Pending Verifications | `/admin/kyc/pending` | `(protected)/kyc/pending/page.tsx` | `GET /api/v1/admin/kyc/pending`, `PATCH /api/v1/admin/kyc/:id/review` |
| | Approved / Rejected | `/admin/kyc/approved` | `(protected)/kyc/approved/page.tsx` | `GET /api/v1/admin/kyc?status=approved` |
| | KYC Audit Trail | `/admin/kyc/audit` | `(protected)/kyc/audit/page.tsx` | KYC audit APIs |
| | KYC Settings | `/admin/kyc/settings` | `(protected)/kyc/settings/page.tsx` | Settings APIs |
| **Wallet & Funds** | Indexer Monitor | `/admin/wallets/indexer` | `(protected)/wallets/indexer/page.tsx` | `GET /api/v1/admin/indexer/status` |
| | Wallet Operations | `/admin/wallets/operations` | `(protected)/wallets/operations/page.tsx` | Operations APIs |
| | Treasury Dashboard | `/admin/treasury` | `(protected)/treasury/page.tsx` | `GET .../hot-wallets/balances`, `.../withdrawals`, `.../deposit-sweeps`, `.../funds/summary` |
| | Deposits | `/admin/wallets/deposits` | `(protected)/wallets/deposits/page.tsx` | Deposits list |
| | Withdrawals | `/admin/wallets/withdrawals` | `(protected)/wallets/withdrawals/page.tsx` | `admin-wallets-api` (withdrawals list, reject) |
| | Manual Adjustments | `/admin/wallets/adjust` | `(protected)/wallets/adjust/page.tsx` | Manual adjust APIs |
| | Balance Summary | `/admin/wallets/funds-summary` | `(protected)/wallets/funds-summary/page.tsx` | Funds summary |
| | Hot / Cold Wallet Monitor | `/admin/wallets/hot` | `(protected)/wallets/hot/page.tsx` | `GET /api/v1/admin/hot-wallets`, `PATCH .../hot-wallets/:chainId` |
| | Cold Wallet Reserves | `/admin/wallets/cold-reserves` | `(protected)/wallets/cold-reserves/page.tsx` | Phase-2 cold reserves APIs |
| | Reconciliation | `/admin/wallets/reconciliation` | `(protected)/wallets/reconciliation/page.tsx` | `GET /api/v1/admin/settlement/balance-reconcile` |
| | Balance Ledger | `/admin/wallets/ledger/balance` | `(protected)/wallets/ledger/balance/page.tsx` | `GET /api/v1/admin/ledger/balance` |
| | Settlement Ledger | `/admin/wallets/ledger/settlement` | `(protected)/wallets/ledger/settlement/page.tsx` | `GET /api/v1/admin/ledger/settlement` |
| **Deposits (top-level)** | Deposits | `/admin/deposits` | `(protected)/deposits/page.tsx` | `GET /api/v1/admin/deposits` (list, stats, filters) |
| | Manual Credit | `/admin/deposits/manual-credit` | `(protected)/deposits/manual-credit/page.tsx` | `POST /api/v1/admin/deposits/manual-credit` |
| **Withdrawals (top-level)** | Withdrawals | `/admin/withdrawals` | `(protected)/withdrawals/page.tsx` | `GET .../withdrawals`, `POST .../withdrawals/:id/approve`, `.../reject` |
| | Pending Approval | `/admin/withdrawals/pending-approval` | `(protected)/withdrawals/pending-approval/page.tsx` | `GET .../withdrawals?status=pending_approval` |
| **Spot Markets** | Market Management | `/admin/markets` | `(protected)/markets/page.tsx` | `GET/PATCH /api/v1/admin/spot/markets` |
| | Listing / Delisting | `/admin/trading/listing-status` | `(protected)/trading/listing-status/page.tsx` | `GET/PATCH .../trading/listing-status` |
| | Market Pairs | `/admin/trading/spot-markets` | `(protected)/trading/spot-markets/page.tsx` | Spot markets APIs |
| | Order Monitoring | `/admin/trading/orders` | `(protected)/trading/orders/page.tsx` | `GET /api/v1/admin/spot/orders` |
| | Trade History | `/admin/trading/trade-history` | `(protected)/trading/trade-history/page.tsx` | `GET /api/v1/admin/spot/trades` |
| | Market Making | `/admin/market-making` | `(protected)/market-making/page.tsx` | Trading/market-making APIs |
| | Circuit Breakers | `/admin/trading/circuit-breakers` | `(protected)/trading/circuit-breakers/page.tsx` | `GET .../spot/markets`, `POST .../circuit-reset` |
| | Fee Controls | `/admin/trading/fees` | `(protected)/trading/fees/page.tsx` | Fee APIs |
| | Market Halt Controls | `/admin/trading/market-control` | `(protected)/trading/market-control/page.tsx` | `GET/PATCH .../spot/markets`, circuit-reset |
| **P2P** | P2P Overview | `/admin/p2p` | `(protected)/p2p/page.tsx` | `GET /api/v1/admin/trading` (or p2p overview) |
| | Active Trades, Orders, Escrows, Disputes, Merchants, Payment Methods, P2P Settings | Various | Corresponding `(protected)/p2p/*.tsx` | P2P disputes, orders, escrows, etc. |
| **Compliance** | Sanctions, Sanctions Config, STR/CTR, Circuit Breaker History, Risk Intelligence, AML Alerts, Reports, Cases, AML Dashboard | Various | `(protected)/compliance/*.tsx`, `security/compliance` | `.../compliance/sanctions`, `.../aml/alerts`, `.../aml/reports`, `.../compliance/str-ctr/*`, etc. |
| **Security** | Rate Limits, Geo Blocking, Network Risk, Audit Logs, Admin Audit, Sessions, IP Rules, Withdrawal Risk, Risk Rules, Security Dashboard | Various | `(protected)/security/*.tsx`, `rate-limits/page.tsx` | `.../security/*`, `.../aml/dashboard` |
| **Governance** | Forensics, Proof of Reserves, User Behavior, System Reliability, Playbooks | Various | Corresponding `(protected)/*.tsx` | Analytics/operational endpoints |
| **Exchange Control** | Control Center | `/admin/control-center` | `(protected)/control-center/page.tsx` | `GET /api/v1/admin/control/overview`, `GET/POST .../trading-halt` |
| | API Monitoring | `/admin/api-monitoring` | `(protected)/api-monitoring/page.tsx` | `GET /api/v1/admin/analytics/api-metrics` |
| | Others (Automation, Smart Alerts, Incidents, Orderbook/Liquidity/Revenue intel, etc.) | Various | Corresponding pages | Various analytics/operations APIs |
| **System** | System Config, Price Oracle, Operations, Settings, Withdrawal Tier Limits, 2FA, Liquidity SLA, Scheduled Compliance, Alert Channels, Backups, API Settings, Feature Flags, Blockchain, Engine Recovery, System Health, Integrations, Counters | Various | `(protected)/system-config/page.tsx`, `settings/*.tsx`, `engine/recovery-status`, etc. | `.../settings`, `.../trading-halt`, `.../compliance/*`, `.../operational/backups`, etc. |
| **Finance & Fees** | Fee Configuration, Revenue Metrics, Referral System | `/admin/fees/trading`, `reports/financial`, `referrals/campaigns` | Corresponding pages | `.../fees/*`, `.../referrals/*` |
| **Support & Reports** | Support Tickets, Reports / Exports, Notifications | `/admin/support`, `reports`, `notifications` | Corresponding pages | Support and report APIs |
| **Admin Users** | Admin List, Roles & Permissions, Activity Log | `/admin/admins`, `admins/roles`, `admins/logs` | `(protected)/admins/page.tsx`, etc. | Admin CRUD, roles, audit |

**Note:** Some sidebar links point to the same or overlapping data (e.g. “Deposits” under Wallets vs top-level Deposits; “Withdrawals” under Wallets vs Withdrawals; “Risk Intelligence” listed twice under Compliance). User detail is reached from the **User List** via `/admin/users/[id]`; “User Detail” in the sidebar is a landing page that directs to the list.

---

## Step 2 — Page Data Audit (Summary)

For each area we summarize: **what is displayed**, **APIs used**, **gaps**, **fragmentation**, and **operational sufficiency**.

- **Dashboard:** Stats (users, KYC, P2P, referrals), trading halt, health, multiple charts. **Sufficient** for a high-level ops view. Real-time updates via WebSocket.
- **Analytics Hub:** Link hub only; no data on the page. **Missing:** at least summary metrics or quick stats on the hub.
- **User List:** Paginated list, search, status/KYC filters, link to user detail. **Good.** User detail is only via `/admin/users/[id]` (from list click), not from “User Detail” sidebar.
- **User Detail (`/admin/users/[id]`):** See Step 3. **Gaps:** country, risk score, open orders, trade history, volume/fees, login/sessions/IP/2FA, KYC docs, AML/sanctions, tickets/disputes.
- **KYC Pending:** List of pending applications, approve/reject with reason. **Good.** Approved/Rejected and Audit/Settings need to be checked for full workflow.
- **Wallets overview (`/admin/wallets`):** Blockchains, currencies, balances, total wallets from `GET /api/v1/admin/wallets`. **Good** entry point; deposit/withdrawal queues are on separate pages.
- **Deposits (main):** List with stats (total, pending, confirming, completed, failed, flagged), filters (user, chain, token, status, flagged). **Good** for deposit queue visibility.
- **Withdrawals:** List with filters; approve/reject from main withdrawals page and from pending-approval page. **Good** for withdrawal queue.
- **Treasury:** Hot balances, withdrawal queue sample, sweep status, cold wallets, pending count, funds summary. **Good** for treasury and movement visibility.
- **Indexer, Hot/Cold, Reconciliation, Ledgers:** Dedicated pages with specific APIs. **Good** for funds and settlement visibility.
- **Manual credit:** Form to credit user; uses `POST .../deposits/manual-credit`. **Good.**
- **Spot: Markets, Listing status, Orders, Trade history, Circuit breakers, Fees, Market halt:** Pages exist and call the corresponding admin/spot APIs. **Adequate** for trading operations monitoring and control.
- **Control Center:** Overview (trading halt, settlement pending, spot metrics, markets), halt/resume, cancel orders. **Good** for exchange control.
- **Compliance (Sanctions, STR/CTR, AML alerts, reports):** Pages and APIs exist; some workflows (e.g. escalate to STR, mark submitted) are implemented. **Adequate** but compliance team may want more guided workflows.
- **Security (sessions, audit logs, geo-blocking, rate limits, etc.):** Sessions/devices use `securityApi`; other pages use their respective admin security APIs. **Good** coverage; per-user session view from User Detail is missing (sessions are on a separate page filtered by user).
- **System / Settings:** Many settings are dynamic (system_settings, feature toggles, withdrawal tier limits, 2FA, liquidity SLA, scheduled compliance, alert channels, blockchain/tokens, API settings). **Good** for configurability.
- **Feature flags:** Page reads/writes feature toggles (with rollout). **Dynamic.**
- **API Monitoring:** Request latency, spot orders/trades counters from analytics. **Good** for basic API visibility; no user-facing API key or rate-limit config on this page (that’s under User API Keys and system/API settings).
- **Admin users / roles:** Admin list, roles, activity log. **Present.**

**Fragmentation:**  
- Deposit-related: “Deposits” under Wallets vs “Deposits” at top level (and deposits/manual-credit, deposits/completed, etc.).  
- Withdrawal-related: “Withdrawals” under Wallets vs “Withdrawals” at top level and “Pending approval” and “Security → Withdrawal Risk Monitor.”  
- User context: User detail (`[id]`) does not aggregate sessions, AML, disputes, tickets; those are on separate global pages with optional user filter.  
- Compliance: “Risk Intelligence” appears twice in sidebar; AML Dashboard under Security and AML Alerts under Compliance.

**Operational picture:**  
For **funds and trading**, the panel gives a **complete enough** picture: deposit/withdrawal queues, treasury, hot/cold, ledgers, reconciliation, spot orders/trades, halt, circuit breakers, fees. For **user-centric** operations (one user’s full profile, risk, and activity), the picture is **split** across User Detail, User API Keys, Sessions (filter by user), and other sections, with several data points missing on the user detail page itself.

---

## Step 3 — Deep Audit: Users Module (User Detail)

**Reach:** True user detail is **`/admin/users/[id]`** (opened from User List). Sidebar “User Detail” is a landing that links to the list.

| Data category | Present on user detail? | Notes |
|---------------|--------------------------|--------|
| **User profile** | | |
| Email | Yes | From `user` |
| Phone | Yes | From `user` |
| Country | **No** | Not displayed; backend may or may not have it |
| KYC status | Partial | Tier level shown; no explicit “verified/pending/rejected” label |
| Risk score | **No** | Not on user detail page |
| **Account** | | |
| Account status | Yes | active / suspended / locked |
| Ban status | Implicit | “Suspended” / “Locked” used as freeze; no separate “banned” flag shown |
| API keys | **No** | Separate page (User API Keys) by user ID |
| **Wallet** | | |
| All wallet balances | Yes | From `.../users/:id/balances` (token, chain, available, locked) |
| Deposit history | Yes | Last 10 from `.../deposits?user=` |
| Withdrawal history | Yes | Last 10 from `.../withdrawals?user=` |
| Internal transfers | **No** | Not shown on user detail |
| **Funds** | | |
| Total assets | **No** | Only per-token rows; no sum or “total assets” |
| Frozen funds | Partial | Locked balance per token only |
| Margin usage | **No** | N/A if no margin product; not shown |
| **Trading** | | |
| Open orders | **No** | Not on user detail |
| Trade history | **No** | Not on user detail |
| Volume statistics | **No** | Not on user detail |
| Fee paid | **No** | Not on user detail |
| Market activity | **No** | Not on user detail |
| **Security** | | |
| Login history | **No** | Not on user detail (only last_login_at) |
| IP addresses | **No** | Not on user detail |
| Sessions | **No** | Separate page; filter by user |
| Device history | **No** | Separate page; filter by user |
| 2FA status | **No** | Not on user detail |
| **Compliance** | | |
| KYC documents | **No** | Not on user detail |
| Sanctions check | **No** | Not on user detail |
| AML alerts | **No** | Not on user detail |
| Risk flags | **No** | Not on user detail |
| **Support** | | |
| Tickets | **No** | Not on user detail |
| Disputes | **No** | Not on user detail |
| Reports | **No** | Not on user detail |

**Actions on user detail:** Freeze / Unfreeze (status change with reason). No link to “User API Keys” or “Sessions” for this user from this page.

**Missing for Tier-1:**  
A single user view that aggregates: **country, risk score, open orders, trade history (and volume/fees), login/sessions/IPs/devices/2FA, KYC documents, sanctions/AML/risk flags, tickets, P2P disputes**, plus quick links to **User API Keys** and **Sessions** for that user. Today this is **partially present** (profile, status, balances, last 10 deposits/withdrawals, freeze/unfreeze) and **partially missing or on other pages**.

---

## Step 4 — Wallets & Funds Module

| Capability | Present? | Where | Notes |
|------------|----------|--------|--------|
| Deposit queue | Yes | Deposits page, Treasury (partial) | List with status filters and stats |
| Withdrawal queue | Yes | Withdrawals, Pending approval, Treasury (sample) | List and approve/reject |
| Manual adjustments | Yes | Wallets → Manual Adjustments | Manual credit and adjust flows |
| Hot wallet balances | Yes | Treasury, Hot wallet monitor, Wallets overview | Balances and hot wallet config |
| Cold wallet balances | Yes | Cold reserves, Cold page (hot-wallets response) | Cold addresses and movements |
| Treasury movements | Partial | Treasury (sweeps, withdrawal queue) | Not a single “movements” ledger view |
| Ledger entries | Yes | Balance Ledger, Settlement Ledger | Dedicated pages with filters |
| Reconciliation status | Yes | Reconciliation (Super Admin) | Trigger and view balance reconcile |

**Gaps:**  
- No single “Treasury movements” timeline (all in/out across hot/cold) on one page.  
- Deposit queue and withdrawal queue are on different sections (Deposits vs Withdrawals); both exist and are usable.  
- **Operationally sufficient** for monitoring and controlling funds; improvements would be one-place “movements” view and clearer grouping of deposit/withdrawal under Wallet & Funds.

---

## Step 5 — Trading Operations Module

| Capability | Present? | Where | Notes |
|------------|----------|--------|--------|
| Markets | Yes | Market Management, Listing status, Spot markets | List and edit status |
| Order books | Partial | Orderbook intelligence (analytics); no live orderbook on admin | Live depth typically on trading UI |
| Trades | Yes | Trade history | List with filters |
| Fees | Yes | Fee controls, Trading fees, Withdrawal fees | Config and view |
| Liquidity | Yes | Liquidity, Liquidity stability, Market making | Analytics and monitoring |
| Market makers | Yes | Market Making, MM Risk Monitor | Dedicated pages |
| Circuit breakers | Yes | Circuit Breakers, Market halt controls | View and reset |
| Trading halt | Yes | Control Center, Operations | Global halt/resume |

**Assessment:** Trading activity is **monitorable and controllable** (orders, trades, fees, liquidity, circuit breakers, halt). Orderbook is more “intelligence” than live admin orderbook; acceptable for many ops teams.

---

## Step 6 — Exchange Configuration (Dynamic vs Hardcoded)

| Setting area | Dynamic (admin UI)? | Where | Notes |
|--------------|----------------------|--------|--------|
| Trading fees | Yes | Fees (trading), Fee tiers, Promotions | APIs and pages |
| Withdrawal limits | Yes | Withdrawal tier limits (KYC), Withdrawal settings (per token) | system_settings / tokens |
| Deposit confirmations | Backend/config | Not clearly exposed in admin | Often chain config |
| KYC rules | Partial | KYC settings | May be partially env/config |
| AML rules | Yes | Compliance (sanctions config, STR/CTR, alerts) | Config and workflow |
| Feature flags | Yes | Settings → Feature Flags | DB + rollout % |
| Token listings | Yes | Blockchain / Token config, Listing status | Markets and tokens |
| Market settings | Yes | Market Management, Spot markets | Status, pairs |
| Liquidity parameters | Yes | Liquidity SLA | system_settings |
| API settings | Yes | System → API Settings | Email, SMS, KYC, etc. |
| Rate limits | Yes | Rate limit monitoring; config may be backend | Monitoring present |

**Summary:** Most exchange-critical settings are **dynamic** and manageable from the admin panel (fees, withdrawal limits, features, tokens, markets, liquidity SLA, API/integration settings). Deposit confirmations and some KYC/AML rules may still be in env or backend config.

---

## Step 7 — Admin API Management

| Capability | Present? | Where | Notes |
|------------|----------|--------|--------|
| **User API keys** | Yes | Users → User API Keys | Lookup by user ID, list, revoke |
| **API rate limits** | Monitoring only | Rate limit monitoring | View usage; limit config may be backend |
| **API monitoring** | Yes | Exchange Control → API Monitoring | Latency, spot orders/trades counters |
| **API permissions** | Per key (backend) | User API Keys show key type/usage | No admin UI to edit permission scopes |
| **Webhook settings** | Partial | Alert channels (compliance/ops) | Not “user webhooks” for trading |

**Assessment:** **User** API keys are manageable (list/revoke by user). **Platform** API (rate limit config, key management for admin/integrations) is partly in System/API Settings and partly backend. **Sufficient** for user API key operations; Tier-1 would often add explicit rate-limit and scope management in admin.

---

## Step 8 — Information Organization

**Easy to find:**  
- Main flows (dashboard, users, KYC, deposits, withdrawals, trading, control center, settings) are in the sidebar.  
- Naming is clear (e.g. “Pending Verifications”, “Withdrawal queue”, “Circuit Breakers”).

**Fragmentation / confusion:**  
- **Duplicate or overlapping entries:** “Deposits” (Wallets vs top-level), “Withdrawals” (Wallets vs top-level), “Risk Intelligence” (twice in Compliance), AML Dashboard (Security) vs AML Alerts (Compliance).  
- **User-centric data split:** Full picture for one user requires User Detail + User API Keys + Sessions (filter) + potentially AML alerts (filter), with no cross-links from User Detail.  
- **“User Detail”** in sidebar does not open a user; it opens a landing that sends you to the list. Real detail is only at `/admin/users/[id]` from the list.  
- **Analytics Hub** is links only; no at-a-glance metrics on the hub.  
- **Compliance** has many sub-pages (Sanctions, STR/CTR, Alerts, Reports, Cases, Risk Intelligence); workflow could be clearer (e.g. “Start from Alerts → escalate to STR/CTR”).

**Recommendations (data grouping, no UI change):**  
- Treat “User Detail” either as the landing it is (and rename to “Open User List to view detail”) or remove and rely on list → `[id]`.  
- Group deposit-related under one parent (e.g. “Deposits” with children: All, Manual credit, Completed, Flagged, Reports) to avoid two top-level “Deposits”.  
- Same idea for Withdrawals (All, Pending approval, Completed, Failed, Reports, Settings).  
- Remove duplicate “Risk Intelligence” in sidebar.  
- On User Detail (`[id]`), add links to “Sessions for this user” and “API keys for this user” and, if backend supports, “AML alerts for this user”.

---

## Step 9 — Tier-1 Exchange Benchmark (Binance / Coinbase / Kraken)

**What the panel already provides (aligned with Tier-1):**  
- Central dashboard with user/KYC/P2P/referral stats and trading health.  
- User list with search/filters and user-level detail (profile, status, balances, recent deposits/withdrawals, freeze).  
- KYC workflow (pending, approve/reject, audit).  
- Full funds visibility: deposits, withdrawals, manual credit, treasury, hot/cold, ledgers, reconciliation.  
- Trading: markets, listing, orders, trades, fees, circuit breakers, halt.  
- Compliance: sanctions config, STR/CTR workflow, AML alerts, reports.  
- Security: sessions, devices, audit logs, geo-blocking, rate limit monitoring.  
- System: feature flags, withdrawal limits, 2FA policy, liquidity SLA, alert channels, API/integration settings.  
- Admin RBAC and audit.

**Typical Tier-1 additions (information/ops, not UI):**  
- **Single-user 360° view:** One page (or clear tabs) with profile, country, risk score, KYC docs, balances, open orders, trade history, volume/fees, sessions/IPs/devices/2FA, AML/sanctions flags, tickets, disputes, and links to API keys.  
- **Explicit risk score** on user list and user detail (from risk engine or rules).  
- **Country** and **sanctions/AML status** on user detail.  
- **Operational reports:** Scheduled compliance, financial, and custom reports with clear export.  
- **API:** Rate limit and scope configuration in admin (if not only in backend).  
- **Support:** Ticket queue and assignment visible in admin with user context.  
- **Real-time alerts:** Alert center or notifications for critical events (beyond existing WebSocket metrics).

---

## Step 10 — Final Audit Report

### Sidebar page → data coverage (condensed)

| Area | Data coverage | Main gap |
|------|----------------|----------|
| Dashboard | High | — |
| Analytics Hub | None (links only) | Summary metrics on hub |
| Users (list) | High | — |
| User Detail (landing) | N/A | Redirect only |
| User Detail (`[id]`) | Medium | Risk, country, trading, security, compliance, support (see Step 3) |
| User API Keys | High | — |
| KYC (pending, approved, audit, settings) | High | — |
| Wallet & Funds (all sub-pages) | High | Single “movements” timeline |
| Deposits / Withdrawals | High | Slight duplication with Wallets |
| Spot (markets, orders, trades, fees, halt, circuit) | High | — |
| P2P | Present | — |
| Compliance | High | Workflow clarity, duplicate Risk Intelligence link |
| Security | High | Per-user links from User Detail |
| Exchange Control | High | — |
| System / Settings | High | — |
| Finance & Fees | Present | — |
| Support & Reports | Present | — |
| Admin Users | Present | — |

### Missing information (priority)

1. **User detail page:** Country, risk score, open orders, trade history, volume/fees, login history, IPs, sessions/devices link, 2FA status, KYC documents, sanctions/AML/risk flags, tickets, disputes.  
2. **User detail:** Total assets summary; link to “Sessions for this user” and “API keys for this user”.  
3. **Analytics Hub:** Any summary metrics or quick stats on the hub page.  
4. **Treasury:** Single “movements” or “activity” view (optional).  
5. **API:** Admin-side rate limit and scope configuration if desired for Tier-1.

### Information duplication

- Deposits: under Wallets and as top-level (and sub-pages).  
- Withdrawals: under Wallets and as top-level (and Pending approval, Security → Withdrawal Risk).  
- Risk Intelligence: two entries in Compliance.  
- AML: Security (AML Dashboard) vs Compliance (AML Alerts/Reports).

### Recommended data grouping (no UI redesign)

- **Users:** Keep list and `[id]`; add on `[id]`: risk score, country (if available), total assets, open orders, trade history, links to Sessions and API Keys for this user; optionally tabs or sections for Security and Compliance for this user when backend supports.  
- **Deposits:** One parent “Deposits” with: All, Manual credit, Completed, Flagged, Reports (or keep as-is but document single “source of truth” for queue).  
- **Withdrawals:** One parent “Withdrawals” with: All, Pending approval, Completed, Failed, Reports, Settings.  
- **Compliance:** Single “Risk Intelligence” link; keep AML Alerts and AML Dashboard but clarify “Dashboard = overview, Alerts = list”.

### Operational visibility gaps

- **Per-user operational view:** One place (or linked set of sections) for all user-related data (profile, risk, funds, trading, security, compliance, support).  
- **Analytics Hub:** At least one screen with key metrics (e.g. DAU, volume, open alerts) so the hub is informative, not only navigational.  
- **Support:** If support tickets exist, expose them with user context in admin (and optional link from User Detail).  
- **Alerts/notifications:** Central place or consistent pattern for critical ops alerts (beyond dashboard and WebSocket).

---

**Conclusion:**  
The admin panel already provides **broad and deep** coverage for a Tier-1-style exchange: funds, trading, compliance, security, and system configuration are well covered and mostly dynamic. The main gap is **user-centric completeness**: the user detail page and surrounding navigation do not yet provide (or link to) a full 360° view (risk, country, trading, security, compliance, support). Addressing that, plus light de-duplication in the sidebar and a more informative Analytics Hub, would bring information completeness and organization in line with Tier-1 expectations while keeping the panel understandable and easy to use.
