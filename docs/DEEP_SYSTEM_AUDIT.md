# Deep System Audit Report — Backend, Frontend, UX/UI

**Date:** February 27, 2026  
**Scope:** Full system — Backend APIs, Frontend flows, Auth, Spot, P2P, KYC, Deposits/Withdrawals, Admin, Security, UI/UX

---

## Executive Summary

| Area | Verdict | Key Findings |
|------|---------|--------------|
| **Backend** | ✅ Solid | Fastify, auth (JWT + API key + session), rate limits, idempotency, settlement pipeline |
| **Frontend** | ✅ Good | Auth flow fixed (401/403 only → logout), RequireAuth, api.ts with refresh retry |
| **Spot** | ✅ Connected | Orderbook, matching, candles (depends on trading_pairs + ohlcv_candles), chart error/loading fixed |
| **P2P** | ✅ Connected | Ads, orders, escrow, expiry job, dispute, payment methods |
| **Auth** | ⚠️ Minor gaps | Signup no rate limit, session-core/lock optional services |
| **Security** | ⚠️ Review | Debug route enabled, CSP disabled, session-core fallback |
| **UX/UI** | ⚠️ Gaps | Some placeholder pages, minor Binance-grade polish |

---

## 1. Backend Audit

### 1.1 Architecture

- **Stack:** Fastify, PostgreSQL, Redis, RabbitMQ (optional)
- **Routes:** auth, spot, p2p, wallet, trading, kyc, admin, convert, upload, debug
- **Auth:** `authenticate` (user JWT), `authenticateOptional`, `authenticateUser` (JWT or X-API-Key)
- **Plugins:** latencyTrace, authDecision (session-core), authLock (lock service)

### 1.2 Auth Flow

| Component | Status | Notes |
|-----------|--------|-------|
| JWT sign/verify | ✅ | Fastify JWT, 15m access, 7d refresh |
| Session validation | ✅ | Redis `session:${sessionId}` + DB fallback in session.service |
| OTP (send/verify) | ✅ | otp.service, rate limited (send-otp 3/min) |
| Passkeys (WebAuthn) | ✅ | auth.fastify signup + login |
| API key auth | ✅ | X-API-Key / X-MBX-APIKEY, HMAC optional, IP restriction |
| Admin auth | ✅ | Separate admin JWT, admin/auth/login, admin/auth/me |

**Auth routes (auth.fastify.ts):** send-otp, verify-otp, login, login/verify-step, login/resend-otp, login/check-passkeys, signup, refresh, me, logout, password/change, passkey/*

**Note:** `auth.routes.ts` (Express) and `middleware/auth.ts` (Express) exist but are **not** used by the server. Server uses `auth.fastify.ts` exclusively. `auth.service.ts` uses `generateTokens`, `verifyRefreshToken`, `blacklistToken` from `middleware/auth.js` — these are utility functions, not route handlers.

### 1.3 Critical Backend Issues

| # | Issue | Severity | Location | Recommendation |
|---|-------|----------|----------|----------------|
| 1 | **Signup has no rate limit** | P1 | auth.fastify POST /signup | Add `rateLimitByIp` preHandler (e.g. 10/hour) |
| 2 | **Signup breaks when Redis down** | P0 | verify-otp sets Redis flag; signup reads it | Fallback to DB-based verification when Redis unavailable |
| 3 | **Debug route enabled in prod** | P2 | /api/v1/debug/user-balance/:email | Disable or gate behind feature flag / admin role in production |
| 4 | **CSP disabled** | P2 | helmet({ contentSecurityPolicy: false }) | Enable CSP with safe defaults |
| 5 | **Session-core / lock service** | Info | authDecision, authLock | Optional; fallback allows JWT auth when down. Ensure URLs configurable (done: SESSION_CORE_URL, LOCK_SERVICE_URL) |

### 1.4 Backend — What Works

- **Spot:** Order placement, cancel, matching, orderbook cache, WebSocket, candle aggregation
- **P2P:** Ads, order create, escrow, confirm/release/cancel, dispute, expiry job (90s), idempotency
- **Wallet:** balances, deposit address, withdrawal, transfer, KYC status
- **Settlement:** match poller, settlement worker, wallet reconciliation, global balance audit, spot integrity check
- **Rate limits:** Global 100/min; per-route limits for auth, OTP, spot
- **Idempotency:** P2P order create, release, confirm, cancel; withdrawal; transfer

---

## 2. Frontend Audit

### 2.1 Auth Flow

| Step | Status | Notes |
|------|--------|-------|
| Login (OTP / Passkey) | ✅ | auth/send-otp → auth/login or verify-step |
| Signup (OTP + Password) | ✅ | auth/send-otp → auth/verify-otp → auth/signup |
| AuthProvider runMe | ✅ | GET /auth/me on load; 401/403 → logout |
| Refresh on 401 | ✅ | tryRefreshFromStorage; auth/me retry with new token |
| 5xx / network | ✅ | Does **not** logout; keeps existing user (fixed from earlier audit) |
| apiRequest 401 | ✅ | refreshAccessToken → retry; auth:refresh-failed event |
| RequireAuth | ✅ | Waits authResolved; redirects to /login if !isAuthenticated |

### 2.2 Critical Frontend Issues

| # | Issue | Severity | Notes |
|---|-------|----------|-------|
| 1 | **Signup bypasses auth store** | P1 | Uses login() + setAuthenticated; verify both are called (currently done) |
| 2 | **/auth/me timeout 10s** | Low | AbortController timeout; may log out on slow network. Consider increasing or retry |
| 3 | **Dashboard KYC endpoint** | Info | Uses /wallet/kyc-status; backend returns verified, status, level. Matches. |

