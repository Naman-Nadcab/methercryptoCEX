/**
 * Settlement backlog metrics for /health, /metrics, and ops alerts.
 */
import { db } from '../lib/database.js';

export type SettlementBacklogSnapshot = {
  pendingCount: number;
  /** Seconds since created_at of oldest pending row; 0 if queue empty. */
  oldestPendingAgeSeconds: number;
};

let lastSnapshot: SettlementBacklogSnapshot = { pendingCount: 0, oldestPendingAgeSeconds: 0 };

export function getLastSettlementBacklogSnapshot(): SettlementBacklogSnapshot {
  return lastSnapshot;
}

export async function refreshSettlementBacklogSnapshot(): Promise<SettlementBacklogSnapshot> {
  try {
    const r = await db.query<{ cnt: string; oldest: string | null }>(
      `SELECT COUNT(*)::text AS cnt,
              EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::text AS oldest
       FROM settlement_events
       WHERE status = 'pending'`
    );
    const pendingCount = parseInt(r.rows[0]?.cnt ?? '0', 10) || 0;
    const oldestRaw = r.rows[0]?.oldest;
    const oldestPendingAgeSeconds =
      pendingCount === 0 || oldestRaw == null || oldestRaw === ''
        ? 0
        : Math.max(0, parseFloat(oldestRaw) || 0);
    lastSnapshot = { pendingCount, oldestPendingAgeSeconds };
    return lastSnapshot;
  } catch {
    lastSnapshot = { pendingCount: 0, oldestPendingAgeSeconds: 0 };
    return lastSnapshot;
  }
}
