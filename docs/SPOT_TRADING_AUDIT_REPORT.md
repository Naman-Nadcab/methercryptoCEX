# Spot Trading Page — Backend Alignment Audit Report

**Scope:** Audit and verify the Spot trading page against the existing backend (no redesign, no new APIs, backend is source of truth).  
**Date:** 2026-02-27

---

## 1. Confirmed Working Components

### 1.1 Backend API Integration

| Area | Status | Notes |
|------|--------|--------|
| **Place order** | ✅ | `POST /api/v1/spot/order` — body: `market`, `side`, `type`, `quantity`, `price?`, `stop_price?`, `trailing_delta?`, `time_in_force?`, `client_order_id?`. Response: `{ success, data: { id, market, side, type, price, quantity, filled_quantity, status, created_at, client_order_id? } }`. Frontend sends correct fields and handles success/error. |
| **Cancel order** | ✅ | `POST /api/v1/spot/orders/:orderId/cancel` — frontend uses correct path and removes order from open list on success. |
| **Open orders** | ✅ | `GET /api/v1/spot/orders?status=OPEN&limit=50` — backend returns `{ success, data: { orders, next_cursor } }`. Frontend uses `res.data.orders` and filters by symbol. |
| **Order history** | ✅ | `GET /api/v1/spot/orders?status=HISTORY&limit=30&cursor=?` — cursor format `timestamp|id` matches backend. Frontend uses `res.data.orders` and `res.data.next_cursor`. |
| **Trade history** | ✅ | `GET /api/v1/spot/trade-history?page=&limit=&market=` — backend returns `{ success, data: rows, pagination }`. Frontend uses `res.data` as array. |
| **Wallet balances** | ✅ | Spot uses `useBalancesByAccount` → `GET /api/v1/wallet/balances/by-account`. Response: `{ symbol, name, funding, trading, total }`. Frontend uses `row.trading` for order entry; backend spot uses trading balance for lock/debit. |
| **Market list** | ✅ | `GET /api/v1/spot/markets` — returns markets with `min_qty`, `min_notional`, `price_precision`, `qty_precision`, `maker_fee`, `taker_fee`. Frontend uses for precision and fees. |
| **Ticker (REST)** | ✅ | `GET /api/v1/spot/ticker/:symbol` — returns `last_price`, `bid`, `ask`, `volume_24h`, `high_24h`, `low_24h`. Frontend uses for header and chart. |
| **Orderbook (REST)** | ✅ | `GET /api/v1/spot/orderbook/:symbol?limit=20` — returns `{ bids, asks }`. Frontend loads snapshot on symbol change. |
| **Candles** | ✅ | `GET /api/v1/trading/candles/:symbol?interval=&from=&to=&cursor=&limit=&direction=` — frontend uses all params; backend supports them and returns `time`, `open`, `high`, `low`, `close`, `volume`. Chart uses cursor pagination for ~6 months. |

### 1.2 WebSocket

| Stream | Status | Notes |
|--------|--------|--------|
| **Orderbook** | ✅ | Subscribe `orderbook:SYMBOL` → backend sends `orderbook_snapshot` on subscribe, then `orderbook_update` (full snapshot) after trades. Frontend replaces state with snapshot; no local orderbook construction. |
| **Ticker** | ✅ | Subscribe `ticker:SYMBOL` → backend sends `ticker` with `symbol`, `last_price`, `bid`, `ask`. Frontend updates ticker state. |
| **Trades** | ✅ | Subscribe `trades:SYMBOL` → backend sends `trades` (array). Frontend updates recent trades list. |
| **user.orders** | ✅ | Backend sends `order_update` to user after place/fill/cancel. Auth required; frontend subscribes when `isAuth`. |
| **user.trades** | ✅ | Backend sends `trade` (user trade) after execution. Frontend subscribes when `isAuth`. |

### 1.3 Trading Lifecycle

- **Place order:** User submits → backend validates (market, side, type, min_qty, min_notional, balance) → order enters orderbook / executes → `pushSpotUpdates` invalidates orderbook cache, refreshes snapshot, broadcasts orderbook + ticker + trades, sends `user.orders` + `user.trades` to user. Frontend increments `ordersVersion`, invalidates balances, refetches open orders via effect.
- **Cancel:** Frontend calls cancel API → backend updates status and unlocks balance → frontend removes order from open list and refetches balances.
- **Orderbook / ticker / trades:** Updated via REST snapshot on symbol change and via WebSocket (snapshot + full updates). No incremental orderbook built on frontend; all data from backend.

### 1.4 Chart Pipeline

- Candles: `getChartCandles` uses `interval`, `from`, `to`, `cursor`, `limit`, `direction`. Backend returns OHLCV; frontend normalizes and uses `prependCandles` for backfill. Chart has volume series; live price/trade updates applied via adapter. No fabricated price data.

