# Binance-Grade Exchange — Full System Audit

**Scope:** Backend APIs, Frontend pages/flows, UX/UI, features, buttons, API keys — everything a Binance-grade spot + P2P exchange should have.  
**Date:** February 2026

---

## 1. BACKEND — API & FEATURE AUDIT

### 1.1 Auth (`/api/v1/auth`)

| Item | Status | Notes |
|------|--------|-------|
| POST send-otp | ✅ | Rate limit 3/min per IP |
| POST verify-otp | ✅ | Rate limit 5/min |
| POST signup | ✅ | After verify-otp, password set |
| POST login | ✅ | OTP + optional verify-step (SMS/email/2FA) |
| POST login/verify-step | ✅ | Multi-step verification |
| POST login/resend-otp | ✅ | |
| GET login/check-passkeys | ✅ | Passkey option when available |
| POST logout, logout-all-other | ✅ | |
| GET me | ✅ | Session validation |
| Passkey register/verify, authenticate/verify | ✅ | |
| GET/PATCH profile | ✅ | |
| 2FA setup, enable, verify, disable | ✅ | |
| Fund password: status, set, check-same | ✅ | |
| Anti-phishing code | ✅ | |
| GET/POST withdrawal-addresses, withdrawal-limits | ✅ | |
| GET api-keys, POST api-keys, DELETE api-keys/:id | ✅ | Create/list/revoke; permissions (no_withdraw) enforced on withdraw |
| GET fee-rates, POST fee-rates/mnt-discount | ✅ | VIP-style from system_settings |
| OAuth Google/Apple URL + callbacks | ✅ | auth.oauth.ts |
| GET preferences, POST preferences | ✅ | |
| GET withdrawal-whitelist/status, POST toggle | ✅ | |
| Rate limits (send-otp, verify, signup, login) | ✅ | Per IP / per user |

**Gap:** None critical.

---

### 1.2 Spot (`/api/v1/spot`)

| Item | Status | Notes |
|------|--------|-------|
| GET markets | ✅ | With maker_fee, taker_fee |
| GET tickers | ✅ | All markets, 24h stats |
| GET ticker/:symbol | ✅ | Single market |
| GET orderbook/:symbol | ✅ | L2 depth, Redis cache |
| POST order | ✅ | market, limit, stop_loss, stop_limit, trailing_stop_market; client_order_id idempotency |
| POST order/:id/cancel | ✅ | Rate limited |
| POST orders/cancel-all | ✅ | By market |
| GET open-orders | ✅ | |
| GET order-history | ✅ | Pagination |
| GET trade-history | ✅ | Pagination |
| GET orders | ✅ | Status filter, cursor |
| POST orders/:orderId/cancel | ✅ | Idempotent cancel |
| GET metrics | ✅ | Observability |
| WebSocket /ws | ✅ | orderbook, trades, ticker, user orders |
| Candles | ⚠️ | Under **/api/v1/trading** (GET candles/:symbol), not /spot; chart uses trading/candles |

**Gap:** Candles live under trading prefix; spot and trading are both used. No functional gap.

---

### 1.3 P2P (`/api/v1/p2p`)

| Item | Status | Notes |
|------|--------|-------|
| GET ads | ✅ | Public list with filters |
| POST ads | ✅ | Create ad (auth) |
| GET my-ads | ✅ | |
| POST/DELETE blocked-advertisers | ✅ | |
| GET payment-methods | ✅ | Platform methods |
| GET my-payment-methods, POST, PATCH, DELETE | ✅ | User payment methods |
| GET orders/:orderId | ✅ | Order detail |
| GET orders/:orderId/messages?since= | ✅ | Chat; `since` for polling new messages |
| POST orders/:orderId/messages | ✅ | Send message |
| GET my-orders | ✅ | |
| GET merchant-stats | ✅ | |
| POST orders (create) | ✅ | Idempotency-Key |
| POST orders/:orderId/confirm-payment | ✅ | |
| POST orders/:orderId/release | ✅ | AML on release |
| POST orders/:orderId/cancel | ✅ | |
| POST orders/:orderId/dispute | ✅ | Open dispute |

**Gap:** None.

---

### 1.4 Wallet (`/api/v1/wallet`)

