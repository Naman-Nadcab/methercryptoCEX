# Spot Trading Page — UX/UI Audit & Bybit-Style Standard

**Date:** 2025  
**Scope:** Spot trading page only (no backend changes).  
**Reference:** Bybit spot trading UI; Binance-grade global theme; industry-grade exchange standards.

---

## 1. Audit Summary

| Area | Status | Notes |
|------|--------|--------|
| **Theme consistency** | ✅ Fixed | Chart now follows app light/dark mode |
| **Market info bar** | ✅ Aligned | Last price fallback (mid), compact bar, primary accent |
| **Orderbook** | ✅ Aligned | Last price fallback, depth shading, precision, sentiment |
| **Trade panel** | ✅ Aligned | Buy/Sell buttons, balance %, Max, theme tokens |
| **Bottom panel** | ✅ Aligned | Tabs, tables, theme-aware |
| **Chart** | ✅ Fixed | Light/dark sync; Screenshot label; toolbar |
| **Standard** | ✅ Met | Theme tokens, contrast, semantics, no hardcoded colors |

---

## 2. Standards Checklist

### 2.1 Theme — Binance-grade global (Light / Dark)

- **Color system:** Binance-style green for buy/price-up (`#0ecb81` → `--primary`, `--exchange-buy`, `--price-up`), red for sell/price-down (`#f6465d` → `--destructive`, `--exchange-sell`, `--price-down`). All exchange UI and chart use these global CSS variables.
- **Light:** Background white; card `220 14% 99%`; primary = green; destructive = red; borders and muted from neutral grays.
- **Dark:** Background `220 18% 4%` (Binance-style #0b0e11); card `220 14% 11%` (#1e2329-style); same green/red, slightly brighter for contrast.
- **Chart:** Candles/volume/trade markers use Binance green/red (#0ecb81 / #f6465d); layout/grid/scale follow app theme.
- **All surfaces:** Use theme tokens only: `bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `text-price-up`, `text-price-down` — no hardcoded hex for UI (chart uses fixed Binance hex for candlesticks only).

### 2.2 Layout (Bybit-style, as implemented)

- **Header:** Logo, Spot / P2P / Markets / Orders / Assets / History / Deposit, pair search, theme toggle, notifications, user.
- **Market bar (PairHeader):** Pair name, Spot badge, WS status, Last, 24h %, High, Low, Vol, Turnover, Bid/Ask — single row, no duplicate Bid/Ask.
- **Main grid (3 columns on lg):**
  - **Row 1:** Chart (col 1, ~60%), Orderbook + Trades (col 2, ~20%), Buy/Sell (col 3, ~20%). Chart and orderbook share the **same row height**: `minmax(54vh, 1fr)` so they do not shrink.
  - **Row 2:** Bottom panel (Open Orders, Order History, Trade History, Assets) **spans col 1 + col 2 only** (left end to middle); **not** under Buy/Sell. Buy/Sell column spans both rows (full height).
- **Gap:** `gap-x-px` between columns; `gap-y-0` between row 1 and row 2 so **minimal space** between chart/orderbook and bottom panel.
- **Scroll:** Main content area is scrollable (`overflow-y-auto`). On load, chart/orderbook get 54vh; upper part of bottom panel visible; user scrolls slightly to see full bottom panel.
- **Bottom panel:** Tabs, sortable tables, theme-aware; position and width as above.

### 2.3 Data & Copy

- **Last price:** From ticker when available; fallback to mid(best bid, best ask) when only orderbook exists — same logic in header and orderbook.
- **24h stats:** From WebSocket/API; show "—" or "0" only when no data.
- **Orderbook Last row:** Always show a value when orderbook has levels (ticker last or mid).
- **Labels:** No truncation (e.g. "Screenshot" not "Scree"); use `whitespace-nowrap` / `shrink-0` where needed.

### 2.4 Trade Panel

- **Buy:** `bg-primary` (Binance green), `text-primary-foreground`; Sell: `bg-destructive` (Binance red), `text-destructive-foreground`.
- **Balance %:** 25%, 50%, 75%, 100% visible; theme-aware (`bg-muted/40`, `border-border`, hover).
- **Max:** `text-primary`, hover underline; no fixed blue-400.
- **Inputs:** `bg-background`, `border-input`, focus ring.

### 2.5 Orderbook

- **Columns:** Price, Amount, Total; precision selector (2/4/6/8).
- **Last / Spread row:** Always show Last (ticker or mid); Spread with value and %.
- **Depth:** Row background intensity by depth; green/red for buy/sell; theme-safe (e.g. green-500/red-500 with opacity).
- **Market sentiment:** Bar with Buy % / Sell %; theme-aware text.

### 2.6 Chart

- **Theme sync:** On app theme change, chart applies new layout/grid/scale colors without full re-init (e.g. `updateTheme(theme)`).
- **Candles/volume/markers:** Binance-grade green `#0ecb81` (up/buy), red `#f6465d` (down/sell); volume bars and trade markers use same palette.
- **Light:** Background `#fafafa`, text `#4b5563`, grid `rgba(0,0,0,0.08)`.
- **Dark:** Background `#0b0e11`, text `#9ca3af`, grid `rgba(255,255,255,0.1)`.
- **Toolbar:** Chart / Depth, intervals, Indicators, Reset, Fullscreen, Screenshot (full label, no truncation).

### 2.7 Micro-interactions & A11y

- **Hover:** Rows use `hover:bg-muted/50` or `hover:bg-muted`.
- **Focus:** Buttons/inputs have visible focus ring (`focus-visible:ring-2`).
- **Loading:** Spinners and empty states use `text-muted-foreground`.
- **ARIA:** Buttons have `aria-label` where needed; chart container has `aria-label`.

---

## 3. Fixes Applied (This Pass)

1. **Chart theme:** Added `updateTheme(theme)` to chart adapter; `useChartAdapter` calls it when `theme` changes so the chart matches light/dark mode.
2. **Last price:** Header and orderbook use ticker last price, with fallback to mid(best bid, best ask) when ticker is missing; same logic in grid and orderbook panel.
3. **Screenshot button:** Wrapped label in `<span className="whitespace-nowrap">Screenshot</span>` and added `shrink-0` so it never truncates to "Scree".
4. **PairHeader:** Added primary-colored vertical accent (pill) next to pair name; slightly reduced bar height (52px) for a denser, Bybit-like bar.
5. **Trade panel:** Max button uses `text-primary` and `hover:underline`; Balance % buttons use `bg-muted/40` and clearer hover for visibility in both themes.
6. **Orderbook Last:** Uses `lastDisplay = lastPrice ?? mid(bestBid, bestAsk)` so the Last row always shows a value when orderbook has data.
7. **Binance-grade global theme:** `globals.css` and `tailwind.config.ts` use Binance-style green (`#0ecb81` → `--primary`, `--exchange-buy`, `--price-up`) and red (`#f6465d` → `--destructive`, `--exchange-sell`, `--price-down`) for light and dark. Dark background `220 18% 4%` (#0b0e11), card `220 14% 11%`. Chart candlesticks, volume bars, and trade markers use same green/red hex. Buy/Sell buttons, orderbook, PairHeader, and all price-up/down text use theme variables. WS indicator and price flash use `--price-up` / `--price-down`.

---

## 4. Backend / Feature Alignment

- **Markets:** `GET /api/v1/spot/markets` — used for pair list and precision.
- **Orderbook:** WebSocket + REST snapshot; bids/asks drive orderbook and mid fallback.
- **Ticker:** WebSocket; last_price, 24h high/low/volume; header and chart use this.
- **Orders:** Submit/cancel and open/history use existing APIs; no new endpoints.
- **Auth:** Trade panel and bottom panel respect auth; empty state when not signed in.

No backend changes were required; all fixes are frontend-only and consistent with current APIs and features.

---

## 5. File-Level Reference

| Component | File | Changes |
|-----------|------|---------|
| Chart theme | `chart/ChartAdapter.ts`, `LightweightChartsAdapter.ts`, `useChartAdapter.ts` | `updateTheme`, theme sync on change |
| Last price fallback | `SpotTradingGrid.tsx`, `SpotOrderbookPanel.tsx` | Mid price when no ticker |
| PairHeader | `PairHeader.tsx` | Accent pill, bar height |
| Chart toolbar | `ChartPanel.tsx` | Screenshot label, shrink-0 |
| Trade panel | `SpotOrderEntryPanel.tsx` | Max, Balance % styling |

---

## 6. How to Verify

1. **Theme:** Toggle light/dark; chart background and grid/text must match; no dark chart on light page.
2. **Orderbook:** With no ticker but orderbook data, Last and header must show mid(best bid, best ask).
3. **Trade panel:** Buy green (Binance), Sell red (Binance); 25/50/75/100% visible; Max uses primary color.
4. **Toolbar:** Resize or narrow; "Screenshot" must not truncate.
5. **Market bar:** Single Bid/Ask block; primary accent on pair; compact layout.

This document serves as the standard for future Spot page UI changes and for matching Bybit-style behaviour within our backend and feature set.

---

## 7. Current implementation (requirement-aligned)

| Item | Value / behaviour |
|------|-------------------|
| Chart + orderbook row height | `minmax(54vh, 1fr)` — same height, no shrink |
| Bottom panel position | Col 1–2, row 2 only (left end to middle) |
| Vertical gap (chart ↔ bottom panel) | `gap-y-0` — minimal; only border-t on bottom panel |
| Horizontal gap (columns) | `gap-x-px` |
| Scroll | Content area `overflow-y-auto`; load shows 54vh + top of bottom panel; scroll for full bottom panel |
| Buy/Sell | Full height (spans row 1 + row 2), right column only |
| Theme | Binance-grade: green buy/up, red sell/down via CSS vars; chart candles/markers #0ecb81 / #f6465d; `updateTheme(theme)` on toggle |
