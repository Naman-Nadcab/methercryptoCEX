/**
 * One-time DB → memory L2 hydrate per symbol (cold start). Avoids applying deltas to an empty book.
 */

import { getOrderbookFromDb } from './spot-orderbook-cache.service.js';
import { replaceFromSnapshot } from './spot-in-memory-orderbook.service.js';

const warmed = new Set<string>();

export async function ensureMemoryBookHydrated(symbol: string): Promise<void> {
  if (warmed.has(symbol)) return;
  const snap = await getOrderbookFromDb(symbol);
  replaceFromSnapshot(snap);
  warmed.add(symbol);
}
