# Admin Panel — Complete Summary (पूरी डिटेल)

यह डॉक्यूमेंट बताता है कि **Admin Panel** में अब तक क्या-क्या काम हुआ है, कौन सा **theme** और **tech stack** use हो रहा है, और सब कुछ एकदम detail में।

---

## 1. Theme & Design (थीम और डिज़ाइन)

### Primary theme: **Enterprise Dark (Binance-grade)**

- **Main background:** `#0B0F1A` (dark navy — admin panel का मुख्य बैकग्राउंड)
- **Card background:** `#111827` (cards, tables)
- **Elevated / hover:** `#1a1f2e` (hover, dropdowns)
- **Border:** `rgba(255,255,255,0.06)` (subtle light border)
- **Primary (blue):** `#3B82F6`
- **Success (green):** `#10B981`
- **Warning (orange):** `#F59E0B`
- **Error (red):** `#EF4444`
- **Text primary:** `#F3F4F6`
- **Text muted:** `#9CA3AF`

### CSS variables (globals.css)

- `--admin-bg`, `--admin-card`, `--admin-card-hover`, `--admin-border`
- `--admin-accent-blue`, `--admin-accent-purple`, `--admin-accent-green`, `--admin-accent-orange`, `--admin-accent-red`
- `--admin-text`, `--admin-muted`
- Cards: gradient + border + shadow, hover par thoda highlight

### Ant Design theme (AdminAntdProvider)

- **ConfigProvider** se Ant Design components (Table, Form, Button, etc.) ko dark theme diya gaya hai
- `colorBgContainer: '#111827'`, `colorBgElevated: '#1a1f2e'`, `colorPrimary: '#3B82F6'`, etc.
- Table background bhi same dark shades

### Optional light theme

- Class `.admin-panel.light-theme` se light mode bhi support hai (variables override)

---

## 2. Tech Stack (क्या-क्या use हो रहा है)

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 14 (App Router) |
| **UI library** | Ant Design 5.x (Table, Form, Button, Card, Select, Input, Switch, Modal, Tag, etc.) |
| **Charts** | Recharts 2.x (LineChart, BarChart, AreaChart, PieChart — analytics pages par) |
| **Icons** | Lucide React |
| **State** | Zustand (admin auth store, session) |
| **API calls** | fetch + getApiBaseUrl() (Bearer token from store) |
| **Styling** | Tailwind CSS + globals.css (admin variables) |
| **Auth** | JWT in header, `/api/v1/admin/auth/me` se session verify |
| **Layout** | Sidebar + Header, ThemeProvider, AdminAntdProvider |

---

## 3. Layout Structure (लेआउट)

- **Route:** `/admin/*` (login alag: `/admin/login`)
- **Protected layout:** `app/admin/(protected)/layout.tsx`
  - **Sidebar** (left) — collapsible, menu items with icons
  - **Header** (top) — user, logout, notifications
  - **AdminAntdProvider** — Ant Design dark theme wrap
  - **ThemeProvider** — app-level theme
  - Session check: token nahi to `/admin/login` redirect
- **Admin session:** token localStorage/store se, har request me `Authorization: Bearer <token>`

---

## 4. Sidebar Menu — Sections & Pages (पूरी साइडबार)

### Dashboard & Analytics
- Dashboard — `/admin/dashboard`
- Analytics Hub — `/admin/analytics`

### Users
- User List — `/admin/users`
- **User API Keys** — `/admin/users/api-keys` (search user, list/revoke API keys)
- User Detail — `/admin/users/detail`
- User Risk Profile — `/admin/users/risk`
- User Activity / Sessions — `/admin/security/sessions`

### KYC / Identity
- Pending Verifications — `/admin/kyc/pending`
- Approved / Rejected — `/admin/kyc/approved`
- KYC Audit Trail — `/admin/kyc/audit`
- KYC Settings — `/admin/kyc/settings`