### 1.5 Orderbook UI

- Bids/asks from backend; bids shown descending, asks ascending (with one reversed for display). Spread from best bid/ask; depth bars from quantities. No local construction.

### 1.6 Order Entry

- Order types: Limit, Market, Stop, Stop Limit, Trailing Stop — all sent with correct `type` and optional `stop_price` / `trailing_delta`. Time-in-force sent (GTC/IOC/FOK). Price/quantity from inputs; client_order_id generated. Balance shown from `useBalancesByAccount` (trading).

### 1.7 Bottom Panel

- Open Orders / Order History / Trade History / Assets tabs. Cancel works; order history has cursor load-more; tables sort by column. Data from REST; refetch on tab/symbol/ordersVersion.

---

## 2. Backend Integration Mismatches

### 2.1 Trade message field: `time` vs `created_at`

- **Backend:** WS `trades` and REST trade-history rows use `created_at` (and DB columns like `order_id`, `fee`, `fee_asset`).
- **Frontend:** `TradeMessage` / `RecentTradeRow` use `time` for display. Orderbook “Trades” tab renders `t.time`. If backend only sends `created_at`, `t.time` is undefined and UI shows "—".
- **Fix:** Normalize WS and REST trade rows to a single shape in the frontend: either map `created_at` → `time` when receiving, or use `created_at` in the UI (e.g. `t.created_at ?? t.time`).

### 2.2 WS Ticker overwrites 24h stats

- **Backend:** On subscribe to `ticker:SYMBOL`, WS sends only `{ symbol, last_price, bid, ask }` (no `volume_24h`, `high_24h`, `low_24h`).
- **Frontend:** Initial ticker comes from REST and has 24h stats. When a WS `ticker` message arrives, it replaces the whole ticker state, so 24h stats are lost until next REST fetch (e.g. on symbol change).
- **Fix:** Merge WS ticker into existing ticker: update only `last_price`, `bid`, `ask` from WS and keep existing `volume_24h`, `high_24h`, `low_24h` (or re-fetch ticker REST when 24h stats are missing).

### 2.3 user.orders / user.trades not applied in real time

- **Backend:** Sends `order_update` and `trade` on user channel after place/fill/cancel.
- **Frontend:** Subscribes to `user.orders` and `user.trades` but does not pass `onOrderUpdate` / `onTradeUpdate` from `SpotTradingGrid` into `useSpotWs`. Open orders and trade history only refresh on refetch (place/cancel, tab switch, ordersVersion).
- **Fix:** Pass `onOrderUpdate` and `onTradeUpdate` from the grid into `useSpotWs`, and in those callbacks update open-orders list (add/update/remove by id) and prepend or update trade history so the bottom panel reflects fills and cancels without a full refetch.

### 2.4 Candles symbol: spot_markets vs trading_pairs

- **Backend:** Spot routes use `spot_markets.symbol`; candle API uses `trading_pairs.symbol` and `ohlcv_candles`.
- **Risk:** If a market exists only in `spot_markets` and not in `trading_pairs`, or symbols differ, chart will get empty candles. No code bug found; ensure symbol alignment (e.g. same symbol string) between spot_markets and trading_pairs for all listed spot markets.

---

## 3. Missing Trading Behaviors

### 3.1 Frontend validation for min order size and min notional

- **Backend:** Enforces `min_qty` and `min_notional` on place order; returns `MIN_QTY` / `MIN_NOTIONAL` with message.
- **Frontend:** Order entry does not validate `min_qty` or `min_notional` before submit. User can submit and only then see backend error.
- **Recommendation:** In `SpotTradingGrid` (or order entry), before allowing submit: compare quantity to `selectedMarket.min_qty` and notional (price × quantity) to `selectedMarket.min_notional`, and show inline error or disable submit with tooltip (e.g. “Min quantity 0.001”, “Min notional 10 USDT”). Use same decimals as backend (market’s `qty_precision` / `price_precision`).

### 3.2 Trade history pagination in UI

- **Backend:** Supports `page` and `limit`; response includes `pagination: { page, limit, total, totalPages }`.
- **Frontend:** `fetchTrades(page)` exists but only page 1 is requested when opening the tab; no “Load more” or page controls.
- **Recommendation:** Add “Load more” or page buttons and pass `page` (or next page) into `fetchTrades`, appending to list (or replace if page 1), and optionally show total from `pagination.total`.

### 3.3 Error code handling for place order

