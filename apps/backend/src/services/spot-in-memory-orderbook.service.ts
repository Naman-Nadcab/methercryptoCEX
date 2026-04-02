/**
 * Full aggregated L2 in memory (price → size). Hot path: no DB reads for WS orderbook.
 * Redis/DB used only to hydrate cold symbols or periodic backup.
 */

import { Decimal } from '../lib/decimal.js';
import { ROUND_DOWN } from './spot-decimal.js';
import type { OrderbookSnapshot, OrderbookLevel } from './spot-orderbook-cache.service.js';

export const DEFAULT_L2_DEPTH = 50;

type Side = 'buy' | 'sell';

type BookSide = Map<string, string>;

type SymbolBook = { bids: BookSide; asks: BookSide };

const books = new Map<string, SymbolBook>();

function book(symbol: string): SymbolBook {
  let b = books.get(symbol);
  if (!b) {
    b = { bids: new Map(), asks: new Map() };
    books.set(symbol, b);
  }
  return b;
}

function levels(b: SymbolBook, side: Side): BookSide {
  return side === 'buy' ? b.bids : b.asks;
}

function normQty(qty: string, precision: number): string {
  return new Decimal(qty || '0').toDecimalPlaces(precision, ROUND_DOWN).toString();
}

export function addLiquidity(symbol: string, side: Side, price: string, qty: string, qtyPrecision = 8): void {
  const q = normQty(qty, qtyPrecision);
  if (new Decimal(q).lte(0)) return;
  const L = levels(book(symbol), side);
  const prev = new Decimal(L.get(price) ?? '0');
  L.set(price, prev.plus(q).toDecimalPlaces(qtyPrecision, ROUND_DOWN).toString());
}

/** Remove filled quantity at a price level (maker side). */
export function removeLiquidity(symbol: string, side: Side, price: string, qty: string, qtyPrecision = 8): void {
  const q = normQty(qty, qtyPrecision);
  if (new Decimal(q).lte(0)) return;
  const L = levels(book(symbol), side);
  const prev = new Decimal(L.get(price) ?? '0');
  const next = prev.minus(q).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
  if (next.lte(0)) L.delete(price);
  else L.set(price, next.toString());
}

export function replaceFromSnapshot(snapshot: OrderbookSnapshot): void {
  const b = book(snapshot.symbol);
  b.bids.clear();
  b.asks.clear();
  for (const l of snapshot.bids) {
    if (new Decimal(l.quantity || '0').gt(0)) b.bids.set(l.price, normQty(l.quantity, 12));
  }
  for (const l of snapshot.asks) {
    if (new Decimal(l.quantity || '0').gt(0)) b.asks.set(l.price, normQty(l.quantity, 12));
  }
}

export function snapshotTop(symbol: string, depth = DEFAULT_L2_DEPTH): OrderbookSnapshot {
  const b = book(symbol);
  const bidLevels: OrderbookLevel[] = [...b.bids.entries()]
    .sort((a, x) => parseFloat(x[0]) - parseFloat(a[0]))
    .slice(0, depth)
    .map(([price, quantity]) => ({ price, quantity }));
  const askLevels: OrderbookLevel[] = [...b.asks.entries()]
    .sort((a, x) => parseFloat(a[0]) - parseFloat(x[0]))
    .slice(0, depth)
    .map(([price, quantity]) => ({ price, quantity }));
  return { symbol, bids: bidLevels, asks: askLevels, lastUpdateId: 0 };
}

export function isMemoryBookEmpty(symbol: string): boolean {
  const b = books.get(symbol);
  if (!b) return true;
  return b.bids.size === 0 && b.asks.size === 0;
}

export function listSymbolsWithMemoryBooks(): string[] {
  return [...books.keys()];
}
