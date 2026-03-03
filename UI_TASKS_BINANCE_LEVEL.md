# UI Tasks — Binance-Level Exchange

**Goal:** Complete these UI tasks so the interface is Binance-level. After UI is done, run full testing to verify what works and what doesn’t.

---

## Priority 1 — Spot Trading (Must Have)

| # | Task | Where | Detail |
|---|------|--------|--------|
| 1 | **Spot bottom panel: show table + cancel** | `/dashboard/spot` (SpotBottomPanel) | Right now only "Open: N" / "History: N" / "Trades: N" is shown. Add a small table for Open Orders (market, side, price, trigger, qty, status, Cancel) and optionally compact rows for Order History / Trade History. Reuse `useSpotBottomPanel` data; add cancel handler. |
| 2 | **Spot bottom panel: show stop_price & Pending Trigger** | Same | When rendering open orders in the new table, show trigger price column and display "Pending Trigger" for status PENDING_TRIGGER (data already has stop_price from API). |
| 3 | **Trade/spot page: add Stop & Stop Limit** | `/dashboard/trade/spot/page.tsx` | Form currently has only Limit + Market. Add Stop and Stop Limit buttons, stop_price input (conditionally), and send stop_price in POST /spot/order body when type is stop_loss or stop_limit. |
| 4 | **Trade/spot page: markets from API** | Same | Replace `MARKETS_STATIC` with fetch from GET /api/v1/spot/markets so new pairs appear automatically. |
| 5 | **Orderbook loading skeleton** | `/dashboard/spot` (SpotTradingGrid / SpotOrderbookPanel) | On symbol change, show skeleton or loading state for orderbook until data loads. |
| 6 | **WebSocket connection indicator** | Spot header or chart area | Show a small "Connected" / "Reconnecting" / "Disconnected" indicator so user knows live data status. |

---

## Priority 2 — P2P (Binance-Style)

| # | Task | Where | Detail |
|---|------|--------|--------|
| 7 | **P2P landing: Buy/Sell + pair selector** | `/dashboard/p2p/page.tsx` | Instead of hard redirect to buy/USDT/INR, show a short landing: "Buy Crypto" / "Sell Crypto" and crypto (USDT, BTC, ETH…) + fiat (INR, USD…) selector, then navigate to `/dashboard/p2p/[buy\|sell]/[crypto]/[fiat]`. |
| 8 | **P2P order list / "My P2P orders"** | New or existing | Easy way to see "My orders" (open, completed) with link to order detail. Can be a card on P2P landing or a dedicated "My orders" section. |
| 9 | **P2P timer on order detail** | `/dashboard/p2p/orders/[orderId]` | Show remaining time to pay or to release (e.g. "15 min left to pay") if backend sends payment_deadline or similar. |

---

## Priority 3 — Dashboard & Global UX

| # | Task | Where | Detail |
|---|------|--------|--------|
| 10 | **Dashboard home: ticker/market skeleton** | `/dashboard/page.tsx` | While market data loads, show skeleton rows for tickers instead of empty or jump. |
| 11 | **Dashboard home: 401 handling** | Same | If announcements or market API returns 401, don’t break layout; show empty or "Sign in to see" where appropriate. |
| 12 | **Consistent empty states** | All list/table pages | Every table/list (open orders, order history, P2P ads, etc.) should have a clear empty state: icon + short message + optional CTA (e.g. "Place first order"). |
| 13 | **Loading states** | All data pages | Every page that fetches data should have loading (skeleton or spinner); avoid blank then pop. |
| 14 | **Error toasts / inline errors** | Global or per page | Critical actions (place order, cancel, P2P confirm/release) should show success/error in a consistent way (toast or inline banner). |
| 15 | **Mobile: sidebar / nav** | Dashboard layout | Ensure sidebar collapses to hamburger and key flows (Spot, P2P, Orders, Assets) work on small screens. |
| 16 | **Accessibility: focus & labels** | Forms & buttons | Important buttons and inputs have aria-labels; focus order is logical; no focus trap. |

---

## Priority 4 — Assets, Wallet, Withdraw, Deposit

| # | Task | Where | Detail |
|---|------|--------|--------|
| 17 | **Deposit: QR + address copy** | `/dashboard/deposit/crypto` | Show deposit address and QR; one-click copy with feedback. |
| 18 | **Withdraw: confirmation step** | `/dashboard/withdraw/crypto` | Before submit, show summary (amount, fee, address, network) and require 2FA/OTP if configured. |
| 19 | **Assets overview: balance by asset** | `/dashboard/assets/overview` | List balances per asset (from API); loading and empty state. |
| 20 | **Convert: source/target + amount** | `/dashboard/assets/convert` or `/dashboard/convert` | Clear flow: select source asset, target asset, amount; show quote and slippage if any; submit. |

---

## Priority 5 — Polish (Nice to Have)

| # | Task | Where | Detail |
|---|------|--------|--------|
| 21 | **Spot: price/quantity shortcuts** | Order form | e.g. 25%, 50%, 75%, 100% of balance for quantity (Binance-style). |
| 22 | **Spot: last price click** | Order form | Click on last price in orderbook or ticker to fill price field. |
| 23 | **P2P: ad card layout** | P2P ads list | Card layout for ads (price, limit, payment methods, completion rate) with clear "Buy" / "Sell" CTA. |
| 24 | **Dark/light theme consistency** | Global | All new components support dark/light; no contrast issues. |
| 25 | **Earn / Copy Trading / Demo / Events** | Placeholder pages | Keep "Coming Soon" but ensure layout and link from dashboard are consistent. |

---

## Summary Count

- **P1 (Spot):** 6 tasks  
- **P2 (P2P):** 3 tasks  
- **P3 (Dashboard/Global):** 7 tasks  
- **P4 (Assets/Wallet):** 4 tasks  
- **P5 (Polish):** 5 tasks  

**Total: 25 UI tasks.** Complete P1 → P3 first for a solid Binance-level Spot + P2P UX; then P4 and P5.

---

## After UI Is Done

1. Run full regression: auth, spot (place/cancel, open orders, history, stop orders), P2P (create ad, create order, pay, release, chat).
2. Check backend logs and DB for errors.
3. Use **SYSTEM_CHECK_FULL.md** (next document) to verify overall system and remaining gaps.
