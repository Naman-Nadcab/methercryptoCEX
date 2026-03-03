# Exchange System Audit Report

**Date:** Feb 2026  
**Scope:** Backend, Frontend, DB, Config (OTP/SMS/APIs), Coins/Currencies — complete exchange view.

---

## 1. BACKEND — Implemented & Working

### 1.1 Auth
| Feature | Status | Notes |
|--------|--------|-------|
| Send OTP (email/phone) | ✅ | `POST /api/v1/auth/send-otp`; uses `otp.service` (createOTP + sendEmailOTP/sendSMSOTP) |
| Verify OTP → login/signup | ✅ | `POST /api/v1/auth/verify-otp`; 503 + `OTP_DELIVERY_UNAVAILABLE` when delivery fails |
| JWT + session (Redis) | ✅ | `authenticate` decorator; session validation |
| API key auth (spot) | ✅ | `authenticateUser`: Bearer JWT or `X-API-Key` for spot routes |
| Rate limit (send-otp 3/min per IP) | ✅ | `rateLimitByIp('auth:send-otp', 3, 60)` |
| OAuth (Google/Apple) | ✅ | Routes + callback; credentials from env or `api_settings` (social_login) |

### 1.2 Spot Trading
| Feature | Status | Notes |
|--------|--------|-------|
| Place order (limit/market/stop_loss/stop_limit) | ✅ | `POST /api/v1/spot/order`; stop orders need `stop_price`; PENDING_TRIGGER → trigger job |
| Cancel order (by id, cancel-all) | ✅ | Includes PENDING_TRIGGER; unlock uses `stop_price` when needed |
| Open orders / order history / trade history | ✅ | GET endpoints; open includes PENDING_TRIGGER |
| Orderbook snapshot + WebSocket | ✅ | Redis cache; broadcast on order/cancel |
| Candles from trades | ✅ | `candle-aggregation.service` → `ohlcv_candles`; job every 120s + one-time on startup |
| Stop order trigger job | ✅ | `processTriggeredStopOrders()` every 30s |
| Matching (FIFO, partial fills, balance lock) | ✅ | `spot-matching.service`; used by place-order and trigger |

### 1.3 P2P
| Feature | Status | Notes |
|--------|--------|-------|
| Ads CRUD + filters | ✅ | List, create, cancel |
| Create order + escrow lock | ✅ | `p2pService.createOrder`; moveToEscrow in transaction |
| Confirm payment / Release / Cancel | ✅ | Idempotency + cooldown |
| Dispute + admin resolve | ✅ | openDispute, resolveDispute |
| Expiry auto-refund | ✅ | `p2pService.handleExpiredOrders()` every 90s |
| P2P order chat API | ✅ | `GET/POST /api/v1/p2p/orders/:orderId/messages` |

### 1.4 Wallet / Balances
| Feature | Status | Notes |
|--------|--------|-------|
| user_balances (single source of truth) | ✅ | Spot/P2P use it; balance_locks for spot |
| Lock/unlock (spot) | ✅ | lockTradingBalance, debitLockedTradingBalance, etc. |
| Escrow (P2P) | ✅ | moveToEscrow, releaseFromEscrow, refundFromEscrow |

### 1.5 Scheduled Jobs (server.ts)
| Job | Interval | Status |
|-----|----------|--------|
| P2P expiry | 90s | ✅ |
| Candle aggregation | 120s | ✅ |
| Startup candle aggregation | Once | ✅ (non-blocking) |
| Stop order trigger | 30s | ✅ |
| Deposit sweep / auto sweep / orderbook refresh / balance audit / settlement | As configured | ✅ |

---

## 2. FRONTEND — Implemented & Working

| Area | Status | Notes |
|------|--------|-------|
| Login / Signup (OTP) | ✅ | send-otp → verify-otp flow |
| Dashboard layout + sidebar | ✅ | Progress Tracker link, KYC banner, notifications |
| Spot trading (grid) | ✅ | Chart (our candles), orderbook, order entry: Limit/Market/Stop/Stop Limit, trade markers |
| Spot trade/spot page | ✅ | Place order, open orders, history (uses POST /spot/order) |
| P2P ads list + create ad + create order | ✅ | Type/crypto/fiat filters |
| P2P order detail | ✅ | Confirm payment, Release, Cancel + **Chat** (messages list + send) |
| P2P payment methods | ✅ | List, add, edit |
| Progress Tracker | ✅ | `/dashboard/progress`; reads `exchangeProgressSteps.ts` (23/23 done) |
| Chart intervals | ✅ | 1m/5m/15m/1H/4H/1D; refetch candles |
| Coming Soon badges | ✅ | Earn, Copy Trading, Demo Trading, Events |