### Wallet & Funds
- Indexer Monitor — `/admin/wallets/indexer`
- Wallet Operations — `/admin/wallets/operations`
- Treasury Dashboard — `/admin/treasury`
- Deposits — `/admin/wallets/deposits`
- Withdrawals — `/admin/wallets/withdrawals`
- Manual Adjustments — `/admin/wallets/adjust`
- Balance Summary — `/admin/wallets/funds-summary`
- Hot / Cold Wallet Monitor — `/admin/wallets/hot`
- **Cold Wallet Reserves** — `/admin/wallets/cold-reserves` (reserves + movement log)
- Reconciliation — `/admin/wallets/reconciliation`
- Balance Ledger — `/admin/wallets/ledger/balance`
- Settlement Ledger — `/admin/wallets/ledger/settlement`

### Spot Markets
- Market Management — `/admin/markets`
- **Listing / Delisting** — `/admin/trading/listing-status` (market status: active/suspended/delisted)
- Market Pairs — `/admin/trading/spot-markets`
- Order Monitoring — `/admin/trading/orders`
- Trade History — `/admin/trading/trade-history`
- Market Making — `/admin/market-making`
- MM Risk Monitor — `/admin/monitoring/mm-risk`
- Circuit Breakers — `/admin/trading/circuit-breakers`
- Fee Controls — `/admin/trading/fees`
- Market Halt Controls — `/admin/trading/market-control`

### P2P System
- P2P Overview — `/admin/p2p`
- Active Trades — `/admin/p2p/trades`
- Orders / Ads — `/admin/p2p/orders`
- Escrow Monitor — `/admin/p2p/escrows`
- Disputes — `/admin/p2p/disputes`
- Merchants — `/admin/p2p/merchants`
- Payment Methods — `/admin/p2p/payment-methods`
- P2P Settings — `/admin/p2p/settings`

### Compliance / AML
- Sanctions Dashboard — `/admin/compliance/sanctions`
- **Sanctions Config** — `/admin/compliance/sanctions-config` (provider, API URL, key)
- **STR / CTR Workflow** — `/admin/compliance/str-ctr` (generate STR/CTR, escalate alert, mark submitted)
- **Circuit Breaker History** — `/admin/compliance/circuit-breaker-history` (open/reset log)
- Risk Intelligence — `/admin/risk-intelligence`
- AML Alerts — `/admin/compliance/alerts`
- Alert Detail — `/admin/compliance/alert`
- STR / CTR Reports — `/admin/compliance/reports`
- Case Management — `/admin/compliance/cases`
- AML Dashboard — `/admin/security/compliance`

### Security & Risk
- Rate Limit Monitoring — `/admin/rate-limits`
- Geo Blocking — `/admin/security/geo-blocking`
- Network Risk Monitor — `/admin/security/network-risk`
- Audit Logs (Immutable) — `/admin/security/audit-logs`
- **Admin Audit Trail** — `/admin/security/admin-audit` (redirect to audit-logs with actorType=admin)
- Active Sessions — `/admin/security/sessions`
- IP / Device Risk Rules — `/admin/security/ip-rules`
- Withdrawal Risk Monitor — `/admin/security/withdrawals`
- Risk Rules — `/admin/security/risk-rules`
- Security Dashboard — `/admin/security/dashboard`

### Governance
- Forensics — `/admin/forensics`
- Proof of Reserves — `/admin/proof-of-reserves`
- User Behavior — `/admin/user-behavior`
- System Reliability — `/admin/system-reliability`
- Operational Playbooks — `/admin/playbooks`

### Exchange Control
- Control Center — `/admin/control-center`
- Automation Engine — `/admin/automation`
- Smart Alerts — `/admin/smart-alerts`
- Incidents — `/admin/incidents`
- Orderbook Intelligence — `/admin/orderbook-intelligence`
- Liquidity Stability — `/admin/liquidity-stability`
- User Risk Intelligence — `/admin/user-risk`
- Trader Intelligence — `/admin/trader-intelligence`
- Whale Activity — `/admin/whale-activity`
- Liquidity Monitoring — `/admin/liquidity`
- Revenue Intelligence — `/admin/revenue`
- API Monitoring — `/admin/api-monitoring`
- Admin Notifications — `/admin/notifications/broadcast`

