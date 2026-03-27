'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import type { TimelineEventPayload } from '@/lib/control-api';
import { invalidateQueriesForEvent, ADMIN_WS_EVENT_QUERY_MAP, type AdminWsInvalidationEvent } from '@/lib/admin-ws-invalidation';

const RECONNECT_MS = 5000;
const WS_PATH = '/api/v1/admin/ws/events';

export type AdminControlEventType =
  | 'connected'
  | 'control_status_changed'
  | 'emergency_level_changed'
  | 'incident_created'
  | 'service_restarted'
  | 'liquidity_kill_activated'
  | 'health_score_updated'
  | 'timeline_event';

export interface AdminControlEventMessage {
  event: AdminControlEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface UseAdminControlEventsWsOptions {
  onTimelineEvent?: (entry: TimelineEventPayload) => void;
}

function getWsUrl(token: string): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * Connect to /api/v1/admin/ws/events and invalidate relevant queries on control events.
 * Optional onTimelineEvent: called for timeline_event so timeline can append without refetch.
 * Reconnects every 5 seconds if disconnected. No full page reload.
 */
export function useAdminControlEventsWs(options?: UseAdminControlEventsWsOptions) {
  const { onTimelineEvent } = options ?? {};
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimelineEventRef = useRef(onTimelineEvent);
  onTimelineEventRef.current = onTimelineEvent;

  const connect = useCallback(() => {
    if (typeof window === 'undefined' || !token) return;
    const url = getWsUrl(token);
    if (!url) return;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as AdminControlEventMessage;
          if (!msg.event || msg.event === 'error' || msg.event === 'pong' || msg.event === 'connected') return;
          if (msg.event === 'timeline_event') {
            const entry = msg.payload as unknown as TimelineEventPayload;
            if (entry?.event != null && entry?.timestamp != null) {
              onTimelineEventRef.current?.(entry);
            }
            return;
          }
          if (msg.event in ADMIN_WS_EVENT_QUERY_MAP) {
            invalidateQueriesForEvent(queryClient, msg.event as AdminWsInvalidationEvent);
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, RECONNECT_MS);
      };
      ws.onerror = () => {};
    } catch {
      reconnectRef.current = setTimeout(connect, RECONNECT_MS);
    }
  }, [token, queryClient]);

  useEffect(() => {
    if (token) connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, connect]);

  return null;
}
