# Admin Panel — Full Structure & Details Audit

**Date:** 2026-02-27  
**Scope:** Frontend admin app (Next.js), layout, routes, components, API client, auth, and backend admin routes.

---

## 1. High-Level Structure

| Layer | Location | Purpose |
|-------|----------|---------|
| **Entry** | `apps/frontend/src/app/admin/page.tsx` | Redirects to login or dashboard |
| **Login** | `apps/frontend/src/app/admin/login/page.tsx` | Admin login (email/password, JWT) |
| **Protected layout** | `apps/frontend/src/app/admin/(protected)/layout.tsx` | Sidebar + Header + auth check; wraps all authenticated pages |
| **Dashboard** | `apps/frontend/src/app/admin/(protected)/dashboard/page.tsx` | Main dashboard (welcome card, KPIs, charts, tables) |
| **All other pages** | `apps/frontend/src/app/admin/(protected)/**/page.tsx` | 177+ route segments (pages) |

**Auth flow:** Token in `localStorage` (`admin-auth-storage`). Layout calls `GET /api/v1/admin/auth/me` in background; invalid/missing token → redirect to `/admin/login`.

---

## 2. Design System (CSS)

**Scope:** Any element under `.admin-panel` (root in protected layout).

| Variable | Value | Usage |
|----------|--------|--------|
| `--admin-bg` | `#F8FAFC` | Main content & header background |
| `--admin-card-bg` | `#FFFFFF` | Cards, dropdowns |
| `--admin-card-border` | `#E5E7EB` | Card borders |
| `--admin-sidebar-bg` | `#FFFFFF` | Sidebar |
| `--admin-header-bg` | `#F8FAFC` | Header |
| `--admin-text` | `#1F2937` | Primary text |
| `--admin-text-muted` | `#6B7280` | Secondary text |
| `--admin-primary` | `#7C3AED` | Links, active states, accents |
| `--admin-success` | `#10B981` | Success / positive |
| `--admin-warning` | `#F59E0B` | Warning |
| `--admin-danger` | `#EF4444` | Danger / negative |
| `--admin-radius` | `12px` | Card border radius |
| `--admin-sidebar-w` | `260px` | Sidebar width |

**Defined in:** `apps/frontend/src/app/globals.css` (admin section).

---

## 3. Layout & Shell

### 3.1 Protected layout

- **File:** `apps/frontend/src/app/admin/(protected)/layout.tsx`
- **Behaviour:**
  - Waits for store hydration (`_hasHydrated`).
  - If no token → `null` (then redirect from client).
  - Calls `GET /api/v1/admin/auth/me` with Bearer token (non-blocking).
  - Renders: `ThemeProvider` → `AdminSessionManager` (30 min idle) → `div.admin-panel` → `Sidebar` + main area (`Header` + `main`).
- **Main area:** `lg:ml-[260px]`, `main` has `p-5 lg:p-6`.

### 3.2 Sidebar

- **File:** `apps/frontend/src/components/admin/layout/Sidebar.tsx`
- **Width:** 260px, fixed left, white bg, border-right.
- **Sections:**
  - **Logo:** “EX” box + “Exchange”.
  - **MAIN:** Dashboard only (optional “Live” badge when trading not halted).
  - **APPS & PAGES:** All other nav groups (see §4).
- **Behaviour:** Collapsible groups (ChevronDown/ChevronRight). Active link: purple left border + tinted bg. Wallet shows “HOT” badge when `pendingWithdrawals > 0`. Footer: Trading status (Live/Halted) from `getTradingHalt`.
- **APIs used:** `getWithdrawals` (stats), `getTradingHalt`.

### 3.3 Header

- **File:** `apps/frontend/src/components/admin/layout/Header.tsx`
- **Left:** Hamburger (mobile), “Search here...” (max-width search input).
- **Right:** Trading status (optional), session count, Grid icon, Theme toggle, Fullscreen, Bell (alerts dropdown), Profile (avatar + name + dropdown).
- **Dropdowns:** Alerts (pending withdrawals, open disputes); Profile (Settings link, Sign out).
- **APIs used:** `getTradingHalt`, `getDashboardStats`, `getWithdrawals`.

