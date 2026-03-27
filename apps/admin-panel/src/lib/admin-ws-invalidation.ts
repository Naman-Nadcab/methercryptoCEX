/**
 * Admin WebSocket event → query invalidation mapping.
 * Ensures only relevant queries are invalidated when backend state changes.
 * Pattern: onEvent(event) → invalidateQueries(keys) → refetch data.
 */

import type { QueryClient } from '@tanstack/react-query';

/** Events broadcast by /api/v1/admin/ws/events (excluding connected, error, pong). */
export type AdminWsInvalidationEvent =
  | 'control_status_changed'
  | 'emergency_level_changed'
  | 'incident_created'
  | 'service_restarted'
  | 'liquidity_kill_activated'
  | 'health_score_updated';

/** Query key prefix; invalidateQueries matches any query that starts with the key. */
type QueryKeyPrefix = readonly string[];

/**
 * Map: WebSocket event → query key prefixes to invalidate.
 * Only these queries are refetched; unrelated data is not touched.
 */
export const ADMIN_WS_EVENT_QUERY_MAP: Record<AdminWsInvalidationEvent, QueryKeyPrefix[]> = {
  control_status_changed: [
    ['admin', 'control', 'status'],
    ['admin', 'control', 'asset-freeze'],
    ['admin', 'control', 'circuit-history'],
    ['admin', 'control', 'events'],
    ['admin', 'trading-halt'],
  ],
  emergency_level_changed: [
    ['admin', 'control', 'emergency-level'],
    ['admin', 'control', 'status'],
  ],
  incident_created: [
    ['admin', 'control', 'incidents'],
    ['admin', 'control', 'events'],
  ],
  service_restarted: [
    ['admin', 'control', 'health'],
    ['admin', 'control', 'commands', 'history'],
    ['admin', 'control', 'events'],
  ],
  liquidity_kill_activated: [
    ['admin', 'control', 'status'],
    ['admin', 'control', 'events'],
  ],
  health_score_updated: [['admin', 'control', 'health-score']],
};

/**
 * Invalidate only the queries mapped to this event.
 * Does not refetch unrelated data; maintains performance.
 */
export function invalidateQueriesForEvent(
  queryClient: QueryClient,
  event: AdminWsInvalidationEvent
): void {
  const keys = ADMIN_WS_EVENT_QUERY_MAP[event];
  if (!keys?.length) return;
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey });
  }
}
