# Chart + Spot System — Deep Audit

**Date:** 2025-02-27  
**Scope:** Chart data flow, backend APIs, DB, frontend — pura system check.

---

## 1. System Overview — Kya Hai System Mein

### Backend
- **Spot routes** (`/api/v1/spot/*`): markets, orderbook, ticker, place/cancel orders.
- **Trading routes** (`/api/v1/trading/*`): pairs, **candles** (chart), balances, orders, history, currencies.
- **Candles API:** `GET /api/v1/trading/candles/:symbol?interval=60&from=&to=&limit=&direction=`
  - Symbol: spot market symbol (e.g. `BTC_USDT`), same as `trading_pairs.symbol`.
  - Interval: seconds (60=1m, 300=5m, 900=15m, 3600=1h, 14400=4h, 86400=1d).
  - Reads from table **`ohlcv_candles`** (trading_pair_id, interval_type, open_time, OHLCV).

### Database
- **`trading_pairs`**: id, symbol (e.g. BTC_USDT), base/quote, fees, etc.
- **`ohlcv_candles`**: id, trading_pair_id, interval_type ('1m','5m','15m','30m','1h','4h','1d','1w','1M'), open_time, close_time, open_price, high_price, low_price, close_price, volume, quote_volume, trade_count.  
  **Unique:** (trading_pair_id, interval_type, open_time).

### Data Sources for Candles
1. **Historical loader script** (`apps/backend/scripts/load-historical-candles.ts`): Fetches ~6 months OHLCV from Binance public API and UPSERTs into `ohlcv_candles`. Run manually after DB is ready.
2. **Candle aggregation service** (`candle-aggregation.service.ts`): Builds candles from `spot_trades` into `ohlcv_candles`. Used when you have real trades on your exchange.

### Frontend
- **Spot page:** `SpotTradingGrid` → chart (`ChartPanel`), orderbook, trade panel, bottom panel.
- **Chart:** `useChartAdapter` → `getChartCandles(symbol, intervalSeconds)` → `GET /api/v1/trading/candles/:symbol?...` → `LightweightChartsAdapter.setCandles()`.
- **API client:** `api.get()` uses `getApiBaseUrl()` (browser: `''` → Next.js rewrite to backend).

---

## 2. Chart Data Kyu Nahi Aa Raha Tha — Root Causes

### 2.1 Table `ohlcv_candles` migrate mein nahi tha
- **Issue:** `full-schema.sql` mein table defined tha, but **`migrate.ts`** mein `ohlcv_candles` (aur `candle_interval` enum) add nahi tha.
- **Result:** Agar app sirf migrations run karke start hota, to table exist hi nahi karta. Candles API query fail → 500 ya relation does not exist.
- **Fix:** `migrate.ts` mein `candle_interval` enum aur `ohlcv_candles` table (with index) add kar diya. Ab migrate run karte hi table create ho jayega.

### 2.2 Table empty — koi rows nahi
- **Issue:** Table create ho bhi jaye, agar **koi candle insert nahi hua** (na historical loader run hua, na aggregation), to API hamesha `data: []` return karega.
- **Result:** Chart ko data milta hi nahi, chart khali dikhega.
- **Fix:** Historical candle loader run karna zaroori hai (step 4 below).

### 2.3 Frontend race — adapter null pe fetch skip
- **Issue:** `useChartAdapter` mein candle-fetch effect **adapter ref check karke** early return kar raha tha (`if (!adapter) return`). Adapter **requestAnimationFrame** se thodi der baad create hota tha, isliye pehli run pe adapter null tha aur fetch kabhi start hi nahi hota tha.
- **Result:** Backend se data aa bhi jata to chart ko set hi nahi ho pata.
- **Fix:** (1) Fetch hamesha run hota hai (adapter null hone pe bhi). (2) Result `lastCandlesRef` mein store hota hai. (3) Jab adapter create hota hai (init effect), to agar `lastCandlesRef` mein candles hain to turant `setCandles` + `fitContent` call hota hai. (4) Fetch complete hone pe `adapterRef.current?.setCandles()` bhi call hota hai taaki adapter late create ho to bhi data set ho jaye.

