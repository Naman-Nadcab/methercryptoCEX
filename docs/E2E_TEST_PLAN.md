# End-to-End (E2E) Test Plan — Cryptocurrency Exchange

**Scope:** Spot trading, P2P marketplace, wallet, Rust matching engine, settlement workers, liquidity bot, WebSocket, admin, monitoring.  
**Audience:** QA engineers, automation.  
**References:** FULL_DEEP_ARCHITECTURE_AUDIT.md, FULL_SYSTEM_INTELLIGENCE_AUDIT.md, EXCHANGE_SYSTEM_OVERVIEW_CLIENT_HANDOVER.md.

---

## Prerequisites

- Backend API running (default `http://localhost:4000`)
- PostgreSQL, Redis (and optionally RabbitMQ) running
- Rust matching engine running when testing Phase 4 / `USE_RUST_MATCHING_ENGINE=true`
- Test users and API keys for authenticated flows
- Optional: indexer running for deposit tests; workers enabled for settlement/withdrawal tests

**Env for automated runs:** `E2E_BASE_URL`, `E2E_ENGINE_URL` (default `http://localhost:7101`), `E2E_JWT`, `E2E_API_KEY`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.

---

## PHASE 1 — System Health

| ID   | Test | Expected |
|------|------|----------|
| 1.1  | GET `/health` returns 200 when DB and Redis up | `status: "healthy"`, `services.database: "up"`, `services.redis: "up"` |
| 1.2  | GET `/health` returns 503 when DB or Redis down | `status: "unhealthy"`, appropriate service "down" |
| 1.3  | Response includes `depth.settlement_pending`, `depth.withdrawal_queue` | Numeric values present |
| 1.4  | GET `/metrics` returns Prometheus text | 200, Content-Type text/plain, body contains `settlement_pending_count` or `http_request_duration` |
| 1.5  | GET `/api/v1/observability/slo` returns SLO payload | 200, `status` in [ok, degraded, critical], `slo.settlement_pending`, `slo.order_latency_p99_ms` |
| 1.6  | Rust engine GET `http://localhost:7101/engine/snapshot` (if engine running) | 200, `markets` object |
| 1.7  | Database connectivity (backend health implies DB) | Covered by 1.1 |
| 1.8  | Redis connectivity | Covered by 1.1 |
| 1.9  | RabbitMQ (optional) | Not exposed on health; optional dedicated check |

**Automation:** `e2e/api/phase1-health.test.ts`

---

## PHASE 2 — Authentication

| ID   | Test | Expected |
|------|------|----------|
| 2.1  | POST `/api/v1/auth/send-otp` with email/phone | 200, OTP sent (or rate-limited 429) |
| 2.2  | POST login/verify with valid OTP | 200, JWT and refresh token in body/cookie |
| 2.3  | GET `/api/v1/auth/me` with valid JWT | 200, user profile |
| 2.4  | GET `/api/v1/auth/me` with expired JWT | 401 |
| 2.5  | GET `/api/v1/auth/me` with invalid JWT | 401 |
| 2.6  | Invalid OTP on verify | 400/401, no token |
| 2.7  | API key auth: request with valid X-API-Key to protected route (e.g. GET /spot/open-orders) | 200 |
| 2.8  | API key auth: invalid key | 401 |
| 2.9  | HMAC signed request (if supported) with valid signature | 200 |
| 2.10 | HMAC with invalid signature | 401 |
| 2.11 | 2FA enable flow (TOTP setup, verify, enable) | 200 at each step |
| 2.12 | 2FA disable with valid code | 200 |

**Automation:** `e2e/api/phase2-auth.test.ts` (requires test user and optional API key)

---

## PHASE 3 — Spot Trading E2E

| ID   | Test | Expected |
|------|------|----------|
| 3.1  | GET `/api/v1/spot/markets` | 200, array of markets with symbol, base_asset, quote_asset |
| 3.2  | GET `/api/v1/spot/orderbook/:symbol` (e.g. BTC_USDT) | 200, bids/asks arrays |
| 3.3  | Place limit sell (user A) | 200, order id, status OPEN |
| 3.4  | Place market buy (user B) matching A’s sell | 200, order filled or partial; trades created |
| 3.5  | Verify spot_orders and spot_trades (DB or via GET /spot/order-history, GET /spot/trade-history) | Orders and trades present; filled_quantity/status updated |
| 3.6  | Verify user_balances (trading) after trade | Buyer base increased, quote decreased; seller opposite |
| 3.7  | Cancel open order | 200, order status CANCELLED |
| 3.8  | GET open-orders | 200, list excludes cancelled |
| 3.9  | Orderbook and ticker updates (via WebSocket or REST) | Orderbook/ticker reflect new order/trade |
| 3.10 | Partial fill: place two orders so one fills partially | Filled quantity and PARTIALLY_FILLED status |