---

## 3. DATABASE — What Exists

### 3.1 Core Tables (migrate.ts / usage)
- **users** – email, phone, status, KYC, 2FA, etc.
- **otp_verifications** – identifier, type (email/phone/password_reset), otp_hash, salt, expires_at.
- **sessions / user_sessions** – session store.
- **user_balances** – user_id, currency_id, chain_id, account_type, available_balance, locked_balance (single source of truth).
- **balance_locks** – spot order locks (reference_id for order cancel).
- **currencies** – id, symbol, name, currency_type, etc. **Not created in migrate.ts**; backfill from tokens (deposits.currency_id). **full-schema.sql** has CREATE + INSERT (BTC, ETH, BNB, USDT, USDC, SOL, MATIC, TRX, etc.).
- **tokens** – id, symbol, name, chain_id, contract_address, decimals, is_active, is_native, min_deposit, min_withdrawal, withdrawal_fee. **Seeded:** ETH, BNB, MATIC, SOL, TRX, BTC, USDT (multi-chain), USDC (multi-chain), DOT.
- **chains** – id, name, type, native_currency, rpc_url, explorer_url, etc. **Seeded:** ethereum, bsc, polygon, solana, tron, bitcoin, arbitrum, base, polkadot.
- **spot_markets** – symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision, maker_fee, taker_fee. **Seeded (if currencies exist):** BTC_USDT, ETH_USDT.
- **spot_orders** – user_id, market, side, type (market/limit/stop_loss/stop_limit), price, **stop_price**, quantity, filled_quantity, status (OPEN/PARTIALLY_FILLED/FILLED/CANCELLED/REJECTED/**PENDING_TRIGGER**), client_order_id.
- **spot_trades** – order_id, user_id, market, side, price, quantity, fee, fee_asset.
- **ohlcv_candles** – trading_pair_id, interval_type, open_time, close_time, OHLCV, trade_count (filled by aggregation job).
- **p2p_ads, p2p_orders, escrows, p2p_disputes** – P2P flow.
- **p2p_order_messages** – order_id, sender_id, message, created_at (chat).
- **user_api_keys** – API keys for users (X-API-Key auth).
- **api_settings** – category, provider, name, api_key, api_secret, api_url, additional_config, is_active, is_default. **UNIQUE(category, provider).** Used for: SMS (category=`sms`, provider=fast2sms/twilio/…), OAuth (category=`social_login`).

### 3.2 Coin / Currency Source of Truth
- **Spot/Wallet** code uses **currencies** (e.g. `getCurrencyIdBySymbol` → `currencies`).
- **Currencies** in migrate are only **backfilled** from tokens where deposits.currency_id exists; no initial CREATE in migrate.
- **full-schema.sql** defines and seeds **currencies** (and blockchains); actual DB may come from migrate only, so **currencies** might be missing or partial until backfill or manual seed.
- **tokens** table is fully created and seeded in migrate (ETH, BNB, MATIC, SOL, TRX, BTC, USDT/USDC multi-chain, DOT).
- **spot_markets** seed requires **currencies** with BTC, ETH, USDT; if currencies table is empty, spot_markets insert is no-op.

**Gap:** If you only run migrate (no full-schema), **currencies** table might not exist or be empty. Then spot_markets seed fails (no BTC/ETH/USDT in currencies), and getCurrencyIdBySymbol returns null → spot order can fail with “Market assets not configured”. **Recommendation:** Ensure currencies table exists and has at least BTC, ETH, USDT (e.g. seed from tokens by symbol or add explicit currency seed in migrate).

---

## 4. OTP / EMAIL / SMS — Config & Behaviour

### 4.1 Email OTP
- **Config:** Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (optional). Config schema: `SMTP_USER`, `SMTP_PASSWORD` (optional).
- **Code:** `otp.service.ts` uses **process.env** (SMTP_HOST, SMTP_USER, SMTP_PASS, etc.). If not set, no transporter → **DEV:** logs OTP to console and returns true; **production:** returns false → send-otp returns **503 OTP_DELIVERY_UNAVAILABLE** (fixed earlier).
- **Status:** Works in dev (log only). For production: set SMTP env vars.

### 4.2 SMS OTP
- **Config (priority):**
  1. **DB:** `api_settings` where `category = 'sms'` and `is_active = TRUE`; provider e.g. fast2sms, twilio. Columns: api_key, api_secret, additional_config (e.g. message_id, route for Fast2SMS).
  2. **Env (fallback):** Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`; or `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_API_KEY_SECRET`, `SMS_SENDER_ID`.
- **Code:** `getSMSConfigFromDB()` in otp.service; then sendViaTwilio / sendViaMSG91 / sendViaTextLocal / sendViaFast2SMS.
- **Status:** If no DB config and no Twilio env: DEV log only. For production SMS: add row in **Admin → System → API Settings** (category `sms`, provider `fast2sms` or `twilio`, api_key etc.) or set Twilio env.

### 4.3 Summary
- **OTP create/verify:** Working (DB + optional Redis).
- **Email delivery:** Needs SMTP env in production.
- **SMS delivery:** Needs api_settings (sms) or Twilio env in production.

---

## 5. REMAINING / GAPS (Exchange-Complete View)

### 5.1 Backend
- **Currencies seed:** Ensure currencies table has BTC, ETH, USDT (and any other spot base/quote) so spot_markets and getCurrencyIdBySymbol work. Either add explicit currency seed in migrate or document “run full-schema or seed currencies from tokens”.
- **TradingView custom datafeed:** Chart is LightweightCharts with our candles; TradingView component exists but uses external Binance data. Optional: custom datafeed for TradingView using our OHLCV API.
- **Read-only API keys:** Keys have `permission` (read_write/read_only); spot routes don’t enforce it yet (all keys can place/cancel). Optional: reject POST /order and cancel when permission is read_only.
- **Withdrawal flow:** Exists (wallet routes, approval, signing queue); not re-verified in this audit.
- **KYC:** Provider (Hyperverge/Onfido/mock) in config; flows exist; not re-verified end-to-end.

### 5.2 Frontend
- **Dashboard spot page** (`/dashboard/trade/spot/page.tsx`): Still only Limit/Market in UI (no Stop/Stop Limit). Main grid (`SpotTradingGrid`) has Stop/Stop Limit.
- **Open orders table:** Can show `stop_price` and “Pending Trigger” for stop orders (backend already returns them).
- **Earn / Copy Trading / Demo / Events:** Placeholder “Coming Soon” only.

### 5.3 DB / Config
- **api_settings:** No automatic seed for SMS. Admin must add SMS provider (e.g. fast2sms) in Admin → System → API Settings.
- **system_settings:** Seeded (trading_enabled, p2p_enabled, withdrawals_enabled, etc.).
- **Fee tiers / fee_promotions:** Tables exist; spot uses maker_fee/taker_fee from spot_markets.

---

## 6. FEATURE MATRIX (Quick Reference)

| Feature | Backend | Frontend | DB/Config |
|---------|---------|----------|-----------|
| Auth (OTP login/signup) | ✅ | ✅ | otp_verifications ✅ |
| Email OTP | ✅ (needs SMTP env) | — | — |
| SMS OTP | ✅ (needs api_settings or Twilio) | — | api_settings ✅ |
| Spot limit/market/stop | ✅ | ✅ (grid) | spot_orders ✅ |
| Spot cancel / open orders | ✅ | ✅ | — |
| Candles | ✅ | ✅ | ohlcv_candles ✅ |
| Orderbook + WS | ✅ | ✅ | Redis + WS ✅ |
| API key (spot) | ✅ | — | user_api_keys ✅ |
| P2P full flow | ✅ | ✅ | p2p_* ✅ |
| P2P chat | ✅ | ✅ | p2p_order_messages ✅ |
| Progress tracker | — | ✅ | exchangeProgressSteps.ts ✅ |
| Currencies/coins | Used | — | currencies: seed gap ⚠️ |
| Spot markets | ✅ | ✅ | spot_markets (depends on currencies) ⚠️ |

---

## 7. RECOMMENDATIONS

1. **Currencies:** Add a migration or seed that ensures `currencies` has at least BTC, ETH, USDT (e.g. from tokens or explicit INSERT) so spot_markets and spot order flow work out of the box.
2. **Production OTP:** Set SMTP env for email; add SMS provider in Admin → API Settings (or Twilio env) for SMS.
3. **Optional:** Enforce read_only API keys on spot write endpoints; add stop_price + “Pending Trigger” in open orders table on frontend; align `/dashboard/trade/spot` page with grid (Stop/Stop Limit) if desired.
4. **Doc:** Document for ops: required env (JWT, DB, Redis, SMTP, optional RabbitMQ, optional SMS/Twilio), and that SMS can be configured via api_settings (category=sms).

---

*End of audit.*
