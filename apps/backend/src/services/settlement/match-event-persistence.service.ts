/**
 * Tier-1: Durable match events before tape / settlement reliance on Rust memory.
 * Inserts into settlement_events (same row shape as match-poller) with ON CONFLICT DO NOTHING.
 * Call from: Rust inline response, syncEngineMatchesAfterPlace, match-poller.
 */
import type { PoolClient } from 'pg';
import { db, type Queryable } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { matchEventsPersistedTotal, matchEventsPersistFailedTotal } from '../../lib/prometheus-metrics.js';
import type { EngineMatchEvent } from './engine-client.js';
import { config } from '../../config/index.js';

/** Thrown when match events could not be written to Postgres after retries (Rust may already have matched). */
export class MatchEventPersistenceError extends Error {
  override readonly name = 'MatchEventPersistenceError';
  constructor(message: string) {
    super(message);
  }
}

export type MatchEventPersistSource = 'rust_inline' | 'sync_pull' | 'match_poller';

function eventToPayload(ev: EngineMatchEvent): Record<string, unknown> {
  return {
    event_id: ev.event_id,
    match_engine_id: ev.match_engine_id,
    symbol: ev.symbol,
    price: ev.price,
    qty: ev.qty,
    taker_order_id: ev.taker_order_id,
    maker_order_id: ev.maker_order_id,
    taker_user_id: ev.taker_user_id,
    maker_user_id: ev.maker_user_id,
    taker_side: ev.taker_side,
    timestamp: ev.timestamp,
  };
}

/**
 * Persist engine match events to settlement_events. Idempotent per (match_engine_id, engine_event_id).
 * Use the same client as an outer transaction when provided.
 */
export async function persistEngineMatchEvents(
  events: EngineMatchEvent[],
  source: MatchEventPersistSource,
  client?: PoolClient
): Promise<{ inserted: number }> {
  if (events.length === 0) return { inserted: 0 };
  let inserted = 0;
  const executor: Queryable = client ?? db;
  try {
    for (const ev of events) {
      const mid = ev.match_engine_id || 'default';
      const payload = JSON.stringify(eventToPayload({ ...ev, match_engine_id: mid }));
      const r = await executor.query(
        `INSERT INTO settlement_events (match_engine_id, engine_event_id, payload, status)
         VALUES ($1, $2, $3::jsonb, 'pending')
         ON CONFLICT (match_engine_id, engine_event_id) DO NOTHING`,
        [mid, ev.event_id, payload]
      );
      if ((r.rowCount ?? 0) > 0) inserted += 1;
    }
    if (inserted > 0) {
      matchEventsPersistedTotal.inc({ source }, inserted);
    }
    return { inserted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    matchEventsPersistFailedTotal.inc({ source });
    logger.error('CRITICAL: failed to persist engine match events to settlement_events', {
      source,
      count: events.length,
      firstEventId: events[0]?.event_id,
      error: msg,
    });
    throw e;
  }
}

export async function persistEngineMatchEventsWithRetry(
  events: EngineMatchEvent[],
  source: MatchEventPersistSource,
  opts?: { retries?: number; delayMs?: number; client?: PoolClient }
): Promise<{ inserted: number }> {
  const retries = opts?.retries ?? config.spot.matchEventPersistRetries;
  const delayMs = opts?.delayMs ?? 50;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await persistEngineMatchEvents(events, source, opts?.client);
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw new MatchEventPersistenceError(
    lastErr instanceof Error ? lastErr.message : String(lastErr)
  );
}
