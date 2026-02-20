# UI Remaining — Placeholder, Mock & Missing

List of UI elements that are **placeholder**, **mock**, or **not yet wired** to live data. Use this for prioritising what to build next.

---

## User panel (dashboard)

| Page / Component | Status | Notes |
|------------------|--------|--------|
| **Spot — Price chart** (`/dashboard/spot`) | Wired | Real chart wired via `useChartAdapter` + `getChartCandles`; uses `/api/v1/trading/candles/:symbol`. If no data shows, ensure backend `ohlcv_candles` is populated (candle aggregation job). |
| **Assets — PnL chart** (`/dashboard/assets/pnl`) | Mock fallback | Uses `generateMockChartData()` when API fails or returns no data. Backend may not expose PnL chart API; either add API or keep as mock for now. |
| **Assets — Overview chart** (`/dashboard/assets/overview`) | Placeholder | "Generate chart data points (placeholder)" — chart data is generated locally, not from API. |
| **Convert — Price chart** (`/dashboard/assets/convert`) | Placeholder | "Price chart coming soon". |
| **Withdraw — Fiat** (`/dashboard/withdraw/fiat`) | Implemented | Now a "Coming soon" page; link from withdraw crypto no longer 404s. |
| **Dashboard home** (`/dashboard/page`) | Partial mock | Market data and trending events can be static/mock; ensure tickers or key metrics come from API if needed. |

---

## Admin panel

| Page / Component | Status | Notes |
|------------------|--------|--------|
| **Reports (financial / users / trading)** | Verify | If these pages fetch data, confirm backend endpoints exist (e.g. GET reports). Otherwise they may be hub/links only. |
| **Support / tickets** | Verify | If support pages call a tickets API, ensure that route exists; otherwise treat as placeholder. |
| **KYC settings** | Verify | If the page has toggles/config, ensure backend exposes GET/PATCH for KYC settings. |

---

## Summary

- **Done:** Withdraw fiat — "Coming soon" page added.
- **To wire:** Spot price chart on `/dashboard/spot` using existing chart component + `/api/v1/trading/candles` (and ensure OHLCV data is populated).
- **Optional:** PnL and overview charts — either add backend APIs or keep mock/placeholder.
- **Verify:** Admin reports, support, KYC settings — confirm backend and remove or implement as needed.
