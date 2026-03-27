/**
 * Phase-8 Step-5: Match Poller.
 * Poll engine using persistent cursor; insert events into settlement_events.
 * Cursor survives restarts (stored in settlement_poller_cursor).
 * Phase-9: Resumes from latest system snapshot when cursor is 0.
 * Graceful degrade: when engine is down, back off to 30s and log at warn (no error spam).
 * Tier-1: On first engine failure, send alert webhook so ops are notified.
 */
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { sendAlertWebhook } from '../../lib/alert-webhook.js';
import { fetchMatches } from './engine-client.js';
import { initializeRecoveryState } from './snapshot-service.js';

const POLL_INTERVAL_MS = 2_000;
const BACKOFF_INTERVAL_MS = 30_000;
const BACKOFF_LOG_EVERY_N = 5; // log warn only every Nth backoff poll

async function getLastEngineEventId(): Promise<number> {
  const r = await db.query<{ last_engine_event_id: string }>(
    `SELECT last_engine_event_id FROM settlement_poller_cursor WHERE id = 1`
  );
  if (r.rows.length === 0) {
    return 0;
  }
  return parseInt(r.rows[0]!.last_engine_event_id, 10) || 0;
}

async function setLastEngineEventId(lastId: number): Promise<void> {
  await db.query(
    `UPDATE settlement_poller_cursor SET last_engine_event_id = $1 WHERE id = 1`,
    [lastId]
  );
}

async function pollOnce(): Promise<void> {
  let afterId = await getLastEngineEventId();
  if (afterId === 0) {
    const recovery_anchor = await initializeRecoveryState();
    if (recovery_anchor > 0) {
      afterId = recovery_anchor;
      await setLastEngineEventId(recovery_anchor);
      logger.info('Match poller resumed from recovery anchor', { engine_event_id: afterId });
    }
  }
  const { last_id, events } = await fetchMatches(afterId);
  if (events.length === 0) {
    if (last_id > afterId) {
      await setLastEngineEventId(last_id);
    }
    return;
  }
  let maxInsertedId = afterId;
  for (const ev of events) {
    await db.query(
      `INSERT INTO settlement_events (engine_event_id, payload, status)
       VALUES ($1, $2::jsonb, 'pending')
       ON CONFLICT (engine_event_id) DO NOTHING`,
      [ev.event_id, JSON.stringify(ev)]
    );
    if (ev.event_id > maxInsertedId) maxInsertedId = ev.event_id;
  }
  const cursorToSet = events.length > 0 ? maxInsertedId : last_id;
  await setLastEngineEventId(cursorToSet);
  logger.debug('Match poller inserted events', { count: events.length, last_id, cursorToSet });
}

let pollIntervalId: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
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
        logger.info('Match poller resumed (engine back online)');
      }
    } catch (err) {
      isBackoff = true;
      consecutiveFailures++;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (consecutiveFailures === 1) {
        sendAlertWebhook({
          type: 'engine_unavailable',
          message: 'Match poller: engine unavailable, backoff mode. No new matches until engine is back.',
          error: errMsg,
        }).catch(() => {});
      }
      const shouldLog = consecutiveFailures % BACKOFF_LOG_EVERY_N === 1;
      if (shouldLog) {
        logger.warn('Match poller: engine unavailable, backoff mode', {
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
        message: 'Match poller: engine unavailable, switching to backoff. No new matches until engine is back.',
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
    logger.warn('Match poller: engine unavailable, switching to backoff', {
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
  pollIntervalId = setInterval(schedulePoll, POLL_INTERVAL_MS);
  logger.info('Match poller started');
}

export function stopMatchPoller(): void {
  if (pollIntervalId != null) {
    clearTimeout(pollIntervalId);
    pollIntervalId = null;
    logger.info('Match poller stopped');
  }
}
