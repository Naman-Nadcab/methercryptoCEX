# Spot Page – Full Audit (Binance-Grade)

**Date:** 2026  
**Scope:** UI/UX, Backend, DB connectivity, end-to-end functionality.

---

## 1. Backend ↔ DB Connectivity

| Item | Status | Notes |
|------|--------|------|
| **spot_markets** | ✅ | Used by GET /spot/markets, orderbook, ticker, order placement. |
| **spot_orders** | ✅ | Order placement, cancel, list, matching. |
| **spot_trades** | ✅ | Trade history, ticker 24h stats, pushSpotUpdates. |
| **user_balances** (trading) | ✅ | Lock/unlock on order, debit/credit on fill. |
| **ohlcv_candles** | ⚠️ | Used by GET /trading/candles. **Requires trading_pairs.id**; candles API reads `trading_pairs` (trading_enabled=TRUE), not `spot_markets`. If `trading_pairs` has no row for symbol (e.g. BTC_USDT), chart returns empty. |
| **trading_pairs** | ⚠️ | Candles & legacy paths use it. Must have same symbols as spot_markets and `trading_enabled = TRUE` for chart to work. |
| **Redis** | ✅ | Orderbook cache, WS pub/sub. Optional; server runs without it with degraded behaviour. |

**Gap:** Chart data depends on `trading_pairs` + `ohlcv_candles`. Ensure every `spot_markets.symbol` has a matching `trading_pairs.symbol` with `trading_enabled = TRUE`, and candle aggregation (or seed script) fills `ohlcv_candles`.

---

## 2. Frontend ↔ Backend Connectivity

| API | Frontend | Backend | Status |
|-----|----------|---------|--------|
| **Markets** | GET /api/v1/spot/markets | GET /spot/markets | ✅ |
| **Orderbook** | GET /api/v1/spot/orderbook/:symbol?limit=20 | GET /spot/orderbook/:symbol | ✅ |
| **Ticker** | GET /api/v1/spot/ticker/:symbol | GET /spot/ticker/:symbol | ✅ |
| **Place order** | POST /api/v1/spot/order | POST /spot/order | ✅ |
| **Cancel order** | POST /api/v1/spot/orders/:orderId/cancel | POST /spot/orders/:orderId/cancel | ✅ |
| **Cancel all** | POST /api/v1/spot/orders/cancel-all | POST /spot/orders/cancel-all | ✅ |
| **Open orders** | GET /api/v1/spot/orders?status=OPEN | GET /spot/orders (status=OPEN → OPEN+PARTIALLY_FILLED+PENDING_TRIGGER) | ✅ |
| **Order history** | GET /api/v1/spot/orders?status=HISTORY | GET /spot/orders?status=HISTORY | ✅ |
| **Trade history** | GET /api/v1/spot/trade-history?page=&limit=&market= | GET /spot/trade-history | ✅ |
| **Candles** | GET /api/v1/trading/candles/:symbol?interval=... | GET /trading/candles/:symbol | ✅ (symbol must exist in trading_pairs) |
| **Balances** | GET /api/v1/wallet/balances/by-account | GET /wallet/balances/by-account | ✅ |
| **WebSocket** | /api/v1/spot/ws (token in query) | Spot WS at /spot/ws | ✅ |

**Auth:** Order, cancel, orders list, trade-history, and balances require auth. Frontend uses `api` client with Bearer token; WS uses `?token=`.

**Gap:** None for listed endpoints. Chart can return empty if symbol not in `trading_pairs` or `ohlcv_candles` empty.

---

## 3. WebSocket & Real-Time

| Channel | Subscribe | Backend push | Status |
|---------|-----------|--------------|--------|
| orderbook:SYMBOL | ✅ | orderbook_update / orderbook_snapshot | ✅ |
| ticker:SYMBOL | ✅ | ticker | ✅ |
| trades:SYMBOL | ✅ | trades | ✅ |
| user.orders | ✅ (when auth) | order_update | ✅ |
| user.trades | ✅ (when auth) | trade (user_trade) | ✅ |

Reconnect with backoff, subscribe on open, token in URL – implemented. **Gap:** No explicit “Reconnecting…” or “Disconnected” banner on the spot page (only small indicator in PairHeader).

---

## 4. UI/UX vs Binance-Grade

### 4.1 Done / Aligned

- Buy/Sell tabs, order types (Limit, Market, Stop, Stop Limit, Trailing, OCO).
- Order confirmation dialog before place.
- Limit presets (Bid, Last, Ask).
- Slippage warning for market (>0.5%).
- Spread in header (xl).
- Open Orders: Type, Filled/Qty, Cancel, Cancel All, All/Pair filter.
- Order History: Type, Trigger, Filled/Qty, Export CSV.
- Trade History: Fee, Time, Export CSV.
- Sign-in CTA when guest.
- Favorites (localStorage), sorted markets.
- Chart intervals, MA overlay, depth chart toggle.
- Responsive touch targets (min heights), theme-aware loading.

