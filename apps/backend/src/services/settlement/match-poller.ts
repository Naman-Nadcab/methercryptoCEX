/**
 * Match poller: per-engine cursor in settlement_engine_poll_cursor; fetches GET /engine/matches
 * for every configured instance so no shard misses events. Inserts use (match_engine_id, engine_event_id) dedupe.
 */
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { sendAlertWebhook } from '../../lib/alert-webhook.js';
import { fetchMatchesForEngine } from './engine-client.js';
import { initializeRecoveryState } from './snapshot-service.js';
import { persistEngineMatchEvents } from './match-event-persistence.service.js';
import { listMatchingEngineInstances } from './matching-engine-registry.js';
import { refreshAllMatchingEngineHealth } from './matching-engine-runtime-health.service.js';

const POLL_INTERVAL_MS = 2_000;
const BACKOFF_INTERVAL_MS = 30_000;
const BACKOFF_LOG_EVERY_N = 5;
const HEALTH_REFRESH_MS = 5_000;

export async function getPollCursorForEngine(engineId: string): Promise<number> {
  const r = await db.query<{ last_after_id: string }>(
    `SELECT last_after_id::text FROM settlement_engine_poll_cursor WHERE engine_id = $1`,
    [engineId]
  );
  if (r.rows.length === 0) return 0;
  return parseInt(r.rows[0]!.last_after_id, 10) || 0;
}

export async function bumpPollCursorForEngine(engineId: string, nextAfter: number): Promise<void> {
  await db.query(
    `INSERT INTO settlement_engine_poll_cursor (engine_id, last_after_id) VALUES ($1, $2)
     ON CONFLICT (engine_id) DO UPDATE SET last_after_id = GREATEST(settlement_engine_poll_cursor.last_after_id, EXCLUDED.last_after_id)`,
    [engineId, nextAfter]
  );
}

/**
 * When Postgres cursor is ahead of the engine's max event id (engine restart, WAL replay gap, etc.),
 * GET /engine/matches returns nothing forever because GREATEST-only bumps never decrease the cursor.
 * Realign so polling and syncEngineMatchesAfterPlace can see new matches again.
 */
export async function reconcilePollCursorIfEngineBehind(
  engineId: string,
  dbAfterId: number,
  engineLastId: number
): Promise<boolean> {
  if (!(engineLastId > 0 && engineLastId < dbAfterId)) return false;
  const rewindAfterId = 0;
  await db.query(
    `INSERT INTO settlement_engine_poll_cursor (engine_id, last_after_id) VALUES ($1, $2)
     ON CONFLICT (engine_id) DO UPDATE SET last_after_id = EXCLUDED.last_after_id`,
    [engineId, rewindAfterId]
  );
  logger.warn('settlement_engine_poll_cursor reconciled down (engine max id behind DB cursor)', {
    engineId,
    dbAfterId,
    engineLastId,
    rewoundTo: rewindAfterId,
  });
  return true;
}

async function pollOneEngine(inst: { id: string; baseUrl: string }): Promise<boolean> {
  let afterId = await getPollCursorForEngine(inst.id);
  if (afterId === 0 && inst.id === 'default') {
    const recoveryAnchor = await initializeRecoveryState();
    if (recoveryAnchor > 0) {
      afterId = recoveryAnchor;
      await bumpPollCursorForEngine(inst.id, recoveryAnchor);
      logger.info('Match poller resumed from recovery anchor', {
        engine_id: inst.id,
        engine_event_id: afterId,
      });
    }
  }
  try {
    let { last_id, events } = await fetchMatchesForEngine(inst.baseUrl, afterId, inst.id);
    if (events.length === 0 && last_id > 0 && last_id < afterId) {
      const fixed = await reconcilePollCursorIfEngineBehind(inst.id, afterId, last_id);
      if (fixed) {
        afterId = 0;
        ({ last_id, events } = await fetchMatchesForEngine(inst.baseUrl, afterId, inst.id));
      }
    }
    if (events.length === 0) {
      if (last_id > afterId) {
        await bumpPollCursorForEngine(inst.id, last_id);
      }
      return true;
    }
    await persistEngineMatchEvents(events, 'match_poller');
    let maxId = afterId;
    for (const ev of events) {
      if (ev.event_id > maxId) maxId = ev.event_id;
    }
    await bumpPollCursorForEngine(inst.id, maxId);
    logger.debug('Match poller inserted events', {
      engine: inst.id,
      count: events.length,
      last_id,
      cursorToSet: maxId,
    });
    return true;
  } catch {
    return false;
  }
}