---

## 4. Sidebar Navigation (All Links)

Every href below has a matching `page.tsx` under `app/admin/(protected)/`.

| Section | Label | Href |
|---------|--------|------|
| **MAIN** | Dashboard | `/admin/dashboard` |
| **Users** | All Users | `/admin/users` |
| | KYC Verification | `/admin/kyc/pending` |
| | KYB Accounts | `/admin/kyc/approved` |
| | Suspended Accounts | `/admin/users/suspended` |
| **Wallet & Funds** | Wallet Monitor | `/admin/wallets/monitor` |
| | Treasury | `/admin/wallets/treasury` |
| | Deposits | `/admin/deposits` |
| | Withdrawals | `/admin/withdrawals` |
| | Hot Wallet Monitor | `/admin/wallets/hot` |
| | Cold Wallet Monitor | `/admin/wallets/cold-reserves` |
| | Blockchain Nodes | `/admin/wallets/blockchain` |
| | Funds Summary | `/admin/wallets/funds-summary` |
| **Trading** | Engine Monitor | `/admin/trading/engine` |
| | Liquidity Monitor | `/admin/trading/liquidity` |
| | Orderbook Surveillance | `/admin/trading/surveillance` |
| | Spot Markets | `/admin/trading/spot-markets` |
| | Market Management | `/admin/trading/pairs` |
| | Trading Pairs | `/admin/settings/trading-pairs` |
| | Orderbook Monitor | `/admin/trading/orderbook` |
| | Trade History | `/admin/trading/trade-history` |
| | Market Making | `/admin/market-making` |
| | Trading Fees | `/admin/fees/trading` |
| **P2P Trading** | P2P Orders | `/admin/p2p/orders` |
| | Disputes | `/admin/p2p/disputes` |
| | Payment Methods | `/admin/p2p/payment-methods` |
| | Escrow Wallet | `/admin/p2p/escrows` |
| | P2P Overview | `/admin/p2p` |
| **Risk Control** | Risk Dashboard | `/admin/risk` |
| | Withdrawal Risk | `/admin/risk/withdrawals` |
| | AML Monitoring | `/admin/compliance/alerts` |
| | STR/CTR Reports | `/admin/compliance/reports` |
| | Compliance Dashboard | `/admin/security/compliance` |
| **Reports & Analytics** | Trading Volume | `/admin/reports` |
| | Exchange Revenue | `/admin/reports/financial` |
| | User Growth | `/admin/reports/users` |
| **System Configuration** | Alert Center | `/admin/alerts` |
| | API Settings | `/admin/system/api-settings` |
| | Notifications | `/admin/notifications` |
| | Feature Flags | `/admin/settings/features` |
| | Maintenance Mode | `/admin/settings/operations` |
| | Blockchain Config | `/admin/settings/blockchain` |
| **Admin Management** | Admin Users | `/admin/admins` |
| | Roles & Permissions | `/admin/admins/roles` |
| | Admin Activity Logs | `/admin/security/admin-audit` |
| **Security** | Admin Audit Logs | `/admin/security/audit` |
| | Audit Logs | `/admin/security/audit-logs` |
| | Withdrawal Approvals | `/admin/security/withdrawals` |
| | IP Whitelisting | `/admin/security/ip-rules` |

**Total sidebar links:** 47. All have corresponding `(protected)/**/page.tsx` files.

---

## 5. Pages Not in Sidebar (Orphan / Deep Links)

These routes exist but are not in the sidebar (detail pages, sub-tools, alternate entry points):