### 2.3 Frontend — What Works

- **Auth:** Login, signup, refresh, logout, RequireAuth, api.ts with Bearer + refresh retry
- **Dashboard:** Layout, sidebar, balance summary, notifications, KYC banner
- **Spot:** SpotTradingGrid, orderbook, chart (LightweightCharts), order entry, open orders, history
- **P2P:** Ads list, create order, order detail, payment methods, chat
- **Navigation:** menuItems include spot, p2p, orders, assets, account, referral, api, fee-rates, help

### 2.4 Placeholder / Stub Pages

| Page | Status | Notes |
|------|--------|-------|
| /dashboard/copy-trading | Placeholder | Coming soon |
| /dashboard/demo-trading | Placeholder | Coming soon |
| /dashboard/earn | Placeholder | Coming soon |
| /dashboard/events | Placeholder | Coming soon |
| /dashboard/progress | Implemented | Progress tracker |
| /dashboard/data-export | May be stub | Verify implementation |
| /dashboard/assets/funding | Exists | Verify backend |
| /dashboard/assets/unified | Exists | Verify backend |

---

## 3. Spot Trading Flow

### 3.1 Backend ↔ Frontend Connectivity

| API | Frontend | Backend | Status |
|-----|----------|---------|--------|
| Markets | GET /spot/markets | spot.fastify | ✅ |
| Orderbook | GET /spot/orderbook/:symbol | spot.fastify | ✅ |
| Ticker | GET /spot/ticker/:symbol | spot.fastify | ✅ |
| Place order | POST /spot/order | spot.fastify | ✅ |
| Cancel | POST /spot/orders/:id/cancel | spot.fastify | ✅ |
| Open orders | GET /spot/orders?status=OPEN | spot.fastify | ✅ |
| Order history | GET /spot/orders?status=HISTORY | spot.fastify | ✅ |
| Trade history | GET /spot/trade-history | spot.fastify | ✅ |
| Candles | GET /trading/candles/:symbol | trading.fastify | ✅ (needs trading_pairs) |
| Balances | GET /wallet/balances/by-account | wallet.fastify | ✅ |
| WebSocket | /spot/ws?token= | spot-ws.service | ✅ |

### 3.2 Chart Dependency

- **Candles** require: (1) symbol in `trading_pairs` with `trading_enabled = TRUE`, (2) data in `ohlcv_candles`
- **Migration:** `trading_pairs` sync from `spot_markets` done; candle aggregation runs on startup + every 2 min
- **Chart error/loading:** useChartAdapter returns chartError, chartLoading, retryChart; ChartPanel shows error overlay + Retry

### 3.3 Spot — Remaining UX Gaps (from SPOT_PAGE_FULL_AUDIT)

- PairHeader: 24H High/Low/Vol hidden on mobile
- Order entry: trailing stop 0.1–100% validation (done); estimated value in quote asset
- Markets: search/filter in pair selector
- Orderbook: total row (sum bids/asks)
- OCO badge in open orders (backend needs oco_group_id in GET /spot/orders)

---

## 4. P2P Flow

### 4.1 Backend

- **Ads:** GET /p2p/ads (filters: type, currency, fiat), create/update/cancel
- **Orders:** create (idempotency), confirm payment, release, cancel
- **Escrow:** moveToEscrow on create; release on confirm
- **Expiry:** p2pService.handleExpiredOrders every 90s
- **Dispute:** openDispute, resolveDispute (admin)
- **Payment methods:** user CRUD, platform methods

