# Admin Panel — Architecture Analysis

This document explains how the admin panel works. It is analysis only; no code or design changes are implied.

---

## Step 1 — Project Overview

### What this admin panel controls

The admin panel is the **operations console** for an enterprise cryptocurrency exchange. It lets staff manage:

- **Users** — list, detail, risk, activity, API keys, bans
- **KYC / Identity** — pending approvals, approved/rejected, audit trail
- **Wallets & funds** — deposits, withdrawals, manual credits, treasury, hot/cold wallets, reconciliation, ledger
- **Spot trading** — markets, listing/delisting, orders, trade history, fees, circuit breakers, halt controls
- **P2P** — ads, orders, escrows, disputes, merchants, payment methods
- **Compliance / AML** — sanctions, STR/CTR, alerts, reports, risk intelligence
- **Security & risk** — rate limits, geo-blocking, network risk, audit logs, sessions, withdrawal risk
- **Governance** — forensics, proof of reserves, user behavior, system reliability, playbooks
- **Exchange control** — control center, automation, smart alerts, incidents, orderbook/liquidity/revenue intelligence, API monitoring
- **System** — config, price oracle, 2FA, liquidity SLA, scheduled compliance, alert channels, feature flags, blockchain/tokens, engine recovery, backups, integrations
- **Finance & fees** — fee configuration, revenue, referrals
- **Support & reports** — support tickets, reports/exports, notifications
- **Admin users** — admin list, roles & permissions, activity log

### Main purpose

To give operators a **single place** to monitor and control the exchange: users, KYC, funds, trading, P2P, compliance, security, and system settings, with **role-based access** so only allowed areas are visible and callable.

### Technologies used

- **Runtime:** Node.js (Next.js), browser (React)
- **Language:** TypeScript
- **UI:** React 18, Next.js 14 (App Router)
- **Styling:** Tailwind CSS, global CSS (admin Liquid Glass theme), Ant Design (admin only)
- **Charts:** Recharts
- **State:** Zustand (persisted for admin auth), local `useState`/`useEffect` in pages; some React Query for users/wallets/analytics
- **Forms:** React Hook Form, Zod
- **Icons:** Lucide React

### Framework

- **Next.js 14** with the **App Router**. Admin lives under `app/admin/`. No separate “admin app”; it’s part of the same Next.js app as the public and user dashboard.

### UI libraries

- **Ant Design (antd)** — tables, forms, modals, buttons, etc. inside the admin panel only. Wrapped by `AdminAntdProvider` with a custom token theme.
- **Tailwind CSS** — layout, spacing, typography, colors, responsive. Used across the app including admin.
- **Radix UI** — used in the rest of the app (e.g. dialogs, dropdowns); admin leans more on Ant Design.
- **Recharts** — line/area/bar/pie charts on dashboard and analytics pages.

---

## Step 2 — Folder Structure

All paths below are under `apps/frontend/src/`.

### `app/`

- **Role:** Next.js App Router. Defines routes and top-level layouts.
- **Admin-relevant:**
  - `app/admin/page.tsx` — redirects `/admin` → `/admin/login`.
  - `app/admin/login/page.tsx` — admin login (no sidebar; standalone page).
  - `app/admin/(protected)/` — route group for all authenticated admin pages. Shares one layout.
  - `app/admin/(protected)/layout.tsx` — wraps all protected admin routes: sidebar, header, auth check, theme, Ant Design provider.
  - `app/admin/(protected)/**/page.tsx` — one file per admin screen (e.g. `dashboard/page.tsx`, `kyc/pending/page.tsx`).
- **Connection:** Every admin URL (except `/admin` and `/admin/login`) is a `page.tsx` under `(protected)`. The layout wraps them and provides Sidebar + Header.

### `components/`

