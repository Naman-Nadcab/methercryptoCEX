/**
 * File snapshot of writer L2 + WS seq + JetStream offset + per-symbol writer_seq (persistent volume / bind mount).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import {
  exportWriterOrderbookState,
  importWriterOrderbookState,
  type WriterOrderbookPersisted,
} from './spot-orderbook-ws-engine.service.js';
import type { OrderbookSnapshot } from './spot-orderbook-cache.service.js';
import { listSymbolsWithMemoryBooks, replaceFromSnapshot, snapshotTop } from './spot-in-memory-orderbook.service.js';
import { isNatsSpotPipelineConfigured } from './nats.service.js';
import { initWriterStateFromSnapshot, exportWriterSeqSnapshot } from './spot-orderbook-writer-state.service.js';
import { redis } from '../lib/redis.js';

export type SpotWriterSnapshotFileV1 = {
  version: 1;
  shardId: number;
  ws: WriterOrderbookPersisted;
  books: Record<string, OrderbookSnapshot>;
};

export type SpotWriterSnapshotFileV2 = {
  version: 2;
  shardId: number;
  /** Last JetStream stream sequence successfully acked (SPOT_MATCH). Resume consumer at +1 after consumer reset. */
  lastSpotMatchStreamSeq: number;
  /** Monotonic writer_seq per symbol (from publishers). */
  perSymbolWriterSeq: Record<string, number>;
  /** Last applied event_key per symbol (debug / audit). */
  perSymbolLastEventKey: Record<string, string>;
  /** Optional object storage URI or external checkpoint (ops-managed). */
  snapshotStorageUri?: string;
  ws: WriterOrderbookPersisted;
  books: Record<string, OrderbookSnapshot>;
};

/** Align Redis INCR keys with snapshot so next publish continues monotonic seq after failover. */
async function restoreRedisWriterSeqKeys(perSymbol: Record<string, number>): Promise<void> {
  for (const [sym, seq] of Object.entries(perSymbol)) {
    if (typeof seq !== 'number' || seq < 0) continue;
    const k = sym.toUpperCase();
    try {
      await redis.set(`spot:match:writer_seq:${k}`, String(seq));
    } catch {
      /* best-effort */
    }
  }
}

function snapshotPath(): string {
  const base = config.nats.snapshotPath;
  if (config.nats.shardTotal > 1) {
    const dir = path.dirname(base);
    const ext = path.extname(base);
    const name = path.basename(base, ext);
    return path.join(dir, `${name}-shard${config.nats.shardId}${ext || '.json'}`);
  }
  return base;
}

export async function loadWriterSnapshotIfPresent(): Promise<void> {
  if (!isNatsSpotPipelineConfigured() || !config.nats.orderbookWriterEnabled) return;
  const p = snapshotPath();
  try {
    const raw = await fs.readFile(p, 'utf8');
    const data = JSON.parse(raw) as SpotWriterSnapshotFileV1 | SpotWriterSnapshotFileV2;
    if (data.version === 2) {
      const d = data as SpotWriterSnapshotFileV2;
      if (!d.ws || !d.books) return;
      initWriterStateFromSnapshot({
        lastSpotMatchStreamSeq: d.lastSpotMatchStreamSeq ?? 0,
        perSymbolWriterSeq: d.perSymbolWriterSeq ?? {},
        perSymbolLastEventKey: d.perSymbolLastEventKey ?? {},
      });
      await restoreRedisWriterSeqKeys(d.perSymbolWriterSeq ?? {});
      for (const snap of Object.values(d.books)) {
        replaceFromSnapshot(snap);
      }
      importWriterOrderbookState(d.ws);
      logger.info('Orderbook writer snapshot loaded (v2)', {
        path: p,
        symbols: Object.keys(d.books).length,
        lastSpotMatchStreamSeq: d.lastSpotMatchStreamSeq ?? 0,
      });
      return;
    }
    if (data.version === 1) {
      const d = data as SpotWriterSnapshotFileV1;
      if (!d.ws || !d.books) return;
      initWriterStateFromSnapshot({
        lastSpotMatchStreamSeq: 0,
        perSymbolWriterSeq: {},
        perSymbolLastEventKey: {},
      });
      await restoreRedisWriterSeqKeys({});
      for (const snap of Object.values(d.books)) {
        replaceFromSnapshot(snap);
      }
      importWriterOrderbookState(d.ws);
      logger.info('Orderbook writer snapshot loaded (v1 → upgrade to v2 on next save)', {
        path: p,
        symbols: Object.keys(d.books).length,
      });
      return;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Orderbook writer snapshot load failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function saveWriterSnapshot(): Promise<void> {
  if (!isNatsSpotPipelineConfigured() || !config.nats.orderbookWriterEnabled) return;
  const ws = exportWriterOrderbookState();
  const seqMeta = exportWriterSeqSnapshot();
  const syms = new Set([...Object.keys(ws.lastSnapshots), ...listSymbolsWithMemoryBooks()]);
  const books: Record<string, OrderbookSnapshot> = {};
  for (const sym of syms) {
    books[sym] = snapshotTop(sym, 500);
  }
  const storageUri = process.env.ORDERBOOK_SNAPSHOT_STORAGE_URI?.trim();
  const payload: SpotWriterSnapshotFileV2 = {
    version: 2,
    shardId: config.nats.shardId,
    lastSpotMatchStreamSeq: seqMeta.lastSpotMatchStreamSeq,
    perSymbolWriterSeq: seqMeta.perSymbolWriterSeq,
    perSymbolLastEventKey: seqMeta.perSymbolLastEventKey,
    ...(storageUri ? { snapshotStorageUri: storageUri } : {}),
    ws,
    books,
  };
  const p = snapshotPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(payload), 'utf8');
}