| Item | Status | Notes |
|------|--------|-------|
| GET chains, chains/:chainId/tokens | ✅ | |
| GET tokens, tokens/:symbol/chains | ✅ | |
| GET kyc-status | ✅ | |
| GET deposit-address/:chainId | ✅ | |
| GET addresses | ✅ | Deposit addresses |
| GET balances, balances/spot, by-account, summary, funding, trading | ✅ | |
| GET withdrawal-fee/:symbol/:chainId | ✅ | |
| GET withdraw/preview | ✅ | |
| POST withdrawals | ✅ | type=onchain \| internal; 2FA + fund_password enforced when enabled; Idempotency-Key |
| GET withdrawals | ✅ | List user withdrawals |
| POST withdrawals/:id/cancel | ✅ | |
| POST transfer | ✅ | Funding ↔ trading (same user) |
| GET transfer/history | ✅ | |
| GET deposit-history, deposit/:txHash | ✅ | |
| GET balance-diagnostic | ✅ | Debug |

**Gap:** None on backend. **Frontend** does not send `twoFactorCode` or `fund_password` in withdraw request → see Frontend section.

---

### 1.5 User (`/api/v1/user`)

| Item | Status | Notes |
|------|--------|-------|
| GET profile | ✅ | user.fastify + auth profile (both exist) |
| GET fee-tier | ✅ | Volume tier, 30d volume, next tier min (for UI progress) |
| GET referrals | ✅ | Code, referrals list, recent commissions |
| GET risk-status | ✅ | KYC, limits, cooldowns |
| GET kyc | ✅ | Status |
| GET/PATCH profile (user.fastify) | ✅ | |
| GET sessions, activity, announcements, notifications | ✅ | |
| PATCH notifications/:id/read, POST read-all | ✅ | |

**Gap:** None.

---

### 1.6 KYC (`/api/v1/kyc`)

| Item | Status | Notes |
|------|--------|-------|
| GET status | ✅ | |
| POST upload-document | ✅ | |

**Gap:** None.

---

### 1.7 Convert (`/api/v1/convert`)

| Item | Status | Notes |
|------|--------|-------|
| GET market-prices, currencies, quote | ✅ | |
| POST convert (if any) | ✅ | Implemented in convert.fastify |
| GET orders/active | ✅ | |

**Gap:** None.

---

### 1.8 Admin (`/api/v1/admin`)

| Area | Status | Notes |
|------|--------|-------|
| Auth login, logout, me | ✅ | |
| Dashboard stats | ✅ | |
| Monitoring: counters, mm-risk | ✅ | |
| Settlement: events, ledger-discrepancy, circuit-reset, balance-reconcile | ✅ | |
| Escrows: list, get, freeze, unfreeze | ✅ | |
| Users: list, get, patch status | ✅ | |
| KYC: pending, PATCH :id/review (kyc:review permission) | ✅ | |
| P2P disputes: list, resolve | ✅ | |
| Settings: get, patch | ✅ | |
| Wallets: list, funds/summary, deposits, withdrawals, manual-credit (super_admin) | ✅ | |
| Deposit sweeps: eligibility, run | ✅ | |
| Hot wallets: list, per-chain | ✅ | |
| Trading: halt, list, orders | ✅ | |
| P2P: list, ads, orders | ✅ | |
| Referrals: list, codes, relationships, commissions, campaigns CRUD | ✅ | |
| Fees: tiers, trading, withdrawal, promotions | ✅ | |
| Notifications: announcements, email/sms templates, push broadcast | ✅ | |
| Admins: list, logs | ✅ | |
| Settings: blockchains, currencies, trading-pairs, p2p-assets, features, quote-assets | ✅ | |
| Tokens: list, withdrawal-limits | ✅ | |
| Withdrawals: list, approve, reject | ✅ | getAdminForWithdrawalApproval |
| AML (admin-aml): config, dashboard, alerts, reports | ✅ | |

**Gap:** Admin RBAC enforced on KYC review and withdrawal approve; other routes use getAdminFromRequest (any admin). Optional: extend permission checks to more sensitive routes.

---

### 1.9 Admin Security (`/api/v1/admin`)

| Item | Status | Notes |
|------|--------|-------|
| GET security/dashboard | ✅ | Risk overview |
| Withdrawals pending, get, approve, reject | ✅ | |