- `dashboard` — in sidebar.
- **Users:** `/admin/users/[id]`, `/admin/users/detail`, `/admin/users/verification`, `/admin/users/tiers`, `/admin/users/api-keys`, `/admin/users/risk`, `/admin/users/banned` — not in sidebar.
- **KYC:** `/admin/kyc`, `/admin/kyc/rejected`, `/admin/kyc/review`, `/admin/kyc/settings`, `/admin/kyc/audit` — not in sidebar.
- **Wallets:** `/admin/wallets`, `/admin/wallets/hot/[chainId]`, `/admin/wallets/deposits`, `/admin/wallets/withdrawals`, `/admin/wallets/currencies`, `/admin/wallets/ledger/balance`, `/admin/wallets/ledger/settlement`, `/admin/wallets/deposit-sweeps`, `/admin/wallets/reconciliation`, `/admin/wallets/operations`, `/admin/wallets/adjust`, `/admin/wallets/indexer` — not in sidebar.
- **Deposits:** `/admin/deposits/pending`, `/admin/deposits/completed`, `/admin/deposits/flagged`, `/admin/deposits/manual-credit`, `/admin/deposits/reports` — not in sidebar.
- **Withdrawals:** `/admin/withdrawals/pending`, `/admin/withdrawals/pending-approval`, `/admin/withdrawals/processing`, `/admin/withdrawals/completed`, `/admin/withdrawals/failed`, `/admin/withdrawals/reports`, `/admin/withdrawals/settings` — not in sidebar.
- **Trading:** `/admin/trading`, `/admin/trading/orders`, `/admin/trading/order-history`, `/admin/trading/fees`, `/admin/trading/circuit-breakers`, `/admin/trading/listing-status`, `/admin/trading/market-control` — not in sidebar.
- **P2P:** `/admin/p2p/ads`, `/admin/p2p/trades`, `/admin/p2p/disputes/[id]`, `/admin/p2p/settings` — not in sidebar.
- **Compliance:** `/admin/compliance/alert`, `/admin/compliance/alerts/[id]`, `/admin/compliance/cases`, `/admin/compliance/sanctions`, `/admin/compliance/sanctions-config`, `/admin/compliance/str-ctr`, `/admin/compliance/reports/[id]`, `/admin/compliance/circuit-breaker-history` — not in sidebar.
- **Reports:** `/admin/reports/custom`, `/admin/reports/p2p`, `/admin/reports/trading` — not in sidebar.
- **Settings:** `/admin/settings`, `/admin/settings/page`, `/admin/settings/blockchain/chains`, `/admin/settings/blockchain/currencies`, `/admin/settings/blockchain/tokens`, `/admin/settings/p2p-assets`, `/admin/settings/withdrawal-tier-limits`, `/admin/settings/liquidity-sla`, `/admin/settings/maintenance`, `/admin/settings/api`, `/admin/settings/alert-channels`, `/admin/settings/scheduled-compliance`, `/admin/settings/2fa-enforcement` — not in sidebar.
- **Fees:** `/admin/fees`, `/admin/fees/tiers`, `/admin/fees/withdrawal`, `/admin/fees/promotions` — not in sidebar.
- **Notifications:** `/admin/notifications/announcements`, `/admin/notifications/email`, `/admin/notifications/sms`, `/admin/notifications/push`, `/admin/notifications/broadcast` — not in sidebar.
- **Security:** `/admin/security`, `/admin/security/dashboard`, `/admin/security/activity`, `/admin/security/audit`, `/admin/security/audit-logs`, `/admin/security/withdrawals`, `/admin/security/ip-rules`, `/admin/security/ip`, `/admin/security/risk-rules`, `/admin/security/geo-blocking`, `/admin/security/network-risk`, `/admin/security/sessions`, `/admin/security/compliance`, `/admin/security/fraud` — not in sidebar.
- **System:** `/admin/system-config`, `/admin/system-health`, `/admin/system/price-oracle`, `/admin/system/api-settings` — not in sidebar.
- **Engine:** `/admin/engine/recovery-status` — not in sidebar.
- **Monitoring:** `/admin/monitoring/counters`, `/admin/monitoring/mm-risk` — not in sidebar.
- **Other:** `/admin/alerts`, `/admin/analytics`, `/admin/markets`, `/admin/liquidity`, `/admin/liquidity-stability`, `/admin/treasury`, `/admin/revenue`, `/admin/user-risk`, `/admin/risk-intelligence`, `/admin/forensics`, `/admin/orderbook-intelligence`, `/admin/trader-intelligence`, `/admin/user-behavior`, `/admin/whale-activity`, `/admin/smart-alerts`, `/admin/automation`, `/admin/playbooks`, `/admin/incidents`, `/admin/backups`, `/admin/integrations`, `/admin/proof-of-reserves`, `/admin/support`, `/admin/support/responses`, `/admin/support/my-tickets`, `/admin/referrals/codes`, `/admin/referrals/commissions`, `/admin/referrals/campaigns`, `/admin/referrals/relationships`, `/admin/rate-limits`, `/admin/api-monitoring`, `/admin/system-reliability` — not in sidebar.