### 4.2 Gaps / Not Binance-Grade

| # | Area | Gap |
|---|------|-----|
| 1 | **Chart** | No error state when candle fetch fails (useChartAdapter swallows errors). User sees empty chart with no message. |
| 2 | **Chart** | No loading skeleton for chart; only empty area until candles load. |
| 3 | **Orderbook** | No “Orderbook empty” or “No liquidity” message when bids/asks empty. |
| 4 | **PairHeader** | 24H High/Low/Vol/Spread/Bid·Ask hidden on small screens (lg/xl). Mobile users get only Last + 24H Change. |
| 5 | **Tables** | No column resize or horizontal scroll hint when many columns on small screens. |
| 6 | **Order entry** | No “Estimated value” in quote asset for limit orders (only “Order Value” total). Binance shows both. |
| 7 | **Order entry** | Trailing stop: no min/max hint (0.1–100%) in input placeholder or validation message. |
| 8 | **Markets** | No search/filter in pair selector; only dropdown. No “Recent” or “Gainers/Losers” quick filters. |
| 9 | **Orders** | Open order rows don’t show “OCO” badge when order is part of OCO (backend doesn’t return oco_group_id in list). |
| 10 | **Price depth** | Orderbook depth bars good; no “Total” row (sum of bids/asks) like Binance. |
| 11 | **Errors** | submitError shown in a bar; no inline per-field validation (e.g. “Price must be &gt; 0”). |
| 12 | **KYC / Limits** | No spot-tier or withdrawal-limit indicator on spot page. |

---

## 5. Wrong / Inconsistent

| # | Item | Detail |
|---|------|--------|
| 1 | **Candles symbol** | Chart uses spot symbol (e.g. BTC_USDT). Backend candles use `trading_pairs.symbol`. If only `spot_markets` is seeded and not `trading_pairs`, chart stays empty with no error. |
| 2 | **Wallet by-account** | Backend returns `trading` per currency; frontend expects `row.trading` for “trading” account. Naming matches. (No bug; confirmed.) |

---

## 6. Functionality Checklist (Fully Connected?)

| Flow | Connected? | Notes |
|------|------------|--------|
| Load spot page | ✅ | Fetches markets, sets symbol from URL. |
| Select pair | ✅ | Orderbook + ticker REST + WS subscribe. |
| Show balance | ✅ | useBalancesByAccount → wallet/balances/by-account; shows trading balance for selected base/quote. |
| Place limit/market order | ✅ | POST /spot/order; balance lock; matching; WS order_update. |
| Place stop / OCO | ✅ | Backend supports; OCO = two orders with oco_group_id. |
| Cancel single | ✅ | POST /spot/orders/:id/cancel; WS order_update. |
| Cancel all | ✅ | POST /spot/orders/cancel-all. |
| Open orders list | ✅ | GET /spot/orders?status=OPEN; refetch on ordersVersion. |
| Order history | ✅ | GET /spot/orders?status=HISTORY. |
| Trade history | ✅ | GET /spot/trade-history; fee + time shown. |
| Chart candles | ⚠️ | GET /trading/candles/:symbol; works only if symbol in trading_pairs and ohlcv_candles populated. |
| Real-time orderbook/ticker/trades | ✅ | WS; throttle on orderbook updates. |

**Verdict:** Spot page is **functionally connected** to backend and DB for trading, orders, and balances. Chart is **conditionally connected** (depends on trading_pairs + ohlcv_candles).

---

## 7. What to Do Next (Priority)

### Must-fix

1. **Chart error state**  
   In `useChartAdapter` (or chart layer), surface fetch failure (e.g. state or callback) and in ChartPanel show “Chart unavailable” + Retry when candles fail.

2. **trading_pairs + candles**  
   Ensure for every active spot market symbol there is a `trading_pairs` row with same symbol and `trading_enabled = TRUE`. Run candle aggregation (or load-historical-candles) so `ohlcv_candles` has data for chart.

### Should-have (Binance-grade)

3. Chart loading skeleton.  
4. Orderbook empty state message.  
5. PairHeader: show at least Last + Change on mobile; optional compact 24h/Spread.
6. Order entry: trailing stop 0.1–100% validation + placeholder.
7. Markets: search or filter in pair selector.

### Nice-to-have

8. OCO badge in open orders (needs backend to return oco_group_id in GET /spot/orders).
9. Orderbook total row (sum bids / sum asks).
10. Spot tier / limit indicator on page.

---

## 8. Summary

- **Backend–DB:** Connected; chart depends on trading_pairs + ohlcv_candles.
- **Frontend–Backend:** All spot and wallet APIs and WS are correctly used.
- **UI/UX:** Core flows and tables are Binance-like; main gaps are chart error/loading, balance % slider bug, and mobile/empty states.
- **Fully functional:** Yes for trading, orders, and balances; chart data/error handling and trading_pairs alignment to be fixed for a solid Binance-grade spot page.
