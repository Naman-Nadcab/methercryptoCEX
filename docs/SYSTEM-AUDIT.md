# Full System Audit — Backend to Frontend, Admin, User, Deposit, Withdrawal, Spot, P2P

**Scope:** End-to-end audit of the Exchange platform: backend API, frontend (user dashboard + admin), authentication, deposit, withdrawal, spot trading, P2P, convert, and related flows.

---

## 1. Architecture Overview

| Layer | Stack | Entry |
|-------|--------|--------|
| **Backend** | Fastify, PostgreSQL, Redis, RabbitMQ, JWT | `apps/backend` — `server.ts`, port 4000 |
| **Frontend** | Next.js 14, React | `apps/frontend` — port 3000 |
| **Admin** | Same Next.js app, `/admin/*` | Admin JWT + IP whitelist |
| **Indexer** | EVM block indexer (deposits/txs) | `apps/indexer` — port 4001 (API) |

**API base:** All backend routes under `/api/v1/*`. Frontend uses same-origin proxy (browser → Next → backend) for user APIs; WebSocket and admin may use `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:4000`).

---

## 2. Backend — Route Map

### 2.1 Route Registration (`server.ts`)

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/v1/auth` | auth.fastify, auth.oauth | User login (OTP, passkey, 2FA), refresh, profile, security |
| `/api/v1/trading` | trading.fastify | Legacy trading pairs, balances, orders, history |
| `/api/v1/p2p` | p2p.fastify | P2P ads, orders, payment methods, merchant stats |
| `/api/v1/user` | user.fastify | User profile, sessions, activity, announcements, notifications, referrals, risk, KYC |
| `/api/v1/admin` | admin.fastify, admin-aml, admin-security | Admin dashboard, users, KYC, deposits, withdrawals, P2P, settings, fees, blockchains, trading pairs, hot wallets, referrals, etc. |
| `/api/v1/upload` | upload.fastify | File uploads (e.g. KYC) |
| `/api/v1/wallet` | wallet.fastify | Chains, tokens, KYC status, addresses, balances, deposit/withdraw, transfer |
| `/api/v1/convert` | convert.fastify | Convert currencies, market prices, quote, instant/limit convert, orders |
| `/api/v1/kyc` | kyc.js | KYC status, document upload |
| `/api/v1/debug` | debug.fastify | Debug (dev) |
| `/api/v1/spot` | spot.fastify | **Spot:** markets, ticker, orderbook, order, cancel, orders, order-history, trade-history, open-orders, metrics, WebSocket |
| `/api/v1/admin/spot` | admin-spot.fastify | Admin spot markets, orders |

### 2.2 Authentication & Security (Backend)

- **User routes:** `app.authenticate` — JWT Bearer, `type !== 'admin'`, Redis session check, optional refresh.
- **Admin routes:** No global hook; each handler calls `getAdminFromRequest(app, request, reply, requireSuperAdmin)`. That:
  - Verifies JWT with `type === 'admin'`.
  - Validates admin session (Redis or DB).
  - Enforces **admin IP whitelist** when configured (production: empty whitelist = deny all).
  - Applies **admin rate limit** (e.g. 60/min per admin).
- **IP rules:** `ipRulesMiddleware(app)` — applies to all requests; admin scope gets stricter treatment (whitelist-if-exists); blocks logged to audit.
- **Spot public:** `GET /spot/markets`, `GET /spot/ticker/:symbol`, `GET /spot/orderbook/:symbol` — no auth (skipAuth in frontend). Order/order-history/open-orders require auth.

---

## 3. Frontend — App Structure

### 3.1 User-Facing (Dashboard)

| Path | Purpose |
|------|--------|
| `/`, `/dashboard` | Landing / dashboard home |
| `/dashboard/spot` | **Spot trading** — chart, orderbook, recent trades, order entry, open orders, order/trade history |
| `/dashboard/markets` | Markets list (link to spot with ?symbol=) |
| `/dashboard/orders`, `/dashboard/orders/spot`, `/dashboard/orders/p2p` | Orders (spot/P2P) |
| `/dashboard/assets`, `/dashboard/assets/overview`, `/dashboard/assets/[symbol]`, funding, history, convert, PnL, unified | **Assets:** balances, deposit, withdraw, transfer, convert, history |
| `/dashboard/deposit/crypto` | Crypto deposit (chains, address, history) |
| `/dashboard/withdraw/crypto`, `/dashboard/withdraw/fiat` | Withdraw crypto/fiat |
| `/dashboard/transfer` | Internal transfer (funding ↔ trading) |
| `/dashboard/p2p`, `/dashboard/p2p/orders/[orderId]`, P2P create/browse | **P2P** — ads, orders |
| `/dashboard/referral`, `/dashboard/referral/my-referrals` | Referrals |
| `/dashboard/history` | History |
| `/dashboard/preferences`, `/dashboard/security/*`, `/dashboard/api/create`, `/dashboard/fee-rates`, `/dashboard/data-export` | Settings, security, API keys, fees, export |

### 3.2 Admin

| Path | Purpose |
|------|--------|
| `/admin`, `/admin/login` | Admin login (email/password → admin JWT) |
| `/admin/(protected)/dashboard` | Admin dashboard |
| `/admin/(protected)/users`, users/[id], kyc, deposits, withdrawals, etc. | Users, KYC, deposits, withdrawals |
| `/admin/(protected)/wallets/*` | Hot/cold wallets, funds summary, deposit sweeps, ledger, reconciliation |
| `/admin/(protected)/trading/*`, `/admin/(protected)/settings/trading-pairs` | Spot trading admin, pairs |
| `/admin/(protected)/p2p/*` | P2P ads, orders, disputes, merchants, payment methods, settings |
| `/admin/(protected)/withdrawals`, `/admin/(protected)/deposits/manual-credit` | Withdrawal approval/reject, manual credit |
| `/admin/(protected)/kyc/*`, `/admin/(protected)/compliance/*`, `/admin/(protected)/security/*` | KYC, AML/compliance, security |
| `/admin/(protected)/settings/*` | Blockchains, currencies, tokens, features, API, P2P assets, quote assets |
| `/admin/(protected)/referrals/*`, `/admin/(protected)/admins/*`, `/admin/(protected)/system-health`, etc. | Referrals, admin roles, system health |

Admin frontend uses `NEXT_PUBLIC_API_URL` (or equivalent) and sends **admin JWT** in `Authorization: Bearer <adminToken>`.

---

## 4. Critical Flows

### 4.1 User Auth

- **Login:** `POST /api/v1/auth/send-otp` (rate limited) → user submits OTP → `POST /api/v1/auth/login` (or verify) → returns `accessToken`, `refreshToken` (user JWT, `type !== 'admin'`).
- **Refresh:** `POST /api/v1/auth/refresh` with `refreshToken` → new access + refresh; session rotated in Redis.
- **Passkey / 2FA / fund password / API keys / preferences:** Under `auth.fastify` and `user.fastify`; all require user JWT.

### 4.2 Admin Auth

- **Login:** `POST /api/v1/admin/auth/login` (email + password) → admin JWT (`type: 'admin'`) + refresh; session stored Redis + DB.
- **Usage:** Every admin route calls `getAdminFromRequest()` (and optionally `getAdminForWithdrawalApproval` for withdrawal actions). IP whitelist and rate limit applied there.

### 4.3 Deposit (Crypto)

- **User:** `GET /api/v1/wallet/deposit-address/:chainId` (per chain), `GET /api/v1/wallet/deposit-history`, `GET /api/v1/wallet/deposit/:txHash` (by tx).
- **Backend:** Indexer/workers credit deposits; `wallet.fastify` and deposit-credit service apply balances and ledger.
- **Admin:** `GET /api/v1/admin/deposits`, `POST /api/v1/admin/deposits/manual-credit`, deposit-sweeps (eligibility, run), hot-wallet management.

### 4.4 Withdrawal (Crypto)

- **User:** `GET /api/v1/wallet/withdrawal-limits`, `GET /api/v1/wallet/withdrawal-fee/:symbol/:chainId`, `GET /api/v1/wallet/withdraw/preview`, `POST /api/v1/wallet/withdrawals`, `POST /api/v1/wallet/withdrawals/:id/cancel`, `GET /api/v1/wallet/withdrawals`.
- **Backend:** Withdrawal approval service (threshold, high-risk tokens); signing queue; hot wallet payout.
- **Admin:** `GET /api/v1/admin/withdrawals`, `POST /api/v1/admin/withdrawals/:id/approve`, `POST /api/v1/admin/withdrawals/:id/reject`; security module has `/admin/security/withdrawals/pending` and approve/reject.

### 4.5 Spot Trading

- **Public (no auth):** `GET /api/v1/spot/markets`, `GET /api/v1/spot/ticker/:symbol`, `GET /api/v1/spot/orderbook/:symbol`.
- **Authenticated:** `POST /api/v1/spot/order` (rate limited), `POST /api/v1/spot/order/:id/cancel`, `POST /api/v1/spot/orders/cancel-all`, `GET /api/v1/spot/orders`, `GET /api/v1/spot/order-history`, trade-history, open-orders. Idempotent `POST /api/v1/spot/orders` (client_order_id) also exists.
- **WebSocket:** `GET /api/v1/spot/ws` (optional token) — orderbook/trades/ticker updates.
- **Matching:** Match poller + settlement worker + wallet reconciliation (Phase-8); global balance audit, settlement replay check.

### 4.6 P2P

- **User:** `GET /api/v1/p2p/ads`, `GET /api/v1/p2p/payment-methods`, `GET /api/v1/p2p/my-ads`, `GET /api/v1/p2p/my-orders`, `GET /api/v1/p2p/orders/:orderId`, `POST /api/v1/p2p/orders`, confirm-payment, release, cancel; merchant stats.
- **Admin:** P2P disputes (list, resolve), orders, ads, merchants, settings, escrows.

### 4.7 Convert

- **User:** `GET /api/v1/convert/currencies`, `GET /api/v1/convert/market-prices`, `GET /api/v1/convert/quote`, `POST /api/v1/convert/...` (instant/limit), `GET /api/v1/convert/orders/active`, `GET /api/v1/convert/history`, cancel limit.
- **Backend:** Idempotency (hash + TTL); balance moves and ledger in convert.fastify.

### 4.8 Wallet & Balances

- **User:** `GET /api/v1/wallet/balances`, `GET /api/v1/wallet/balances/by-account`, `GET /api/v1/wallet/balances/spot`, funding, summary; `POST /api/v1/wallet/transfer`; tokens, chains, addresses, KYC status, balance-diagnostic.
- **Admin:** Funds summary, hot/cold wallets, ledger, reconciliation, deposit-sweeps.

---

## 5. Data & Consistency

- **Spot:** Orderbook from Redis cache (or DB); ticker/trades from DB; matching and settlement workers keep balances and ledger in sync.
- **P2P:** Escrow and locks; velocity and escrow caps; dispute flow.
- **Deposits:** Indexer + deposit-credit service; sweeps for hot wallets.
- **Withdrawals:** Approval workflow, signing queue, audit logs.

---

## 6. Gaps & Recommendations

| Area | Finding | Recommendation |
|------|--------|----------------|
| **Auth** | User and admin tokens strictly separated (`type` in JWT). Session stored in Redis (and DB for admin). | Keep; ensure admin refresh and logout invalidate session. |
| **Admin** | No global admin hook; each route calls `getAdminFromRequest`. IP whitelist and rate limit inside that. | Consider a single `preHandler` for `/api/v1/admin/*` (except login) to avoid missing checks on new routes. |
| **Spot** | Two order endpoints: `POST /order` (legacy?) and `POST /orders` (idempotent). | Clarify which is canonical; document idempotency for clients. |
| **Frontend proxy** | Browser uses same-origin for API; WebSocket uses backend URL when base is empty. | Document env (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_WS_URL) for production. |
| **Markets** | Spot page shows "No markets" or "Select a market" if `GET /spot/markets` is empty or fails. | Ensure `spot_markets` seeded or admin creates pairs; error/empty states already improved. |
| **Session-core** | `authDecisionPlugin` calls external session-core; fallback allows JWT when unavailable. | Confirm session-core deployment for production or document JWT-only mode. |
| **Indexer** | EVM indexer (port 4001); RPC/WS 401 errors in logs (e.g. Ankr). | Treat as env/API-key issue; spot and core flows do not depend on indexer for trading. |
| **KYC** | Routes under `/api/v1/kyc` and `/api/v1/user` and wallet (kyc-status). | Ensure single source of truth for KYC status used by wallet/withdraw. |
| **Withdrawal approval** | Admin and admin-security both have withdrawal approve/reject. | Confirm single workflow (e.g. security module for compliance) to avoid confusion. |
| **Audit** | Admin actions and IP blocks logged (audit_logs_immutable, user_activity_logs). | Retain; consider retention and search for compliance. |

---

## 7. File Reference (Key Entry Points)

| Concern | Backend | Frontend |
|---------|---------|----------|
| Server & routes | `apps/backend/src/server.ts` | — |
| User auth | `apps/backend/src/routes/auth.fastify.ts` | `apps/frontend/src/context/AuthContext.tsx`, `store/auth` |
| Admin auth | `apps/backend/src/routes/admin.fastify.ts` (getAdminFromRequest) | `apps/frontend/src/app/admin/*` |
| Spot | `apps/backend/src/routes/spot.fastify.ts` | `apps/frontend/src/app/dashboard/spot/page.tsx`, `components/trade/*` |
| Wallet (deposit/withdraw) | `apps/backend/src/routes/wallet.fastify.ts` | `apps/frontend/src/app/dashboard/deposit/*`, `withdraw/*`, `assets/*` |
| P2P | `apps/backend/src/routes/p2p.fastify.ts` | `apps/frontend/src/app/dashboard/p2p/*`, `app/p2p/*` |
| Convert | `apps/backend/src/routes/convert.fastify.ts` | `apps/frontend/src/app/dashboard/assets/convert/*` |
| API client | — | `apps/frontend/src/lib/api.ts`, `getApiUrl.ts` |

---

*Audit generated from codebase exploration. Update this doc when adding routes or changing auth/flow.*