**Flow:** User A limit sell → User B market buy → matching engine executes → trade recorded → balances updated → WS updates (Phase 9).  
**Automation:** `e2e/api/phase3-spot.test.ts`

---

## PHASE 4 — Rust Matching Engine

| ID   | Test | Expected |
|------|------|----------|
| 4.1  | POST `/engine/place` with valid Order JSON | 200, `{ "ok": true }` |
| 4.2  | GET `/engine/matches?after_id=0` | 200, `last_id`, `events` array |
| 4.3  | Event shape: event_id, symbol, price, qty, taker_order_id, maker_order_id, taker_user_id, maker_user_id, taker_side, timestamp | All fields present and types correct |
| 4.4  | event_id sequence strictly increasing | No duplicate event_ids; after_id cursor returns only new events |
| 4.5  | POST `/engine/cancel` with order_id | 200, `{ "ok": true }`; order removed from book (snapshot no longer contains it) |
| 4.6  | GET `/engine/snapshot?market=BTC_USDT` | 200, markets.BTC_USDT.bids/asks |
| 4.7  | Backend settlement: after place → poll matches → settlement_events → spot_orders/spot_trades updated | Covered by integration; can verify via DB or API |

**Automation:** `e2e/api/phase4-rust-engine.test.ts`

---

## PHASE 5 — Wallet

| ID   | Test | Expected |
|------|------|----------|
| 5.1  | Deposit: simulate indexer writing to `deposits`; run credit job or trigger credit path | deposit status completed; user_balances (funding) credited |
| 5.2  | GET `/api/v1/wallet/deposits` | 200, list includes deposit records |
| 5.3  | GET `/api/v1/wallet/balances` or `/balances/trading` | 200, balances by currency |
| 5.4  | POST `/api/v1/wallet/withdrawals` (valid request, idempotency key) | 202/200, withdrawal created; enters signing queue when worker runs |
| 5.5  | Withdrawal risk checks (insufficient balance, KYC, whitelist) | 400 with appropriate code |
| 5.6  | GET `/api/v1/wallet/withdrawals` | 200, list includes withdrawal |
| 5.7  | Verify withdrawals table and user_balances (locked then debited after broadcast) | DB or admin API |

**Automation:** `e2e/api/phase5-wallet.test.ts` (withdrawal create/list; deposit may require DB fixture or indexer stub)

---

## PHASE 6 — Internal Transfer

| ID   | Test | Expected |
|------|------|----------|
| 6.1  | Funding → trading transfer | 200, funding balance decreased, trading balance increased |
| 6.2  | User-to-user internal transfer (if supported) | 200, sender debited, receiver credited |
| 6.3  | Verify ledger/balance entries | Ledger or balance history reflects transfer |

**Automation:** `e2e/api/phase6-internal-transfer.test.ts`

---

## PHASE 7 — P2P Trading

| ID   | Test | Expected |
|------|------|----------|
| 7.1  | GET `/api/v1/p2p/ads` | 200, list of ads |
| 7.2  | POST `/api/v1/p2p/ads` (seller creates ad) | 200, ad id |
| 7.3  | POST `/api/v1/p2p/orders` (buyer creates order: adId, quantity, paymentMethodId) | 200, order id; escrow locks seller funds |
| 7.4  | POST `/api/v1/p2p/orders/:id/upload-payment-proof` or confirm-payment | 200 |
| 7.5  | POST `/api/v1/p2p/orders/:id/release` (seller releases) | 200; escrow debited, buyer credited |
| 7.6  | Verify p2p_orders and escrow balances (user_balances) | Status and balances correct |
| 7.7  | POST `/api/v1/p2p/orders/:id/cancel` | 200, order cancelled; escrow refunded |
| 7.8  | POST `/api/v1/p2p/orders/:id/dispute` | 200, dispute opened; admin can resolve |
| 7.9  | GET `/api/v1/p2p/orders/:id/messages`, POST messages | 200, chat flow |

**Automation:** `e2e/api/phase7-p2p.test.ts`

---

## PHASE 8 — Liquidity Bot & Oracle

