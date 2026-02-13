# Phase-4: Spot Trading Hardening — Completion Doc

## A) WebSocket architecture & events

- **Endpoint:** `GET /api/v1/spot/ws?token=<JWT>` (optional token for user channels).
- **Auth:** Query param `token` with user JWT. If present and valid, `userId` is attached to the connection for `user.orders` / `user.trades`.
- **Channels:**
  - **Public (read-only):**
    - `orderbook:{SYMBOL}` — L2 order book (snapshot on subscribe, then `orderbook_update` on changes).
    - `trades:{SYMBOL}` — Recent trades feed (snapshot on subscribe, then `trades` on new trades).
    - `ticker:{SYMBOL}` — Last price, bid, ask (snapshot on subscribe, then `ticker` on updates).
  - **User (auth required):**
    - `user.orders` — Real-time order updates (place, fill, cancel).
    - `user.trades` — Real-time trade confirmations.
- **Client messages:** `{ type: "ping" }`, `{ type: "subscribe", channel: "orderbook:BTC_USDT" }`, `{ type: "unsubscribe", channel: "..." }`.
- **Server messages:** `pong`, `subscribed` / `unsubscribed`, `orderbook_snapshot` / `orderbook_update`, `trades`, `ticker`, `order_update`, `trade` (user), plus `error` when e.g. auth required for user channel.
- **Reconnect:** Client should reconnect on close, resend `subscribe` for desired channels; server sends snapshot for orderbook/ticker/trades on each subscribe.

---

## B) Backend changes (files + handlers)

| Area | File | Change |
|------|------|--------|
| DB | `apps/backend/src/database/migrate.ts` | Add `maker_fee`, `taker_fee` to `spot_markets` (default 0.001). |
| Cache | `apps/backend/src/services/spot-orderbook-cache.service.ts` | Redis cache for L2 order book; `getCachedOrderbook`, `getOrderbookFromDb`, `setOrderbookCache`, `refreshOrderbookCache`, `invalidateOrderbookCache`. |
| WS | `apps/backend/src/services/spot-ws.service.ts` | In-memory connection/subscription map; `broadcast(channel, type, data)`, `sendToUser(userId, channel, type, data)`. |
| Metrics | `apps/backend/src/services/spot-metrics.service.ts` | `recordOrder()`, `recordTrade()`, `recordOrderLatencyMs()`, `getSpotMetrics()` (orders/trades per minute, latency p50/p99). |
| Spot routes | `apps/backend/src/routes/spot.fastify.ts` | Orderbook reads from cache (miss → DB + set cache); POST order uses per-market maker/taker fee in matching; MARKET_PAUSED for maintenance; `pushSpotUpdates` invalidates cache, refreshes, broadcasts orderbook/ticker/trades and user order/trade; circuit breaker (INCR key, auto set status maintenance if ≥5); GET /orderbook uses cache; GET /ticker includes status, volume_24h, high_24h, low_24h; POST /orders/cancel-all; GET /metrics; WebSocket handler with subscribe/unsubscribe and snapshot for orderbook/ticker/trades. |
| Admin spot | `apps/backend/src/routes/admin-spot.fastify.ts` | GET /admin/spot/markets, PATCH /admin/spot/markets/:symbol (status, min_qty, min_notional, maker_fee, taker_fee); on status=active clear circuit key. |
| Server | `apps/backend/src/server.ts` | Register admin-spot routes; 5s interval to refresh orderbook cache for all active/maintenance markets. |
| Redis | `apps/backend/src/lib/redis.ts` | `incr(key)` for circuit breaker. |

---

## C) Redis caching strategy

- **Key:** `spot:orderbook:{SYMBOL}` — JSON snapshot `{ symbol, bids, asks, lastUpdateId }`.
- **TTL:** 10 seconds (refresh on read miss and on periodic job).
- **Writes:** On order place/cancel, `invalidateOrderbookCache(symbol)` then `refreshOrderbookCache(symbol)` (rebuild from DB). Order placement is not blocked by reads; reads use cache or DB.
- **Periodic:** Every 5s, server calls `refreshOrderbookCache(symbol)` for each market with status `active` or `maintenance` so cache stays warm.
- **Circuit breaker:** `spot:circuit:{SYMBOL}` — INCR on generic order failure; EXPIRE 3600s; if count ≥ 5, set `spot_markets.status = 'maintenance'` for that symbol. Admin PATCH to `active` clears the key.

---

## D) Admin APIs & UI components

**APIs (admin auth required):**

- `GET /api/v1/admin/spot/markets` — List all spot markets (symbol, status, min_qty, min_notional, maker_fee, taker_fee, etc.).
- `PATCH /api/v1/admin/spot/markets/:symbol` — Body: `{ status?, min_qty?, min_notional?, maker_fee?, taker_fee? }`. Status: `active` | `disabled` | `maintenance`. Clearing maintenance (setting active) also deletes `spot:circuit:{symbol}`.

**Admin UI:**

- **Page:** `apps/frontend/src/app/admin/(protected)/trading/spot-markets/page.tsx`.
- **Route:** `/admin/trading/spot-markets` (linked in sidebar under Spot Trading → Spot Markets).
- **Behavior:** Table of markets (symbol, status, min qty, min notional, maker/taker fee); Edit opens modal (status, min_qty, min_notional, maker_fee, taker_fee); Pause/Resume toggles status between `active` and `maintenance`.