### System Controls
- System Configuration — `/admin/system-config`
- Price Oracle — `/admin/system/price-oracle`
- Operations Control — `/admin/settings/operations`
- System Settings — `/admin/settings`
- **Withdrawal Tier Limits** — `/admin/settings/withdrawal-tier-limits` (KYC tier 0–3 daily/monthly limits)
- **2FA Enforcement** — `/admin/settings/2fa-enforcement` (require 2FA for login/withdrawal/API)
- **Liquidity SLA** — `/admin/settings/liquidity-sla` (min depth, max spread, enable)
- **Scheduled Compliance** — `/admin/settings/scheduled-compliance` (cron, recipients)
- **Alert Channels** — `/admin/settings/alert-channels` (webhook, Slack, PagerDuty)
- Backup & Recovery — `/admin/backups`
- API Settings — `/admin/system/api-settings`
- Feature Flags — `/admin/settings/features`
- Blockchain / Token Config — `/admin/settings/blockchain`
- **Engine Recovery Status** — `/admin/engine/recovery-status` (open orders count, last event ID)
- Observability — `/admin/system-health`
- Integrations — `/admin/integrations`
- Counters / Limits — `/admin/monitoring/counters`

### Finance & Fees
- Fee Configuration — `/admin/fees/trading`
- Revenue Metrics — `/admin/reports/financial`
- Referral System — `/admin/referrals/campaigns`

### Support & Reports
- Support Tickets — `/admin/support`
- Reports / Exports — `/admin/reports`
- Notifications — `/admin/notifications`

### Admin Users
- Admin List — `/admin/admins`
- Roles & Permissions — `/admin/admins/roles`
- Activity Log — `/admin/admins/logs`

---

## 5. Reusable Components (एडमिन में use होने वाले कॉम्पोनेंट्स)

### Control-plane (`@/components/admin/control-plane`)
- **SectionHeader** — page title + description
- **Panel** — content wrapper (card style)
- **MetricWidget** — single metric display
- **StatusBadge** — status tag (variant: success, warning, error, etc.)
- **ActionButton** — primary/secondary/danger button
- **DataTable** — DataTableContainer, DataTableHead, DataTableTh, DataTableBody, DataTableRow, DataTableCell (custom table layout)

### Charts (`@/components/admin/charts`)
- **TradingVolumeChart**, **RevenueChart**, **UserGrowthChart**, **TopMarketsChart**
- **DepositWithdrawChart**, **OrderFlowChart**, **TradeDistributionChart**
- **P2PActivityChart**, **SettlementThroughputChart**, **LiquidityHeatmap**
- **AdminChartCard** — chart wrapper card

### Layout
- **Sidebar** — full menu, icons (Lucide), expand/collapse
- **Header** — top bar, admin user, logout
- **AdminAntdProvider** — Ant Design theme wrapper
- **AdminSessionManager** — session handling

### Other
- **ReasonCaptureModal**, **ConfirmDialog**, **StatCard** (security/confirm flows)

---

## 6. Backend APIs (एडमिन के लिए कौन-कौन से API)

- **Prefix:** `/api/v1/admin/`
- **Auth:** `Authorization: Bearer <admin_jwt>`
- **Approx:** 120+ admin endpoints (users, KYC, wallets, deposits, withdrawals, spot, P2P, compliance, security, settings, control center, analytics, etc.)

### Phase 1 (Critical Safety & Compliance) — jo humne add kiye
- `GET/PATCH /compliance/sanctions/config`, `POST /compliance/sanctions/test`
- `GET/PATCH /settings/withdrawal-tier-limits`
- `GET /compliance/str-ctr/reports`, `POST .../generate-str`, `.../generate-ctr`, `.../escalate-alert-to-str`, `.../reports/:id/mark-submitted`
- `GET/PATCH /settings/alert-channels`

