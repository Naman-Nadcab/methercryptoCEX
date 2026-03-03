# Full System Audit Report — Production Cryptocurrency Exchange

**Scope:** Spot Trading + P2P Trading  
**Audit type:** Code-level verification (no assumptions)  
**Date:** February 2026

---

## PART 1 — SPOT TRADING AUDIT

### Matching engine & order flow

| Item | Status | Details |
|------|--------|---------|
| **Two spot order paths** | ⚠️ Risky | **Path A:** `POST /api/v1/spot/order` (single order) — runs `runMatching()` in same transaction; price-time priority via DB `ORDER BY price ASC/DESC, created_at ASC`. **Path B:** `POST /api/v1/spot/orders` — lock + insert only, **no matching** (comment: "No matching"). |
| **Frontend uses Path B** | 🚨 **Dangerous** | `SpotTradingGrid.tsx`, `dashboard/trade/spot/page.tsx`, `useSpotBottomPanel` all call **`POST /api/v1/spot/orders`**. Limit orders placed from the UI are **never matched**; they only sit on the book. |
| **In-memory matching engine** | ❌ Not in use | `matching-engine.service.ts` (matchingEngine) with `orders`/`trades` tables is used only by **Express** app (`index.ts`). Default `npm run dev` runs **Fastify** (`server.ts`). So the in-memory engine is **not** in the live path. |
| **Price-time priority (FIFO)** | ✅ | In `spot.fastify.ts` `runMatching()`: opposite side selected with `ORDER BY price ASC, created_at ASC` (buy) or `ORDER BY price DESC, created_at ASC` (sell). |
| **Partial fills** | ✅ | `runMatching` updates `filled_quantity` on both sides; order status remains OPEN/PARTIALLY_FILLED until fully filled. |
| **Market order logic** | ✅ | Only on `POST /spot/order`: best ask used, slippage buffer 1%, `NO_LIQUIDITY` if no fill. |
| **Balance update atomicity** | ✅ | `lockTradingBalance` → insert order → `runMatching` (debit/credit in same tx) in one `db.transaction()`. |
| **Slippage** | ✅ | `MARKET_ORDER_SLIPPAGE_BUFFER = 0.01` for buy market orders; lock uses `bestAsk * (1 + 0.01)`. |
| **Tick/step validation** | ✅ | `spot-decimal.js` and market `price_precision`/`qty_precision`; `toDecimalPlaces(..., ROUND_DOWN)`. |

### APIs

| API | Status | File |
|-----|--------|------|
| Place order | ✅ (path `/spot/order`) / ⚠️ (path `/spot/orders` no match) | `spot.fastify.ts` |
| Cancel order | ✅ | `POST /spot/orders/:orderId/cancel` |
| Open orders | ✅ | `GET /spot/orders?status=OPEN` |
| Order history | ✅ | `GET /spot/orders?status=HISTORY` |
| Trades history | ✅ | `GET /spot/trade-history` |
| Orderbook snapshot | ✅ | `GET /spot/orderbook/:symbol` (Redis cache then DB) |
| Candles | ✅ | `GET /trading/candles/:symbol?interval=` (reads `ohlcv_candles`) |
| WebSocket | ✅ | `spot-ws.service.ts`; `orderbook:${symbol}`, `trades:${symbol}`, `ticker:${symbol}`, `user.orders`, `user.trades` |

### Candle engine

| Item | Status | Details |
|------|--------|---------|
| **OHLCV from trades** | ❌ **Missing** | No code found that **inserts** into `ohlcv_candles` from `spot_trades`. Table is only **read** in `trading.fastify.ts`. |
| **Fake/random candles** | ❌ | None; chart is empty if table not populated by another process. |
| **Live candle updates** | ❌ | No stream or job that appends new candles from trades. |

### Detected problems

- **Orders matched via DB:** Yes; matching uses `spot_orders` + `runMatching()` in same transaction. Correct.
- **Missing atomic transactions:** No; place (path A) and cancel use transactions.
- **Incorrect fill logic:** Path B does not run matching — **limit orders via `/spot/orders` never fill**.
- **Price inconsistencies:** No; match uses maker's price.

---

## PART 2 — P2P TRADING AUDIT

### Implemented & safety