**Gap:** None.

---

### 1.10 Trading (legacy/alternate) (`/api/v1/trading`)

| Item | Status | Notes |
|------|--------|-------|
| GET pairs, balances, wallets, orders, history, currencies | ✅ | |
| GET candles/:symbol | ✅ | Used by frontend chart |

**Gap:** None.

---

## 2. FRONTEND — PAGES & FLOWS

### 2.1 Auth

| Page / Flow | Status | Notes |
|-------------|--------|-------|
| Login | ✅ | Identifier → OTP → optional verify-step (SMS/email/2FA); passkey option |
| Signup | ✅ | Identifier → OTP → password |
| Forgot password | ✅ | |
| Terms, Privacy, Cookies | ✅ | |
| OAuth callback (Google, Apple) | ✅ | |

**Gap:** None.

---

### 2.2 Dashboard (User)

| Page | Status | Notes |
|------|--------|-------|
| /dashboard | ✅ | Overview |
| /dashboard/spot | ✅ | Spot trading (grid: chart, orderbook, order entry) |
| /dashboard/trade/spot | ✅ | Alternate spot trade page (form) |
| /dashboard/p2p | ✅ | P2P landing |
| /dashboard/p2p/[type]/[crypto]/[fiat], create | ✅ | Buy/sell flow, create order |
| /dashboard/p2p/orders/[orderId] | ✅ | Order detail + chat |
| /dashboard/p2p/payment-methods | ✅ | |
| /dashboard/orders | ✅ | Orders hub |
| /dashboard/orders/spot, orders/p2p | ✅ | |
| /dashboard/assets/overview, funding, convert, history, pnl, [symbol] | ✅ | |
| /dashboard/deposit/crypto | ✅ | |
| /dashboard/withdraw/crypto | ✅ | On-chain + internal (internal_user_identifier); **missing 2FA and fund password inputs** |
| /dashboard/transfer | ✅ | Funding ↔ trading (same user) |
| /dashboard/identity, identity/upload, identity/success | ✅ | KYC |
| /dashboard/security | ✅ | 2FA, passkeys, sessions |
| /dashboard/security/change-password, passkeys, withdrawal-limits | ✅ | |
| /dashboard/account | ✅ | Account info |
| /dashboard/api, api/create | ✅ | API keys create/list (key shown once) |
| /dashboard/fee-rates | ✅ | VIP + volume tier (GET /user/fee-tier) |
| /dashboard/referral | ✅ | |
| /dashboard/markets | ✅ | Market list |
| /dashboard/announcements, help, preferences | ✅ | |
| /dashboard/data-export | ✅ | |
| /dashboard/progress, copy-trading, demo-trading, earn, events | ✅ | Pages exist (some may be placeholder) |

**Gap:** Withdraw crypto page does **not** collect or send `twoFactorCode` or `fund_password`. When user has 2FA or fund password enabled, backend returns 400 (2FA_REQUIRED / FUND_PASSWORD_REQUIRED) and the user cannot complete withdrawal from UI. **Fix:** Add optional 2FA code and fund password fields (or modal) on withdraw form and include in POST body.

---

### 2.3 Spot Trading — Components & UX

| Item | Status | Notes |
|------|--------|-------|
| Order types (Limit, Market, Stop, Stop Limit) | ✅ | SpotOrderEntryPanel + SpotTradingGrid |
| Trailing Stop (trailing_stop_market) | ⚠️ | **Backend supports; frontend order form does not expose** (no tab/button) |
| Price, quantity, trigger price, time-in-force | ✅ | |
| Buy/Sell toggle | ✅ | aria-label, aria-pressed |
| Place order button | ✅ | aria-label, aria-busy |
| Orderbook | ✅ | |
| Chart | ✅ | LightweightChartsAdapter; data from /trading/candles + spot/trade-history |
| Open orders list, cancel | ✅ | |
| Trade history | ✅ | |
| client_order_id | ✅ | Sent from SpotTradingGrid |
| Empty / loading states | ✅ | "No spot markets", "Loading markets…", "No trades yet" |

**Gap:** Trailing stop order type not available in UI (backend supports it).

---

### 2.4 P2P — Flows & UX

