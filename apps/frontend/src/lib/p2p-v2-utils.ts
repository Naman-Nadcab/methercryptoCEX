import type { P2PAdRow } from '@/lib/p2pApi';

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
