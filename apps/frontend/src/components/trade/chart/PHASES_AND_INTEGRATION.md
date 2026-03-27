# Chart phases — what shipped & how to extend

## Folder layout

| Path | Role |
|------|------|
| `extension/types.ts` | Shared TS contracts (`ChartExtensionsConfig`, `DrawingToolMode`, plugin types). |
| `utils/throttle.ts` | Crosshair throttle helper. |
| `tools/DrawingToolManager.ts` | H / V / trend drawings + overlay sync on pan/zoom. |
| `tools/FibonacciRetracementTool.ts` | Placeholder; **Phase C** Fib UI is `DrawingToolManager` mode `fib` + `SerializedDrawing` `{ kind:'fib' }`. |
| `indicators/plugins/` | **Phase B:** `ModularEmaVwapPlugin`, `OverlayStudyPlugin` (dropdown SMA/EMA/VWAP/BB), `RsiPanePlugin`, `VolumeMaPlugin`. |
| `overlays/` | Placeholder for extra visual layers. |
| `REGRESSION_CHECKLIST.md` | Phase 0 manual QA. |

## Integration (current)

- **`LightweightChartsAdapter`**: `applyExtensions()`, `attachDrawingOverlay()`, `setDrawingToolMode()`, `clearDrawings()`, richer crosshair legend, arrow trade markers.
- **`ChartPanel`**: Wraps `#chart-mount` in a `relative` flex child; absolute chart + drawing overlay; toolbar toggles for EMA stack, VWAP², volume bars, draw modes.

## Assumptions / limits

- **Incremental modular EMA** (inside `ModularEmaVwapPlugin`): On same-candle live ticks, each enabled EMA uses `line.update` with \(k\cdot close + (1-k)\cdot EMA_{n-1}\); seeds refresh on full passes (`setCandles`, new bars, toggles).
- **Modular VWAP²** (same plugin): On light ticks, VWAP is recomputed at most **once per animation frame** (RAF), not on every price tick.
- **Overlay / RSI / Vol SMA**: Still full recompute each `refreshStudies` (can be optimized later).
- **Drawings (Phase A)**: Select, drag/move, Delete/Backspace, serialize via `exportDrawings` / `importDrawings`. Horizontal lines use native `createPriceLine` + invisible SVG hit band.
- **Duplicate VWAP**: Overlay dropdown “VWAP” and “VWAP²” can both be on — intentional for power users; turn one off if cluttered.

## External API (for other UI)

```ts
if (adapter instanceof LightweightChartsAdapter) {
  adapter.applyExtensions({ ema20: true, modularVwap: true, volumeHistogram: true });
  adapter.setDrawingToolMode('hline');
  adapter.setDrawingMutateListener(() => {
    /* e.g. persist adapter.exportDrawings() */
  });
  const snapshot = adapter.exportDrawings();
  adapter.importDrawings(snapshot);
  adapter.clearDrawings();
}
```

- **ChartPanel** persists drawings to `localStorage` key `exchange.chart.drawings.v1.${symbol}` (debounced). Legend shows `T … UTC` on crosshair + live bar.
