# Coins & Blockchains — Source of Truth (User vs Admin)

## Summary

| Panel | API | DB tables | Purpose |
|-------|-----|-----------|---------|
| **User** (deposit/withdraw) | `/api/v1/wallet/chains`, `/api/v1/wallet/tokens`, `/api/v1/wallet/tokens/:symbol/chains` | **chains** + **tokens** | Coin list, chain list, chains per token |
| **Admin** (Settings → Blockchain / Currencies) | `/api/v1/admin/settings/blockchains`, `/api/v1/admin/settings/currencies` | **blockchains** + **currencies** | Blockchain and currency CRUD |

So:

- **User panel coin list** = exactly what is in **chains** and **tokens** (RPC etc. in `chains`, coins in `tokens`).
- **Admin blockchain/currency pages** = what is in **blockchains** and **currencies**.

If you only ever populated **chains** and **tokens** (e.g. via migrate + your RPC/coin inserts), then:

- User panel will show coins/chains correctly.
- Admin “Blockchain” and “Currencies” settings may be empty or error if **blockchains** / **currencies** tables are missing or not filled.

## Trade engine (spot) — what it uses

- **Markets:** `spot_markets` (symbol, base_asset, quote_asset, base_currency_id, quote_currency_id, fees, etc.).
- **Orders / trades:** `spot_orders`, `spot_trades`.
- **User-facing spot API:** `/api/v1/spot/*` reads/writes `spot_markets`, `spot_orders`, `spot_trades`.
- Migrate can seed `spot_markets` only when **currencies** exists and has rows (base/quote currency IDs). So either:
  - You have **currencies** (from backfill or full-schema) and spot_markets get seeded, or
  - You add `spot_markets` rows manually with valid base_currency_id / quote_currency_id (from **currencies** or from **tokens** if spot_markets references tokens).

So:

- **User panel coins** = **chains** + **tokens**.
- **Admin blockchain/currencies** = **blockchains** + **currencies** (can be different from chains/tokens).
- **Spot trade engine** = **spot_markets** + **spot_orders** + **spot_trades**; spot_markets typically ties to **currencies** (or tokens) for base/quote.

## Making admin show the same as user panel

To have admin show the same chains/coins as the user panel when you only use **chains** + **tokens**:

1. **Option A:** Add/admin API that returns chains and tokens (from **chains** / **tokens**) in a shape admin UI can use (or a dedicated “Chains & Tokens (wallet)” admin page).
2. **Option B:** Keep using **blockchains** + **currencies** in admin but sync from **chains** + **tokens** (e.g. job or migration that fills blockchains/currencies from chains/tokens).
3. **Option C:** Change admin Settings → Blockchain/Currencies to read from **chains** + **tokens** when **blockchains** is empty or missing (fallback).

Implementation in the codebase uses Option C fallback so admin can see the same list when only chains/tokens exist.

---

## Trade engine (spot) — kya missing hai

**Backend:** Trade engine **complete** hai — `spot.fastify` me place order, cancel, orderbook, ticker, trades, WebSocket sab hai. Tables: `spot_markets`, `spot_orders`, `spot_trades`. Markets list GET `/api/v1/spot/markets` se aati hai.

**Agar markets nahi dikh rahe:** `spot_markets` me rows honi chahiye. Migrate BTC_USDT / ETH_USDT tabhi insert karta hai jab **currencies** table me BTC/USDT rows hon. Agar aapne sirf **chains** + **tokens** bhare hain to **currencies** backfill (migrate) se tokens se aa sakti hai; uske baad spot_markets seed ho sakta hai, ya manually `spot_markets` me rows add karo (symbol, base_asset, quote_asset, base_currency_id, quote_currency_id — currency IDs **currencies** ya **tokens** ke IDs se).

**UI:** User spot page (`/dashboard/spot`) markets ko GET `/api/v1/spot/markets` se leta hai. Agar response empty hai to dropdown empty dikhega. Chart candles GET `/api/v1/trading/candles/:symbol` se aate hain (backend me `ohlcv_candles` table chahiye); agar OHLCV nahi bhara to chart empty dikh sakta hai — **sirf UI/data missing**, engine khud missing nahi hai.