- **Role:** Reusable React components.
- **Admin-relevant:**
  - `components/admin/` — admin-only components.
    - `AdminAntdProvider.tsx` — Ant Design `ConfigProvider` with admin theme.
    - `AdminSessionManager.tsx` — idle timeout and session-activity tracking; logs out and redirects to `/admin/login` on expiry.
    - `layout/Sidebar.tsx` — left navigation (menu items, RBAC filtering, trading-halt badge).
    - `layout/Header.tsx` — top bar (menu toggle, search, trading status, alerts, profile, logout).
    - `control-plane/` — shared building blocks: `Panel`, `MetricWidget`, `StatusBadge`, `SectionHeader`, `ActionButton`, `DataTable*`.
    - `charts/` — AdminChartCard, UserGrowthChart, TradingVolumeChart, RevenueChart, etc., used on dashboard and analytics.
    - `dashboard/AdminMetricCard.tsx` — dashboard metric cards.
    - `security/` — ConfirmDialog, ReasonCaptureModal, StatCard, DataTable (security-specific).
  - `components/ThemeToggle.tsx`, `ThemeProvider.tsx` — used by admin for light/dark.
- **Connection:** Layout imports Sidebar and Header. Pages import from `@/components/admin/control-plane`, `@/components/admin/charts`, and sometimes `@/components/admin/ReasonCaptureModal` or security components.

### `lib/`

- **Role:** Shared utilities and API helpers (no React).
- **Admin-relevant:**
  - `getApiUrl.ts` (export `getApiBaseUrl`) — returns base URL for backend ('' in browser when same-origin so Next.js can proxy).
  - `admin-rbac.ts` — admin roles (`super_admin`, `finance_admin`, etc.), route scopes per role, `canAccessRoute(role, pathname)`.
  - `admin-users-api.ts` — types and React Query hooks for admin user list/detail/balances/status and related.
  - `admin-wallets-api.ts` — admin wallet/balance/treasury APIs (if used).
  - `admin-analytics-api.ts` — admin analytics APIs (if used).
- **Connection:** Pages and Sidebar call `getApiBaseUrl()` and add `Authorization: Bearer <token>`. Sidebar uses `canAccessRoute(role, href)` to filter menu items. Some pages use hooks from `admin-users-api` (and similar) instead of raw `fetch`.

### `store/`

- **Role:** Global client state.
- **Admin-relevant:**
  - `admin-auth.ts` — Zustand store: `admin`, `accessToken`, `refreshToken`, `isAuthenticated`, `login`, `logout`, `setTokens`, etc. Persisted to `localStorage` under key `admin-auth-storage`.
- **Connection:** Layout and all protected pages read `accessToken` (and sometimes `admin`) from `useAdminAuthStore()`. Login page calls `login()`. Session manager and layout call `logout()` and redirect to `/admin/login` when needed.

### `hooks/`

- **Role:** Reusable React hooks.
- **Admin-relevant:**
  - `useAdminMetricsWs.ts` — WebSocket subscription for admin metrics (e.g. trade_executed, deposit_confirmed); used on dashboard to refresh stats.
- **Connection:** Dashboard (and any other page that subscribes) uses this hook to refetch or update UI when backend pushes events.

### `styles/`

- **Role:** Theme and chart styling.
- **Admin-relevant:**
  - `adminChartTheme.ts` — chart colors and tooltip/grid/axis tokens (CSS vars) for Recharts in admin.
- **Connection:** Admin chart components import `adminChartTheme` and use it for strokes, fills, tooltips.

### `data/`

- **Role:** Static data (e.g. steps, config).
- **Connection:** Used where needed (e.g. onboarding/progress); not central to admin routing or layout.

### `context/`

- **Role:** React context (e.g. auth for main app).
- **Connection:** Admin uses its own Zustand store for auth, not the main app’s auth context.

---

## Step 3 — Admin Modules

Modules correspond to sidebar sections and URL segments. For each, we summarize: what it does, what data it shows, and what actions the admin can perform.

