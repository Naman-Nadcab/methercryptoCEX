# Exchange Audit — Binance-Level Spot + P2P | UX/UI & Feature Checklist

**Date:** Feb 2026  
**Scope:** What’s done, what’s remaining, page-wise UX/UI audit, Spot page detail, errors and gaps.

---

## PART 1 — WHAT’S DONE (Implemented & Working)

### Backend — Spot
| Feature | Status | Notes |
|--------|--------|-------|
| Place order (limit, market, stop_loss, stop_limit) | ✅ | `POST /api/v1/spot/order`; stop_price; PENDING_TRIGGER + trigger job |
| Cancel order (by id, cancel-all) | ✅ | Includes PENDING_TRIGGER; unlock uses stop_price |
| **GET /spot/open-orders** | ✅ | Returns OPEN, PARTIALLY_FILLED, PENDING_TRIGGER (no stop_price in response) |
| **GET /spot/orders** (list) | ✅ | Fixed: status=OPEN includes OPEN/PARTIALLY_FILLED/PENDING_TRIGGER; response includes stop_price |
| Orderbook snapshot + WebSocket | ✅ | Redis cache; broadcast on order/cancel |
| Candles from trades | ✅ | candle-aggregation; job 120s + startup |
| Stop order trigger job | ✅ | processTriggeredStopOrders() every 30s |
| Matching (FIFO, partial fills) | ✅ | spot-matching.service |
| API key auth (X-API-Key) | ✅ | authenticateUser on spot routes |

### Backend — P2P
| Feature | Status |
|--------|--------|
| Ads CRUD + filters | ✅ |
| Create order + escrow | ✅ |
| Confirm payment / Release / Cancel | ✅ |
| Dispute + admin resolve | ✅ |
| Expiry auto-refund (90s) | ✅ |
| P2P order chat API | ✅ GET/POST /p2p/orders/:id/messages |

### Backend — Auth / Wallet
| Feature | Status |
|--------|--------|
| Send OTP, verify OTP, 503 on delivery fail | ✅ |
| JWT + session, API key | ✅ |
| user_balances, balance_locks, escrow | ✅ |
| Currencies + spot_markets seed (migrate) | ✅ (currencies table + BTC/ETH/USDT seed added) |
| api_settings seed (SMS fast2sms/twilio) | ✅ |

### Frontend — Implemented
| Area | Status |
|------|--------|
| Login / Signup (OTP, passkey option) | ✅ |
| Dashboard layout, sidebar, KYC banner, notifications | ✅ |
| **Spot main grid** (`/dashboard/spot`) | ✅ Chart, orderbook, Limit/Market/Stop/Stop Limit, trade markers, intervals |
| **Spot alternate page** (`/dashboard/trade/spot`) | ⚠️ Limit/Market only (no Stop/Stop Limit in UI) |
| P2P ads list, create ad, create order | ✅ |
| P2P order detail + chat UI | ✅ |
| P2P payment methods | ✅ |
| Orders hub → Spot Orders / P2P Orders | ✅ |
| Progress Tracker | ✅ |
| Earn, Copy Trading, Demo, Events | Placeholder “Coming Soon” |

---

## PART 2 — REMAINING / GAPS (Binance-Level)

### Backend
| Gap | Priority | Detail |
|-----|----------|--------|
| **GET /spot/orders?status=OPEN** | ✅ Fixed | Filter now uses status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'). |
| **GET /spot/orders list** | ✅ Fixed | SELECT includes **stop_price**. Frontend now shows Trigger column and “Pending Trigger” properly from list. |
| **GET /spot/open-orders** | ✅ Fixed | Response now includes **stop_price**. |
| Read-only API keys | 🟢 Low | permission read_only not enforced on place/cancel. |
| TradingView custom datafeed | 🟢 Low | TradingView component uses external data; optional our-OHLCV datafeed. |

### Frontend — Spot
| Gap | Priority | Detail |
|-----|----------|--------|
| **/dashboard/trade/spot** | 🟡 Medium | Only Limit/Market in form; add Stop / Stop Limit + stop_price input (align with SpotTradingGrid). |
| **Spot bottom panel** (grid) | ✅ Fixed | **Active tab styling** added (border + highlight). Counts only still; full table optional later. |
| **Open orders table** (grid + orders/spot page) | ✅ Fixed | **stop_price** column and **“Pending Trigger”** display on orders/spot page; cancel allowed for PENDING_TRIGGER. |
| **/dashboard/orders/spot** | ✅ Fixed | Uses GET /spot/orders?status=OPEN (backend now returns PENDING_TRIGGER). Table has Trigger column and Pending Trigger status. |

