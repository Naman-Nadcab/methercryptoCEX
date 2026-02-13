/**
 * Phase-8 Step-5: Match Poller.
 * Poll engine using persistent cursor; insert events into settlement_events.
 * Cursor survives restarts (stored in settlement_poller_cursor).
 * Phase-9: Resumes from latest system snapshot when cursor is 0.
 */
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { fetchMatches } from './engine-client.js';
import { initializeRecoveryState } from './snapshot-service.js';

const POLL_INTERVAL_MS = 2_000;

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
  for (const ev of events) {
    await db.query(
      `INSERT INTO settlement_events (engine_event_id, payload, status)
       VALUES ($1, $2::jsonb, 'pending')
       ON CONFLICT (engine_event_id) DO NOTHING`,
      [ev.event_id, JSON.stringify(ev)]
    );
  }
  await setLastEngineEventId(last_id);
  logger.debug('Match poller inserted events', { count: events.length, last_id });
}

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

export function startMatchPoller(): void {
  if (pollIntervalId != null) {
    return;
  }
  pollIntervalId = setInterval(() => {
    pollOnce().catch((err) => {
      logger.error('Match poller error', { error: err instanceof Error ? err.message : String(err) });
    });
  }, POLL_INTERVAL_MS);
  logger.info('Match poller started');
}

export function stopMatchPoller(): void {
  if (pollIntervalId != null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    logger.info('Match poller stopped');
  }
}
