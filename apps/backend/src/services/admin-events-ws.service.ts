/**
 * Admin control events WebSocket: broadcast control_status_changed, emergency_level_changed,
 * incident_created, service_restarted, liquidity_kill_activated to admin dashboard.
 * Channel: /api/v1/admin/ws/events
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';

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

interface AdminEventsConnection {
  id: string;
  socket: WebSocket;
  adminId: string;
  connectedAt: number;
}

const connections = new Map<string, AdminEventsConnection>();

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

export function broadcastAdminControlEvent(event: AdminControlEventType, payload: Record<string, unknown>): void {
  const message: AdminControlEventMessage = { event, payload, timestamp: Date.now() };
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
}

export function getAdminEventsConnectionCount(): number {
  return connections.size;
}