| Module | What it does | Data shown | Admin actions |
|--------|--------------|------------|----------------|
| **Dashboard** | Entry view after login | User/KYC/P2P/referral stats, trading halt, health, charts (volume, growth, revenue, deposits/withdrawals, top markets, P2P, settlement, order flow, distribution) | Refresh; navigate to sub-pages |
| **Analytics Hub** | Analytics overview | Aggregated analytics and links to detailed reports | Navigate to reports |
| **Users** | User management | User list, detail, API keys, risk, activity/sessions | View, search, filter; ban/unban; view balances; revoke API keys |
| **KYC / Identity** | Verification workflow | Pending, approved, rejected applications; audit trail; settings | Approve/reject with reason; view history |
| **Wallet & Funds** | Funds and treasury | Indexer status, operations, treasury, deposits/withdrawals, manual adjustments, balance summary, hot/cold wallets, cold reserves, reconciliation, ledger (balance + settlement) | Manual credit; trigger sweeps; view/cancel withdrawals; adjust balances; configure hot/cold |
| **Spot Markets** | Spot trading ops | Markets, listing status, pairs, orders, trade history, market making, MM risk, circuit breakers, fees, halt controls | List/delist; suspend; set fees; halt/resume; manage circuit breakers |
| **P2P System** | P2P ops | Overview, active trades, orders/ads, escrows, disputes, merchants, payment methods, settings | Resolve disputes; manage ads and payment methods |
| **Compliance / AML** | Sanctions, STR/CTR, risk | Sanctions dashboard and config, STR/CTR workflow and reports, circuit breaker history, risk intelligence, AML alerts, cases | Configure sanctions; generate STR/CTR; escalate alerts; mark reports submitted; manage cases |
| **Security & Risk** | Security and risk ops | Rate limits, geo-blocking, network risk, audit logs, admin audit, sessions, IP/device rules, withdrawal risk, risk rules, security dashboard | Configure blocks; view logs; kill sessions; set rules |
| **Governance** | Forensics and reliability | Forensics, proof of reserves, user behavior, system reliability, playbooks | View reports; run playbooks |
| **Exchange Control** | Control center and intel | Control center, automation, smart alerts, incidents, orderbook/liquidity/trader/whale/revenue/API intel, notifications | Halt/resume trading; cancel orders; configure automation and alerts; broadcast notifications |
| **System Controls** | Backend and feature config | System config, price oracle, operations, settings, withdrawal tier limits, 2FA, liquidity SLA, scheduled compliance, alert channels, backups, API settings, feature flags, blockchain/tokens, engine recovery, system health, integrations, counters | Edit config; toggle features; set limits; manage backups |
| **Finance & Fees** | Fees and revenue | Fee configuration, revenue metrics, referral campaigns | Set fees; view revenue; manage referrals |
| **Support & Reports** | Support and exports | Support tickets, reports/exports, notifications | Handle tickets; run exports; send notifications |
| **Admin Users** | Admin identity and RBAC | Admin list, roles & permissions, activity log | Create/edit admins; assign roles; view audit |

---

## Step 4 — Routing System

### How routing works

- Next.js **App Router** file-based routing under `app/`.
- **Admin base:** `app/admin/`. No separate router or config file; routes are the folder/file tree.

### How admin pages are connected

- **Entry:** `/admin` → `app/admin/page.tsx` → redirect to `/admin/login`.
- **Login:** `/admin/login` → `app/admin/login/page.tsx`. No shared layout with the rest of admin; it’s a standalone screen.
- **Protected:** All other admin paths live under `app/admin/(protected)/`. The `(protected)` group does not change the URL; it only attaches the same layout to all of them.
- **Layout:** `app/admin/(protected)/layout.tsx` wraps every child route. So `/admin/dashboard`, `/admin/kyc/pending`, `/admin/wallets/deposits`, etc. all get:
  - Auth check (token from store; if missing, redirect to `/admin/login`).
  - Optional session check via `GET /api/v1/admin/auth/me` (background).
  - ThemeProvider → AdminAntdProvider → Sidebar + Header + main content area.
- **Child as content:** Each route’s `page.tsx` is rendered as `children` inside that layout’s `<main>`.

### Where routes are defined

- **Routes:** Defined only by the file system under `app/admin/`:
  - `app/admin/page.tsx` → `/admin`
  - `app/admin/login/page.tsx` → `/admin/login`
  - `app/admin/(protected)/dashboard/page.tsx` → `/admin/dashboard`
  - `app/admin/(protected)/kyc/pending/page.tsx` → `/admin/kyc/pending`
  - `app/admin/(protected)/compliance/alerts/[id]/page.tsx` → `/admin/compliance/alerts/:id`
  - etc.
