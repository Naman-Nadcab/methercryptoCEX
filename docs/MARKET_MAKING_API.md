# Market Making API Guide

**Purpose:** Enable trading bots and market makers to place/cancel orders via API keys without JWT session.

---

## 1. API Key Setup

1. **Create API key:** Dashboard → API → Create Key → choose **API Transaction** (read_write).
2. **Store securely:** The secret is shown once; copy it before closing.
3. **Headers:** Send `X-API-Key: <your_api_key>` or `X-MBX-APIKEY: <your_api_key>` on each request.

---

## 2. Authentication

Spot trading routes accept **either**:

- **Bearer JWT:** `Authorization: Bearer <access_token>`
- **API Key:** `X-API-Key: <api_key>` or `X-MBX-APIKEY: <api_key>`

For HMAC-signed requests (optional, for higher security):

- `X-TIMESTAMP`: Unix timestamp (seconds)
- `X-SIGNATURE`: HMAC-SHA256 of request body using `api_secret` (if key was created with secret)

---

## 3. Permissions and Scopes

| Permission | Place Order | Cancel | Withdraw | Get Orders/Trades/Balances |
|------------|-------------|--------|----------|---------------------------|
| `read_write` | ✅ | ✅ | ✅* | ✅ |
| `read_only` | ❌ | ❌ | ❌ | ✅ |

\* Withdrawal is blocked if the API key has scope **no_withdraw** (or `withdraw: false` in permissions). When creating a key you can set `permissions: { no_withdraw: true }` to disallow withdrawals; such keys return `403 API_KEY_NO_WITHDRAW` on POST `/withdrawals`.

---

## 4. Spot Endpoints (Market Making)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/spot/order` | API Key or JWT | Place limit/market order |
| POST | `/api/v1/spot/orders/cancel` | API Key or JWT | Cancel single order |
| POST | `/api/v1/spot/orders/cancel-all` | API Key or JWT | Cancel all open orders |
| GET | `/api/v1/spot/orders` | API Key or JWT | List open/history orders |
| GET | `/api/v1/spot/trade-history` | API Key or JWT | Trade history |
| GET | `/api/v1/spot/orderbook/:symbol` | Public | Orderbook (no auth) |
| GET | `/api/v1/spot/tickers` | Public | Tickers (no auth) |

---

## 5. Rate Limits

- Place order: 30 per 60 seconds per user
- Cancel: 60 per 60 seconds per user
- Orders list: 30 per 60 seconds per user

---

## 6. Example: Place Order with API Key

```bash
curl -X POST "http://localhost:4000/api/v1/spot/order" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "market": "BTC_USDT",
    "side": "buy",
    "type": "limit",
    "price": "50000",
    "quantity": "0.01",
    "timeInForce": "gtc",
    "clientOrderId": "mm-001"
  }'
```

---

## 7. WebSocket (Spot)

WebSocket `/ws` accepts JWT in `?token=...` query param. For API-key–based bots, obtain a short-lived JWT via login or a dedicated token endpoint if available, then pass it to WS. Alternatively, poll REST for orderbook/trades if real-time WS with API key is not required.

---

## 8. Idempotency

Use `clientOrderId` when placing orders. If the same `clientOrderId` is sent again, the server returns the existing order instead of creating a duplicate.