### Frontend — P2P
| Gap | Priority | Detail |
|-----|----------|--------|
| **/dashboard/p2p** | 🟢 Low | Hard redirect to **buy/USDT/INR**; no market selector or sell entry from hub. Binance-style: show Buy/Sell + crypto/fiat selector on P2P landing. |

### Frontend — General
| Gap | Priority | Detail |
|-----|----------|--------|
| Earn / Copy Trading / Demo / Events | 🟢 Low | Placeholder only; not required for “Binance-level Spot + P2P” MVP. |

---

## PART 3 — PAGE-WISE UX/UI AUDIT

### 3.1 Dashboard Home (`/dashboard`)
- **Working:** Cards (balance, markets, announcements, rewards, help), KYC banner, theme.
- **Issues:** Market data loading state; no skeleton for tickers. Help links are static (no real docs).
- **Errors:** None critical. Ensure `getApiBaseUrl()` and announcements API handle 401 gracefully.

### 3.2 Spot Trading — Main Grid (`/dashboard/spot`)
- **Working:** Pair selector, chart (our candles), intervals (1m–1D), orderbook, recent trades, order form (Limit/Market/Stop/Stop Limit), trade markers, balance display, place order → POST /spot/order.
- **Issues:**
  - **Bottom panel:** Tabs “Open Orders” / “Order History” / “Trade History” have **no active state** (all look same). Content is only **counts** (“Open: 0”), no table, no cancel button. Feels incomplete.
  - No loading skeleton for orderbook on symbol switch.
  - No explicit “connection lost” for WebSocket (only `connected` in PairHeader if used).
- **Errors:** None; form validation and API errors shown.

### 3.3 Spot Trading — Alternate Page (`/dashboard/trade/spot`)
- **Working:** Market dropdown, Limit/Market, place order (POST /spot/order), open orders + history tabs, cancel, refresh.
- **Issues:** **No Stop / Stop Limit** in UI; no stop_price. Markets are **hardcoded** (BTC_USDT, ETH_USDT) not from API.
- **Errors:** Cancel/order errors shown; idempotency via client_order_id.

### 3.4 Spot Orders Page (`/dashboard/orders/spot`)
- **Working:** Open / History tabs, table (market, side, price, qty, status, cancel), loading skeletons, refresh.
- **Issues:** **No stop_price column**; status shown raw (e.g. PENDING_TRIGGER not “Pending Trigger”). **OPEN filter** from API excludes PENDING_TRIGGER until backend fixed. Cancel button only for OPEN/PARTIALLY_FILLED (should allow PENDING_TRIGGER; backend already does).
- **Errors:** Cancel error displayed; no lint issues.

### 3.5 P2P Landing (`/dashboard/p2p`)
- **Working:** Redirects to buy/USDT/INR.
- **Issues:** No landing with Buy/Sell + pair selector; direct redirect is acceptable but not Binance-style.

### 3.6 P2P Trading Page (`/dashboard/p2p/[type]/[crypto]/[fiat]`)
- **Working:** Ads table, filters, create ad, create order, FAQ, help.
- **Issues:** Large single page; could split “My ads” vs “Browse”. No critical UX errors.

### 3.7 P2P Order Detail (`/dashboard/p2p/orders/[orderId]`)
- **Working:** Order info, Confirm payment, Release, Cancel, **Chat** (messages + send).
- **Issues:** None critical; chat scroll and loading states OK.

### 3.8 P2P Payment Methods (`/dashboard/p2p/payment-methods`)
- **Working:** List, add, edit.
- **Issues:** None.

### 3.9 Orders Hub (`/dashboard/orders`)
- **Working:** Links to Spot Orders, P2P Orders, Convert; clear labels.
- **Issues:** None.

### 3.10 Assets Overview (`/dashboard/assets/overview`)
- **Working:** Balance view, tabs, links to funding/convert/history.
- **Issues:** None critical.

