# Chart regression checklist (Phase 0)

Run after any chart-related change (adapter, `ChartPanel`, indicators, drawings).

## Data & live

- [ ] Initial load: candles render, no console errors
- [ ] Symbol change: new history loads, scales sane
- [ ] Interval change: chart reloads, OHLC legend updates
- [ ] WebSocket / live tick: last candle updates, volume bar updates, no flicker loop

## UI & layout

- [ ] Light + dark theme: grid, text, candle colors OK
- [ ] Fullscreen: chart resizes, no dead gap at bottom
- [ ] `hideDuplicatePairSummary`: OHLC row still shows in chart mode

## Indicators (if enabled)

- [ ] Overlay dropdown (SMA/EMA/VWAP/BB) still works
- [ ] Modular EMA toggles: lines appear/disappear without breaking candles
- [ ] Overlay dropdown (SMA/EMA/VWAP/BB) + RSI pane + volume MA after plugin split
- [ ] Modular VWAP + overlay VWAP: both can coexist (or verify expected overlap)
- [ ] RSI pane: toggle on/off, layout margins OK
- [ ] Volume histogram visibility toggle
- [ ] Volume SMA line still optional

## Drawings (Phase A)

- [ ] Tool mode `none`: chart scroll/zoom normal (overlay `pointer-events` only on drawing hits)
- [ ] Horizontal line: create (H mode), drag vertically to move, click to select, Delete/Backspace removes selected
- [ ] Vertical line: create (V mode), drag horizontally to move, select + delete
- [ ] Trendline: two-click (∠ mode); endpoints show when selected; drag handles or body to move line
- [ ] Fib: two clicks set swing range; seven retracement price lines; select any level to highlight group; Del removes; export/import includes `fib`
- [ ] Clr clears all drawings
- [ ] Pan/zoom: overlay geometry stays aligned

## Markers

- [ ] Trade markers: buy arrow up, sell arrow down, updates with new trades

## Crosshair

- [ ] Legend shows bar **T … UTC** + OHLC; with modular EMA/RSI on, extra values appear when hovering bars

## Drawings persistence

- [ ] Change symbol → drawings restore from localStorage for that symbol
- [ ] **Esc** clears trend/Fib pending click or deselects without deleting