| Item | Status | Notes |
|------|--------|-------|
| Browse ads (buy/sell) | ✅ | |
| Create order from ad | ✅ | |
| Order detail: status, actions (Confirm payment, Release, Cancel), chat | ✅ | |
| Chat: list messages, send, optional poll with `since` | ✅ | Backend supports since=; frontend can use for polling |
| Payment methods (user) | ✅ | |
| My orders list | ✅ | |
| Empty state (no messages) | ✅ | |

**Gap:** None critical.

---

### 2.5 Admin — Sidebar vs Pages

| Sidebar Link | Route | Page Exists |
|--------------|-------|-------------|
| Dashboard | /admin/dashboard | ✅ |
| User List | /admin/users | ✅ |
| User Detail | /admin/users/detail | ✅ |
| User Risk Profile | /admin/users/risk | ✅ |
| Pending Verifications | /admin/kyc/pending | ✅ |
| Approved/Rejected | /admin/kyc/approved, rejected | ✅ |
| KYC Audit, Settings | /admin/kyc/audit, settings | ✅ |
| Deposits | /admin/wallets/deposits | ✅ (wallets/deposits) |
| Withdrawals | /admin/wallets/withdrawals | ✅ |
| Manual Adjustments | /admin/wallets/adjust | ✅ |
| Balance Summary, Hot, Reconciliation, Ledger | ✅ | |
| Spot: markets, orders, trade-history, MM risk, circuit breakers, fees, market control | ✅ | |
| P2P: overview, trades, orders, escrows, disputes, merchants, payment methods, settings | ✅ | |
| Compliance: alerts, alert detail, reports, cases, compliance dashboard | ✅ | |
| Security: audit-logs, sessions, ip-rules, withdrawals, risk-rules, dashboard | ✅ | |
| System: settings, api-settings, features, blockchain, counters | ✅ | |
| Finance: fees/trading, reports/financial, referrals/campaigns | ✅ | |
| Support: support, reports, notifications | ✅ | support/page.tsx, reports, notifications |
| Admins: roles, list | ✅ | |

**Gap:** All sidebar links have corresponding pages. Some admin pages may be thin (e.g. support tickets list without backend).

---

## 3. UX/UI — BUTTONS, FORMS, STATES

| Item | Status | Notes |
|------|--------|-------|
| Loading states | ✅ | Spinners, "Loading…" on key pages |
| Error handling | ✅ | Toasts, setError on forms |
| Empty states | ✅ | EmptyState component; "No orders yet", "No markets", etc. |
| Form validation | ✅ | Client-side on login, signup, withdraw (amount, address) |
| Buttons: disabled when submitting | ✅ | Place order, withdraw submit |
| Spot: aria-label on Buy/Sell, inputs, Place order | ✅ | |
| Fee tier card (volume tier) | ✅ | aria-label on card |
| Responsive layout | ⚠️ | Present; not fully tuned for small screens (docs/A11Y_MOBILE.md) |
| Keyboard / focus | ⚠️ | No full a11y audit; focus-visible could be improved |

**Gap:** Withdraw form missing 2FA/fund password fields. Trailing stop not in UI. Minor: more consistent focus and touch targets on mobile.

---

## 4. BINANCE-GRADE CHECKLIST — SUMMARY

### Must-have (production)

| # | Item | Status |
|---|------|--------|
| 1 | Login / signup / OTP / 2FA / passkey | ✅ |
| 2 | Spot: limit, market, stop, cancel, orderbook, chart | ✅ |
| 3 | Spot: client_order_id idempotency | ✅ |
| 4 | P2P: ads, create order, confirm, release, cancel, chat | ✅ |
| 5 | Wallet: deposit, withdraw (on-chain + internal), transfer | ✅ |
| 6 | Withdraw: 2FA and fund password when enabled | ✅ (frontend: confirm step inputs + body) |
| 7 | API keys: create, list, revoke; no_withdraw scope | ✅ |
| 8 | KYC: upload, admin review | ✅ |
| 9 | Admin: users, KYC, withdrawals, P2P, spot, AML, settings | ✅ |
| 10 | AML: record on deposit, withdraw, transfer, spot, P2P | ✅ |
| 11 | Rate limits, idempotency (withdraw, P2P), CORS | ✅ |

### Should-have (Binance-like)

