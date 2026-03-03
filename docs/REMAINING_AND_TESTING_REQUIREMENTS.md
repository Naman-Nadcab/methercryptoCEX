# Exchange — Remaining Work & Testing Requirements

**Scope:** Spot (limit, market, market making via API) + P2P (Binance-style)  
**Chart:** TradingView / LightweightCharts + apna trade data  
**Date:** February 2026

---

## Part A — Remaining Work (Backend)

### Spot

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Limit / market order | ✅ Done | `POST /api/v1/spot/order` — matching, FIFO, partial fills. Frontend ab isi use karta hai. |
| 2 | Market making via **API key** | ✅ Done | Spot routes `authenticateUser` use karte hain jo JWT + `X-API-Key` dono support karta hai. `read_only` keys place/cancel par reject. `user_api_keys` table + create/list/delete API hai, lekin **spot order place** ke liye API key auth (e.g. `X-API-Key` ya API key se token issue) implement nahi. Market making bots ke liye: ya to API key se auth middleware add karo (spot/order, cancel, orders list) ya documented “API key → JWT token” flow. |
| 3 | Stop loss / stop limit | ✅ Done | spot.fastify: stop_loss, stop_limit, trailing_stop_market; PENDING_TRIGGER + spot-trigger.service. Frontend: Stop/Stop Limit in order form. |
| 4 | Orderbook cache + WS | ✅ | Redis cache + broadcast on order/cancel. |
| 5 | Candles from trades | ✅ Done | `candle-aggregation.service.ts` + scheduler + startup run. |

### P2P (Binance-style)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Ads (create/update/cancel, filters) | ✅ | p2p.service + p2p.fastify. |
| 2 | Create order, escrow lock | ✅ | moveToEscrow in tx. |
| 3 | Confirm payment, release, cancel | ✅ | confirmPayment, releaseCrypto, cancelOrder. |
| 4 | Dispute + admin resolve | ✅ | openDispute, resolveDispute (favor_buyer/favor_seller/cancelled). |
| 5 | Payment methods CRUD | ✅ | User + admin. |
| 6 | Expiry auto-refund | ✅ Done | processExpiredP2POrders scheduler (90s). |
| 7 | **In-order chat** | ✅ Done | GET/POST /p2p/orders/:id/messages; chat UI on order detail (messages, “Mark as paid” coordination) backend me nahi. FAQ me “order details page” hai; chat API / UI add karna baaki. |
| 8 | Payment time limit enforcement | ✅ | Ad has payment_time_limit; order expires_at; expiry job refunds. |

### Backend UX / Safety

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Rate limits (auth, spot) | ✅ | send-otp, verify-otp, spot order, cancel. |
| 2 | Idempotency (P2P order, spot client_order_id) | ✅ | |
| 3 | OTP delivery 503 | ✅ Done | OTP_DELIVERY_UNAVAILABLE. |

---

## Part B — Remaining Work (Frontend)

### Spot UI/UX

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Place order (limit + market) | ✅ | `POST /api/v1/spot/order` — matching chal raha hai. |
| 2 | Chart — apna data | ✅ | `ChartPanel` → LightweightCharts + `getChartCandles` (our API). Candles + ticker poll se last price update. |
| 3 | Chart — TradingView with **our** data | ⚠️ Partial | `TradingViewChart.tsx` BINANCE symbol use karta hai (external data). Agar “TradingView use karenge lekin humare trade ka data” chahiye to: ya to **TradingView custom datafeed** implement karo (apne candles + trades feed) ya current setup ko clearly “Binance reference chart” label karo aur main chart LightweightCharts (our data) hi rakhna. |
| 4 | Chart par **trade markers** | ❌ Pending | Abhi chart par sirf candles + last price line; “humare” executed trades ke markers (buy/sell dots/lines) nahi. Agar chahiye to WebSocket `user.trades` / trade-history se markers draw karna add karna hoga. |
| 5 | Chart interval switch | ⚠️ Partial | ChartPanel me 1m, 5m, 15m, 1H, 4H, 1D labels hain lekin click se `intervalSeconds` change + refetch logic verify karo (useChartAdapter symbol/intervalSeconds depend karta hai). |
| 6 | Orderbook + recent trades live | ✅ | useSpotWs: orderbook, trades, user.orders, user.trades. |
| 7 | Open orders / history / trade history | ✅ | Bottom panel + GET spot/orders, spot/trade-history. |

### P2P UI/UX

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Ads list, filters, create ad | ✅ | |
| 2 | Create order, confirm payment, release, cancel | ✅ | |
| 3 | Order detail page | ✅ | |
| 4 | Dispute open (user) | ✅ | |
| 5 | **Order chat UI** | ✅ Done | P2P order detail page: chat list + input + Send. |
| 6 | Payment methods (list/add/edit) | ✅ | |