### 3.11 Auth — Login (`/(auth)/login`)
- **Working:** Identifier (email/phone), OTP, verification steps, passkey option, error messages, countdown resend.
- **Issues:** Long page; could shorten copy. No critical errors.

### 3.12 Dashboard Layout (sidebar / nav)
- **Working:** Menu items, expand/collapse, Progress Tracker, API, Fee rates, Spot Wallet link.
- **Links check:** All main hrefs have corresponding pages: `/dashboard/account`, `/dashboard/security`, `/dashboard/data-export`, `/dashboard/assets/unified`, `/dashboard/assets/convert`, `/dashboard/assets/history`, `/dashboard/wallet/spot`, `/dashboard/preferences` — **all exist** (no 404s).
- **Issues:** “Spot Wallet” points to `/dashboard/wallet/spot`; “Unified Trading” to `/dashboard/assets/unified` — confirm these are intended (unified may be different from spot grid).

### 3.13 Progress Tracker (`/dashboard/progress`)
- **Working:** Lists steps from exchangeProgressSteps; done/pending; counts.
- **Issues:** None.

### 3.14 Earn, Copy Trading, Demo, Events
- **Working:** “Coming Soon” placeholders.
- **Issues:** None for MVP.

---

## PART 4 — SPOT PAGE SUMMARY (What’s There)

| Element | Main grid (`/dashboard/spot`) | Alternate (`/dashboard/trade/spot`) | Orders page (`/dashboard/orders/spot`) |
|--------|-------------------------------|-------------------------------------|----------------------------------------|
| Chart | ✅ Our candles, intervals | ❌ | ❌ |
| Orderbook | ✅ Live + WS | ❌ | ❌ |
| Order form | ✅ Limit/Market/Stop/Stop Limit | ✅ Limit/Market only | ❌ |
| Place order API | ✅ POST /spot/order | ✅ POST /spot/order | ❌ |
| Open orders | ✅ Bottom panel (count only) | ✅ Table + cancel | ✅ Table + cancel |
| Order history | ✅ Bottom panel (count only) | ✅ Table | ✅ Table |
| Trade history | ✅ Bottom panel (count only) | ❌ | ❌ |
| Stop price / Pending Trigger | ✅ In form; not in bottom panel | ❌ | ❌ (no stop_price column; API gap) |
| Markets source | ✅ API /spot/markets | ❌ Hardcoded | N/A |

---

## PART 5 — ERRORS & LINT

- **Lint:** No linter errors in `apps/frontend/src/app/dashboard` or `apps/frontend/src/components/trade`.
- **Runtime:** No systematic JS errors observed; API and form errors are shown in UI.
- **Backend:** Fixed: GET /spot/orders status=OPEN now includes PENDING_TRIGGER; list and open-orders include stop_price.

---

## PART 6 — RECOMMENDED FIX ORDER (Binance-Level Spot + P2P)

1. ~~**Backend:** Fix GET /spot/orders so that status=OPEN returns PENDING_TRIGGER and add stop_price~~ **Done.** List and open-orders now return stop_price; OPEN filter includes PENDING_TRIGGER.
2. **Frontend — Spot bottom panel:** Add active tab styling and show at least open orders as a small table with cancel (reuse useSpotBottomPanel data).
3. **Frontend — Orders/spot + grid:** Add stop_price column and “Pending Trigger” (or displayStatus) once API returns them.
4. **Frontend — /dashboard/trade/spot:** Add Stop/Stop Limit and stop_price; optionally load markets from API.
5. **P2P landing (optional):** Add simple Buy/Sell + crypto/fiat selector before redirecting to trading page.

---

## PART 7 — FEATURE MATRIX (Quick)

| Feature | Backend | Frontend | UX note |
|--------|---------|----------|--------|
| Spot limit/market | ✅ | ✅ | — |
| Spot stop/stop limit | ✅ | ✅ grid; ❌ trade/spot page | — |
| Spot open orders list | ⚠️ OPEN filter + stop_price | ✅ | Show stop_price + Pending Trigger |
| Spot bottom panel | — | ⚠️ counts only | Table + tab state |
| P2P full flow + chat | ✅ | ✅ | — |
| Auth OTP + 503 | ✅ | ✅ | — |
| Currencies + markets seed | ✅ | — | — |
| Progress Tracker | — | ✅ | — |

---

*End of audit.*
