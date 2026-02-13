# Phase-5A Deliverables

## A) Exact Sidebar Structure (Files + Code)

**File:** `apps/frontend/src/components/admin/layout/Sidebar.tsx`

Sidebar uses a single `menuItems` array. Structure:

| Section | Children | href |
|--------|----------|------|
| **Dashboard** | — | `/admin/dashboard` |
| **User Management** | Users, Suspended Users, Login Activity | `/admin/users`, `/admin/users/suspended`, `/admin/security/sessions` |
| **KYC Management** | Pending KYC, Approved KYC, Rejected KYC, KYC Settings | `/admin/kyc/pending`, `/admin/kyc/approved`, `/admin/kyc/rejected`, `/admin/kyc/settings` |
| **Wallets** | Asset Balances, Hot Wallets, Cold Wallets, Wallet Health | `/admin/wallets/funds-summary`, `/admin/wallets/hot`, `/admin/wallets/cold`, `/admin/wallets/blockchain` |
| **Spot Trading** | Market List, Market Control, Fees & Limits, Circuit Breakers, Live Orders, Failed Orders, Cancel Orders, Live Trades, Trade Audit | `/admin/trading/spot-markets`, `/admin/trading/market-control`, `/admin/trading/fees`, `/admin/trading/circuit-breakers`, `/admin/trading/orders` (+ query), `/admin/trading/trade-history` |
| **P2P Trading** | Orders, Disputes | `/admin/p2p/orders`, `/admin/p2p/disputes` |
| **Deposits** | Pending Deposits, Failed Deposits | `/admin/deposits/pending`, `/admin/deposits/flagged` |
| **Withdrawals** | Pending Withdrawals, Risk Holds, Manual Review | `/admin/withdrawals/pending-approval`, `/admin/withdrawals/pending` |
| **Fee Management** | Spot Fees, Withdrawal Fees | `/admin/fees/trading`, `/admin/fees/withdrawal` |
| **Security** | Risk Flags, Circuit Breakers, Admin IP Whitelist, Audit Logs | `/admin/security/risk-rules`, `/admin/trading/circuit-breakers`, `/admin/security/ip-rules`, `/admin/security/audit-logs` |
| **Reports** | Volume, Revenue, User Growth | `/admin/reports/trading`, `/admin/reports/financial`, `/admin/reports/users` |
| **Settings** | System Settings, Feature Toggles | `/admin/settings`, `/admin/settings/features` |
| **Admin Users** | Roles & Permissions, Activity Logs | `/admin/admins/roles`, `/admin/security/audit-logs` |
| **Support** | Tickets, User Messages | `/admin/support` (both) |

Every `href` targets an existing route under `apps/frontend/src/app/admin/(protected)/`.

---

## B) Admin Pages Created/Updated

| Page | Path | Status |
|------|------|--------|
| **Circuit Breakers** | `apps/frontend/src/app/admin/(protected)/trading/circuit-breakers/page.tsx` | **Created** – lists markets with circuit count, tripped state, reset button |
| **Market Control** | `apps/frontend/src/app/admin/(protected)/trading/market-control/page.tsx` | **Created** (prior work) – select market, status/fees/limits/circuit/stats |
| **Trading Fees (Fees & Limits)** | `apps/frontend/src/app/admin/(protected)/trading/fees/page.tsx` | **Updated** – redirects to `/admin/fees/trading` (single source of truth) |
| **Spot Markets** | `apps/frontend/src/app/admin/(protected)/trading/spot-markets/page.tsx` | Existing – list + edit modal |
| **Orders / Trade history / Fees (Fee Mgmt)** | Existing pages | Unchanged – already wired to real APIs |

---

## C) API Wiring Per Page

| Page | APIs Used |
|------|-----------|
| **Circuit Breakers** | `GET /api/v1/admin/spot/markets` (list with `circuit_breaker_count`, `circuit_breaker_tripped`), `POST /api/v1/admin/spot/markets/:symbol/circuit-reset` |
| **Market Control** | `GET /api/v1/admin/spot/markets`, `GET /api/v1/admin/spot/markets/:symbol`, `PATCH /api/v1/admin/spot/markets/:symbol`, `POST .../circuit-reset` |
| **Trading Fees (redirect)** | None – client redirect to `/admin/fees/trading` |
| **Spot Fees (Fee Management)** | `GET /api/v1/admin/fees/trading`, `PATCH /api/v1/admin/fees/trading/pair/:id` |
| **Spot Markets list** | `GET /api/v1/admin/spot/markets`, `PATCH /api/v1/admin/spot/markets/:symbol` |