### General UX

| # | Item | Notes |
|---|------|--------|
| 1 | Loading / error states | Spot/P2P pages par mostly present; jahan gap ho wahan add karna. |
| 2 | Mobile layout | Spot grid, orderbook, chart — small screen par test karke tweaks. |
| 3 | Empty states | No orders, no trades, no ads — messages clear hon. |

---

## Part C — Testing Ke Liye Aapko Kya Provide Karna Hoga

### 1. Environment / 3rd Party

| Item | Use | Optional? |
|------|-----|-----------|
| **DATABASE_URL** | PostgreSQL (orders, users, balances, P2P, candles). | No |
| **REDIS_URL** | Session, rate limit, orderbook cache, locks. | No (recommended) |
| **JWT_SECRET** | Auth tokens. | No |
| **SMTP (host, user, pass, port)** | Email OTP (signup/login). | Yes — bina SMTP 503 aayega (OTP_DELIVERY_UNAVAILABLE). |
| **SMS provider** | Phone OTP. Twilio / MSG91 / Fast2SMS / TextLocal — env + backend `api_settings` (SMS category). | Yes — same 503 if not set. |
| **RPC / WebSocket (EVM chains)** | Indexer / deposits — agar deposit detection test karni ho. | Optional for spot/P2P-only testing. |
| **Hot wallet / KMS** | Withdrawal signing — agar withdraw flow test karna ho. | Optional for spot/P2P-only. |

### 2. Backend Config (env / DB)

- `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_API_BASE_URL` — frontend backend ko is URL par call karega (e.g. `http://localhost:4000`).
- CORS — backend me allowed origins me frontend origin (e.g. `http://localhost:3000`).
- API key auth: Create key at Dashboard → API, send `X-API-Key` header for spot order/cancel. See `docs/MARKET_MAKING_API.md`.

### 3. Test Data (Aap Provide Kar Sakte Ho)

| Data | Purpose |
|------|--------|
| **Spot markets** | `spot_markets` me at least 1 active pair (e.g. BTC_USDT) with min_qty, min_notional, price_precision, qty_precision. |
| **trading_pairs** | Candles API `trading_pairs` use karta hai; same symbol + trading_enabled = true. |
| **Users** | 2+ test users (OTP signup ya seed) — ek buyer, ek seller — balance + orders test. |
| **Balances** | Test users ke `user_balances` (trading + funding) me sufficient balance (spot + P2P test). |
| **P2P** | 1–2 ads (buy/sell), payment methods; phir create order → confirm → release flow. |

### 4. Test Scenarios (Checklist)

**Spot**

- [ ] Limit buy/sell place → orderbook me dikhe, opposite side se match ho.
- [ ] Market buy/sell → fill + balance update.
- [ ] Partial fill (2 orders se fill).
- [ ] Cancel open order → balance unlock.
- [ ] Chart: candles load (interval change if UI hai).
- [ ] WebSocket: orderbook/trades/ticker/order update connect hone par update.

**P2P**

- [ ] Ad create (sell) → balance check.
- [ ] Create order → escrow lock, payment_pending.
- [ ] Confirm payment → release → buyer ko crypto, seller balance update.
- [ ] Cancel order → escrow refund.
- [ ] Expiry: payment_pending order expire → auto refund (scheduler run ke baad).
- [ ] Dispute open → admin resolve (favor_buyer/favor_seller/cancelled).

**Auth**

- [ ] Signup (email/phone) — agar SMTP/SMS na ho to 503 + OTP_DELIVERY_UNAVAILABLE.
- [ ] Login (OTP) → dashboard, spot, P2P access.

### 5. Optional (Agar Market Making / API Test Karna Ho)

- **Abhi:** API key auth implemented. Create key at Dashboard → API (transaction, read_write), send `X-API-Key` header with spot order/cancel requests.

---

## Part D — Short Summary

- **Spot:** Limit/market + matching + candles + WS + frontend order flow + API key auth for MM — done. Baaki: optional stop loss/stop limit.
- **Chart:** LightweightCharts par **apna** candle + last price already; TradingView abhi Binance data. Apna data TradingView par custom datafeed se hi aayega; ya main chart LightweightCharts hi rahe.
- **P2P:** Core flow (ads, order, escrow, release, cancel, dispute, expiry) — done. **Order chat** (backend + frontend) baaki for Binance-style experience.
- **Testing:** DB, Redis, JWT, optional SMTP/SMS, test users + balances + 1 spot market + P2P ads; phir above scenarios run karo. API key testing ke liye pehle backend me API key auth for spot implement karna hoga.

Is doc ko aap “remaining list” + “testing ke liye kya chahiye” dono ke liye use kar sakte ho; testing se pehle jo cheezein provide karni hain (env, 3rd party, test data) unko isi order me set karna simple rahega.