| Item | Status | Details |
|------|--------|---------|
| **Advertisement system** | ✅ | Create/update/cancel ad; balance check for sell ads; no lock at ad creation (PHASE-11). |
| **Escrow locking** | ✅ | `p2p-escrow.service.ts`: `moveToEscrow` in createOrder tx; `FOR UPDATE` on balance row. |
| **Double-release protection** | ✅ | `releaseFromEscrow`: status check `!== 'locked'` returns `alreadyReleased`; UPDATE `WHERE status = 'locked'`; idempotent. |
| **Refund idempotency** | ✅ | `refundFromEscrow` same pattern; `alreadyRefunded` if not locked. |
| **Order lifecycle** | ✅ | Create → escrow locked; confirmPayment → payment_pending; release/refund/cancel/expire. |
| **Payment time limits** | ✅ | Ad has `payment_time_limit`; order has `expires_at`; expiry job refunds. |
| **Cancellation rules** | ✅ | Cancel order in p2p.service with proper state checks; refund if escrow locked. |
| **Dispute system** | ✅ | `openDispute`, admin `resolveDispute` (favor_buyer|favor_seller|cancelled). |
| **Admin freeze** | ✅ | `admin_frozen_at` on escrow; release/refund throw `ESCROW_ADMIN_FROZEN`. |

### States

- OPEN / ESCROW_LOCKED / PAYMENT_PENDING / PAYMENT_SENT / COMPLETED / CANCELLED / EXPIRED / DISPUTED — used in service and routes.

### Expiry job

| Item | Status | Details |
|------|--------|---------|
| **processExpiredP2POrders** | ✅ | `p2p-expiry.service.ts`: selects `payment_pending` and `expires_at < NOW()`; refunds escrow; marks expired; restores ad `available_amount`. |
| **Scheduled invocation** | ❌ **Missing** | No `setInterval`, cron, or worker found that calls `handleExpiredOrders()` or `processExpiredP2POrders()`. Expiry runs only if something explicitly calls it (e.g. admin or future job). |

### APIs

- Ads list/filters, create order, cancel, confirm-payment, release, dispute, payment methods CRUD — present in `p2p.fastify.ts` and `p2p.service.ts`. Chat system: no backend chat API; FAQ text references "order details page" (no chat).

---

## PART 3 — WALLET & BALANCE SAFETY

| Item | Status | Details |
|------|--------|---------|
| **Internal ledger** | ✅ | `balance-ledger.ts`; `insertBalanceLedger` for spot/P2P/escrow. |
| **Cache invalidation** | ✅ | Frontend invalidates `['balances']` after transfer, withdraw, convert, spot orders, P2P orders. |
| **Double-spend** | ✅ | Spot: lock in tx then match; P2P: escrow FOR UPDATE; release/refund with status guard. |
| **Withdrawal protections** | ✅ | Approval flow, admin freeze, risk checks. |
| **Idempotency** | ✅ | P2P create order uses Idempotency-Key; spot `/spot/orders` uses `client_order_id` for idempotent insert. |
| **Precision** | ✅ | Decimal.js, ROUND_DOWN, config monetary precision. |

---

## PART 4 — REAL-TIME & DATA CONSISTENCY

| Item | Status | Details |
|------|--------|---------|
| **WebSocket event flows** | ✅ | `spot-ws.service.ts`: broadcast orderbook/trades/ticker; sendToUser for user.orders/user.trades. |
| **Orderbook streaming** | ✅ | After order/cancel, `invalidateOrderbookCache` + `refreshOrderbookCache` + broadcast. |
| **Trade streaming** | ✅ | `pushSpotUpdates` broadcasts recent trades. |
| **Candle streaming** | ❌ | No candle push; chart relies on REST candles only. |
| **Stale data risk** | ⚠️ | If frontend uses only REST for orderbook without WS, data can be stale. Spot UI uses `useSpotWs` for orderbook. |

---

## PART 5 — FRONTEND AUDIT

| Item | Status | Details |
|------|--------|---------|
| **Spot place order endpoint** | 🚨 | Uses `POST /api/v1/spot/orders` → **no matching**; limit orders never fill. |
| **Mock data** | ✅ | Dashboard tickers from `GET /api/v1/spot/tickers`; announcements from API; KYC conditional. |
| **Hardcoded prices** | ✅ | None for spot; prices from orderbook/tickers. |
| **Chart data** | ⚠️ | Real API `/api/v1/trading/candles/:symbol`; empty if `ohlcv_candles` not populated. |
| **UI actions backed by API** | ✅ | Place/cancel spot, P2P create/cancel/confirm/release, transfer, withdraw. |
| **Error handling** | ✅ | Order failure, NO_LIQUIDITY, INSUFFICIENT_BALANCE mapped to user messages. |
| **Loading states** | ✅ | Buttons disabled during submit; loading flags on forms. |

---

## PART 6 — SECURITY & ABUSE RISKS

