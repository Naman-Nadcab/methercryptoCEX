# Manual QA Checklist — Cryptocurrency Exchange

Use this checklist for manual end-to-end verification. Tick each item when done.

---

## Environment

- [ ] Backend running (`npm run dev` or `npm run dev:fb`)
- [ ] PostgreSQL and Redis (and optionally RabbitMQ) running
- [ ] Rust matching engine running if testing Phase C / Rust path
- [ ] At least one test user created; optional: API key and 2FA

---

## Phase 1 — System health

- [ ] Open `/health` in browser or curl; status 200, body shows `database`, `redis` up
- [ ] Open `/metrics`; Prometheus text, contains `settlement_pending` or similar
- [ ] Open `/api/v1/observability/slo`; returns JSON with `status` (ok/degraded/critical)
- [ ] If engine running: `curl http://localhost:7101/engine/snapshot` returns 200

---

## Phase 2 — Authentication

- [ ] Signup: complete flow and verify email/OTP if applicable
- [ ] Login: enter credentials/OTP, receive JWT/session
- [ ] `GET /api/v1/auth/me` with valid token returns user profile
- [ ] `GET /api/v1/auth/me` with invalid/expired token returns 401
- [ ] Create API key from dashboard/settings
- [ ] Call protected endpoint (e.g. GET /api/v1/spot/open-orders) with X-API-Key; 200
- [ ] Call with wrong API key; 401
- [ ] 2FA: enable TOTP, login with code, disable with code

---

## Phase 3 — Spot trading

- [ ] GET /api/v1/spot/markets returns list of markets
- [ ] GET /api/v1/spot/orderbook/BTC_USDT returns bids/asks
- [ ] Place limit sell (high price so it stays open); order appears in open orders
- [ ] Place market buy (or limit buy that crosses); trade executes
- [ ] Verify order history and trade history show new records
- [ ] Cancel an open order; status becomes CANCELLED
- [ ] Verify balances (trading) updated after trade

---

## Phase 4 — Rust matching engine (if used)

- [ ] POST to engine /engine/place with valid order JSON; 200, ok: true
- [ ] GET /engine/matches?after_id=0 returns last_id and events array
- [ ] POST /engine/cancel with order_id; 200
- [ ] GET /engine/snapshot?market=BTC_USDT returns bids/asks

---

## Phase 5 — Wallet

- [ ] GET /api/v1/wallet/deposits (auth) returns list
- [ ] GET /api/v1/wallet/balances or balances/trading returns balances
- [ ] Create withdrawal (valid address, within limits); record created
- [ ] GET /api/v1/wallet/withdrawals shows the withdrawal
- [ ] (If indexer running) Simulate deposit; confirm balance credited after confirmations

---

## Phase 6 — Internal transfer

- [ ] Transfer funding → trading; balances update
- [ ] (If supported) User-to-user transfer; both balances correct

---

## Phase 7 — P2P

- [ ] GET /api/v1/p2p/ads returns ads (optional filters)
- [ ] Create ad (seller); ad appears in list
- [ ] Create order (buyer) on an ad; escrow locks seller balance
- [ ] Upload payment proof / confirm payment
- [ ] Seller releases; buyer receives crypto, order completed
- [ ] Cancel flow: create order, cancel; escrow refunded
- [ ] Dispute flow: open dispute; admin can resolve (admin panel)

---

## Phase 8 — Liquidity bot & oracle (if enabled)

- [ ] Price oracle: market_prices or convert endpoint shows updated prices
- [ ] Liquidity bot: orderbook has bot orders at expected spread

---

## Phase 9 — WebSocket

- [ ] Connect to ws://localhost:4000/api/v1/spot/ws (or your base URL)
- [ ] Send subscribe orderbook:BTC_USDT; receive subscribed + snapshot
- [ ] Send subscribe ticker:BTC_USDT, trades:BTC_USDT; receive data when available
- [ ] With token: subscribe user.orders; place order from another tab; receive order_update
- [ ] Ping → receive pong

---

## Phase 10 — Load (manual spot check)

- [ ] Run `k6 run load/k6-health-markets.js` with VUS=50; no errors
- [ ] Run `k6 run load/k6-spot-order.js` with API_KEY; orders or expected 4xx

---

## Phase 11 — Security

- [ ] Exceed spot order rate limit (e.g. 30/min); receive 429
- [ ] Call admin endpoint without admin JWT; 401
- [ ] (If whitelist on) Call admin from non-whitelisted IP; 403

---

## Phase 12 — Failure (optional, destructive)

- [ ] Stop Redis; /health shows redis down; restart Redis; health recovers
- [ ] Stop matching engine (if Rust); place order still handled (Node path or graceful error); restart engine
- [ ] Stop settlement worker; place orders; restart worker; pending events process

---

## Admin panel

- [ ] Login to admin with admin credentials
- [ ] Dashboard stats load
- [ ] Users list, KYC pending list
- [ ] P2P disputes list; resolve a test dispute
- [ ] Settlement events list (if Rust engine used)
- [ ] Wallets / funds summary

---

## Sign-off

- [ ] All critical paths for current release manually verified
- [ ] Automated E2E run: `npm run test:e2e` — all phases pass or expected skips

**Date:** _______________  
**Tester:** _______________