### 4.2 Frontend

- P2P landing, ads list, create order, order detail page, payment methods
- Order chat UI (backend: GET/POST /p2p/orders/:id/messages)

---

## 5. KYC, Deposit, Withdrawal

### 5.1 KYC

| Endpoint | Purpose |
|----------|---------|
| GET /wallet/kyc-status | Dashboard layout, deposit page |
| GET /kyc/status | KYC status |
| GET /user/kyc | Full KYC record |
| POST /kyc/* | Initiate, upload, submit |

**Table:** `kyc_applications` (or `kyc_records` — verify schema). Dashboard uses `data.data.verified` from /wallet/kyc-status.

### 5.2 Deposit

- **Crypto:** GET deposit address, indexer scan, deposit-credit.service
- **P2P:** Buy crypto via P2P ads
- **Convert:** Buy with INR (if implemented)

### 5.3 Withdrawal

- **Crypto:** Withdrawal with whitelist, cooldown, risk evaluation, idempotency
- **Fiat:** /dashboard/withdraw/fiat (verify backend)

---

## 6. Admin Panel

- **Auth:** POST /admin/auth/login, GET /admin/auth/me
- **Layout:** admin/(protected)/layout.tsx — checks token, fetches /admin/auth/me
- **Routes:** Dashboard, KYC, Wallets, Deposits, Withdrawals, P2P, Compliance, Security, Trading, etc.
- **Admin middleware:** getAdminFromRequest; admin JWT type

---

## 7. Security Summary

| Item | Status | Notes |
|------|--------|-------|
| CORS | ✅ | Configurable origins; dev allows localhost |
| Rate limit | ✅ | Global + per-route |
| Helmet | ⚠️ | CSP disabled |
| JWT secret | ✅ | From env, min 32 chars |
| Session validation | ✅ | Redis + DB fallback |
| API key IP restriction | ✅ | Optional |
| HMAC API auth | ✅ | X-TIMESTAMP, X-SIGNATURE |
| Debug route | ⚠️ | Authenticated but exposes balance debug; disable in prod |
| XSS / input validation | ✅ | Schema validation on routes |

---

## 8. Priority Fixes — Status

### P0 (Critical) — ✅ Done

1. **Signup when Redis down:** DB fallback already in place. Signup checks `otp_verifications` when Redis returns null.

### P1 (High) — ✅ Done

2. **Signup rate limit:** Already present: `rateLimitByIp('auth:signup', 10, 3600)`.
3. **Debug route in production:** Fixed — debug routes register only when `config.env !== 'production'`.

### P2 (Medium) — ✅ Done

4. **CSP:** Fixed — Helmet contentSecurityPolicy enabled with safe defaults (default-src 'self', scriptSrc, styleSrc, imgSrc, etc.).
5. **Chart / trading_pairs:** Migration + aggregation in place; verify seed for new symbols.

### P3 (Low)

6. **Placeholder pages:** Already have "Coming Soon" UI (copy-trading, demo-trading, earn, events).
7. **Spot UX:** Search in pair selector, orderbook total row, OCO badge — future enhancements.

---

## 9. Flow Checklist — End-to-End

| Flow | Connected? | Notes |
|------|------------|-------|
| Signup | ✅ | OTP → verify-otp → signup; Redis required |
| Login | ✅ | OTP or passkey |
| Dashboard load | ✅ | /auth/me, balances, KYC status |
| Spot trading | ✅ | Order placement, cancel, WS updates |
| P2P create order | ✅ | Escrow, confirm, release |
| Crypto deposit | ✅ | Address, indexer, credit |
| Crypto withdrawal | ✅ | Whitelist, cooldown, signing queue |
| KYC submit | ✅ | Upload, submit, status |
| Admin login | ✅ | Admin JWT, /admin/auth/me |
| Token refresh | ✅ | 401 → refresh → retry |

---

## 10. Conclusion

**System verdict:** The exchange is **functionally solid** with connected backend, frontend, spot, and P2P flows. Auth, session, and refresh handling are correct. Main gaps are:

1. **Signup resilience** when Redis is down (P0)
2. **Signup rate limit** (P1)
3. **Debug route** in production (P2)
4. **CSP** and minor security hardening (P2)
5. **UX polish** (placeholder pages, spot pair search, etc.)

Addressing P0 and P1 will significantly improve production readiness.