- **Sidebar links:** Not the source of routes. The sidebar in `components/admin/layout/Sidebar.tsx` holds a **menu array** (`menuItems`) with `href` values that match these paths. So the sidebar is a navigation map to the same routes the App Router already defines.

---

## Step 5 — Data Flow

### End-to-end path

```
Admin UI (React components)
  → fetch() or React Query (hooks in lib/*-api.ts)
  → HTTP GET/POST/PATCH/DELETE to backend
  → Backend (Fastify) /api/v1/admin/* routes
  → Services / DB / Redis
  → JSON response
  → UI state (useState / React Query cache) → re-render
```

- **Frontend:** Browser (Next.js app).
- **API base URL:** From `getApiBaseUrl()`. In dev with same-origin, often `''` so requests go to the same host (Next.js can proxy to backend).
- **Backend:** Fastify server; admin routes under `/api/v1/admin/`.
- **Database:** PostgreSQL (and Redis for cache/sessions, etc.); backend talks to them, not the frontend.
- **UI:** Pages and components hold local state or use React Query; no global admin data store besides auth.

### API calling system

- **Auth:** Every admin request that needs auth sends `Authorization: Bearer <accessToken>` from `useAdminAuthStore().accessToken`.
- **Pattern 1 — Direct fetch:** Many pages do:
  - `const apiUrl = getApiBaseUrl();`
  - `fetch(\`${apiUrl}/api/v1/admin/...\`, { headers: { Authorization: \`Bearer ${accessToken}\` } })`
  - Then parse JSON and set local state (e.g. `setStats`, `setApplications`).
- **Pattern 2 — React Query:** Some areas (e.g. users, wallets, analytics) use hooks from `lib/admin-users-api.ts` (and similar). Those hooks use `getApiBaseUrl()` and a small helper that adds the Bearer token from the store (or a passed token) and call `useQuery` / `useMutation`.
- **No dedicated “admin API client”:** There is no single axios/fetch client instance for admin; it’s either raw `fetch` in the page or the helpers inside the lib hooks.

### Service layer

- **Frontend:** No backend-style service layer. “Service” logic is either in the page (fetch + setState) or inside the lib hooks (data fetching + cache).
- **Backend:** Has services (e.g. KYC, withdrawals, compliance); the admin frontend only calls HTTP endpoints and does not know about those services directly.

### Data fetching methods

- **On load:** `useEffect` that runs when `accessToken` (and sometimes other deps) is set; inside it, one or more `fetch` (or React Query) calls; results stored in `useState` or in query cache.
- **On action:** Button/handler calls `fetch` with method POST/PATCH/DELETE, then refetches list or updates local state.
- **Real-time (optional):** Dashboard uses `useAdminMetricsWs` to subscribe to backend events and then refetch or update so stats stay fresh.

---

## Step 6 — State Management

### What is used

- **Zustand** for admin auth (and its persistence).
- **React Query (@tanstack/react-query)** in a few places (e.g. `admin-users-api.ts`) for server state (list/detail/cache/invalidation).
- **Local component state** (`useState`, `useEffect`) for most admin pages (tables, filters, modals, loading, error).

There is no Redux, MobX, or global admin “app store” beyond auth.

### How state is managed

- **Auth (global, persisted):** `store/admin-auth.ts`. Zustand store with `admin`, `accessToken`, `refreshToken`, `isAuthenticated`, plus `login`, `logout`, etc. Persisted to `localStorage` so refresh keeps the session. Layout and login read/update this.
- **Server data:** Either kept in page-level `useState` (e.g. `stats`, `applications`) or in React Query cache when using the lib hooks. No shared “admin data store.”
- **UI state:** Modals, selected row, loading flags, error messages are all local to the page or a small subtree.
- **Sidebar/header:** Sidebar has local state for expanded menus and for badges (e.g. withdrawal count, trading halt). Header has local state for dropdowns and alert panel. Both get token (and sometimes role) from the auth store.

---

## Step 7 — Layout System

### Layout structure