| # | Item | Status |
|---|------|--------|
| 12 | Fee tier display (volume + next tier progress) | ✅ |
| 13 | P2P chat polling (since=) | ✅ |
| 14 | Trailing stop order type | ✅ (Trailing Stop + callback rate % in spot UI) |
| 15 | Admin RBAC (permission matrix, KYC/withdraw enforced) | ✅ |
| 16 | Empty / loading / error states | ✅ |
| 17 | Withdrawal whitelist, address book | ✅ |

### Nice-to-have

| # | Item | Status |
|---|------|--------|
| 18 | Support tickets (full flow) | Doc only (SUPPORT_TICKETS.md) |
| 19 | Referral payout automation | Doc only (REFERRAL_PAYOUTS.md) |
| 20 | Full a11y + mobile polish | Partial (A11Y_MOBILE.md) |

---

## 5. REMAINING GAPS (PRIORITIZED)

### P0 — Critical (before production)

1. **Withdraw UI: 2FA and fund password** — **DONE**
   - **Where:** `apps/frontend/src/app/dashboard/withdraw/crypto/page.tsx`
   - **Fix applied:** Added optional "2FA code" and "Fund password" inputs in the confirmation step; both are sent in POST body. Error handling for 2FA_REQUIRED, FUND_PASSWORD_REQUIRED, INVALID_2FA, INVALID_FUND_PASSWORD. Focus-visible rings on Back/Confirm buttons.

### P1 — High

2. **Trailing stop order in spot UI** — **DONE**
   - **Where:** SpotOrderEntryPanel + SpotTradingGrid.
   - **Fix applied:** Added "Trailing Stop" order type and "Callback rate %" (trailing_delta) input; sent in POST /spot/order body. canSubmit includes trailing_stop_market when 0 < trailingDelta ≤ 100.

3. **Admin permission on more routes (optional)** — **DONE**
   - **Where:** admin.fastify.ts.
   - **Fix applied:** POST /deposits/manual-credit now uses getAdminWithPermission(..., 'deposits:credit'). PATCH /p2p/disputes/:id/resolve uses getAdminWithPermission(..., 'p2p:disputes').

### P2 — Medium

4. **P2P chat: use `since` for polling** — **DONE**
   - **Where:** Frontend P2P order detail chat + p2pApi.
   - **Fix applied:** fetchP2POrderMessages(orderId, since?) accepts optional ISO timestamp; backend GET supports ?since=. Order detail page polls every 5s with since=lastMessage.createdAt and merges new messages into query cache.

5. **Mobile / a11y pass** — **DONE (targeted)**
   - **Where:** Spot order submit button, withdraw confirm step buttons.
   - **Fix applied:** focus-visible:ring-2 on Spot OrderEntryPanel Buy/Sell submit button and withdraw Back/Confirm buttons. 2FA and fund password inputs have aria-label.

### P3 — Nice-to-have

6. **Support tickets:** Implement backend + admin UI per docs/SUPPORT_TICKETS.md.  
7. **Referral payout job:** Implement cron or job to credit referrers from pending commissions per docs/REFERRAL_PAYOUTS.md.

---

## 6. QUICK REFERENCE — API ROUTES

| Prefix | Purpose |
|--------|---------|
| /api/v1/auth | Login, signup, OTP, 2FA, passkey, profile, API keys, fee-rates, preferences, withdrawal addresses |
| /api/v1/spot | Markets, tickers, orderbook, order, cancel, orders, trade-history, WebSocket |
| /api/v1/trading | Pairs, balances, orders, history, **candles** (used by chart) |
| /api/v1/p2p | Ads, my-ads, orders, messages (with since), payment methods, block list |
| /api/v1/wallet | Chains, tokens, balances, deposit address, withdrawals, transfer, deposit history |
| /api/v1/user | Profile, fee-tier, referrals, risk-status, sessions, notifications |
| /api/v1/kyc | Status, upload-document |
| /api/v1/convert | Market-prices, quote, orders/active |
| /api/v1/admin | Full admin CRUD (dashboard, users, KYC, wallets, spot, P2P, referrals, fees, settings, AML, security) |

---

**End of audit.** P0, P1, and P2 items above have been implemented. P3 (support tickets, referral payout automation) remain doc-only / optional.
