'use client';

import type { IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { DrawingToolMode, SerializedDrawing } from '../extension/types';

const toTs = (t: number) => t as UTCTimestamp;

const HIT_PX = 8;
const HANDLE_R = 6;
const DRAG_THRESHOLD = 4;

const COL_HLINE = 'rgba(59, 130, 246, 0.85)';
const COL_HLINE_SEL = 'rgba(34, 211, 238, 0.95)';
const COL_VLINE = 'rgba(59, 130, 246, 0.85)';
const COL_VLINE_SEL = 'rgba(34, 211, 238, 0.95)';
const COL_TREND = 'rgba(234, 179, 8, 0.9)';
const COL_TREND_SEL = 'rgba(251, 191, 36, 0.95)';

/** Retracement from swing high toward low: price = high − ratio × (high − low). */
const FIB_LEVEL_META: { r: number; label: string }[] = [
  { r: 0, label: '0%' },
  { r: 0.236, label: '23.6%' },
  { r: 0.382, label: '38.2%' },
  { r: 0.5, label: '50%' },
  { r: 0.618, label: '61.8%' },
  { r: 0.786, label: '78.6%' },
  { r: 1, label: '100%' },
];

const FIB_COLORS = [
  'rgba(244, 114, 182, 0.75)',
  'rgba(167, 139, 250, 0.72)',
  'rgba(129, 140, 248, 0.72)',
  'rgba(96, 165, 250, 0.75)',
  'rgba(52, 211, 153, 0.72)',
  'rgba(251, 191, 36, 0.72)',
  'rgba(248, 113, 113, 0.75)',
];

const FIB_COLORS_SEL = [
  'rgba(244, 114, 182, 0.95)',
  'rgba(167, 139, 250, 0.92)',
  'rgba(129, 140, 248, 0.92)',
  'rgba(96, 165, 250, 0.95)',
  'rgba(52, 211, 153, 0.92)',
  'rgba(251, 191, 36, 0.92)',
  'rgba(248, 113, 113, 0.95)',
];

function newDrawingId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function numTime(t: UTCTimestamp | number): number {
  return typeof t === 'number' ? t : Number(t);
}

type HitResult =
  | { type: 'hline'; id: string }
  | { type: 'vline'; id: string }
  | { type: 'fib'; id: string }
  | { type: 'trend-handle'; id: string; end: 1 | 2 }
  | { type: 'trend-body'; id: string };

type DragState =
  | { kind: 'hline'; id: string }
  | { kind: 'vline'; id: string }
  | { kind: 'trend-end'; id: string; end: 1 | 2 }
  | {
      kind: 'trend-move';
      id: string;
      lastX: number;
      lastY: number;
    };

type HLineEntry = {
  id: string;
  price: number;
  priceLine: IPriceLine;
  hitRect: SVGRectElement;
};

type VLineEntry = {
  id: string;
  time: number;
  visual: SVGLineElement;
  hitRect: SVGRectElement;
};

type TrendEntry = {
  id: string;
  t1: number;
  p1: number;
  t2: number;
  p2: number;
  vis: SVGLineElement;
  hit: SVGLineElement;
  h1: SVGCircleElement;
  h2: SVGCircleElement;
};

type FibEntry = {
  id: string;
  high: number;
  low: number;
  lines: IPriceLine[];
};

type PointerSession =
  | null
  | {
      startX: number;
      startY: number;
      hit: HitResult;
    };

/**
 * Phase 6 + Phase A — drawings with selection, drag/edit, delete, serialize.
 * Horizontal lines use native `createPriceLine`; overlay SVG/DOM syncs on pan/zoom.
 */
export class DrawingToolManager {
  private chart: IChartApi;

  private series: ISeriesApi<'Candlestick'>;

  private root: HTMLElement;

  private mode: DrawingToolMode = 'none';

  private svg: SVGSVGElement;

  /** Captures placement clicks when draw mode !== none (always on top for that mode). */
  private placementEl: HTMLDivElement;

  private hlines: HLineEntry[] = [];

  private vlines: VLineEntry[] = [];

  private trends: TrendEntry[] = [];

  private fibs: FibEntry[] = [];

  private trendPending: { time: number; price: number } | null = null;

  private fibPending: { price: number } | null = null;

  private selectedId: string | null = null;

  private drag: DragState | null = null;

  private session: PointerSession = null;

  private unsubRange: (() => void) | null = null;

  private ro: ResizeObserver | null = null;

  private boundDown = (e: MouseEvent) => this.onPlacementDown(e);

  private boundWinMove = (e: MouseEvent) => this.onWindowMove(e);

  private boundWinUp = (e: MouseEvent) => this.onWindowUp(e);

  private boundKey = (e: KeyboardEvent) => this.onKeyDown(e);

  /** Fired after user edits drawings (not during batched `loadSerializedDrawings`). */
  private mutateCb: (() => void) | null = null;

  private suppressMutate = false;

  constructor(chart: IChartApi, series: ISeriesApi<'Candlestick'>, overlayHost: HTMLElement) {
    this.chart = chart;
    this.series = series;
    this.root = overlayHost;
    this.root.style.pointerEvents = 'none';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'drawing-tools-svg');
    this.svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1;';
    this.root.appendChild(this.svg);

    this.placementEl = document.createElement('div');
    this.placementEl.setAttribute('class', 'drawing-tools-placement');
    this.placementEl.style.cssText =
      'position:absolute;inset:0;z-index:2;pointer-events:none;background:transparent;';
    this.root.appendChild(this.placementEl);
    this.placementEl.addEventListener('mousedown', this.boundDown);

    const onRange = () => this.redrawOverlayGeometry();
    this.chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    this.unsubRange = () => this.chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
    this.ro = new ResizeObserver(() => this.redrawOverlayGeometry());
    this.ro.observe(this.root);

    window.addEventListener('keydown', this.boundKey, true);
  }

  setMode(mode: DrawingToolMode): void {
    this.mode = mode;
    this.trendPending = null;
    this.fibPending = null;
    this.session = null;
    this.placementEl.style.pointerEvents = mode !== 'none' ? 'auto' : 'none';
    this.placementEl.style.cursor =
      mode === 'hline'
        ? 'ns-resize'
        : mode === 'vline'
          ? 'ew-resize'
          : mode === 'trend' || mode === 'fib'
            ? 'crosshair'
            : 'default';
  }

  getMode(): DrawingToolMode {
    return this.mode;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  setMutateCallback(cb: (() => void) | null): void {
    this.mutateCb = cb;
  }

  private notifyMutate(): void {
    if (this.suppressMutate) return;
    this.mutateCb?.();
  }

  serializeDrawings(): SerializedDrawing[] {
    const out: SerializedDrawing[] = [];
    for (const h of this.hlines) out.push({ kind: 'hline', price: h.price });
    for (const v of this.vlines) out.push({ kind: 'vline', time: v.time });
    for (const t of this.trends) out.push({ kind: 'trend', t1: t.t1, p1: t.p1, t2: t.t2, p2: t.p2 });
    for (const f of this.fibs) out.push({ kind: 'fib', high: f.high, low: f.low });
    return out;
  }

  loadSerializedDrawings(payload: SerializedDrawing[]): void {
    this.suppressMutate = true;
    this.clearAll();
    for (const d of payload) {
      if (d.kind === 'hline') this.addHLineAtPrice(d.price);
      else if (d.kind === 'vline') this.addVLineAtTime(d.time);
      else if (d.kind === 'fib') this.addFibSwing(d.high, d.low);
      else this.addTrendComplete(d.t1, d.p1, d.t2, d.p2);
    }
    this.suppressMutate = false;
    this.redrawOverlayGeometry();
  }

  clearAll(): void {
    this.selectedId = null;
    this.session = null;
    this.drag = null;
    this.trendPending = null;
    this.fibPending = null;
    for (const f of this.fibs) {
      for (const ln of f.lines) {
        try {
          this.series.removePriceLine(ln);
        } catch {
          /* ignore */
        }
      }
    }
    this.fibs = [];
    for (const h of this.hlines) {
      try {
        this.series.removePriceLine(h.priceLine);
      } catch {
        /* ignore */
      }
      h.hitRect.remove();
    }
    this.hlines = [];
    for (const v of this.vlines) {
      v.visual.remove();
      v.hitRect.remove();
    }
    this.vlines = [];
    for (const t of this.trends) {
      t.vis.remove();
      t.hit.remove();
      t.h1.remove();
      t.h2.remove();
    }
    this.trends = [];
  }

  destroy(): void {
    window.removeEventListener('keydown', this.boundKey, true);
    this.placementEl.removeEventListener('mousedown', this.boundDown);
    this.unsubRange?.();
    this.unsubRange = null;
    this.ro?.disconnect();
    this.ro = null;
    window.removeEventListener('mousemove', this.boundWinMove);
    window.removeEventListener('mouseup', this.boundWinUp);
    this.clearAll();
    this.placementEl.remove();
    this.svg.remove();
  }

  private chartXY(e: MouseEvent): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitTest(x: number, y: number): HitResult | null {
    for (const t of this.trends) {
      const x1 = this.chart.timeScale().timeToCoordinate(toTs(t.t1));
      const x2 = this.chart.timeScale().timeToCoordinate(toTs(t.t2));
      const y1 = this.series.priceToCoordinate(t.p1);
      const y2 = this.series.priceToCoordinate(t.p2);
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        const d1 = Math.hypot(x - x1, y - y1);
        const d2 = Math.hypot(x - x2, y - y2);
        if (d1 <= HANDLE_R + 2) return { type: 'trend-handle', id: t.id, end: 1 };
        if (d2 <= HANDLE_R + 2) return { type: 'trend-handle', id: t.id, end: 2 };
        if (distPointToSegment(x, y, x1, y1, x2, y2) <= HIT_PX) return { type: 'trend-body', id: t.id };
      }
    }
    for (const f of this.fibs) {
      const hi = Math.max(f.high, f.low);
      const lo = Math.min(f.high, f.low);
      const range = hi - lo;
      if (range <= 0 || !Number.isFinite(range)) continue;
      for (const { r } of FIB_LEVEL_META) {
        const price = hi - r * range;
        const cy = this.series.priceToCoordinate(price);
        if (cy != null && Math.abs(y - cy) <= HIT_PX) return { type: 'fib', id: f.id };
      }
    }
    for (const h of this.hlines) {
      const cy = this.series.priceToCoordinate(h.price);
      if (cy != null && Math.abs(y - cy) <= HIT_PX) return { type: 'hline', id: h.id };
    }
    for (const v of this.vlines) {
      const xc = this.chart.timeScale().timeToCoordinate(toTs(v.time));
      if (xc != null && Math.abs(x - xc) <= HIT_PX) return { type: 'vline', id: v.id };
    }
    return null;
  }

  private onPlacementDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const { x, y } = this.chartXY(e);
    const hit = this.hitTest(x, y);

    if (this.mode === 'fib' && this.fibPending) {
      const price = this.series.coordinateToPrice(y);
      if (price == null) return;
      const hi = Math.max(this.fibPending.price, price);
      const lo = Math.min(this.fibPending.price, price);
      this.addFibSwing(hi, lo);
      this.fibPending = null;
      e.preventDefault();
      e.stopPropagation();
      this.redrawOverlayGeometry();
      return;
    }

    /* Second trend click always completes (even if near another drawing). */
    if (this.mode === 'trend' && this.trendPending) {
      const price = this.series.coordinateToPrice(y);
      const tRaw = this.chart.timeScale().coordinateToTime(x);
      if (price == null || tRaw == null) return;
      const time = numTime(tRaw as UTCTimestamp);
      if (!Number.isFinite(time)) return;
      this.addTrendComplete(this.trendPending.time, this.trendPending.price, time, price);
      this.trendPending = null;
      e.preventDefault();
      e.stopPropagation();
      this.redrawOverlayGeometry();
      return;
    }

    if (this.mode === 'trend' && !hit) {
      const price = this.series.coordinateToPrice(y);
      const tRaw = this.chart.timeScale().coordinateToTime(x);
      if (price == null || tRaw == null) return;
      const time = numTime(tRaw as UTCTimestamp);
      if (!Number.isFinite(time)) return;
      this.trendPending = { time, price };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this.mode === 'fib' && !hit) {
      const price = this.series.coordinateToPrice(y);
      if (price == null) return;
      this.fibPending = { price };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (hit) {
      this.selectedId = hit.id;
      this.applySelectionStyles();
      this.session = { startX: x, startY: y, hit };
      window.addEventListener('mousemove', this.boundWinMove);
      window.addEventListener('mouseup', this.boundWinUp);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (this.mode === 'none') return;

    if (this.mode === 'hline') {
      const price = this.series.coordinateToPrice(y);
      if (price == null) return;
      this.addHLineAtPrice(price);
      e.preventDefault();
      e.stopPropagation();
      this.redrawOverlayGeometry();
      return;
    }

    if (this.mode === 'vline') {
      const tRaw = this.chart.timeScale().coordinateToTime(x);
      if (tRaw == null) return;
      const time = numTime(tRaw as UTCTimestamp);
      if (!Number.isFinite(time)) return;
      this.addVLineAtTime(time);
      e.preventDefault();
      e.stopPropagation();
      this.redrawOverlayGeometry();
      return;
    }

  }

  private onWindowMove(e: MouseEvent): void {
    if (!this.session && !this.drag) return;
    const { x, y } = this.chartXY(e);

    if (this.session && !this.drag) {
      const dx = x - this.session.startX;
      const dy = y - this.session.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      const h = this.session.hit;
      if (!h) return;
      if (h.type === 'fib') {
        this.session = null;
        return;
      }
      if (h.type === 'hline') this.drag = { kind: 'hline', id: h.id };
      else if (h.type === 'vline') this.drag = { kind: 'vline', id: h.id };
      else if (h.type === 'trend-handle') this.drag = { kind: 'trend-end', id: h.id, end: h.end };
      else if (h.type === 'trend-body') this.drag = { kind: 'trend-move', id: h.id, lastX: x, lastY: y };
      this.session = null;
    }

    if (!this.drag) return;

    if (this.drag.kind === 'hline') {
      const entry = this.hlines.find((h) => h.id === this.drag!.id);
      if (!entry) return;
      const price = this.series.coordinateToPrice(y);
      if (price == null) return;
      entry.price = price;
      entry.priceLine.applyOptions({ price });
      this.redrawOverlayGeometry();
      return;
    }

    if (this.drag.kind === 'vline') {
      const entry = this.vlines.find((v) => v.id === this.drag!.id);
      if (!entry) return;
      const tRaw = this.chart.timeScale().coordinateToTime(x);
      if (tRaw == null) return;
      const time = numTime(tRaw as UTCTimestamp);
      if (!Number.isFinite(time)) return;
      entry.time = time;
      this.redrawOverlayGeometry();
      return;
    }

    if (this.drag.kind === 'trend-end') {
      const entry = this.trends.find((t) => t.id === this.drag!.id);
      if (!entry) return;
      const price = this.series.coordinateToPrice(y);
      const tRaw = this.chart.timeScale().coordinateToTime(x);
      if (price == null || tRaw == null) return;
      const time = numTime(tRaw as UTCTimestamp);
      if (!Number.isFinite(time)) return;
      if (this.drag.end === 1) {
        entry.t1 = time;
        entry.p1 = price;
      } else {
        entry.t2 = time;
        entry.p2 = price;
      }
      this.redrawOverlayGeometry();
      return;
    }

    if (this.drag.kind === 'trend-move') {
      const entry = this.trends.find((t) => t.id === this.drag!.id);
      if (!entry) return;
      const t0 = this.chart.timeScale().coordinateToTime(this.drag.lastX);
      const t1 = this.chart.timeScale().coordinateToTime(x);
      const p0 = this.series.coordinateToPrice(this.drag.lastY);
      const p1 = this.series.coordinateToPrice(y);
      if (t0 == null || t1 == null || p0 == null || p1 == null) return;
      const dT = numTime(t1 as UTCTimestamp) - numTime(t0 as UTCTimestamp);
      const dP = p1 - p0;
      if (!Number.isFinite(dT) || !Number.isFinite(dP)) return;
      entry.t1 += dT;
      entry.t2 += dT;
      entry.p1 += dP;
      entry.p2 += dP;
      this.drag.lastX = x;
      this.drag.lastY = y;
      this.redrawOverlayGeometry();
    }
  }

  private onWindowUp(_e: MouseEvent): void {
    const hadDrag = this.drag != null;
    if (this.session && !this.drag && this.session.hit) {
      this.selectedId = this.session.hit.id;
      this.applySelectionStyles();
    }

    this.session = null;
    this.drag = null;
    window.removeEventListener('mousemove', this.boundWinMove);
    window.removeEventListener('mouseup', this.boundWinUp);
    if (hadDrag) this.notifyMutate();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      if (this.trendPending || this.fibPending) {
        this.trendPending = null;
        this.fibPending = null;
        e.preventDefault();
        return;
      }
      if (this.selectedId) {
        this.selectedId = null;
        this.applySelectionStyles();
        e.preventDefault();
      }
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!this.selectedId) return;
    e.preventDefault();
    this.removeDrawingById(this.selectedId);
    this.selectedId = null;
  }

  private removeDrawingById(id: string): void {
    const hi = this.hlines.findIndex((h) => h.id === id);
    if (hi >= 0) {
      const h = this.hlines[hi]!;
      try {
        this.series.removePriceLine(h.priceLine);
      } catch {
        /* ignore */
      }
      h.hitRect.remove();
      this.hlines.splice(hi, 1);
      this.redrawOverlayGeometry();
      this.notifyMutate();
      return;
    }
    const vi = this.vlines.findIndex((v) => v.id === id);
    if (vi >= 0) {
      const v = this.vlines[vi]!;
      v.visual.remove();
      v.hitRect.remove();
      this.vlines.splice(vi, 1);
      this.redrawOverlayGeometry();
      this.notifyMutate();
      return;
    }
    const ti = this.trends.findIndex((t) => t.id === id);
    if (ti >= 0) {
      const tr = this.trends[ti]!;
      tr.vis.remove();
      tr.hit.remove();
      tr.h1.remove();
      tr.h2.remove();
      this.trends.splice(ti, 1);
      this.redrawOverlayGeometry();
      this.notifyMutate();
      return;
    }
    const fi = this.fibs.findIndex((f) => f.id === id);
    if (fi >= 0) {
      const f = this.fibs[fi]!;
      for (const ln of f.lines) {
        try {
          this.series.removePriceLine(ln);
        } catch {
          /* ignore */
        }
      }
      this.fibs.splice(fi, 1);
      this.redrawOverlayGeometry();
      this.notifyMutate();
    }
  }

  /** Phase C — Fib retracement from swing high to low (two price clicks). */
  private addFibSwing(high: number, low: number): void {
    const hi = Math.max(high, low);
    const lo = Math.min(high, low);
    const range = hi - lo;
    if (range <= 0 || !Number.isFinite(range)) return;
    const id = newDrawingId();
    const lines: IPriceLine[] = [];
    for (let i = 0; i < FIB_LEVEL_META.length; i++) {
      const { r, label } = FIB_LEVEL_META[i]!;
      const price = hi - r * range;
      const pl = this.series.createPriceLine({
        price,
        color: FIB_COLORS[i]!,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: label,
      });
      lines.push(pl);
    }
    this.fibs.push({ id, high: hi, low: lo, lines });
    this.selectedId = id;
    this.notifyMutate();
  }

  private addHLineAtPrice(price: number): void {
    const id = newDrawingId();
    const pl = this.series.createPriceLine({
      price,
      color: COL_HLINE,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    });
    const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitRect.setAttribute('fill', 'transparent');
    hitRect.setAttribute('pointer-events', 'auto');
    hitRect.style.cursor = 'ns-resize';
    hitRect.addEventListener('mousedown', (ev) => this.onSvgHitDown(ev, { type: 'hline', id }));
    this.svg.appendChild(hitRect);
    this.hlines.push({ id, price, priceLine: pl, hitRect });
    this.selectedId = id;
    this.notifyMutate();
  }

  private addVLineAtTime(time: number): void {
    const id = newDrawingId();
    const visual = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    visual.setAttribute('stroke', COL_VLINE);
    visual.setAttribute('stroke-width', '1');
    visual.setAttribute('pointer-events', 'none');
    const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hitRect.setAttribute('fill', 'transparent');
    hitRect.setAttribute('pointer-events', 'auto');
    hitRect.style.cursor = 'ew-resize';
    hitRect.addEventListener('mousedown', (ev) => this.onSvgHitDown(ev, { type: 'vline', id }));
    this.svg.appendChild(visual);
    this.svg.appendChild(hitRect);
    this.vlines.push({ id, time, visual, hitRect });
    this.selectedId = id;
    this.notifyMutate();
  }

  private addTrendComplete(t1: number, p1: number, t2: number, p2: number): void {
    const id = newDrawingId();
    const vis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    vis.setAttribute('stroke', COL_TREND);
    vis.setAttribute('stroke-width', '1.5');
    vis.setAttribute('pointer-events', 'none');
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '14');
    hit.setAttribute('pointer-events', 'stroke');
    hit.style.cursor = 'move';
    hit.addEventListener('mousedown', (ev) => this.onSvgHitDown(ev, { type: 'trend-body', id }));
    const h1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const h2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [h1, h2]) {
      c.setAttribute('r', String(HANDLE_R));
      c.setAttribute('fill', 'rgba(250,204,21,0.35)');
      c.setAttribute('stroke', COL_TREND);
      c.setAttribute('stroke-width', '1');
      c.setAttribute('pointer-events', 'auto');
      c.style.cursor = 'crosshair';
    }
    h1.addEventListener('mousedown', (ev) => this.onSvgHitDown(ev, { type: 'trend-handle', id, end: 1 }));
    h2.addEventListener('mousedown', (ev) => this.onSvgHitDown(ev, { type: 'trend-handle', id, end: 2 }));
    /* vis bottom, wide hit stroke above it, handles on top */
    this.svg.appendChild(vis);
    this.svg.appendChild(hit);
    this.svg.appendChild(h1);
    this.svg.appendChild(h2);
    this.trends.push({ id, t1, p1, t2, p2, vis, hit, h1, h2 });
    this.selectedId = id;
    this.notifyMutate();
  }

  private onSvgHitDown(e: MouseEvent, hit: HitResult): void {
    if (e.button !== 0) return;
    const { x, y } = this.chartXY(e);
    this.selectedId = hit.id;
    this.applySelectionStyles();
    this.session = { startX: x, startY: y, hit };
    window.addEventListener('mousemove', this.boundWinMove);
    window.addEventListener('mouseup', this.boundWinUp);
    e.preventDefault();
    e.stopPropagation();
  }

  private applySelectionStyles(): void {
    for (const h of this.hlines) {
      const sel = h.id === this.selectedId;
      h.priceLine.applyOptions({
        color: sel ? COL_HLINE_SEL : COL_HLINE,
        lineWidth: sel ? 2 : 1,
      });
    }
    for (const v of this.vlines) {
      const sel = v.id === this.selectedId;
      v.visual.setAttribute('stroke', sel ? COL_VLINE_SEL : COL_VLINE);
      v.visual.setAttribute('stroke-width', sel ? '2' : '1');
    }
    for (const t of this.trends) {
      const sel = t.id === this.selectedId;
      const lineVisible = t.vis.getAttribute('display') !== 'none';
      t.vis.setAttribute('stroke', sel ? COL_TREND_SEL : COL_TREND);
      t.vis.setAttribute('stroke-width', sel ? '2' : '1.5');
      const showHandles = sel && lineVisible ? 'inline' : 'none';
      t.h1.setAttribute('display', showHandles);
      t.h2.setAttribute('display', showHandles);
    }
    for (const f of this.fibs) {
      const sel = f.id === this.selectedId;
      f.lines.forEach((pl, i) => {
        pl.applyOptions({
          color: sel ? FIB_COLORS_SEL[i]! : FIB_COLORS[i]!,
          lineWidth: sel ? 2 : 1,
        });
      });
    }
  }

  private redrawOverlayGeometry(): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    for (const hl of this.hlines) {
      const cy = this.series.priceToCoordinate(hl.price);
      if (cy == null || !Number.isFinite(cy)) {
        hl.hitRect.setAttribute('display', 'none');
        continue;
      }
      hl.hitRect.setAttribute('display', 'inline');
      hl.hitRect.setAttribute('x', '0');
      hl.hitRect.setAttribute('y', String(cy - HIT_PX));
      hl.hitRect.setAttribute('width', String(w));
      hl.hitRect.setAttribute('height', String(HIT_PX * 2));
    }

    for (const v of this.vlines) {
      const xc = this.chart.timeScale().timeToCoordinate(toTs(v.time));
      if (xc == null) {
        v.visual.setAttribute('display', 'none');
        v.hitRect.setAttribute('display', 'none');
        continue;
      }
      v.visual.setAttribute('display', 'inline');
      v.hitRect.setAttribute('display', 'inline');
      v.visual.setAttribute('x1', String(xc));
      v.visual.setAttribute('x2', String(xc));
      v.visual.setAttribute('y1', '0');
      v.visual.setAttribute('y2', String(h));
      v.hitRect.setAttribute('x', String(xc - HIT_PX));
      v.hitRect.setAttribute('y', '0');
      v.hitRect.setAttribute('width', String(HIT_PX * 2));
      v.hitRect.setAttribute('height', String(h));
    }

    for (const t of this.trends) {
      const x1 = this.chart.timeScale().timeToCoordinate(toTs(t.t1));
      const x2 = this.chart.timeScale().timeToCoordinate(toTs(t.t2));
      const y1 = this.series.priceToCoordinate(t.p1);
      const y2 = this.series.priceToCoordinate(t.p2);
      if (x1 == null || x2 == null || y1 == null || y2 == null) {
        t.vis.setAttribute('display', 'none');
        t.hit.setAttribute('display', 'none');
        t.h1.setAttribute('display', 'none');
        t.h2.setAttribute('display', 'none');
        continue;
      }
      t.vis.setAttribute('display', 'inline');
      t.hit.setAttribute('display', 'inline');
      for (const line of [t.vis, t.hit]) {
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
      }
      t.h1.setAttribute('cx', String(x1));
      t.h1.setAttribute('cy', String(y1));
      t.h2.setAttribute('cx', String(x2));
      t.h2.setAttribute('cy', String(y2));
    }

    this.applySelectionStyles();
  }
}
