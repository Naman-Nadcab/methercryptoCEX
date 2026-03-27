# Admin System — Full Technical Audit

**Purpose:** Complete technical audit of the cryptocurrency exchange admin panel and backend integrations to enable safe rebuild of the admin UI.

**Platform scope:** Spot trading, P2P trading, Market making, Wallet system, Treasury, Compliance/AML, Risk monitoring, Reports & analytics.

**Backend:** Implemented and working. **Admin frontend:** Exists; migrated to Admin V2 (legacy layout/crm removed). This audit documents the current state.

---

## SECTION 1 — ROUTE AUDIT

All admin routes are under `apps/frontend/src/app/admin/`. Protected routes live under `(protected)/`; `login` is outside it.

| Route | File path | Purpose | In sidebar |
|-------|-----------|---------|------------|
| /admin/login | app/admin/login/page.tsx | Admin login | No |
| /admin/dashboard | (protected)/dashboard/page.tsx | Main dashboard (KPIs, health, activity) | Yes (Dashboard) |
| /admin/users | (protected)/users/page.tsx | User list, filters, charts | Yes (Users → All Users) |
| /admin/users/[id] | (protected)/users/[id]/page.tsx | User detail | No (linked from list) |
| /admin/users/detail | (protected)/users/detail/page.tsx | User detail (alternate) | Yes |
| /admin/users/suspended | (protected)/users/suspended/page.tsx | Suspended users | Yes |
| /admin/users/banned | (protected)/users/banned/page.tsx | Banned users | Yes |
| /admin/users/risk | (protected)/users/risk/page.tsx | User risk | No |
| /admin/users/tiers | (protected)/users/tiers/page.tsx | User tiers | No |
| /admin/users/verification | (protected)/users/verification/page.tsx | Verification | No |
| /admin/users/api-keys | (protected)/users/api-keys/page.tsx | User API keys | No |
| /admin/kyc | (protected)/kyc/page.tsx | KYC overview | Yes (KYC Overview) |
| /admin/kyc/pending | (protected)/kyc/pending/page.tsx | Pending KYC | Yes |
| /admin/kyc/approved | (protected)/kyc/approved/page.tsx | Approved KYC | Yes |
| /admin/kyc/rejected | (protected)/kyc/rejected/page.tsx | Rejected KYC | Yes |
| /admin/kyc/review | (protected)/kyc/review/page.tsx | KYC review | No |
| /admin/kyc/settings | (protected)/kyc/settings/page.tsx | KYC settings | No |
| /admin/kyc/audit | (protected)/kyc/audit/page.tsx | KYC audit | No |
| /admin/compliance/alerts | (protected)/compliance/alerts/page.tsx | Compliance alerts | Yes (Compliance Alerts) |
| /admin/compliance/alerts/[id] | (protected)/compliance/alerts/[id]/page.tsx | Alert detail | No |
| /admin/compliance/reports | (protected)/compliance/reports/page.tsx | STR/CTR reports | Yes (STR/CTR Reports) |
| /admin/compliance/reports/[id] | (protected)/compliance/reports/[id]/page.tsx | Report detail | No |
| /admin/compliance/cases | (protected)/compliance/cases/page.tsx | Compliance cases | No |
| /admin/compliance/sanctions | (protected)/compliance/sanctions/page.tsx | Sanctions | No |
| /admin/compliance/sanctions-config | (protected)/compliance/sanctions-config/page.tsx | Sanctions config | No |
| /admin/compliance/circuit-breaker-history | (protected)/compliance/circuit-breaker-history/page.tsx | Circuit breaker history | No |
| /admin/compliance/alert | (protected)/compliance/alert/page.tsx | Single alert | No |
| /admin/compliance/str-ctr | (protected)/compliance/str-ctr/page.tsx | STR/CTR | No |
| /admin/wallets | (protected)/wallets/page.tsx | Wallets overview | No |
| /admin/wallets/monitor | (protected)/wallets/monitor/page.tsx | Wallet monitor | Yes |
| /admin/wallets/treasury | (protected)/wallets/treasury/page.tsx | Treasury | Yes |
| /admin/wallets/hot | (protected)/wallets/hot/page.tsx | Hot wallets | Yes |
| /admin/wallets/hot/[chainId] | (protected)/wallets/hot/[chainId]/page.tsx | Hot wallet by chain | No |
| /admin/wallets/cold | (protected)/wallets/cold/page.tsx | Cold wallets | No |
| /admin/wallets/cold-reserves | (protected)/wallets/cold-reserves/page.tsx | Cold reserves | Yes (Cold Wallets) |
| /admin/wallets/funds-summary | (protected)/wallets/funds-summary/page.tsx | Funds summary | Yes |
| /admin/wallets/deposits | (protected)/wallets/deposits/page.tsx | Deposits (wallets) | No |
| /admin/wallets/withdrawals | (protected)/wallets/withdrawals/page.tsx | Withdrawals (wallets) | No |
| /admin/wallets/ledger/balance | (protected)/wallets/ledger/balance/page.tsx | Ledger balance | No |
| /admin/wallets/ledger/settlement | (protected)/wallets/ledger/settlement/page.tsx | Ledger settlement | No |
| /admin/wallets/reconciliation | (protected)/wallets/reconciliation/page.tsx | Reconciliation | No |
| /admin/wallets/deposit-sweeps | (protected)/wallets/deposit-sweeps/page.tsx | Deposit sweeps | No |
| /admin/wallets/currencies | (protected)/wallets/currencies/page.tsx | Currencies | No |
| /admin/wallets/adjust | (protected)/wallets/adjust/page.tsx | Balance adjust | No |
| /admin/wallets/operations | (protected)/wallets/operations/page.tsx | Wallet operations | No |
| /admin/wallets/blockchain | (protected)/wallets/blockchain/page.tsx | Blockchain nodes | Yes |
| /admin/wallets/indexer | (protected)/wallets/indexer/page.tsx | Indexer | No |
| /admin/deposits | (protected)/deposits/page.tsx | Deposits list | Yes (Deposits) |
| /admin/deposits/completed | (protected)/deposits/completed/page.tsx | Completed deposits | No |
| /admin/deposits/flagged | (protected)/deposits/flagged/page.tsx | Flagged deposits | No |
| /admin/deposits/manual-credit | (protected)/deposits/manual-credit/page.tsx | Manual credit | No |
| /admin/deposits/pending | (protected)/deposits/pending/page.tsx | Pending deposits | No |
| /admin/deposits/reports | (protected)/deposits/reports/page.tsx | Deposit reports | No |
| /admin/withdrawals | (protected)/withdrawals/page.tsx | Withdrawals list, approve/reject | Yes (Withdrawals) |
| /admin/withdrawals/pending | (protected)/withdrawals/pending/page.tsx | Pending withdrawals | No |
| /admin/withdrawals/pending-approval | (protected)/withdrawals/pending-approval/page.tsx | Pending approval | No |
| /admin/withdrawals/processing | (protected)/withdrawals/processing/page.tsx | Processing | No |
| /admin/withdrawals/completed | (protected)/withdrawals/completed/page.tsx | Completed | No |
| /admin/withdrawals/failed | (protected)/withdrawals/failed/page.tsx | Failed | No |
| /admin/withdrawals/reports | (protected)/withdrawals/reports/page.tsx | Withdrawal reports | No |
| /admin/withdrawals/settings | (protected)/withdrawals/settings/page.tsx | Withdrawal settings | No |
| /admin/trading | (protected)/trading/page.tsx | Trading overview | No |
| /admin/trading/orders | (protected)/trading/orders/page.tsx | Spot orders | No |
| /admin/trading/trade-history | (protected)/trading/trade-history/page.tsx | Trade history | Yes (Trade History) |
| /admin/trading/pairs | (protected)/trading/pairs/page.tsx | Trading pairs | Yes (Market Management) |
| /admin/trading/spot-markets | (protected)/trading/spot-markets/page.tsx | Spot markets | Yes |
| /admin/trading/liquidity | (protected)/trading/liquidity/page.tsx | Liquidity | Yes (Liquidity Monitor) |
| /admin/trading/surveillance | (protected)/trading/surveillance/page.tsx | Surveillance | Yes |
| /admin/trading/orderbook | (protected)/trading/orderbook/page.tsx | Orderbook | No |
| /admin/trading/order-history | (protected)/trading/order-history/page.tsx | Order history | No |
| /admin/trading/fees | (protected)/trading/fees/page.tsx | Trading fees | No |
| /admin/trading/circuit-breakers | (protected)/trading/circuit-breakers/page.tsx | Circuit breakers | Yes |
| /admin/trading/engine | (protected)/trading/engine/page.tsx | Engine monitor | Yes |
| /admin/trading/listing-status | (protected)/trading/listing-status/page.tsx | Listing status | No |
| /admin/trading/market-control | (protected)/trading/market-control/page.tsx | Market control | No |
| /admin/liquidity | (protected)/liquidity/page.tsx | Liquidity dashboard | Yes (Liquidity) |
| /admin/p2p | (protected)/p2p/page.tsx | P2P overview | Yes (P2P Overview) |
| /admin/p2p/orders | (protected)/p2p/orders/page.tsx | P2P orders | Yes |
| /admin/p2p/disputes | (protected)/p2p/disputes/page.tsx | P2P disputes | Yes |
| /admin/p2p/disputes/[id] | (protected)/p2p/disputes/[id]/page.tsx | Dispute detail | No |
| /admin/p2p/escrows | (protected)/p2p/escrows/page.tsx | Escrows | Yes (Escrow Wallet) |
| /admin/p2p/payment-methods | (protected)/p2p/payment-methods/page.tsx | Payment methods | Yes |
| /admin/p2p/ads | (protected)/p2p/ads/page.tsx | P2P ads | No |
| /admin/p2p/trades | (protected)/p2p/trades/page.tsx | P2P trades | No |
| /admin/p2p/merchants | (protected)/p2p/merchants/page.tsx | Merchants | No |
| /admin/p2p/settings | (protected)/p2p/settings/page.tsx | P2P settings | No |
| /admin/market-making | (protected)/market-making/page.tsx | Market making | Yes (MM Performance) |
| /admin/monitoring/mm-risk | (protected)/monitoring/mm-risk/page.tsx | MM risk | Yes (MM Risk Alerts) |
| /admin/monitoring/counters | (protected)/monitoring/counters/page.tsx | Monitoring counters | No |
| /admin/risk | (protected)/risk/page.tsx | Risk dashboard | Yes (Risk Dashboard) |
| /admin/risk/intelligence | (protected)/risk/intelligence/page.tsx | Risk intelligence | Yes |
| /admin/risk/withdrawals | (protected)/risk/withdrawals/page.tsx | Withdrawal risk | Yes |
| /admin/reports | (protected)/reports/page.tsx | Reports overview | Yes (Trading Volume) |
| /admin/reports/financial | (protected)/reports/financial/page.tsx | Financial reports | Yes (Revenue) |
| /admin/reports/users | (protected)/reports/users/page.tsx | User reports | Yes (User Growth) |
| /admin/reports/p2p | (protected)/reports/p2p/page.tsx | P2P stats | Yes |
| /admin/reports/trading | (protected)/reports/trading/page.tsx | Trading reports | No |
| /admin/reports/custom | (protected)/reports/custom/page.tsx | Custom reports | No |
| /admin/security | (protected)/security/page.tsx | Security overview | No |
| /admin/security/dashboard | (protected)/security/dashboard/page.tsx | Security dashboard | No |
| /admin/security/withdrawals | (protected)/security/withdrawals/page.tsx | Withdrawal approvals | Yes |
| /admin/security/audit-logs | (protected)/security/audit-logs/page.tsx | Audit logs | Yes |
| /admin/security/ip-rules | (protected)/security/ip-rules/page.tsx | IP whitelisting | Yes |
| /admin/security/risk-rules | (protected)/security/risk-rules/page.tsx | Risk rules | Yes |
| /admin/security/compliance | (protected)/security/compliance/page.tsx | Compliance | Yes |
| /admin/security/activity | (protected)/security/activity/page.tsx | Activity | No |
| /admin/security/audit | (protected)/security/audit/page.tsx | Audit | No |
| /admin/security/sessions | (protected)/security/sessions/page.tsx | Sessions | No |
| /admin/security/fraud | (protected)/security/fraud/page.tsx | Fraud | No |
| /admin/security/geo-blocking | (protected)/security/geo-blocking/page.tsx | Geo-blocking | No |
| /admin/security/ip | (protected)/security/ip/page.tsx | IP | No |
| /admin/security/network-risk | (protected)/security/network-risk/page.tsx | Network risk | No |
| /admin/security/admin-audit | (protected)/security/admin-audit/page.tsx | Admin audit logs | Yes (Activity Logs) |
| /admin/system-health | (protected)/system-health/page.tsx | System health dashboard | Yes (System Health) |
| /admin/settings | (protected)/settings/page.tsx | Settings | Yes |
| /admin/settings/features | (protected)/settings/features/page.tsx | Feature flags | Yes |
| /admin/settings/operations | (protected)/settings/operations/page.tsx | Operations | Yes |
| /admin/settings/blockchain | (protected)/settings/blockchain/page.tsx | Blockchain config | Yes |
| /admin/settings/blockchain/chains | (protected)/settings/blockchain/chains/page.tsx | Chains | No |
| /admin/settings/blockchain/currencies | (protected)/settings/blockchain/currencies/page.tsx | Currencies | No |
| /admin/settings/blockchain/tokens | (protected)/settings/blockchain/tokens/page.tsx | Tokens | No |
| /admin/settings/trading-pairs | (protected)/settings/trading-pairs/page.tsx | Trading pairs | Yes |
| /admin/settings/p2p-assets | (protected)/settings/p2p-assets/page.tsx | P2P assets | No |
| /admin/settings/withdrawal-tier-limits | (protected)/settings/withdrawal-tier-limits/page.tsx | Withdrawal tiers | No |
| /admin/settings/2fa-enforcement | (protected)/settings/2fa-enforcement/page.tsx | 2FA enforcement | No |
| /admin/settings/liquidity-sla | (protected)/settings/liquidity-sla/page.tsx | Liquidity SLA | No |
| /admin/settings/scheduled-compliance | (protected)/settings/scheduled-compliance/page.tsx | Scheduled compliance | No |
| /admin/settings/api | (protected)/settings/api/page.tsx | API settings | No |
| /admin/settings/alert-channels | (protected)/settings/alert-channels/page.tsx | Alert channels | No |
| /admin/settings/maintenance | (protected)/settings/maintenance/page.tsx | Maintenance | No |
| /admin/notifications | (protected)/notifications/page.tsx | Notifications | Yes |
| /admin/notifications/announcements | (protected)/notifications/announcements/page.tsx | Announcements | No |
| /admin/notifications/email | (protected)/notifications/email/page.tsx | Email templates | No |
| /admin/notifications/sms | (protected)/notifications/sms/page.tsx | SMS templates | No |
| /admin/notifications/broadcast | (protected)/notifications/broadcast/page.tsx | Broadcast | No |
| /admin/notifications/push | (protected)/notifications/push/page.tsx | Push | No |
| /admin/alerts | (protected)/alerts/page.tsx | Alert center | Yes |
| /admin/admins | (protected)/admins/page.tsx | Admin users | Yes (Admin Users) |
| /admin/admins/roles | (protected)/admins/roles/page.tsx | Roles & permissions | Yes |
| /admin/fees | (protected)/fees/page.tsx | Fees overview | No |
| /admin/fees/trading | (protected)/fees/trading/page.tsx | Trading fees | Yes |
| /admin/fees/withdrawal | (protected)/fees/withdrawal/page.tsx | Withdrawal fees | No |
| /admin/fees/tiers | (protected)/fees/tiers/page.tsx | Fee tiers | No |
| /admin/fees/promotions | (protected)/fees/promotions/page.tsx | Fee promotions | No |
| /admin/treasury | (protected)/treasury/page.tsx | Treasury | No |
| /admin/analytics | (protected)/analytics/page.tsx | Analytics | No |
| /admin/revenue | (protected)/revenue/page.tsx | Revenue | No |
| /admin/markets | (protected)/markets/page.tsx | Markets | No |
| /admin/control-center | (protected)/control-center/page.tsx | Control center | No |
| /admin/backups | (protected)/backups/page.tsx | Backups | No |
| /admin/rate-limits | (protected)/rate-limits/page.tsx | Rate limits | No |
| /admin/integrations | (protected)/integrations/page.tsx | Integrations | No |
| /admin/proof-of-reserves | (protected)/proof-of-reserves/page.tsx | Proof of reserves | No |
| /admin/system-reliability | (protected)/system-reliability/page.tsx | System reliability | No |
| /admin/incidents | (protected)/incidents/page.tsx | Incidents | No |
| /admin/playbooks | (protected)/playbooks/page.tsx | Playbooks | No |
| /admin/automation | (protected)/automation/page.tsx | Automation | No |
| /admin/smart-alerts | (protected)/smart-alerts/page.tsx | Smart alerts | No |
| /admin/engine/recovery-status | (protected)/engine/recovery-status/page.tsx | Engine recovery | No |
| /admin/system-config | (protected)/system-config/page.tsx | System config | No |
| /admin/system/api-settings | (protected)/system/api-settings/page.tsx | API settings | No |
| /admin/system/price-oracle | (protected)/system/price-oracle/page.tsx | Price oracle | No |
| /admin/orderbook-intelligence | (protected)/orderbook-intelligence/page.tsx | Orderbook intelligence | No |
| /admin/risk-intelligence | (protected)/risk-intelligence/page.tsx | Risk intelligence | No |
| /admin/user-risk | (protected)/user-risk/page.tsx | User risk | No |
| /admin/user-behavior | (protected)/user-behavior/page.tsx | User behavior | No |
| /admin/whale-activity | (protected)/whale-activity/page.tsx | Whale activity | No |
| /admin/trader-intelligence | (protected)/trader-intelligence/page.tsx | Trader intelligence | No |
| /admin/forensics | (protected)/forensics/page.tsx | Forensics | No |
| /admin/api-monitoring | (protected)/api-monitoring/page.tsx | API monitoring | No |
| /admin/liquidity-stability | (protected)/liquidity-stability/page.tsx | Liquidity stability | No |
| /admin/referrals | (protected)/referrals/page.tsx | Referrals | No |
| /admin/referrals/codes | (protected)/referrals/codes/page.tsx | Referral codes | No |
| /admin/referrals/commissions | (protected)/referrals/commissions/page.tsx | Commissions | No |
| /admin/referrals/relationships | (protected)/referrals/relationships/page.tsx | Relationships | No |
| /admin/referrals/campaigns | (protected)/referrals/campaigns/page.tsx | Campaigns | No |
| /admin/support | (protected)/support/page.tsx | Support | No |
| /admin/support/my-tickets | (protected)/support/my-tickets/page.tsx | My tickets | No |
| /admin/support/responses | (protected)/support/responses/page.tsx | Responses | No |