| Item | Status | Details |
|------|--------|---------|
| **Rate limit send-otp** | ✅ | `rateLimitByIp('auth:send-otp', 3, 60)` in `auth.fastify.ts`; Redis-backed in `rate-limit-fastify.ts`. |
| **Rate limit verify-otp** | ✅ | `rateLimitByIp('auth:verify-otp', 5, 60)`. |
| **Rate limit spot order** | ✅ | `rateLimitByUser('spot:order', 30, 60)` on `POST /spot/order`. **POST /spot/orders has no rate limit** (only `app.authenticate`). |
| **Idempotency** | ✅ | P2P orders Idempotency-Key; spot orders `client_order_id`. |
| **Replay** | ✅ | Session + JWT; Redis session validation. |
| **Redis fail-open** | ⚠️ | Rate limit and OTP rate check fail open on Redis error (allow request). |

---

## SIGNUP / SEND-OTP 500

| Cause | Likelihood | Fix |
|-------|------------|-----|
| **OTP send failure** | High | When SMTP/SMS not configured and `NODE_ENV=production`, `sendEmailOTP`/`sendSMSOTP` return `false` → handler returns 500 `OTP_SEND_FAILED`. In dev, no transporter returns `true` (log only). |
| **createOTP throw** | Medium | DB error (e.g. missing `otp_verifications` table or wrong schema) or Redis down (createOTP still uses DB; Redis is optional). |
| **Proxy** | Low | Frontend calls `getApiBaseUrl()`; if `''`, request goes to same-origin; Next.js rewrites `/api/v1/*` to backend. So 500 is from backend. |

**Recommendation:** Ensure SMTP or SMS is configured for production, or in send-otp handler when `sendEmailOTP`/`sendSMSOTP` return false, still return 200 with a message that OTP was sent (and log OTP in dev/staging) so signup flow does not break. Alternatively return 503 with a clear "OTP delivery temporarily unavailable" message instead of 500.

---

## SUMMARY

### ✅ Correctly implemented

- Spot **path A** (`/spot/order`): matching, FIFO, partial fills, atomic balance, slippage, WebSocket updates.
- P2P: escrow, double-release protection, refund idempotency, dispute, admin freeze.
- Wallet: ledger, balance invalidation, idempotency on key flows, precision.
- Real-time: orderbook/trades/ticker WS; push after order/cancel.
- Auth rate limits (send-otp, verify-otp); spot order rate limit on `/spot/order`.
- Frontend: no mock spot prices; APIs wired; error/loading handling.

### ⚠️ Partially implemented / risky

- **Two spot order endpoints:** UI uses the one that does **not** run matching.
- **Candles:** No aggregation from trades; chart empty unless `ohlcv_candles` populated elsewhere.
- **P2P expiry:** Logic correct but **not scheduled**; expired orders may never auto-refund.
- **POST /spot/orders** has no rate limit (only auth).
- Rate limit / OTP fail open on Redis.

### ❌ Missing critical components

- **Candle aggregation job** from `spot_trades` → `ohlcv_candles`.
- **Scheduler/cron** for `processExpiredP2POrders()`.
- **Single canonical spot order endpoint** that both places and matches (or frontend must use `/spot/order` for limit/market).

### 🚨 Dangerous bugs / exchange risks

1. **Limit orders placed via UI never match** — frontend uses `POST /api/v1/spot/orders` (no matching). Users can place limit orders but they will not fill.
2. **Send-OTP 500 in production** when email/SMS not configured or delivery fails — breaks signup.

### 🎯 Exact fix recommendations

1. **Spot orders (critical)**  
   - **Option A:** Change frontend to use `POST /api/v1/spot/order` (single) for both limit and market so that `runMatching()` runs.  
   - **Option B:** Add matching to `POST /api/v1/spot/orders` after insert (same tx as in `/spot/order`), so both endpoints behave consistently.  
   - Prefer one canonical endpoint and document it.

2. **Signup 500**  
   - In `auth.fastify.ts` send-otp: if `sent === false`, either (a) return 200 + `isNewUser` and log OTP in non-production, or (b) return 503 with code `OTP_DELIVERY_UNAVAILABLE` and ask user to retry or contact support.  
   - Ensure `otp_verifications` table exists and schema matches (e.g. `user_id` nullable for login/signup).

3. **P2P expiry**  
   - Register a scheduled job (e.g. every 1–2 minutes) that calls `p2pService.handleExpiredOrders()` or `processExpiredP2POrders()` (e.g. in `server.ts` or a worker process).

4. **Candles**  
   - Add a job that aggregates `spot_trades` into `ohlcv_candles` by interval (e.g. 1m, 5m, 1h) and run it periodically or on trade insert.

5. **Rate limit**  
   - Add `rateLimitByUser('spot:orders', 30, 60)` (or similar) to `POST /spot/orders` so both endpoints are protected.

6. **Fail-closed (optional)**  
   - Consider failing closed on rate-limit Redis errors for auth routes (reject request instead of allowing).

---

*Audit performed by inspecting actual code in `apps/backend` and `apps/frontend`. No generic advice; all findings reference files and logic above.*