### 2.4 Candles API 500 → page break
- **Issue:** Candles API catch block mein 500 return kar raha tha. Agar DB/table issue hota to poora request fail, frontend error.
- **Fix:** Catch mein ab **200 + `data: []`** return karte hain, taaki chart empty dikhe, page crash na ho.

---

## 3. Kya Fix Kiya (Summary)

| Item | Fix |
|------|-----|
| **DB** | `migrate.ts` mein `candle_interval` enum + `ohlcv_candles` table + `idx_candles_query` add. |
| **Backend** | Candles API error pe 200 + `data: []` return. |
| **Frontend** | `useChartAdapter`: fetch hamesha run; `lastCandlesRef` + adapter init pe apply; fetch complete pe `adapterRef.current?.setCandles()`. |

---

## 4. Ab Aapko Kya Karna Hai (Checklist)

1. **Migrations run karo** (agar pehle run ho chuki hain to skip; new deploy pe zaroor run karo):
   ```bash
   cd apps/backend && npm run migrate
   ```
   Isse `ohlcv_candles` table (aur agar pehle nahi tha to `candle_interval` enum) create ho jayega.

2. **Historical candles load karo** (chart ke liye data bharna):
   ```bash
   cd apps/backend && npx tsx scripts/load-historical-candles.ts
   ```
   Ye script:
   - `trading_pairs` (ya `spot_markets`) se enabled symbols leta hai.
   - Har symbol + interval (1m, 5m, 15m, 1h, 4h, 1d) ke liye Binance se ~6 months data fetch karke `ohlcv_candles` mein UPSERT karta hai.
   - Rate limit + logging hai. Ek baar run karke check karo ki logs mein "Loaded X candles for SYMBOL" dikhe.

3. **Backend + frontend restart** (optional, code change ke baad):
   ```bash
   # Backend
   cd apps/backend && npm run dev
   # Frontend (alag terminal)
   cd apps/frontend && npm run dev
   ```
   Ya monorepo script: `npm run dev:fb` (agar configured hai).

4. **Verify**
   - Browser: Spot page kholo, pair select karo (e.g. BTC/USDT). Chart view pe 1m/5m/15m/1H/4H/1D switch karo.
   - Network tab: `GET /api/v1/trading/candles/BTC_USDT?interval=60&...` → 200, body `{ success: true, data: [...] }` with array length > 0.
   - Chart par candles dikhni chahiye.

---

## 5. Agar Ab Bhi Chart Khali Hai

- **API 200 but `data: []`:**  
  Historical loader run kiya? DB mein check: `SELECT COUNT(*), interval_type FROM ohlcv_candles GROUP BY interval_type;`
- **API 404/500:**  
  Backend logs dekho. Route register hai? `server.ts` mein `tradingRoutes` prefix `/api/v1/trading` pe hai.
- **API 200 with data but chart still empty:**  
  Console mein error? Symbol frontend pe sahi ja raha hai (e.g. `BTC_USDT`)? `getChartCandles` same symbol use karta hai jo spot market list se aata hai.

---

## 6. System Flow (Reference)

```
User opens Spot page
  → SpotTradingGrid loads markets (GET /api/v1/spot/markets)
  → User selects pair (e.g. BTC_USDT)
  → ChartPanel mounts, useChartAdapter(symbol, intervalSeconds)
  → getChartCandles(symbol, intervalSeconds, { from, to, limit, direction })
  → GET /api/v1/trading/candles/BTC_USDT?interval=60&from=...&to=...&limit=5000&direction=desc
  → Backend: trading_pairs se id, ohlcv_candles se rows
  → Response: { success: true, data: [ { time, open, high, low, close, volume }, ... ] }
  → buildChartCandles (normalize + validate continuity)
  → adapter.setCandles(recent); adapter.fitContent()
  → LightweightCharts candlestick series update → chart dikhai deta hai
```

---

**Conclusion:** Chart data nahi aane ka main reason: (1) `ohlcv_candles` table migrate mein missing, (2) table empty (historical loader run nahi hua), (3) frontend race (adapter null pe fetch skip). In teeno ko fix + document kar diya. Ab migrate + historical loader run karo, phir chart data dikhna chahiye.
