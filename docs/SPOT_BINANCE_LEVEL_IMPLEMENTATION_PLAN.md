# Spot Page — Binance-Level Features — Implementation Plan

**Scope:** Spot + P2P exchange only. No futures/margin.

---

## 1. USER-SIDE — Existing (Already Have)

| # | Feature | Status |
|---|---------|--------|
| 1 | Pair selector + search | ✅ |
| 2 | Chart (candlestick, depth), intervals 1m–1M | ✅ |
| 3 | Order book + Recent Trades | ✅ |
| 4 | Order types: Limit, Market, Stop, Stop Limit, Trailing Stop | ✅ |
| 5 | Time in force: GTC, IOC, FOK | ✅ |
| 6 | Balance slider (25%, 50%, 75%, 100%) | ✅ |
| 7 | Open Orders, Order History, Trade History, Assets | ✅ |
| 8 | Per-order Cancel | ✅ |
| 9 | Hide small balances (Assets) | ✅ |
| 10 | WebSocket: orderbook, ticker, trades, user orders | ✅ |
| 11 | Fee display, Est. fee, Net received | ✅ |
| 12 | Link: Deposit, Transfer, Convert | ✅ |
| 13 | 24H stats: Last, Change, High, Low, Vol, Turnover | ✅ |
| 14 | Orderbook click → fill price/qty | ✅ |

---

## 2. USER-SIDE — To Add (Backend Already Supports)

| # | Feature | Backend | Implementation |
|---|---------|---------|----------------|
| 1 | **Cancel All Orders** (current market) | POST /spot/orders/cancel-all { market } | Add "Cancel All" button in Open Orders tab when symbol set and open orders exist |
| 2 | **Refresh** button | Same GET endpoints | Add Refresh icon in Open Orders, Order History, Trade History tabs |
| 3 | **Filter: All / Current pair** | Client filter (data already fetched) | Toggle "All" vs "Current pair" in Open Orders |
| 4 | **Quick amounts** (order form) | N/A | Ensure 25/50/75/100% visible and working (already present) |

---

## 3. USER-SIDE — Optional (No Backend Change)

| # | Feature | Notes |
|---|---------|-------|
| 1 | Favorites / Watchlist | localStorage; star on pairs, show favorites first in selector |
| 2 | Export CSV (orders/trades) | Client-side from fetched data |

---

## 4. ADMIN-SIDE — Existing (Already Have)

| # | Feature | Status |
|---|---------|--------|
| 1 | Spot Markets list + Edit (status, min_qty, min_notional, fees) | ✅ |
| 2 | Pause/Resume per market | ✅ |
| 3 | Market Control: status, fees, circuit breaker, reset | ✅ |
| 4 | Order Monitoring (filters, table) | ✅ |
| 5 | Trade History (filters, table) | ✅ |
| 6 | Circuit Breakers | ✅ |
| 7 | Fee Management (maker/taker per pair) | ✅ |
| 8 | Global trading halt (GET/POST /admin/trading-halt) | ✅ |

---

## 5. ADMIN-SIDE — To Add (UI Improvements)

| # | Feature | Notes |
|---|---------|-------|
| 1 | **Cancel All** for user (per market) | Backend: POST /spot/orders/cancel-all — admin would need separate endpoint (admin force-cancel). Skip if no backend. |
| 2 | **Refresh** button in Order/Trade tables | Add manual refresh |
| 3 | **Market filter** in Order Monitoring | Already may have; ensure clear |
| 4 | **Export CSV** (orders, trades) | Client-side from fetched data |

---

## 6. Backend APIs (Spot) — Reference

- `GET /api/v1/spot/markets`
- `GET /api/v1/spot/ticker/:symbol`
- `GET /api/v1/spot/orderbook/:symbol`
- `POST /api/v1/spot/order` (market, limit, stop_loss, stop_limit, trailing_stop_market)
- `POST /api/v1/spot/orders/:id/cancel`
- `POST /api/v1/spot/orders/cancel-all` { market }
- `GET /api/v1/spot/orders?status=OPEN|HISTORY&limit=&cursor=`
- `GET /api/v1/spot/trade-history?market=&page=&limit=`
- `GET /api/v1/trading/candles/:symbol?interval=&from=&to=&limit=&direction=`

---

## 7. Implementation Order (Point-wise) — DONE

1. ✅ **User: Cancel All** — useSpotBottomPanel.handleCancelAll + SpotBottomPanel "Cancel All" button (current market)
2. ✅ **User: Refresh** — Refresh icon in bottom panel; calls fetchOpen/fetchOrderHistory/fetchTrades based on active tab
3. ✅ **User: Filter All/Current pair** — "All" / "Pair" toggle in Open Orders tab
4. ✅ **Admin: Refresh** — Refresh button on Spot Markets page (Orders & Trade History already had Refresh)
5. ✅ **User: Favorites** — useSpotFavorites (localStorage) + star icon in PairHeader; favorites shown first in pair dropdown