- **Root wrapper (protected layout):**  
  `ThemeProvider` → `AdminAntdProvider` → one full-height container with class `admin-panel admin-panel-glass-bg`.
- **Sidebar (left):** Fixed, 240px width (CSS var `--admin-sidebar-w`). Contains logo link to dashboard, then a nav list built from `menuItems`. Each item is either a direct link or a folder (children). Active state and expand/collapse are driven by pathname and local state. On small screens it can be toggled (overlay).
- **Main content (right):** A column that has:
  - **Header (sticky):** Menu toggle (mobile), search, trading status, alerts, profile (with logout). Height and style come from admin theme (e.g. 70px, glass style).
  - **Content area:** `<main className="flex-1 p-3 lg:p-4 ...">` wrapping `{children}`. Each `page.tsx` is rendered here.
- **No nested sub-layouts:** There is no per-section layout (e.g. no separate “KYC layout” or “Wallets layout”). All protected pages share this same layout.

### How pages are wrapped

- Any route under `app/admin/(protected)/*` is wrapped by `app/admin/(protected)/layout.tsx`.
- That layout always renders Sidebar + Header + main; the current route’s `page.tsx` is the `children` inside `<main>`.
- Login and the root `/admin` redirect are not under `(protected)`, so they do not get the sidebar or header.

---

## Step 8 — UI Component System

Reusable building blocks and where they live:

| Component type | Location | How it’s reused |
|----------------|----------|------------------|
| **Tables** | `components/admin/control-plane/DataTable*.tsx`, `components/admin/security/DataTable.tsx` | Imported by many list pages (e.g. KYC pending, users, withdrawals). Head/body/row/cell components compose a table. Ant Design `Table` is also used. |
| **Cards / Panels** | `components/admin/control-plane/Panel.tsx`, `MetricWidget.tsx` | Panel: glass card with optional title, subtitle, header action. MetricWidget: small metric with label, value, variant (neutral/positive/warning/danger). Used on dashboard and section pages. |
| **Charts** | `components/admin/charts/` (AdminChartCard, UserGrowthChart, TradingVolumeChart, RevenueChart, DepositWithdrawChart, TopMarketsChart, P2PActivityChart, SettlementThroughputChart, TradeDistributionChart, OrderFlowChart, LiquidityHeatmap) | Dashboard and analytics pages import and pass data (or use default demo data). Styled with `adminChartTheme`. |
| **Forms** | Ant Design (Form, Input, Select, etc.) and React Hook Form + Zod where used | Login uses RHF + Zod. Many admin forms are Ant Design forms or plain inputs with fetch on submit. |
| **Modals / Dialogs** | Ant Design Modal; `ReasonCaptureModal`, `ConfirmDialog` in `components/admin/` | Reason capture for KYC approve/reject and similar; confirm for destructive actions. |
| **Notifications** | Ant Design message/toast (via ConfigProvider) | Used for success/error after actions. |
| **Buttons** | `components/admin/control-plane/ActionButton.tsx`, Ant Design Button | ActionButton for primary/danger/secondary with loading state. |
| **Badges** | `components/admin/control-plane/StatusBadge.tsx` | Trading status (LIVE/HALTED), KYC status, etc. |
| **Section header** | `components/admin/control-plane/SectionHeader.tsx` | Title + subtitle at top of many pages. |

All of these are standard React components; pages import them from `@/components/admin/...` or from the control-plane index.

---

## Step 9 — Authentication & Permissions

### Admin login system

- **Page:** `app/admin/login/page.tsx`. Form (email + password) with React Hook Form and Zod.
- **Request:** `POST /api/v1/admin/auth/login` with body `{ email, password }`. Base URL from `getApiBaseUrl()`.
- **Response:** Backend returns `{ success, data: { admin, accessToken, refreshToken } }`.
- **Storage:** Frontend calls `login(admin, accessToken, refreshToken)` on the Zustand store. Store persists `accessToken`, `refreshToken`, `admin`, `isAuthenticated` to `localStorage`.
- **Redirect:** On success, redirect to `/admin/dashboard`.
- **Session check:** Protected layout optionally calls `GET /api/v1/admin/auth/me` with the stored token (in background). If that fails, logout and redirect to `/admin/login`.
- **Idle logout:** `AdminSessionManager` listens for user activity and calls `logout()` and redirects to `/admin/login` after a period of inactivity (default 30 minutes).

