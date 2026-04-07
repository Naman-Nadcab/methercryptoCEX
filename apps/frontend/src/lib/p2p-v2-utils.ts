import type { P2PAdRow } from '@/lib/p2pApi';

function parseAmountRaw(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Fiat-denominated values (e.g. price per coin, min/max limit in fiat) — grouped, sane decimals. */
export function formatP2pFiatPrice(raw: string | undefined | null, fiat: string): string {
  const n = parseAmountRaw(raw);
  if (n === null) return raw === '' || raw == null ? '—' : String(raw);
  const u = fiat.toUpperCase();
  const maxDec = ['INR', 'USD', 'EUR', 'GBP'].includes(u) ? 2 : u === 'USDT' ? 4 : 6;
  const minDec = maxDec >= 2 ? 2 : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: minDec, maximumFractionDigits: maxDec });
}

/** Crypto quantities — trim trailing zeros, max 8 dp. */
export function formatP2pCryptoQty(raw: string | undefined | null): string {
  if (raw == null || raw === '') return '—';
  const n = parseAmountRaw(raw);
  if (n === null) return String(raw);
  const s = n.toFixed(8).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

export function p2pAdDisplayPrice(ad: P2PAdRow): string {
  return String(ad.current_price ?? ad.price ?? '0');
}

export function p2pAdSide(ad: P2PAdRow): 'buy' | 'sell' {
  const t = String(ad.ad_type ?? ad.type ?? 'sell').toLowerCase();
  return t === 'buy' ? 'buy' : 'sell';
}

export function formatFiatSymbol(fiat: string): string {
  const u = fiat.toUpperCase();
  if (u === 'INR') return '₹';
  if (u === 'USD' || u === 'USDT') return '$';
  if (u === 'EUR') return '€';
  if (u === 'GBP') return '£';
  return u + ' ';
}

/** Payment method chip classes — aligned with P2P marketplace table. */
const P2P_PM_CHIP_BY_KEYWORD: Record<string, string> = {
  bank: 'bg-[#0ecb81]/8 text-[#0ecb81] border-[#0ecb81]/15',
  upi: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  imps: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
};

export function p2pPaymentMethodChipCls(name: string): string {
  const l = name.toLowerCase();
  for (const [k, v] of Object.entries(P2P_PM_CHIP_BY_KEYWORD)) {
    if (l.includes(k)) return v;
  }
  return 'bg-muted/40 text-muted-foreground border-border/20';
}
