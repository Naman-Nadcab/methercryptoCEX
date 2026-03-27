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
  upVolume: rgba(FALLBACK_UP, 0.45),
  downVolume: rgba(FALLBACK_DOWN, 0.45),
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
    upVolume: rgba(upRgb, 0.45),
    downVolume: rgba(downRgb, 0.45),
  };
}
