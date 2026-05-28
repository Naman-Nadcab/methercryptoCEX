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

function isSameMatchEvent(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): boolean {
  if (!existing) return false;
  return (
    String(existing.match_engine_id ?? '') === String(incoming.match_engine_id ?? '') &&
    String(existing.event_id ?? '') === String(incoming.event_id ?? '') &&
    String(existing.symbol ?? '') === String(incoming.symbol ?? '') &&
    String(existing.taker_order_id ?? '') === String(incoming.taker_order_id ?? '') &&
    String(existing.maker_order_id ?? '') === String(incoming.maker_order_id ?? '') &&
    String(existing.taker_user_id ?? '') === String(incoming.taker_user_id ?? '') &&
    String(existing.maker_user_id ?? '') === String(incoming.maker_user_id ?? '') &&
    String(existing.taker_side ?? '') === String(incoming.taker_side ?? '') &&
    String(existing.price ?? '') === String(incoming.price ?? '') &&
    String(existing.qty ?? '') === String(incoming.qty ?? '')
  );
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
      if ((r.rowCount ?? 0) > 0) {
        inserted += 1;
        continue;
      }

      const existing = await executor.query<{ payload: Record<string, unknown> | null }>(
        `SELECT payload FROM settlement_events WHERE match_engine_id = $1 AND engine_event_id = $2 LIMIT 1`,
        [mid, ev.event_id]
      );
      const incomingPayload = JSON.parse(payload) as Record<string, unknown>;
      const existingPayload = existing.rows[0]?.payload ?? null;
      if (isSameMatchEvent(existingPayload, incomingPayload)) {
        continue;
      }

      // Engine restarted and reused event IDs; preserve event by reassigning a new per-engine id.
      let reassignedInserted = false;
      let reassignedId = ev.event_id;
      for (let attempt = 0; attempt < 3; attempt++) {
        const nextIdRow = await executor.query<{ next_id: string }>(
          `SELECT (COALESCE(MAX(engine_event_id), 0) + 1)::text AS next_id
             FROM settlement_events
            WHERE match_engine_id = $1`,
          [mid]
        );
        const nextId = parseInt(nextIdRow.rows[0]?.next_id ?? '0', 10) || ev.event_id + attempt + 1;
        const insReassigned = await executor.query(
          `INSERT INTO settlement_events (match_engine_id, engine_event_id, payload, status)
           VALUES ($1, $2, $3::jsonb, 'pending')
           ON CONFLICT (match_engine_id, engine_event_id) DO NOTHING`,
          [mid, nextId, payload]
        );
        if ((insReassigned.rowCount ?? 0) > 0) {
          reassignedInserted = true;
          reassignedId = nextId;
          inserted += 1;
          break;
        }
      }
      if (reassignedInserted) {
        logger.warn('settlement_event_id_collision_reassigned', {
          matchEngineId: mid,
          originalEngineEventId: ev.event_id,
          reassignedEngineEventId: reassignedId,
          source,
        });
      }
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