Many of these are reached from in-page links (e.g. user detail, dispute detail, hot wallet by chain).

---

## 6. Dashboard Page (Structure & Data)

- **File:** `apps/frontend/src/app/admin/(protected)/dashboard/page.tsx`
- **Layout:**
  1. **Row 1:** Welcome card (gradient, greeting, Pending Withdrawals, KYC awaiting, refresh) | 3 KPI cards (Total Volume, Total Users, Total Revenue) with sparklines.
  2. **Row 2:** Total Sales (trading volume area chart, 7d/30d).
  3. **Row 3:** Volume by market (progress bars) | Top trading pairs table.
  4. **Row 4:** Recent withdrawals table | Withdrawal summary donut.
  5. **Row 5:** Recent transactions (deposits + / withdrawals −) | User growth line chart.
  6. **Footer:** “Exchange Admin — Control center”.

**APIs used:** `getDashboardStats`, `getWithdrawals`, `getDeposits`, `getAnalyticsAll`, `getRevenue`, `getTradingVolume`, `getLiquidity`, `getUserGrowth`.

---

## 7. Frontend API Layer (Admin)

**Base:** `apps/frontend/src/lib/admin/apiClient.ts`  
- `adminFetch(path, { method, body, token, params })` → `Promise<AdminApiResponse<T>>`.  
- Base URL: `getApiBaseUrl() + '/api/v1/admin' + path`.

**Modules (all under `apps/frontend/src/lib/admin/`):**

| File | Exports / purpose |
|------|-------------------|
| `apiClient.ts` | `adminFetch`, `buildUrl`, `AdminApiResponse` |
| `users.ts` | Dashboard stats, user list, impersonation, etc. |
| `wallets.ts` | Wallets, funds summary, hot wallets, withdrawals, deposits, escrows |
| `trading.ts` | Trading halt, monitoring counters, MM risk, control overview |
| `p2p.ts` | P2P orders, disputes, ads, escrows |
| `settings.ts` | Settings endpoints |
| `analytics.ts` | Trading volume, user growth, revenue, deposits, withdrawals, liquidity, revenue breakdown, API metrics |
| `index.ts` | Re-exports all of the above |

**Other admin-related libs (root `lib/`):**  
`admin-users-api.ts`, `admin-wallets-api.ts`, `admin-analytics-api.ts`, `admin-rbac.ts` — used by some pages alongside `lib/admin/*`.

---

## 8. Auth Store

- **File:** `apps/frontend/src/store/admin-auth.ts`
- **State:** `admin`, `accessToken`, `refreshToken`, `isAuthenticated`, `isLoading`, `_hasHydrated`.
- **Persistence:** `localStorage` key `admin-auth-storage` (partialize: token, refresh, admin, isAuthenticated).
- **Actions:** `setAdmin`, `setTokens`, `login`, `logout`, `setLoading`, `setHasHydrated`.

---

## 9. Admin UI Components

| Area | Components |
|------|------------|
| **Layout** | `Sidebar`, `Header` |
| **CRM (cards)** | `KPICard`, `ChartCard`, `TableCard` (`components/admin/crm/`) |
| **Control plane** | `Panel`, `SectionHeader`, `ActionButton`, `StatusBadge`, `MetricWidget`, `DataTable` (`control-plane/`) |
| **Charts** | `TradingVolumeChart`, `RevenueChart`, `UserGrowthChart`, `DepositWithdrawChart`, `P2PActivityChart`, `TopMarketsChart`, etc. (`charts/`) |
| **UI** | `AdminPanel`, `AdminChartCard`, `AdminDataTable`, `AdminEventStream`, `AdminTabs`, `AdminMetricCard`, `AdminStatusBadge` (`ui/`) |
| **Security** | `ConfirmDialog`, `DataTable`, `StatCard` (`security/`) |
| **Other** | `AdminSessionManager`, `ReasonCaptureModal`, `AdminAntdProvider` |