---

## E) UX/UI component list & behavior

- **Trading page** (`apps/frontend/src/app/dashboard/trade/page.tsx`):
  - **Real-time:** WebSocket hook `useSpotWs`; subscribe to `orderbook:{symbol}`, `trades:{symbol}`, `ticker:{symbol}`, `user.orders`, `user.trades`. Order book, recent trades, and ticker update from WS; “Live” indicator when connected.
  - **Order book:** Depth bars (width by level size); bids/asks from WS or REST.
  - **Recent trades:** Feed from WS `trades` updates.
  - **24h stats:** Last, 24h volume, 24h high, 24h low from ticker (REST + WS).
  - **Fees:** Maker/Taker % from market; est. fee uses maker for limit, taker for market.
  - **Market paused:** Banner when `ticker.status === 'maintenance'`; place order disabled; button shows “Trading paused”.
  - **Open orders:** Cancel per order; “Cancel all” (per market) calling POST /spot/orders/cancel-all; partial fill progress bar; row highlight for filled/partially filled; instant removal/update via `order_update` WS.
  - **Trade history:** Refreshed on `user_trade` WS.
  - **Errors:** Only human-readable messages (e.g. `getMessageFromApiError`); MARKET_PAUSED mapped to “Trading is temporarily paused for this market.”
- **Error map:** `apps/frontend/src/lib/errorMessages.ts` — `MARKET_PAUSED` and other codes mapped to user-facing text.

---

## F) Example WebSocket messages

**Client → Server:**

```json
{ "type": "ping" }
{ "type": "subscribe", "channel": "orderbook:BTC_USDT" }
{ "type": "subscribe", "channel": "trades:BTC_USDT" }
{ "type": "subscribe", "channel": "ticker:BTC_USDT" }
{ "type": "subscribe", "channel": "user.orders" }
{ "type": "subscribe", "channel": "user.trades" }
{ "type": "unsubscribe", "channel": "orderbook:BTC_USDT" }
```

**Server → Client:**

```json
{ "type": "pong", "timestamp": 1234567890123 }
{ "type": "subscribed", "channel": "orderbook:BTC_USDT", "timestamp": 1234567890123 }
{ "type": "orderbook_snapshot", "channel": "orderbook:BTC_USDT", "data": { "symbol": "BTC_USDT", "bids": [["50000", "1.2"], ...], "asks": [["50001", "0.5"], ...], "lastUpdateId": 1 }, "timestamp": 1234567890123 }
{ "type": "orderbook_update", "channel": "orderbook:BTC_USDT", "data": { "symbol": "BTC_USDT", "bids": [...], "asks": [...] }, "timestamp": 1234567890123 }
{ "type": "trades", "channel": "trades:BTC_USDT", "data": [{ "id": "...", "market": "BTC_USDT", "side": "buy", "price": "50000", "quantity": "0.1", "created_at": "..." }], "timestamp": 1234567890123 }
{ "type": "ticker", "channel": "ticker:BTC_USDT", "data": { "symbol": "BTC_USDT", "last_price": "50000", "bid": "49999", "ask": "50001" }, "timestamp": 1234567890123 }
{ "type": "order_update", "channel": "user.orders", "data": { "id": "...", "status": "FILLED", "displayStatus": "Filled", "market": "BTC_USDT" }, "timestamp": 1234567890123 }
{ "type": "trade", "channel": "user.trades", "data": [{ "id": "...", "order_id": "...", "market": "BTC_USDT", "side": "buy", "price": "50000", "quantity": "0.1", "fee": "5", "fee_asset": "USDT", "created_at": "..." }], "timestamp": 1234567890123 }
{ "type": "error", "data": { "message": "Access denied or auth required" }, "timestamp": 1234567890123 }
```

---

## G) Final Phase-4 completion checklist

- [x] **Real-time data (WebSockets):** orderbook.{symbol}, trades.{symbol}, ticker.{symbol}, user.orders, user.trades; auth for user channels; snapshot on subscribe; graceful reconnect (client resubscribes).
- [x] **Order book performance:** Redis cache for top N levels; periodic (5s) rebuild from DB; order placement not blocked by reads; DB-based matching unchanged.
- [x] **Fee engine:** maker_fee / taker_fee per market; fees in settlement; visibility in order preview, trade history, ledger.
- [x] **Admin controls:** Enable/disable/pause markets; update min_qty, min_notional, maker_fee, taker_fee; Admin UI: market list, edit modal, trading status toggle.
- [x] **UX/UI hardening:** Real-time order book and trade feed; live price; depth bars; filled/partial order highlight; partial fill progress bar; cancel-all per market; maker/taker fee and 24h stats; human-readable errors only; market paused handling.
- [x] **Safety & observability:** Structured logs (order placement, cancel, circuit breaker); metrics (orders/min, trades/min, orders/sec, trades/sec, order latency p50/p99) via GET /spot/metrics; circuit breaker auto-pause on repeated failures.
- [x] **No Phase-5 scope:** No P2P, margin, or fiat; deposit/withdrawal/wallet logic unchanged; spot APIs backward compatible.

Phase-4 is **complete** when the above are implemented and verified. Do not move to Phase-5 until Spot Trading Hardening UX/UI is complete.