- **Backend:** Returns specific codes: `INSUFFICIENT_BALANCE`, `INSUFFICIENT_QUOTE_BALANCE`, `INSUFFICIENT_BASE_BALANCE`, `NO_LIQUIDITY`, `FOK_NOT_FILLABLE`, `MIN_QTY`, `MIN_NOTIONAL`, `MARKET_NOT_FOUND`, `TRADING_HALTED`, `MM_EMERGENCY_STOPPED`, etc.
- **Frontend:** Uses `getMessageFromApiError(res.error)` and generic “Order failed”. Some codes may not have user-friendly messages.
- **Recommendation:** Map known error codes to short, clear messages (e.g. “Insufficient balance”, “Minimum quantity 0.001”, “Trading halted”) so users understand why the order was rejected.

---

## 4. Performance Risks

### 4.1 WebSocket: no automatic reconnect

- **Current:** `useSpotWs` effect depends on `[token]`. On `ws.onclose`, a timeout is set but it does not trigger a new connection or resubscribe.
- **Risk:** If the connection drops (network, server restart), the UI stays disconnected until the user refreshes or token changes.
- **Recommendation:** On close, set state (e.g. `setReconnectAttempt(n => n + 1)`) or use a dedicated “reconnect” trigger so the effect re-runs, opens a new WebSocket, and then resubscribes to the same channels (symbol, orderbook, ticker, trades, user.orders, user.trades) so snapshot + updates flow again without page reload.

### 4.2 Chart memory cap

- **Current:** `useChartAdapter` backfill has `HARD_CAP = 300000` candles and stops when total ≥ cap or no more data. Prevents unbounded growth.
- **Status:** Acceptable; no change required unless you need longer history with a different strategy (e.g. virtualized or windowed history).

### 4.3 Orderbook / tables under high frequency

- **Current:** Orderbook and bottom-panel tables are not virtualized. Backend sends full orderbook snapshot per update; open orders limited to 50.
- **Risk:** Under very high update rate (e.g. aggressive market making), React may re-render often. No throttling of WS messages in the hook.
- **Recommendation:** If metrics show jank, consider: (1) throttling or batching orderbook/ticker updates (e.g. max once per 100 ms), or (2) virtualizing the orderbook/trade rows if row count grows. Only if needed after measurement.

---

## 5. Recommended Fixes (Summary)

| Priority | Item | Action |
|----------|------|--------|
| **P1** | WS trade display | Normalize trade payload: use `created_at` as `time` (or render `created_at`) so “Trades” tab and chart trade markers show correct time. |
| **P1** | WS ticker 24h stats | Merge WS ticker into existing state: update only `last_price`, `bid`, `ask`; keep or refetch `volume_24h`, `high_24h`, `low_24h`. |
| **P1** | Reconnect + resubscribe | On WebSocket close, trigger reconnect (e.g. re-run effect or retry loop) and resubscribe to current channels so real-time data resumes. |
| **P2** | user.orders / user.trades | Wire `onOrderUpdate` and `onTradeUpdate` to update open orders and trade history in state so partial fills and cancels appear without refetch. |
| **P2** | Min qty / min notional | Validate in order entry using `selectedMarket.min_qty` and `min_notional`; show inline error or disable submit with message. |
| **P2** | Order error codes | Map backend error codes (e.g. INSUFFICIENT_BALANCE, MIN_QTY, TRADING_HALTED) to clear user-facing messages. |
| **P3** | Trade history load more | Use `pagination` from trade-history API and add “Load more” or pagination so users can see more than the first page. |
| **P3** | Symbol alignment | Ensure every `spot_markets.symbol` has a matching `trading_pairs.symbol` (and candles) so chart always has data for the selected market. |

---

## 6. Feature Completeness Checklist

| Feature | Status |
|---------|--------|
| Live ticker | ✅ REST + WS |
| Candlestick chart | ✅ With history and live updates |
| Depth chart | ✅ Under main chart |
| Orderbook | ✅ Snapshot + WS full updates |
| Recent trades | ✅ WS (fix `time`/`created_at` for display) |
| Order entry (Limit, Market, Stop, Stop Limit, Trailing) | ✅ |
| Open orders table | ✅ Cancel works; add WS updates for live state |
| Order history | ✅ Cursor load-more |
| Trade history | ✅ First page; add load-more optional |
| Wallet balances (trading) | ✅ By-account, refetch on place/cancel |
| Cancel order | ✅ |
| Real-time updates (orderbook, ticker, trades) | ✅ After reconnect fix |

---

**Conclusion:** The Spot page is aligned with the backend for placement, cancellation, orders, trade history, wallet, ticker, orderbook, and candles. The main gaps are: (1) normalizing trade `created_at`/`time` and preserving 24h ticker on WS updates, (2) WebSocket reconnect and resubscription, (3) using `onOrderUpdate`/`onTradeUpdate` for live open orders and trades, and (4) frontend validation for min size/notional and clearer error messages. Addressing P1 and P2 will make the Spot page behave like a professional spot terminal without changing backend APIs or redesigning the UI.