| ID   | Test | Expected |
|------|------|----------|
| 8.1  | Price oracle: run `runPriceOracleUpdate()` or wait for schedule; check market_prices table or convert endpoint | Prices updated for configured pairs |
| 8.2  | Liquidity bot: with bot enabled and API key, after cycle run GET orderbook or open-orders for bot user | Orders at mid ± spread; depth present |
| 8.3  | Inventory: bot skew when base/quote imbalanced | Mid adjusted per config (optional assertion) |

**Automation:** `e2e/api/phase8-liquidity-bot.test.ts` (conditional on LIQUIDITY_BOT_ENABLED and oracle)

---

## PHASE 9 — WebSocket

| ID   | Test | Expected |
|------|------|----------|
| 9.1  | Connect to `/api/v1/spot/ws` (no auth) | Connection open |
| 9.2  | Subscribe to `orderbook:BTC_USDT` | Message type subscribed; optional orderbook_snapshot |
| 9.3  | Subscribe to `ticker:BTC_USDT`, `trades:BTC_USDT` | Subscribed; ticker/trades data when available |
| 9.4  | Connect with query `token=<JWT>`; subscribe `user.orders` | Subscribed; order_update when user places/cancels order |
| 9.5  | Ping → pong | Pong with timestamp |
| 9.6  | Unsubscribe | Unsubscribed |

**Automation:** `e2e/api/phase9-websocket.test.ts`

---

## PHASE 10 — Load Test

| ID   | Test | Expected |
|------|------|----------|
| 10.1 | k6: 1000 VUs, 5000 req/s (or max sustainable) to GET /health, GET /spot/markets, GET /spot/tickers | p95 latency &lt; threshold (e.g. 2s); error rate &lt; 1% |
| 10.2 | k6: Spot order placement (limit) with pool of API keys; measure order placement latency | p99 order latency recorded; no invariant violations |
| 10.3 | WebSocket: many concurrent connections; subscribe and receive orderbook/ticker updates | No connection drops; message latency acceptable |

**Scripts:** `load/k6-spot-order.js` (existing); `load/k6-health-markets.js`; `load/k6-high-throughput.js` (configurable VUs and RPS).

---

## PHASE 11 — Security

| ID   | Test | Expected |
|------|------|----------|
| 11.1 | Rate limit: exceed spot order limit (e.g. 30/min) | 429 |
| 11.2 | Invalid API signature (HMAC) | 401 |
| 11.3 | Withdrawal to non-whitelisted address (when whitelist enforced) | 400 |
| 11.4 | Order spam: burst of orders from same user | Rate limited or circuit breaker |
| 11.5 | Admin route without admin JWT | 401 |
| 11.6 | Admin route from non-whitelisted IP (when enabled) | 403 |

**Automation:** `e2e/api/phase11-security.test.ts`

---

## PHASE 12 — Failure Scenarios

| ID   | Test | Expected |
|------|------|----------|
| 12.1 | Matching engine stopped: place order (Node path or Rust path); engine down | Node path: order still placed and matched in-process. Rust path: order in DB; match poller backoff; no crash |
| 12.2 | Redis down: health returns unhealthy for Redis; auth/session may fail or fallback to DB | 503 on health; login may still work if DB fallback |
| 12.3 | DB temporarily unavailable: health 503; API requests fail with 500/503 | No partial state; recovery when DB back |
| 12.4 | Worker crash: settlement worker stopped; matches pile in settlement_events; restart worker | Pending events processed after restart; no duplicate balance credit |

**Automation:** `e2e/api/phase12-failure.test.ts` (partial; some tests require controlled failure injection)

---

## Test Execution

- **Full API E2E:** `npm run test:e2e` (runs all phases in `e2e/api/` via Node/tsx). Optional: `npm run test:e2e -- --phase=1,2,3` to run only phases 1–3.
- **Playwright UI E2E:** `npm run e2e` (existing smoke.spec.ts).
- **Load (k6):**  
  - `npm run load` — spot order + markets/tickers (default 5 VUs).  
  - `npm run load:health` — health + markets + tickers (default 50 VUs, 1m).  
  - `npm run load:stress` — high throughput (default 200 VUs, 2m). Set `VUS=1000` and `API_KEY=...` for order load.
- **Load (Artillery):** `artillery run load/artillery-config.yml` (install with `npm install -g artillery`). Targets health + spot markets + tickers.
- **Smoke API:** `npm run smoke:api` (existing script).

**Note:** Start backend (and optionally Redis, DB, Rust engine) before running E2E; many tests will fail with "fetch failed" if the API is not reachable.

---

## Manual QA Checklist

See **MANUAL_QA_CHECKLIST.md** for a printable checklist covering all phases and edge cases.