**Sidebar source:** `components/admin/v2/Sidebar.tsx` — `SIDEBAR_NAV`. Sections: Dashboard, Users, KYC & Compliance, Wallets & Treasury, Spot Trading, P2P Trading, Market Making, Risk Control, Reports & Analytics, Security, System Settings, Admin Management. Sidebar is permission-filtered via `canAccessNavPermission()`.

---

## SECTION 2 — FRONTEND COMPONENT AUDIT

**Base path:** `apps/frontend/src/components/admin/`

| Component / group | Location | Purpose | Used by | Status |
|-------------------|----------|---------|---------|--------|
| **v2/Sidebar** | v2/Sidebar.tsx | Main nav sidebar; permission-filtered | Protected layout | ACTIVE |
| **v2/Header** | v2/Header.tsx | Top bar; search, alerts, profile | Protected layout | ACTIVE |
| **v2/dashboard/KPICard** | v2/dashboard/KPICard.tsx | KPI card (title, value, sparkline) | Dashboard, reports, withdrawals, notifications, users | ACTIVE |
| **v2/dashboard/ChartCard** | v2/dashboard/ChartCard.tsx | Card with title/subtitle for charts | Users page | ACTIVE |
| **v2/dashboard/ExchangeControls** | v2/dashboard/ExchangeControls.tsx | Trading halt, settlement controls | Dashboard | ACTIVE |
| **v2/dashboard/SystemHealthPanel** | v2/dashboard/SystemHealthPanel.tsx | Health summary | Dashboard | ACTIVE |
| **v2/dashboard/RiskSecurityPanel** | v2/dashboard/RiskSecurityPanel.tsx | Risk/security summary | Dashboard | ACTIVE |
| **v2/dashboard/ActivityStream** | v2/dashboard/ActivityStream.tsx | Activity feed | Dashboard | ACTIVE |
| **v2/dashboard/MMPerformanceCard** | v2/dashboard/MMPerformanceCard.tsx | MM performance | Market-making | ACTIVE |
| **v2/dashboard/LiquidityDepthChart** | v2/dashboard/LiquidityDepthChart.tsx | Liquidity depth chart | Market-making, liquidity | ACTIVE |
| **v2/dashboard/SpreadMonitorChart** | v2/dashboard/SpreadMonitorChart.tsx | Spread monitor | Market-making | ACTIVE |
| **v2/dashboard/OrderbookDepthChart** | v2/dashboard/OrderbookDepthChart.tsx | Orderbook depth | v2 dashboard | ACTIVE |
| **v2/dashboard/LiquidityHeatmap** | v2/dashboard/LiquidityHeatmap.tsx | Liquidity heatmap | Liquidity page | ACTIVE |
| **v2/tables/DataTable** | v2/tables/DataTable.tsx | Table with search, sort, pagination | Withdrawals, deposits, users, many lists | ACTIVE |
| **control-plane/SectionHeader** | control-plane/SectionHeader.tsx | Page title + subtitle + action | Most admin pages | ACTIVE |
| **control-plane/Panel** | control-plane/Panel.tsx | Card panel with optional accent | Most admin pages | ACTIVE |
| **control-plane/MetricWidget** | control-plane/MetricWidget.tsx | Metric display | Dashboard, compliance, etc. | ACTIVE |
| **control-plane/StatusBadge** | control-plane/StatusBadge.tsx | Status badge (LIVE/HALTED/etc.) | Withdrawals, users, system-health | ACTIVE |
| **control-plane/ActionButton** | control-plane/ActionButton.tsx | Primary/secondary/danger button | Withdrawals, compliance, many | ACTIVE |
| **control-plane/DataTable** | control-plane/DataTable.tsx | Table building blocks (DataTableTh, DataTableRow, DataTableCell) | Trading/orders, p2p, ledger, users [id], etc. | ACTIVE |
| **charts/AdminChartCard** | charts/AdminChartCard.tsx | Card wrapper for charts | System-health, liquidity-stability, incidents, etc. | ACTIVE |
| **charts/TradingVolumeChart** | charts/TradingVolumeChart.tsx | Trading volume chart | Market-making | ACTIVE |
| **charts/UserGrowthChart** | charts/UserGrowthChart.tsx | User growth | Users page | ACTIVE |
| **charts/RevenueChart** | charts/RevenueChart.tsx | Revenue | Users page | ACTIVE |
| **charts/DepositWithdrawChart** | charts/DepositWithdrawChart.tsx | Deposit/withdraw trend | Users page | ACTIVE |
| **charts/SettlementThroughputChart** | charts/SettlementThroughputChart.tsx | Settlement throughput | System health (old) | ACTIVE |
| **charts/P2PActivityChart** | charts/P2PActivityChart.tsx | P2P activity | P2P page | ACTIVE |
| **charts/** (others) | charts/*.tsx | TopMarkets, OrderFlow, LiquidityHeatmap, etc. | Various | ACTIVE |
| **ui/AdminPanel** | ui/AdminPanel.tsx | Re-export of control-plane Panel | Wallets, risk, treasury, etc. | ACTIVE |
| **ui/AdminMetricCard** | ui/AdminMetricCard.tsx | Metric card | Wallets monitor, treasury, risk, alerts | ACTIVE |
| **ui/AdminChartCard** | ui/AdminChartCard.tsx | Chart card | Some pages | ACTIVE |
| **ui/AdminDataTable** | ui/AdminDataTable.tsx | Wrapper around control-plane DataTable | Wallets, risk, treasury, trading/pairs | ACTIVE |
| **ui/AdminStatusBadge** | ui/AdminStatusBadge.tsx | Re-export StatusBadge as AdminStatusBadge | Users [id], risk/withdrawals, etc. | ACTIVE |
| **ui/AdminTabs** | ui/AdminTabs.tsx | Tabs | Users [id] | ACTIVE |
| **ui/AdminEventStream** | ui/AdminEventStream.tsx | Event stream | — | ACTIVE (used where needed) |
| **security/DataTable** | security/DataTable.tsx | Security-specific table | Audit-logs, risk-rules, ip-rules, sessions, withdrawals | ACTIVE |
| **security/StatCard** | security/StatCard.tsx | Stat card | Security dashboard | ACTIVE |
| **security/ConfirmDialog** | security/ConfirmDialog.tsx | Confirm dialog | Risk-rules, ip-rules | ACTIVE |
| **AdminSessionManager** | AdminSessionManager.tsx | Idle timeout / session | Protected layout | ACTIVE |
| **AdminAntdProvider** | AdminAntdProvider.tsx | Ant Design provider | Some pages using Antd | ACTIVE |
| **ReasonCaptureModal** | ReasonCaptureModal.tsx | Reason capture for actions | Compliance alerts, P2P disputes | ACTIVE |
| **dashboard/AdminMetricCard** | dashboard/AdminMetricCard.tsx | Another metric card | Possibly legacy | DUPLICATE (ui has AdminMetricCard) |
| **layout/** | — | Sidebar, Header | — | **REMOVED** (replaced by v2) |
| **crm/** | — | KPICard, ChartCard, TableCard | — | **REMOVED** (replaced by v2/dashboard) |

**Summary:** Primary UI is **v2** (Sidebar, Header, dashboard widgets, DataTable). **control-plane** and **charts** are shared. **ui** re-exports or wraps control-plane. **security** has its own DataTable and dialogs. No remaining **layout** or **crm** folders.

---

## SECTION 3 — ADMIN LAYOUT SYSTEM

| Item | Implementation | File(s) |
|------|----------------|--------|
| **Protected layout** | Wraps all routes under `(protected)/`; auth + session refresh | `app/admin/(protected)/layout.tsx` |
| **Auth check** | Token from store; if missing → redirect to `/admin/login`. On load: `GET /api/v1/admin/auth/me` with Bearer token; on success `setAdmin(data)` (role + permissions); on failure logout + redirect | Same layout |
| **Sidebar** | **AdminV2Sidebar** — `components/admin/v2/Sidebar.tsx` | Used in layout |
| **Header** | **AdminV2Header** — `components/admin/v2/Header.tsx` | Used in layout |
| **Session manager** | **AdminSessionManager** — idle timeout 30 min; logout on expire | `components/admin/AdminSessionManager.tsx`; used in layout |
| **Realtime** | **useAdminRealtime()** — WebSocket to `/api/v1/admin/ws/metrics`; invalidates React Query on events | `hooks/admin/useAdminRealtime.ts`; used in layout |

**Active layout:** **Admin V2** only. Layout uses `AdminV2Sidebar` and `AdminV2Header`; no `components/admin/layout/*` (removed).

**Flow:** Hydration → if no token → redirect to login. If token → fetch `/admin/auth/me` in background → update store (admin + permissions). Shell (sidebar + header + main) renders as soon as token exists; auth/me refreshes permissions.

---

## SECTION 4 — DASHBOARD ANALYSIS

**File:** `app/admin/(protected)/dashboard/page.tsx`

| Element | Implementation | Data source / API |
|---------|----------------|--------------------|
| **KPI cards** | v2/dashboard **KPICard** (6 cards) | useDashboardStats, useAnalyticsAll, useRevenue, useTradingVolume, useLiquidity, useWithdrawalsList, useControlOverview |
| **Trading volume chart** | Inline AreaChart (Recharts) | volumeBuckets from useTradingVolume('7d') |
| **Market distribution** | Inline PieChart | byMarket from useLiquidity('24h') |
| **System health** | **SystemHealthPanel** | useControlOverview (and internal fetches) |
| **Exchange controls** | **ExchangeControls** | useControlOverview, useTradingHalt |
| **Risk & security** | **RiskSecurityPanel** | Internal hooks / API |
| **Activity feed** | **ActivityStream** | React Query cache / admin events |

**React Query hooks (useAdminDashboard):**

- useDashboardStats → getDashboardStats → `GET /admin/dashboard/stats`
- useAnalyticsAll(period) → getAnalyticsAll → `GET /admin/analytics/all`
- useRevenue(period) → getRevenue → `GET /admin/analytics/revenue`
- useTradingVolume(period) → getTradingVolume → `GET /admin/analytics/trading-volume`
- useLiquidity(period) → getLiquidity → `GET /admin/analytics/liquidity`
- useWithdrawalsList → getWithdrawals → `GET /admin/withdrawals`
- useControlOverview → getControlOverview → `GET /admin/control/overview`

**Endpoints used by dashboard:** `/admin/dashboard/stats`, `/admin/analytics/*`, `/admin/withdrawals`, `/admin/control/overview`, `/admin/trading-halt` (via ExchangeControls).

---

## SECTION 5 — API INTEGRATION AUDIT

**Base:** `lib/admin/apiClient.ts` — `adminFetch(path, { method, body, token, params })`, base URL `getApiBaseUrl() + '/api/v1/admin' + path`.

| Client file | Main functions | Endpoint paths | Used by |
|-------------|----------------|----------------|---------|
| **apiClient** | adminFetch, buildUrl | — | All other clients |
| **permissions** | hasPermission, canViewUsers, canApproveWithdrawals, canViewRisk, canManageTrading, canManageSettings, canAccessNavPermission | — (store only) | Sidebar, withdrawals pages |
| **users** | getDashboardStats, (others) | /dashboard/stats, /users, … | Dashboard, users pages, hooks |
| **wallets** | getWallets, getFundsSummary, getHotWallets, getWithdrawals, getDeposits, getEscrows | /wallets, /funds/summary, /hot-wallets/*, /withdrawals, /deposits, /escrows | Dashboard, withdrawals, deposits, wallets, hooks |
| **trading** | getTradingHalt, setTradingHalt, getMatches, getSettingsTradingPairs, getFees, getMonitoringCounters, getSpotOrderbook, … | /trading-halt, /matches, /settings/trading-pairs, /fees, /monitoring/counters, /spot/orderbook/:symbol | Dashboard, trading pages, hooks |
| **p2p** | getP2pOverview, getP2pOrders, getP2pDisputes, resolveP2pDispute, getP2pAds | /p2p, /p2p/orders, /p2p/disputes, /p2p/ads | P2P pages (getEscrows from wallets) |
| **settings** | getSettings, patchSettings, getSettingsBlockchains, getSettingsCurrencies, getAdmins, getAdminLogs | /settings, /settings/blockchains, /settings/currencies, /admins, /admins/logs | Settings pages (getSettingsTradingPairs from trading) |
| **analytics** | getTradingVolume, getUserGrowth, getRevenue, getDepositsBuckets, getWithdrawalsBuckets, getLiquidity, getAnalyticsAll, getRevenueBreakdown, getApiMetrics | /analytics/* | Dashboard, users, reports, hooks |
| **risk** | (risk intel, etc.) | /risk, … | Risk pages |
| **search** | adminSearch | /search?q=&limit= | Header global search |
| **systemHealth** | getSystemHealth | /system-health | System-health page |

**Index:** `lib/admin/index.ts` re-exports all; p2p and settings omit conflicting names (getEscrows, getSettingsTradingPairs) to avoid duplicate exports.

---

## SECTION 6 — BACKEND ROUTE AUDIT

**Prefix:** `/api/v1/admin`. All admin routes mounted under this prefix unless noted.

| Module | Prefix | Key endpoints | Purpose |
|--------|--------|----------------|---------|
| **admin.fastify** | /api/v1/admin | /auth/me, /auth/logout, /dashboard/stats, /trading-halt, /system-health, /search, /monitoring/counters, /monitoring/mm-risk, /users, /users/:id, /kyc, /kyc/pending, /kyc/:id/review, /p2p/disputes, /settings, /wallets, /funds/summary, /hot-wallets, /deposits, /withdrawals, /escrows, /trading, /p2p, /p2p/ads, /p2p/orders, /referrals/*, /fees/*, /notifications/*, /admins, /admins/logs, /settings/blockchains, /settings/currencies, /tokens, /settings/quote-assets, /settings/trading-pairs, /settings/p2p-assets, /settlement/*, /deposit-sweeps/*, /ws/metrics (WebSocket), … | Core admin API + WS |
| **admin-aml.fastify** | /api/v1/admin | /aml/config, /aml/dashboard | AML config and dashboard |
| **admin-security.fastify** | /api/v1/admin | /security/dashboard, /security/risk-rules, /security/ip-rules, /security/withdrawals/pending, /security/withdrawals/:id, approve/reject, /security/sessions, /security/audit-logs, … | Security, risk rules, IP, withdrawal approvals, audit |
| **admin-spot.fastify** | /api/v1/admin/spot | /markets, /orders, /trades | Spot markets, orders, trades |
| **admin-control.fastify** | /api/v1/admin | /control/overview, /control/settlement/stats | Control overview, settlement stats |
| **admin-analytics.fastify** | /api/v1/admin | /analytics/api-metrics, /analytics/risk-intelligence | API metrics, risk intelligence |
| **admin-operations.fastify** | /api/v1/admin | /operations/automation/rules, /operations/automation/executions, /operations/incidents, /operations/proof-of-reserves, /operations/system-reliability, /operations/playbooks | Automation, incidents, PoR, playbooks |
| **admin-operational.fastify** | /api/v1/admin | /operational/wallet-status, /operational/rate-limits, /operational/backups | Wallet status, rate limits, backups |
| **admin-integrations.fastify** | /api/v1/admin | /indexer/status, /oracle/status, /security/geo-blocking, /compliance/sanctions, /security/network-risk | Indexer, oracle, geo-blocking, sanctions |
| **admin-phase1-compliance.fastify** | /api/v1/admin | /compliance/sanctions/config, /settings/withdrawal-tier-limits, /compliance/str-ctr/reports, /settings/alert-channels | Sanctions config, tier limits, STR/CTR, alert channels |
| **admin-phase2-4.fastify** | /api/v1/admin | /engine/recovery-status, /wallets/cold/reserves, /settings/2fa-enforcement, /trading/listing-status, /settings/liquidity-sla, /settings/scheduled-compliance, /settings/feature-flags | Engine, cold reserves, 2FA, listing, liquidity SLA, scheduled compliance, feature flags |

**Auth:** Admin routes use `getAdminFromRequest(app, request, reply, requirePermission?)` (JWT + session). Optional permission check via `getAdminWithPermission(…, 'permission_key')`.

---

## SECTION 7 — DATA FLOW

**End-to-end:**

1. **Admin UI** (React) → calls **React Query** hooks (e.g. useDashboardStats, useWithdrawalsList) or direct **API client** (e.g. getSystemHealth).
2. **API client** (`lib/admin/*`) → `adminFetch(path, { token, params, method, body })` → **fetch** to `getApiBaseUrl() + '/api/v1/admin' + path` with `Authorization: Bearer <token>`.
3. **Backend** (Fastify) → admin routes registered with prefix `/api/v1/admin` → **getAdminFromRequest** (JWT + session) → handler → **DB/Redis/services**.
4. **Response** → `{ success, data }` or `{ success: false, error }` → React Query or component state.

**Dashboard data flow:**

- Layout mounts → **useAdminRealtime()** connects to `wss://.../api/v1/admin/ws/metrics?token=...`.
- Dashboard page mounts → **useDashboardStats**, **useAnalyticsAll**, **useRevenue**, **useTradingVolume**, **useLiquidity**, **useWithdrawalsList**, **useControlOverview** run.
- Each hook uses **useQuery** with key like `['admin', 'dashboard-stats', token]` and **queryFn** calling the corresponding `get*` from `lib/admin`.
- **get*** uses **adminFetch** with the same token from **useAdminAuthStore**.
- On WebSocket events (e.g. trade_executed, withdrawal_requested), **useAdminRealtime** invalidates or updates React Query cache so the dashboard updates without full refetch.

**Token source:** Login stores token and admin in **admin-auth** store (Zustand, persisted). Protected layout and hooks read token from store; auth/me refreshes admin (and permissions) on load.

---

## SECTION 8 — PERMISSION SYSTEM (RBAC)

| Layer | Implementation | Where |
|-------|----------------|-------|
| **Backend** | getAdminFromRequest (JWT + session). getAdminWithPermission(app, request, reply, permissionKey) for sensitive routes. SUPER_ROLES bypass permission check. Permission matrix maps route scope to required permission (e.g. withdrawals:approve, monitoring:view). | admin.fastify.ts, other admin route files |
| **Frontend store** | Admin user has `role` and `permissions: string[]`. Set from login and from GET /admin/auth/me. | store/admin-auth.ts |
| **Frontend helpers** | hasPermission(perm), canViewUsers(), canApproveWithdrawals(), canViewRisk(), canManageTrading(), canManageSettings(), canAccessNavPermission(perm). Super admin (role normalized to super_admin) treated as having all permissions. | lib/admin/permissions.ts |
| **Sidebar** | SIDEBAR_NAV items can have `permission`. visibleNav = filter by canAccessNavPermission(item.permission). | components/admin/v2/Sidebar.tsx |
| **Actions** | Withdrawal approve/reject buttons disabled when !canApproveWithdrawals(). | withdrawals page, security/withdrawals, withdrawal-detail-dialog |

**Example permissions:** view_users, view_withdrawals, approve_withdrawals, view_risk, manage_trading, manage_settings.

**Enforcement:** Backend enforces on sensitive routes (e.g. approve withdrawal, circuit reset). Frontend hides nav and disables actions when permission missing.

---

## SECTION 9 — REALTIME SYSTEM

| Feature | Implementation | Purpose |
|---------|----------------|---------|
| **WebSocket** | `GET /api/v1/admin/ws/metrics` (upgraded to WebSocket). Query: `token=<admin_jwt>`. | Admin metrics stream |
| **Hook** | useAdminRealtime() in protected layout. Connects with token from store; reconnect with backoff; ping every 30s. | Keep dashboard and lists updated |
| **Events** | connected, trade_executed, order_created, deposit_confirmed, withdrawal_requested, p2p_order_created, aml_alert_triggered, pong, error. | Invalidate or update React Query cache (e.g. admin/withdrawals, admin/dashboard-stats, admin/analytics-all) |
| **Backend** | admin-ws.service.ts — registerAdminConnection(socket, adminId). Broadcasts from trading/deposit/withdrawal/P2P/AML flows. | Push events to connected admin clients |

**Flow:** Client opens WS → server validates JWT → subscribes to admin metrics stream. Server pushes events → client handler updates or invalidates React Query by queryKey → UI refetches or shows updated data.

---

## SECTION 10 — DESIGN SYSTEM

**Scope:** `.admin-panel` in `apps/frontend/src/app/globals.css`.

**CSS custom properties (tokens):**

| Token | Example value | Purpose |
|-------|----------------|---------|
| --admin-bg | #F8FAFC | Page background |
| --admin-card-bg | #FFFFFF | Card background |
| --admin-card-border | #E5E7EB | Card border |
| --admin-sidebar-bg | #FFFFFF | Sidebar background |
| --admin-header-bg | #F8FAFC | Header background |
| --admin-text | #1F2937 | Primary text |
| --admin-text-muted | #6B7280 | Secondary text |
| --admin-active-bg | rgba(124,58,237,0.1) | Active nav item |
| --admin-hover-bg | #F9FAFB | Hover background |
| --admin-primary | #7C3AED | Primary (purple) |
| --admin-success | #10B981 | Success (green) |
| --admin-warning | #F59E0B | Warning (amber) |
| --admin-danger | #EF4444 | Danger (red) |
| --admin-shadow | 0 1px 3px… | Card shadow |
| --admin-shadow-hover | 0 4px 6px… | Card hover shadow |
| --admin-radius | 12px | Border radius |
| --admin-sidebar-w | 260px | Sidebar width |
| --admin-accent-* | (users, wallets, trading, p2p, risk, reports) | Section accents |
| --chart-primary, --chart-success, etc. | (chart colors) | Charts |
| --admin-input-bg | #F3F4F6 | Input background |

**Classes:** `.admin-panel`, `.admin-card`, `.admin-sidebar`, `.admin-header`, `.admin-skeleton`, `.animate-admin-fade-in`, `.animate-admin-slide-up`, `.animate-admin-scale-in`. Table styles under `.admin-panel table`.

**Layout:** Protected layout sets `data-theme="admin-light"` and `className="admin-panel min-h-screen bg-[var(--admin-bg)]"`. Sidebar width 260px; main content `lg:ml-[260px]`.

---

## SECTION 11 — UNUSED OR LEGACY CODE

| Item | Status | Notes |
|------|--------|-------|
| **components/admin/layout** | REMOVED | Replaced by v2 Sidebar + Header |
| **components/admin/crm** | REMOVED | Replaced by v2/dashboard KPICard, ChartCard |
| **dashboard/AdminMetricCard** | DUPLICATE | ui/AdminMetricCard and control-plane MetricWidget exist; dashboard version may be unused |
| **admin-rbac.ts (role-based)** | LEGACY? | Route access by role (e.g. canAccessRoute). Permissions (lib/admin/permissions.ts) are the active RBAC for nav and actions |
| **admin-users-api.ts, admin-wallets-api.ts, admin-analytics-api.ts** | ALTERNATE CLIENTS | Some pages import from these instead of lib/admin; not unified in index |
| **SectionHeader description prop** | FIXED | Several pages used `description`; SectionHeader expects `subtitle` — already corrected in audit pass |
| **Conflicting lib/admin exports** | FIXED | getEscrows, getSettingsTradingPairs, getDeposits/getWithdrawals conflicts resolved via explicit re-exports and getDepositsBuckets/getWithdrawalsBuckets in analytics |

**Candidates for removal on rebuild:** None required for current V2 migration. For a full rebuild, consolidate duplicate metric/chart wrappers (ui vs dashboard) and prefer a single admin API surface (lib/admin vs admin-*-api.ts).

---

## SECTION 12 — REBUILD PLAN

**Goal:** Rebuild admin UI without breaking backend or losing capability.

### 1. Do not remove or change

- **Backend:** All routes under `/api/v1/admin` and admin route modules. Keep auth (JWT + session), getAdminFromRequest, getAdminWithPermission.
- **API clients:** `lib/admin/*` (apiClient, users, wallets, trading, p2p, settings, analytics, risk, search, systemHealth, permissions). Keep adminFetch contract and base URL.
- **React Query hooks:** `hooks/admin/useAdminDashboard.ts` and any other admin hooks. Keep queryKeys and dependency on lib/admin.
- **Store:** `store/admin-auth.ts` (admin, tokens, permissions). Keep persistence and auth/me refresh.
- **Realtime:** `hooks/admin/useAdminRealtime.ts` and backend admin WebSocket. Keep event types and cache invalidation.

### 2. Safe to replace (UI only)

- **Layout:** Keep using the same layout contract (sidebar + header + main). Can replace `components/admin/v2/Sidebar.tsx` and `v2/Header.tsx` with new components as long as they still use the same permission helpers and nav structure (or a cleaned-up one).
- **Dashboard:** Keep data flow (same hooks and endpoints). Can replace page and v2/dashboard components (KPICard, ChartCard, ExchangeControls, SystemHealthPanel, RiskSecurityPanel, ActivityStream) with new implementations that consume the same hooks and APIs.
- **Tables:** Many pages use `DataTable` from v2/tables or security/DataTable. Can replace with a new table component that keeps the same props/API where possible.
- **Control-plane:** SectionHeader, Panel, MetricWidget, StatusBadge, ActionButton can be replaced by new primitives that preserve props (e.g. title/subtitle for SectionHeader) so pages don’t break.

### 3. Folders to remove (only after new UI is in place)

- **components/admin/layout** — Already removed.
- **components/admin/crm** — Already removed.
- **components/admin/dashboard** — Only if every usage of dashboard/AdminMetricCard is migrated to ui or v2; then remove to avoid duplicate.
- **components/admin/v2** — Remove only after new layout (sidebar, header), new dashboard widgets, and new DataTable live elsewhere and all imports are updated.

### 4. Recommended rebuild sequence

1. **Phase 1 — Design system:** Define new tokens and components (buttons, cards, inputs, tables) without removing old ones. Use a new namespace or path (e.g. `components/admin/v3` or `components/admin/design-system`).
2. **Phase 2 — Layout:** Build new Sidebar and Header (permission-aware, same auth store). Swap them in `app/admin/(protected)/layout.tsx`; keep AdminSessionManager and useAdminRealtime. Remove or deprecate v2/Sidebar and v2/Header only after verification.
3. **Phase 3 — Dashboard:** Build new dashboard page and widgets that use existing hooks (useDashboardStats, useAnalyticsAll, etc.) and same endpoints. Switch dashboard route to new page; then remove old v2/dashboard usage.
4. **Phase 4 — List/detail pages:** Migrate pages to new table and card components one by one; keep calling the same lib/admin functions and hooks. Update imports from control-plane and v2/tables to new components.
5. **Phase 5 — Cleanup:** Remove unused components (legacy layout, crm, duplicate dashboard/ui components). Consolidate admin API usage to lib/admin where possible.

### 5. Testing checklist before/after rebuild

- Login → redirect to dashboard; auth/me and permissions load; sidebar shows correct sections for permission set.
- Dashboard loads; KPIs and charts show data; system health and activity update.
- Withdrawals list and approve/reject (with permission) work; sidebar hides when permission missing.
- Global search (Header) returns users/orders/trades/withdrawals/transactions and navigation works.
- System health page shows latency, WS, DB, node, queue metrics.
- WebSocket: connect to /admin/ws/metrics; trigger a trade or withdrawal; dashboard or list updates.
- No direct calls to removed paths (layout/*, crm/*). No runtime errors from missing components or wrong prop names (e.g. subtitle not description).

---

**Document version:** 1.0  
**Last audit context:** Admin V2 active; layout and crm removed; RBAC and realtime in place; build and type errors addressed in codebase.