---

## 10. Backend Admin Routes (Registered)

All under prefix `/api/v1/admin` unless noted.

| Module | Prefix | Purpose |
|--------|--------|---------|
| `admin.fastify` | `/api/v1/admin` | Auth (login, me), WS metrics |
| `adminAmlRoutes` | `/api/v1/admin` | AML config, dashboard, alerts, reports (STR/CTR) |
| `adminSecurityRoutes` | `/api/v1/admin` | Security dashboard, risk rules, IP rules, withdrawals (approve/reject), sessions, devices, audit logs |
| `adminSpotRoutes` | `/api/v1/admin/spot` | Spot markets, orderbook (admin) |
| `adminControlRoutes` | `/api/v1/admin` | Control overview |
| `adminAnalyticsRoutes` | `/api/v1/admin` | Analytics (volume, users, revenue, liquidity, etc.) |
| `adminOperationsRoutes` | `/api/v1/admin` | Operations (trading halt, playbooks, etc.) |
| `adminOperationalRoutes` | `/api/v1/admin` | Operational (backups, restore, etc.) |
| `adminIntegrationsRoutes` | `/api/v1/admin` | Integrations |
| `adminPhase1ComplianceRoutes` | `/api/v1/admin` | Phase1 compliance |
| `adminPhase24Routes` | `/api/v1/admin` | Phase 2–4 |

Additional admin behaviour lives in other route files (e.g. `admin.fastify.ts` for auth and JWT/session helpers: `getAdminFromRequest`, `getAdminWithPermission`, `getAdminForWithdrawalApproval`).

---

## 11. Findings & Recommendations

### 11.1 Structure

- **Layout:** Single protected layout with sidebar (260px) and header; all 47 sidebar links have a matching page.
- **Design:** Centralised in `.admin-panel` CSS variables; light theme, card-based.
- **Auth:** Token + `/auth/me`; session manager for idle timeout; logout clears store and redirects to login.

### 11.2 Gaps / Inconsistencies

1. **Search:** Header “Search here...” is present but search behaviour (e.g. global search for users/orders) is not implemented.
2. **Orphan pages:** 100+ routes exist without a sidebar entry; many are detail or sub-pages. Consider adding key ones (e.g. KYC rejected, withdrawal reports, fees hub) to sidebar or ensure they are linked from parent pages.
3. **Duplicate libs:** Both `lib/admin/*` and `lib/admin-*-api.ts` exist; some pages may use different clients. Consider consolidating on `lib/admin/*` and deprecating the `admin-*-api.ts` names.
4. **Maintenance Mode:** Sidebar points to `/admin/settings/operations`; there is also `/admin/settings/maintenance` — clarify which is canonical and link accordingly.

### 11.3 Recommendations

1. Implement global search (e.g. users, order IDs, withdrawal IDs) and wire it to header search.
2. Add “Fees” parent to sidebar (Fees, Trading Fees, Withdrawal Fees, Tiers, Promotions) and “Referrals” if needed.
3. Ensure every critical flow (e.g. withdrawal approval, KYC review) is reachable from sidebar or from a single-hop link from a sidebar page.
4. Standardise on one admin API client and one set of types for admin responses across the app.
5. Add a simple “System health” or “API status” link in sidebar if operations rely on it.

---

## 12. File Count Summary

| Category | Count |
|----------|--------|
| Admin protected pages (`(protected)/**/page.tsx`) | 177 |
| Sidebar links | 47 |
| Admin lib modules | 8 (apiClient + 7 domain) |
| Admin layout/components | Sidebar, Header, layout.tsx |
| Admin UI/CRM/control-plane components | 40+ files under `components/admin/` |
| Backend admin route modules | 11 |

---

*End of audit.*