### Phase 2–4 — jo humne add kiye
- `GET /engine/recovery-status`
- `GET /wallets/cold/reserves`, `GET /wallets/cold/movements`
- `GET /compliance/circuit-breaker/history`
- `GET/PATCH /settings/2fa-enforcement`
- `GET /users/:userId/api-keys`, `DELETE /api-keys/:id/revoke`
- `GET /trading/listing-status`, `PATCH /trading/listing-status/:symbol`
- `GET/PATCH /settings/liquidity-sla`
- `GET/PATCH /settings/scheduled-compliance`
- `GET /settings/feature-flags`, `PATCH /settings/feature-flags/:key` (rollout %)

---

## 7. Phase-wise Kaam (हमने क्या-क्या implement kiya)

### Phase 1 — Critical Safety & Compliance
- Sanctions provider config (DB/system_settings se), test sanctions API
- Withdrawal limits by KYC tier (tier 0–3 daily/monthly), KYC approve par user limits set
- STR/CTR workflow: list reports, generate STR/CTR for period, escalate single alert to STR, mark submitted
- Alert channels: webhook, Slack, PagerDuty (system_settings)
- **Admin pages:** Sanctions Config, Withdrawal Tier Limits, STR/CTR Workflow, Alert Channels

### Phase 2 — Exchange Resilience
- Engine recovery: GET /internal/engine/state (pehle se), admin ke liye **Engine Recovery Status** page (open orders count, last_engine_event_id)
- Run mode: `RUN_MODE=api|workers|all` (pehle se)
- Cold wallet: **cold_wallet_movements** table, reserves + movement log APIs, **Cold Wallet Reserves** page
- Circuit breaker: **circuit_breaker_history** table, open/reset log, **Circuit Breaker History** page
- Admin audit: **Admin Audit Trail** page (audit-logs with actorType=admin)

### Phase 3 — Governance & Policy
- 2FA enforcement: **require_2fa_login**, **require_2fa_withdrawal**, **require_2fa_api_trading** (system_settings), withdrawal flow me check, **2FA Enforcement** page
- API key admin: list user API keys, revoke by id, **User API Keys** page
- Listing/delisting: spot_markets status (active/suspended/maintenance/delisted), **Listing / Delisting** page
- Liquidity SLA: min depth, max spread, enabled — **Liquidity SLA** page
- Scheduled compliance: cron, recipients — **Scheduled Compliance** page

### Phase 4 — Scaling & Controls
- Circuit breaker history (Phase 2 me)
- Feature flags: **rollout_percentage** column, GET/PATCH feature-flags APIs
- Read replica: backend me `queryRead()` already; koi alag admin page nahi

---

## 8. Admin Pages Count (लगभग)

- **Protected pages (page.tsx):** ~100+ (dashboard, users, KYC, wallets, spot, P2P, compliance, security, governance, control, system, finance, support, admins, reports, notifications, fees, referrals, etc.)
- **Nested routes:** alerts/[id], reports/[id], disputes/[id], hot/[chainId], etc.
- **Login:** `/admin/login` (alag), protected layout me redirect

---

## 9. Short Summary (एक नज़र में)

| Item | Detail |
|------|--------|
| **Theme** | Enterprise dark — `#0B0F1A` background, `#111827` cards, blue/green/amber/red accents |
| **UI** | Next.js 14 + Ant Design 5 + Tailwind + Recharts + Lucide |
| **Layout** | Sidebar (expand/collapse) + Header, ThemeProvider + AdminAntdProvider |
| **Auth** | JWT in header, session verify via `/admin/auth/me` |
| **Pages** | 100+ admin pages, 12+ sidebar sections |
| **Backend** | 120+ admin APIs under `/api/v1/admin/` |
| **Phase 1–4** | Sanctions, tier limits, STR/CTR, alert channels, cold reserves, circuit history, 2FA policy, API key admin, listing/delisting, liquidity SLA, scheduled compliance, feature-flag rollout, engine recovery status |

Agar kisi section ya page ka aur detail chahiye (e.g. exact API list ya component props) to batao, us hisaab se alag se nikal sakta hai.