**Backend changes (admin-spot):**

- `GET /api/v1/admin/spot/markets` – response now includes per-row `circuit_breaker_count` and `circuit_breaker_tripped` (from Redis `spot:circuit:SYMBOL`).
- `GET /api/v1/admin/spot/markets/:symbol` – returns market + `circuit_breaker_count`, `circuit_breaker_tripped`, `open_orders_count`, `volume_24h`, `last_price`.
- `POST /api/v1/admin/spot/markets/:symbol/circuit-reset` – clears Redis circuit key and sets market status to `active`.

---

## D) UX Behavior Per Critical Screen

- **Circuit Breakers:** Skeleton rows while loading; table with Symbol, Status badge, Failure count, Reset (only when count > 0). Dismissible error via `getMessageFromApiError`. Refresh button to re-fetch list. No raw error codes.
- **Market Control:** Market dropdown → load detail; status dropdown (Active/Maintenance/Disabled) with PATCH; Live stats card (open orders, 24h volume, last price); Fees & limits read-only; Circuit breaker card with count, tripped state, confirmation then POST circuit-reset. Skeleton for detail load; errors human-readable.
- **Trading Fees (Spot Trading → Fees & Limits):** Redirect to Fee Management → Spot Fees with short “Redirecting…” so no dead/stub screen.
- **User Trade page:** Full spot trading UI at `/dashboard/trade`; no 404 when opening from sidebar or `/trade` redirect.

---

## E) Trade Page Routing Fixes (Exact Files + Snippets)

1. **Redirect route (optional but required for UX)**  
   **File:** `apps/frontend/src/app/trade/page.tsx`  
   - Client component: `router.replace('/dashboard/trade')` so `/trade` → `/dashboard/trade`.

2. **Dashboard sidebar**  
   **File:** `apps/frontend/src/app/dashboard/layout.tsx` (or equivalent nav)  
   - Trade nav item already points to `/dashboard/trade` (no change if already correct).

3. **Dashboard main page**  
   **File:** `apps/frontend/src/app/dashboard/page.tsx`  
   - Main “Trade” button: `href="/dashboard/trade"` (was `/trade/spot`).  
   - Per-row “Trade” in markets table: `href={/dashboard/trade}` (was `/trade/spot/...`).  
   - “View All Markets”: `href="/dashboard/trade"`.

4. **Other user links to Trade**  
   - `apps/frontend/src/app/dashboard/fee-rates/page.tsx`: “Trade Spot” → `/dashboard/trade`.  
   - `apps/frontend/src/app/dashboard/assets/unified/page.tsx`: “Trade” → `/dashboard/trade`.  
   - `apps/frontend/src/app/dashboard/assets/pnl/page.tsx`: “Start Trading” → `/dashboard/trade`.

**Actual Trade UI:** `apps/frontend/src/app/dashboard/trade/page.tsx` (unchanged; already full spot trading UI).

---

## F) Final Verification Checklist

| Check | Expected |
|-------|----------|
| User can open Trade page | Logged-in user clicks Trade (sidebar or dashboard) → `/dashboard/trade` loads spot trading UI; no 404. |
| User opening `/trade` | Redirects to `/dashboard/trade` and loads same UI. |
| Admin can fully control spot markets | Market Control: change status, view stats, reset circuit. Spot Markets: list + edit. Circuit Breakers: list + reset. |
| No dead sidebar links | Every sidebar item opens an existing route; Circuit Breakers and Market Control and Fees & Limits all resolve. |
| No dummy screens | Circuit Breakers and Market Control use real APIs; Trading Fees is a redirect to real Spot Fees page; no placeholder-only pages. |

**Phase-5A is complete when:**

- User Trade page opens correctly from all entry points.  
- Admin panel is Binance-level: full sidebar, real controls, no placeholders.  
- Every admin control (market status, circuit reset, fees via Fee Management) calls real backend APIs.
