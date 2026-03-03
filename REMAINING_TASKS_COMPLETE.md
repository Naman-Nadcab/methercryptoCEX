# Exchange — Complete Remaining Tasks

**Based on:** Deep audit (User Management, Spot, P2P, Wallet, KYC, Admin, Security, Infrastructure, API, Frontend)  
**Generated:** February 2025  
**Updated:** Session 2 — completed items marked ✅

---

## P0 — Critical (Fix Before Go-Live)

| # | Area | Task | Location / Notes |
|---|------|------|------------------|
| 1 | **Auth** | Add rate limits to verify-otp, login, passkey routes | ✅ Already in place (`auth.fastify.ts`) |
| 2 | **Auth** | Remove TOTP weak fallback (`default-encryption-key`) | ✅ Done — `totp-verify.ts`, `auth.fastify.ts` |
| 3 | **P2P** | Add Idempotency-Key for P2P order creation | ✅ Already in place (`p2p.fastify.ts`) |
| 4 | **KYC** | Replace DigiLocker auto-approve with real integration or remove | `kyc.ts` — not production-safe |
| 5 | **KYC** | Implement real KYC document upload and storage | `kyc.ts` — upload route is stub |
| 6 | **Config** | Make SESSION_CORE_URL and LOCK_SERVICE_URL configurable | ✅ Done — env vars with fallbacks |
| 7 | **Audit** | Ensure manual credit writes to immutable audit | ✅ Already uses `logAuditFromRequest` |
| 8 | **Audit** | Audit trail for user suspend/freeze/activate (store reason) | ✅ Already uses `logAuditFromRequest` (admin_user_status_change) |
| 9 | **Audit** | Audit trail for KYC approve/reject | ✅ Done — added `logAuditFromRequest` to PATCH /kyc/:id/review |
| 10 | **Audit** | Audit trail for P2P escrow freeze/unfreeze | ✅ Already in `operator-controls.service.ts` (logAudit) |

---

## P1 — High Priority

| # | Area | Task | Location / Notes |
|---|------|------|------------------|
| 11 | **Wallet** | Invalidate balance cache after withdraw, transfer, convert | ✅ Done — `invalidateBalanceCache()` helper; used in withdraw, transfer, convert, TransferModal, SpotTradingGrid |
| 12 | **Indexer** | Fix schema mismatch (user_wallets/blockchains vs wallets/chains) | `ChainIndexer.ts` vs backend migrations |
| 13 | **Dashboard** | Replace mock market data with live spot API | ✅ Done — GET /spot/tickers, dashboard uses live data |
| 14 | **API** | Handle empty response bodies in api.ts | ✅ Done — empty 2xx returns `{ success: true }` |
| 15 | **Session** | Pass real client IP instead of 127.0.0.1 | ✅ Done — auth.service.signup, auth.routes |
| 16 | **P2P** | Fix payment method validation (user_p2p_payment_methods) | ✅ Already done — `p2p.service.ts` validates against `user_p2p_payment_methods` |
| 17 | **P2P** | Validate limit/offset on GET /ads | ✅ Already done — `p2p.fastify.ts` has safe parseInt, Number.isFinite, Math.min/max |
| 18 | **Security** | Add IP-based rate limit for OTP (in addition to identifier) | ✅ Done — auth.fastify send-otp has rateLimitByIp 3/min; otp.service has identifier-based checkRateLimit |
| 19 | **Security** | Verify withdrawal route has rateLimitByUser applied | ✅ Done — `wallet.fastify.ts` POST /withdrawals has rateLimitByUser 5/hour |

---

## P2 — Medium Priority

| # | Area | Task | Location / Notes |
|---|------|------|------------------|
| 20 | **API** | Standardize getApiBaseUrl() usage across all frontend API calls | ✅ Done — lib, components, dashboard, admin pages now use getApiBaseUrl() from @/lib/getApiUrl |
| 21 | **Admin** | Fix admin sidebar dead links (Earn, Copy Trading, Demo Trading) | ✅ Done — earn, copy-trading, demo-trading pages exist |
| 22 | **Admin** | Validate all admin routes use getAdminFromRequest + rate limit | Admin plugins |
| 23 | **Admin** | Add permission checks for sensitive ops (manual credit, withdrawal approval) | `getAdminForWithdrawalApproval` pattern |
| 24 | **Spot** | Add optional depth parameter for orderbook API | ✅ Done — spot.fastify.ts GET /orderbook/:symbol accepts limit/depth |
| 25 | **Spot** | Document trading halt behavior and admin controls | README / admin docs |
| 26 | **Infra** | Add Postgres and Indexer to docker-compose | Root `docker-compose.yml` |
| 27 | **Infra** | Document settlement worker deployment | `docs/` |
| 28 | **Security** | Enable minimal CSP and test | `server.ts` Helmet config |
| 29 | **KYC** | Unify kyc_applications vs kyc_records usage | Migrations + code |