async function pollOnce(): Promise<void> {
  await refreshAllMatchingEngineHealth();
  const instances = listMatchingEngineInstances();
  const results = await Promise.all(instances.map((inst) => pollOneEngine(inst)));
  const okCount = results.filter(Boolean).length;
  if (okCount === 0) {
    throw new Error('All matching engine instances unreachable');
  }
}

let pollIntervalId: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
let healthIntervalId: ReturnType<typeof setInterval> | null = null;
let isBackoff = false;
let consecutiveFailures = 0;

function scheduleNext(intervalMs: number): void {
  pollIntervalId = setTimeout(async () => {
    try {
      await pollOnce();
      if (isBackoff) {
        isBackoff = false;
        consecutiveFailures = 0;
        pollIntervalId = setInterval(schedulePoll, POLL_INTERVAL_MS);
        logger.info('Match poller resumed (at least one engine back online)');
      }
    } catch (err) {
      isBackoff = true;
      consecutiveFailures++;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (consecutiveFailures === 1) {
        sendAlertWebhook({
          type: 'engine_unavailable',
          message:
            'Match poller: all engine instances unreachable, backoff mode. No new matches until at least one engine responds.',
          error: errMsg,
        }).catch(() => {});
      }
      const shouldLog = consecutiveFailures % BACKOFF_LOG_EVERY_N === 1;
      if (shouldLog) {
        logger.warn('Match poller: all engines unavailable, backoff mode', {
          error: errMsg,
          nextPollMs: BACKOFF_INTERVAL_MS,
        });
      }
      scheduleNext(BACKOFF_INTERVAL_MS);
    }
  }, intervalMs);
}

function schedulePoll(): void {
  pollOnce().catch((err) => {
    if (pollIntervalId != null) {
      clearInterval(pollIntervalId as ReturnType<typeof setInterval>);
      pollIntervalId = null;
    }
    isBackoff = true;
    consecutiveFailures++;
    if (consecutiveFailures === 1) {
      sendAlertWebhook({
        type: 'engine_unavailable',
        message:
          'Match poller: all engine instances unreachable, switching to backoff. No new matches until at least one engine responds.',
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
    logger.warn('Match poller: all engines unavailable, switching to backoff', {
      error: err instanceof Error ? err.message : String(err),
      nextPollMs: BACKOFF_INTERVAL_MS,
    });
    scheduleNext(BACKOFF_INTERVAL_MS);
  });
}

export function startMatchPoller(): void {
  if (pollIntervalId != null) {
    return;
  }
  void refreshAllMatchingEngineHealth();
  healthIntervalId = setInterval(() => void refreshAllMatchingEngineHealth(), HEALTH_REFRESH_MS);
  pollIntervalId = setInterval(schedulePoll, POLL_INTERVAL_MS);
  setTimeout(() => schedulePoll(), 0);
  logger.info('Match poller started (multi-engine aware)');
}

export function stopMatchPoller(): void {
  if (healthIntervalId != null) {
    clearInterval(healthIntervalId);
    healthIntervalId = null;
  }
  if (pollIntervalId != null) {
    clearInterval(pollIntervalId);
    clearTimeout(pollIntervalId);
    pollIntervalId = null;
    logger.info('Match poller stopped');
  }
}
