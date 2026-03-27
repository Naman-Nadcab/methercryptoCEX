/**
 * Circuit breaker history: log when circuit opens (system) or resets (admin).
 */

import { db } from '../lib/database.js';

export type CircuitEventType = 'open' | 'reset';

export async function logCircuitEvent(params: {
  eventType: CircuitEventType;
  reason?: string | null;
  actorType?: string;
  actorId?: string | null;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO circuit_breaker_history (event_type, reason, actor_type, actor_id)
       VALUES ($1, $2, $3, $4)`,
      [
        params.eventType,
        params.reason ?? null,
        params.actorType ?? 'system',
        params.actorId ?? null,
      ]
    );
  } catch (e) {
    // best-effort
  }
}

export async function getCircuitHistory(limit: number = 50): Promise<Array<{
  id: number;
  event_type: string;
  reason: string | null;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}>> {
  const r = await db.query(
    `SELECT id, event_type, reason, actor_type, actor_id, created_at::text
     FROM circuit_breaker_history
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return (r.rows ?? []) as Array<{
    id: number;
    event_type: string;
    reason: string | null;
    actor_type: string;
    actor_id: string | null;
    created_at: string;
  }>;
}