### Role-based access control

- **Roles:** Defined in `lib/admin-rbac.ts`: `super_admin`, `finance_admin`, `compliance_admin`, `security_admin`, `support_admin`, `marketing_admin`.
- **Scopes:** Each role (except `super_admin`) has a list of route prefixes it is allowed to access (e.g. `finance_admin` → wallets, deposits, withdrawals, fees, reports/financial, dashboard, treasury, trading, etc.). `super_admin` can access everything.
- **Enforcement on UI:** Sidebar filters menu items with `canAccessRoute(role, href)`. So a logged-in admin only sees menu links they are allowed to open. The backend is expected to enforce the same roles on `/api/v1/admin/*`; the frontend does not enforce API calls, only visibility of links.

### Permission system

- **No fine-grained “permissions” in the frontend:** Access is by **role** and **route scope** only. There is no separate list of “can_approve_kyc” or “can_edit_fees” in the UI; it’s implied by the role and the routes that role can access. Backend can implement finer checks per endpoint.

---

## Step 10 — System Map

High-level map of how the admin panel fits together:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ADMIN UI (Browser)                                 │
│  app/admin/(protected)/**/page.tsx  ←  One page per route                    │
│  app/admin/login/page.tsx            ←  Login (no layout)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ uses
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYOUT (protected)                                                           │
│  • ThemeProvider → AdminAntdProvider                                          │
│  • Sidebar (menu from Sidebar.tsx, filtered by canAccessRoute(role, href))   │
│  • Header (trading status, alerts, profile, logout)                          │
│  • AdminSessionManager (idle timeout → logout)                               │
│  • main → { children } (current page)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ uses
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPONENTS                                                                   │
│  • control-plane: Panel, MetricWidget, StatusBadge, SectionHeader,            │
│    ActionButton, DataTable*                                                   │
│  • charts: AdminChartCard, UserGrowthChart, TradingVolumeChart, ...           │
│  • admin/security: ReasonCaptureModal, ConfirmDialog, StatCard, DataTable    │
│  • layout: Sidebar, Header                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ uses
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STATE & LIB                                                                  │
│  • store/admin-auth.ts (Zustand): admin, accessToken, login, logout          │
│  • lib/getApiUrl.ts: getApiBaseUrl()                                          │
│  • lib/admin-rbac.ts: canAccessRoute(role, pathname), roles, scopes           │
│  • lib/admin-users-api.ts (optional): useQuery/useMutation for users          │
│  • lib/admin-wallets-api.ts, admin-analytics-api.ts (optional)                │
│  • hooks/useAdminMetricsWs: WebSocket for dashboard metrics                   │
│  • styles/adminChartTheme.ts: chart colors for Recharts                       │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    │ HTTP (fetch / React Query)  Authorization: Bearer <token>
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Fastify)                                                            │
│  /api/v1/admin/*  (e.g. auth/login, auth/me, dashboard/stats, kyc/pending,     │
│                    trading-halt, withdrawals, ...)                             │
│  → Services → PostgreSQL / Redis                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Summary of connections

- **URL → Page:** App Router maps `/admin/...` to `app/admin/.../page.tsx`. Protected routes share one layout.
- **Layout → Components:** Layout renders Sidebar and Header and wraps page content. Sidebar gets role from auth store and filters links with RBAC.
- **Pages → Components:** Pages import Panel, charts, tables, SectionHeader, ActionButton, etc., and pass data and handlers.
- **Pages & components → State:** Auth from Zustand; server data from fetch + useState or React Query; UI state from useState.
- **Pages & components → API:** `getApiBaseUrl()` + `fetch` with Bearer token, or React Query hooks that do the same under the hood.
- **Backend:** All admin actions go through `/api/v1/admin/*`. Backend validates token and role and talks to DB/Redis; frontend does not talk to DB directly.

This is the structure of the admin panel as it exists today, described for developers and product managers.
