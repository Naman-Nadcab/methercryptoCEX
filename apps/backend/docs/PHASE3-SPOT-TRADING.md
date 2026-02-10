# Phase-3: Spot Trading — Implementation Summary

## A) Database schema (migrate.ts)

- **spot_markets**: id, symbol (e.g. BTC_USDT), base_asset, quote_asset, base_currency_id, quote_currency_id, status, min_qty, min_notional, price_precision, qty_precision, created_at, updated_at.
- **spot_orders**: id, user_id (FK users), market, side (buy/sell), type (market/limit), price (nullable for market), quantity, filled_quantity, status (OPEN | PARTIALLY_FILLED | FILLED | CANCELLED | REJECTED), created_at, updated_at.
- **spot_trades**: id, order_id (FK spot_orders), user_id (FK users), market, side, price, quantity, fee, fee_asset, created_at.

Seed: BTC_USDT and ETH_USDT inserted when spot_markets exists and currencies exist.

## B) Fastify routes (file: `apps/backend/src/routes/spot.fastify.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/v1/spot/markets | No | List active spot markets |
| GET | /api/v1/spot/ticker/:symbol | No | Last price, bid, ask |
| GET | /api/v1/spot/orderbook/:symbol | No | L2 depth (bids/asks) |
| POST | /api/v1/spot/order | Yes | Place market or limit order |
| POST | /api/v1/spot/order/:id/cancel | Yes | Cancel open/partially filled order |
| GET | /api/v1/spot/open-orders | Yes | User open orders |
| GET | /api/v1/spot/order-history | Yes | User order history (paginated) |
| GET | /api/v1/spot/trade-history | Yes | User trade history (paginated) |

## C) Example request/response

**POST /api/v1/spot/order**
```json
// Request
{ "market": "BTC_USDT", "side": "buy", "type": "limit", "price": "50000", "quantity": "0.001" }

// Response 200
{
  "success": true,
  "data": {
    "id": "uuid",
    "market": "BTC_USDT",
    "side": "buy",
    "type": "limit",
    "price": "50000",
    "quantity": "0.001",
    "filled_quantity": "0",
    "status": "OPEN",
    "displayStatus": "Open",
    "created_at": "2025-02-10T12:00:00.000Z"
  }
}
```

**GET /api/v1/spot/orderbook/BTC_USDT**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC_USDT",
    "bids": [{"price": "49900", "quantity": "0.5"}, ...],
    "asks": [{"price": "50100", "quantity": "0.3"}, ...],
    "lastUpdateId": 1234567890
  }
}
```

**GET /api/v1/spot/open-orders**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "market": "BTC_USDT",
      "side": "buy",
      "type": "limit",
      "price": "50000",
      "quantity": "0.001",
      "filled_quantity": "0",
      "remaining_quantity": "0.001",
      "status": "OPEN",
      "displayStatus": "Open",
      "created_at": "2025-02-10T12:00:00.000Z"
    }
  ]
}
```

## D) Frontend pages/components

- **Page**: `apps/frontend/src/app/dashboard/trade/page.tsx`
  - Market selector (dropdown from GET /spot/markets)
  - Price chart placeholder (mock)
  - Order book (bids/asks from GET /spot/orderbook/:symbol)
  - Buy/Sell form: Market & Limit, price (limit), quantity, fee preview, balance preview, validation, submit (disabled when invalid)
  - Trading balance (from GET /wallet/balances/by-account)
  - Tabs: Open orders | Order history | Trade history (with cancel for open orders)
- **Error mapping**: `apps/frontend/src/lib/errorMessages.ts` — spot codes (INVALID_ORDER, MARKET_NOT_FOUND, INSUFFICIENT_BALANCE, NO_LIQUIDITY, etc.) mapped to user messages; UI uses `getMessageFromApiError()` and never shows raw codes.

## E) UX flow (order → trade → history)

1. User selects market (e.g. BTC_USDT), sees ticker and order book.
2. User chooses Buy/Sell, Limit or Market, enters price (if limit) and quantity. UI shows balance, min qty/notional, and estimated fee; submit is disabled if invalid.
3. On submit: POST /spot/order. Backend checks balance (trading account), market enabled, min qty/notional; locks balance; inserts order; runs simple price-time matching against open opposite orders.
4. On match: spot_trades rows created, both orders’ filled_quantity/status updated, trading balances debited/credited (and fee deducted). Trades appear in GET /spot/trade-history and in GET /wallet/ledger and GET /wallet/fund-history.
5. Open orders refresh; user can cancel (POST /spot/order/:id/cancel) only if status OPEN or PARTIALLY_FILLED. Cancel unlocks remaining balance.
6. Order history and trade history show filled vs remaining, status (displayStatus), and fees; no raw error codes.

## F) Phase-3 completion checklist

Phase-3 is **complete** when all of the following hold:

- [x] **Database**: spot_markets, spot_orders, spot_trades exist in migrate.ts; seed creates at least one market (e.g. BTC_USDT) when possible.
- [x] **Backend**: GET /spot/markets, /ticker/:symbol, /orderbook/:symbol return without 500; POST /spot/order validates balance, market, min qty/notional and locks trading balance; simple matching runs in same transaction; trades debit/credit trading balances and record fee; POST /spot/order/:id/cancel only for OPEN/PARTIALLY_FILLED; GET /spot/open-orders, /order-history, /trade-history return user data with displayStatus.
- [x] **Order states**: OPEN, PARTIALLY_FILLED, FILLED, CANCELLED, REJECTED mapped to displayStatus (Open, Partially Filled, Filled, Cancelled, Rejected).
- [x] **Ledger**: Spot trades appear in GET /wallet/ledger (type spot_trade) and in GET /wallet/fund-history with fee and reference_id (order_id).
- [x] **UX/UI**: Trading page has market selector, order book, buy/sell form (market/limit, fee preview, balance preview, validation), open orders with cancel, order history, trade history; trading balance visible; errors shown via error map only.
- [x] **Safety**: No changes to deposit, withdrawal, or balance-locking outside spot; no P2P/escrow; spot uses existing trading balances only; atomic DB transactions for place and cancel.

**Definition of done**: A user can place a spot order, see it fill (or stay open), see balance update, see the trade in history and in ledger/fund-history, and understand fees and status. No Phase-4 (P2P, etc.) until this is verified.