---

## UI Tasks — User Panel

| # | Page / Component | Task | Notes |
|---|------------------|------|-------|
| 30 | **Spot Trading** | Wire Spot page to live data | ✅ Done — spot page now uses SpotTradingGrid (live orderbook, ticker, trades) |
| 31 | **Spot Chart** | Ensure candle data from API | `/api/v1/trading/candles` — verify ohlcv_candles populated |
| 32 | **Assets — PnL** | Replace mock chart or add backend API | `assets/pnl/page.tsx` — `generateMockChartData()` |
| 33 | **Assets — Overview** | Wire overview chart to API | `assets/overview/page.tsx` — placeholder chart data |
| 34 | **Convert** | Add price chart | ✅ Done — live rate display (1 X = Y Z) + 24h change from marketPrices |
| 35 | **Dashboard home** | Wire tickers/metrics to live API | ✅ Done — markets table uses GET /spot/tickers |
| 36 | **2FA Setup** | Implement 2FA enable/disable UI | ✅ Already implemented — Security page has Google 2FA setup/enable/disable; API: /auth/2fa/setup, enable, disable |
| 37 | **Password Reset** | Verify forgot-password flow wired to backend | ✅ Done — auth.fastify POST /password/reset/request, POST /password/reset; frontend /forgot-password page; login has "Forgot password?" link |
| 38 | **Balance refresh** | Invalidate balances after withdraw/transfer/convert | ✅ Done — invalidateBalanceCache() on all mutation flows |
| 39 | **Transfer** | Verify double-submit guard (if submitting return) | ✅ Done — TransferModal handleTransfer has `if (submitting) return` |

---

## UI Tasks — Admin Panel

| # | Page / Component | Task | Notes |
|---|------------------|------|-------|
| 40 | **Admin sidebar** | Fix 404 links | Validate all sidebar links resolve |
| 41 | **Reports** | Verify backend endpoints for financial/users/trading reports | Admin reports pages |
| 42 | **Support / Tickets** | Implement or remove | If tickets API missing, add or hide |
| 43 | **KYC Settings** | Wire toggles to backend GET/PATCH | Admin KYC settings |
| 44 | **Feature flags** | Ensure toggles map to backend | Admin features page |
| 45 | **Dashboard announcements** | Add loading and error UI | Dashboard page |
| 46 | **P2P Ads** | Invalidate query after order create | P2P create order flow |

---

## UI Tasks — P2P

| # | Task | Notes |
|---|------|------|
| 47 | **P2P Chat** | Implement chat API and UI | `p2p_chat_messages` table exists; no API/UI |

---

## UI Tasks — Spot

| # | Task | Notes |
|---|------|------|
| 48 | **Markets page** | Wire to live spot markets API | `/dashboard/markets` |
| 49 | **Order history / Open orders** | Wire bottom panel to real APIs | SpotTradingDesign bottom panel |

---

## P3 — Lower Priority

| # | Area | Task |
|---|------|------|
| 50 | **Compliance** | FIU-IND registration flow, RBI controls, PMLA docs |
| 51 | **Monitoring** | Settlement worker, deposit credit, withdrawal signing alerts |
| 52 | **OTP** | Monitor SMTP/SMS delivery timeouts |
| 53 | **404** | Consistent not-found handling across app |
| 54 | **VPN/TOR** | Integrate real provider (vpn-tor.service.ts is stub) |
| 55 | **API versioning** | Deprecation policy for v1 |
| 56 | **WebSocket** | Document reconnection behavior for clients |

---

## Summary Counts

| Priority | Count |
|----------|-------|
| P0 Critical | 10 |
| P1 High | 9 |
| P2 Medium | 10 |
| UI — User Panel | 10 |
| UI — Admin Panel | 7 |
| UI — P2P | 1 |
| UI — Spot | 2 |
| P3 Lower | 7 |
| **Total** | **56** |

---

## Quick Wins

1. Add rate limits to auth routes (P0 #1)
2. Invalidate balance cache after mutations (P1 #11)
3. Wire dashboard markets to live API (P1 #13)
4. Standardize getApiBaseUrl() usage (P2 #20)
5. Wire SpotTradingDesign to real data (UI #30)
