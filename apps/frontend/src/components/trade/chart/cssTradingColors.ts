/**
 * Theme buy/sell colors for Lightweight Charts.
 * The library does not parse modern `hsl(H S% L% / a)` — use `rgba()`.
 */

export type TradingChartColors = {
  up: string;
  down: string;
  upVolume: string;
  downVolume: string;
};

/** CSS variable value like `158 88% 36%` → RGB 0–255 */
function hslTripletToRgb(triplet: string): { r: number; g: number; b: number } {
  const m = triplet.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return { r: 22, g: 189, b: 108 };
  const h = parseFloat(m[1]);
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;

  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

function rgba(rgb: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

const FALLBACK_UP = { r: 22, g: 189, b: 108 };
const FALLBACK_DOWN = { r: 240, g: 74, b: 92 };

const FALLBACK: TradingChartColors = {
  up: rgba(FALLBACK_UP, 1),
  down: rgba(FALLBACK_DOWN, 1),
  upVolume: rgba(FALLBACK_UP, 0.55),
  downVolume: rgba(FALLBACK_DOWN, 0.55),
};

export function getTradingChartColors(): TradingChartColors {
  if (typeof document === 'undefined') return FALLBACK;
  const root = document.documentElement;
  const triplet = (name: string): string | null => {
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    return v.length > 0 ? v : null;
  };
  const upRaw = triplet('--price-up');
  const downRaw = triplet('--price-down');
  if (!upRaw || !downRaw) return FALLBACK;

  const upRgb = hslTripletToRgb(upRaw);
  const downRgb = hslTripletToRgb(downRaw);

  return {
    up: rgba(upRgb, 1),
    down: rgba(downRgb, 1),
    upVolume: rgba(upRgb, 0.55),
    downVolume: rgba(downRgb, 0.55),
  };
}

function tripletToRgbOrNull(raw: string | null | undefined): { r: number; g: number; b: number } | null {
  if (raw == null || raw.trim() === '') return null;
  if (!/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(raw.trim())) return null;
  return hslTripletToRgb(raw);
}

/** Options passed to lightweight-charts `layout` / `grid` / scales — rgba only (library limitation). */
export type DomChartThemeOptions = {
  layout: { background: { color: string }; textColor: string };
  grid: { vertLines: { color: string }; horzLines: { color: string } };
  rightPriceScale: { borderColor: string };
  timeScale: { borderColor: string };
};

const FALLBACK_DOM_CHART: Record<'dark' | 'light', DomChartThemeOptions> = {
  dark: {
    layout: { background: { color: '#0b0e11' }, textColor: '#9ca3af' },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.06)' },
      horzLines: { color: 'rgba(255,255,255,0.06)' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.1)' },
  },
  light: {
    layout: { background: { color: '#fafafa' }, textColor: '#4b5563' },
    grid: {
      vertLines: { color: 'rgba(0,0,0,0.06)' },
      horzLines: { color: 'rgba(0,0,0,0.06)' },
    },
    rightPriceScale: { borderColor: 'rgba(0,0,0,0.08)' },
    timeScale: { borderColor: 'rgba(0,0,0,0.08)' },
  },
};

/**
 * Chart canvas chrome from `globals.css` tokens (`--card`, `--muted-foreground`, `--border`)
 * so the graph matches the spot shell. Falls back to previous hex if variables are missing.
 */
export function getDomChartThemeOptions(theme: 'dark' | 'light'): DomChartThemeOptions {
  if (typeof document === 'undefined') return FALLBACK_DOM_CHART[theme];
  const root = document.documentElement;
  const read = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();
  const cardRaw = read('--card');
  const mutedRaw = read('--muted-foreground');
  const borderRaw = read('--border');
  const bgRgb = tripletToRgbOrNull(cardRaw);
  const textRgb = tripletToRgbOrNull(mutedRaw);
  const borderRgb = tripletToRgbOrNull(borderRaw);
  if (!bgRgb || !textRgb || !borderRgb) return FALLBACK_DOM_CHART[theme];

  return {
    layout: {
      background: { color: rgba(bgRgb, 1) },
      textColor: rgba(textRgb, 1),
    },
    grid: {
      vertLines: { color: rgba(borderRgb, 0.2) },
      horzLines: { color: rgba(borderRgb, 0.2) },
    },
    rightPriceScale: { borderColor: rgba(borderRgb, 0.55) },
    timeScale: { borderColor: rgba(borderRgb, 0.55) },
  };
}

const FALLBACK_CROSSHAIR = {
  line: 'rgba(96, 165, 250, 0.45)',
  labelBg: 'rgba(37, 99, 235, 0.92)',
} as const;

/** Crosshair line + label pill from `--primary` (matches focus ring / app accent). */
export function getDomChartCrosshairColors(): { line: string; labelBg: string } {
  if (typeof document === 'undefined') return { ...FALLBACK_CROSSHAIR };
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  const rgb = tripletToRgbOrNull(raw);
  if (!rgb) return { ...FALLBACK_CROSSHAIR };
  return {
    line: rgba(rgb, 0.42),
    labelBg: rgba(rgb, 0.92),
  };
}
