# Spot API: REST vs WebSocket consistency

This document is the contract checklist for **public spot market data** and **ticker fields**. It exists to prevent silent regressions (wrong types, invented defaults, or divergent semantics between REST and WS).

## Ticker: REST

| Field | Type (JSON) | Notes |
|-------|-------------|--------|
| `symbol` | string | e.g. `BTC_USDT` |
| `base_asset` | string | |
| `quote_asset` | string | |
| `last_price` | string \| null | Decimal string; `null` when unknown |
| `open_24h` | string \| null | First trade price in 24h window |
| `high_24h` | string \| null | `null` when no range (often coalesced from `'0'`) |
| `low_24h` | string \| null | same |
| `volume_24h` | string | Quote volume |
| `base_volume_24h` | string | Base volume |
| `change_pct` | number \| null | Official 24h % vs `open_24h`; **`null` when not computable** (missing open, bad prices) |

**Source:** `GET /api/v1/spot/tickers` and `GET /api/v1/spot/ticker/:symbol` in `apps/backend/src/routes/spot.fastify.ts` (`changePctFromOpenAndLast`).

## Ticker: WebSocket (`type: "ticker"`, channel `ticker:<SYMBOL>`)

Wire payload (inside envelope `data`):

| Field | Type (JSON) | REST equivalent |
|-------|-------------|-----------------|
| `symbol` | string | `symbol` |
| `last_price` | string \| null | `last_price` |
| `bid` | string \| null | Order book best bid (REST list endpoint may omit) |
| `ask` | string \| null | Order book best ask |
| `high_24h` | string \| null | `high_24h` |
| `low_24h` | string \| null | `low_24h` |
| `volume_24h` | string | `volume_24h` |
| `base_volume_24h` | string | `base_volume_24h` |
| `open_24h` | string \| null | `open_24h` |
| `price_change_pct_24h` | string \| null | Same **meaning** as REST `change_pct`, **string** with fixed decimals from live state |

**Source:** `apps/backend/src/services/spot-live-ws-fanout.service.ts` (uses `spot-live-market-state.service`).

## Normalization rules (frontend)

1. **`change_pct` (REST)** is authoritative as a **number or null**. Display `null` as **"—"**; display `0` as **"0.00%"**. Do not substitute `(last − low) / low` or other proxies when official change is unknown.

2. **`price_change_pct_24h` (WS)** is a **string** (or null). Parse with `parseFloat`; treat non-finite as **null** for display.

3. **`normalizeTicker` in `useSpotWs.ts`** may set `change_pct` from `price_change_pct_24h` when the numeric field is absent — that is **the same official value**, not a client-side estimate.

4. **Merging WS updates in `SpotMarketDataContext`:** use `field !== undefined` (not `??`) for `change_pct` and `price_change_pct_24h` so an explicit **`null` from the server clears** the previous value instead of preserving a stale number.

## Order updates (private WS)

Private `user.orders` frames align with REST order status enums after uppercase/normalization. REST returns string `status` and decimal quantities as **strings**; WS `order_update` payloads mirror engine/settlement shapes — compare using normalized status tokens (e.g. `FILLED`, `CANCELLED`).

## Versioning

Any new field added to REST tickers should be added to WS ticker payloads (or documented as REST-only), and vice versa for client-visible stats. Type changes (string → number) are **breaking** for web clients; prefer additive fields.

## Operational verification (alerts)

Tier-1 alert **logging** (independent of Alertmanager) is proven by:

```bash
npm run verify:tier1-alerts
```

This simulates high `indexer_state_lag_seconds` and a burst on `spot_ws_disconnects_total`, then asserts `ALERT_TRIGGERED` appears in logs. Prometheus rules live in `apps/backend/prometheus/alerts/spot-tier1.rules.yml`.
