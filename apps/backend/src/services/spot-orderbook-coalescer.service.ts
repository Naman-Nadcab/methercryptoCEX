/**
 * Batched Redis backup of in-memory L2 (default 50ms). No DB reads — cache warm path only.
 */

import { snapshotTop } from './spot-in-memory-orderbook.service.js';
import { setOrderbookCache } from './spot-orderbook-cache.service.js';
import { logger } from '../lib/logger.js';

const COALESCE_MS = 50;
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const symbols = [...dirty];
  dirty.clear();
  for (const symbol of symbols) {
    try {
      const raw = snapshotTop(symbol);
      await setOrderbookCache({ ...raw, symbol, lastUpdateId: raw.lastUpdateId });
    } catch (e) {
      logger.warn('Orderbook Redis backup failed', {
        symbol,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/** At most one Redis write per symbol per COALESCE_MS. */
export function scheduleOrderbookRedisBackup(symbol: string): void {
  dirty.add(symbol);
  if (timer != null) return;
  timer = setTimeout(() => {
    void flush();
  }, COALESCE_MS);
}

/** @deprecated Use scheduleOrderbookRedisBackup */
export const scheduleOrderbookRefresh = scheduleOrderbookRedisBackup;
