/**
 * Admin control events WebSocket: broadcast control_status_changed, emergency_level_changed,
 * incident_created, service_restarted, liquidity_kill_activated to admin dashboard.
 * Channel: /api/v1/admin/ws/events
 *
 * Debounced: same event type is coalesced within a 5s window to prevent UI spam.
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import { eventBus, type EventChannel } from '../lib/eventBus.js';

export type AdminControlEventType =
  | 'connected'
  | 'control_status_changed'
  | 'emergency_level_changed'
  | 'incident_created'
  | 'service_restarted'
  | 'liquidity_kill_activated'
  | 'health_score_updated'
  | 'timeline_event'
  | 'mm_circuit_changed'
  | 'admin_session_terminated';

export interface AdminControlEventMessage {
  event: AdminControlEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

interface AdminEventsConnection {
  id: string;
  socket: WebSocket;
  adminId: string;
  connectedAt: number;
}

const connections = new Map<string, AdminEventsConnection>();
const DEBOUNCE_MS = 5000;
const lastBroadcast = new Map<AdminControlEventType, number>();

function genId(): string {
  return `admin-events-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function send(socket: WebSocket, message: AdminControlEventMessage): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (e) {
    logger.debug('Admin events WS send failed', { error: e instanceof Error ? e.message : 'Unknown' });
  }
}

export function registerAdminEventsConnection(socket: WebSocket, adminId: string): string {
  const id = genId();
  connections.set(id, { id, socket, adminId, connectedAt: Date.now() });

  socket.on('close', () => {
    connections.delete(id);
  });

  send(socket, {
    event: 'connected',
    payload: { clientId: id },
    timestamp: Date.now(),
  });

  return id;
}

export function unregisterAdminEventsConnection(connectionId: string): void {
  connections.delete(connectionId);
}

const EVENT_TO_CHANNEL: Partial<Record<AdminControlEventType, EventChannel>> = {
  control_status_changed: 'system:status',
  emergency_level_changed: 'system:status',
  incident_created: 'incident:update',
  health_score_updated: 'system:status',
};

const ALWAYS_BROADCAST: Set<AdminControlEventType> = new Set([
  'incident_created',
  'emergency_level_changed',
  'liquidity_kill_activated',
  'service_restarted',
  'mm_circuit_changed',
  'admin_session_terminated',
]);

export function broadcastAdminControlEvent(event: AdminControlEventType, payload: Record<string, unknown>): void {
  const now = Date.now();

  if (!ALWAYS_BROADCAST.has(event)) {
    const last = lastBroadcast.get(event) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
  }
  lastBroadcast.set(event, now);

  const message: AdminControlEventMessage = { event, payload, timestamp: now };
  const raw = JSON.stringify(message);
  for (const conn of connections.values()) {
    if (conn.socket.readyState === 1) {
      try {
        conn.socket.send(raw);
      } catch {
        // skip
      }
    }
  }

  const channel = EVENT_TO_CHANNEL[event];
  if (channel) {
    eventBus.publish(channel, { ...payload, controlEvent: event }, 'control');
  }
  eventBus.publish('activity:update', { ...payload, action: event }, 'control');
}

export function getAdminEventsConnectionCount(): number {
  return connections.size;
}
