/**
 * Admin metrics WebSocket: broadcast real-time events to admin dashboard.
 * Channel: admin:metrics. Events: trade_executed, order_created, deposit_confirmed,
 * withdrawal_requested, p2p_order_created, aml_alert_triggered.
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';

const ADMIN_METRICS_CHANNEL = 'admin:metrics';

export type AdminMetricsEventType =
  | 'connected'
  | 'trade_executed'
  | 'order_created'
  | 'deposit_confirmed'
  | 'withdrawal_requested'
  | 'p2p_order_created'
  | 'aml_alert_triggered';

export interface AdminMetricsEvent {
  type: AdminMetricsEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

interface AdminConnection {
  id: string;
  socket: WebSocket;
  adminId: string;
  connectedAt: number;
}

const connections = new Map<string, AdminConnection>();

function genId(): string {
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function send(socket: WebSocket, payload: AdminMetricsEvent): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch (e) {
    logger.debug('Admin WS send failed', { error: e instanceof Error ? e.message : 'Unknown' });
  }
}

/**
 * Register a new admin WebSocket connection. Call after verifying admin JWT.
 */
export function registerAdminConnection(socket: WebSocket, adminId: string): string {
  const id = genId();
  connections.set(id, { id, socket, adminId, connectedAt: Date.now() });

  socket.on('close', () => {
    connections.delete(id);
  });

  send(socket, {
    type: 'connected',
    data: { clientId: id, adminId },
    timestamp: Date.now(),
  });

  return id;
}

export function unregisterAdminConnection(connectionId: string): void {
  connections.delete(connectionId);
}

/**
 * Broadcast an admin metrics event to all connected admin clients.
 */
export function broadcastAdminMetrics(type: AdminMetricsEventType, data: Record<string, unknown>): void {
  const payload: AdminMetricsEvent = { type, data, timestamp: Date.now() };
  const raw = JSON.stringify(payload);
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

/** Convenience: trade executed */
export function publishTradeExecuted(trade: { id?: string; market?: string; side?: string; price?: string; quantity?: string; user_id?: string }): void {
  broadcastAdminMetrics('trade_executed', trade);
}

/** Convenience: order created */
export function publishOrderCreated(order: { id?: string; market?: string; side?: string; type?: string; user_id?: string }): void {
  broadcastAdminMetrics('order_created', order);
}

/** Convenience: deposit confirmed */
export function publishDepositConfirmed(deposit: { id?: string; user_id?: string; amount?: string; currency_id?: string }): void {
  broadcastAdminMetrics('deposit_confirmed', deposit);
}

/** Convenience: withdrawal requested */
export function publishWithdrawalRequested(withdrawal: { id?: string; user_id?: string; amount?: string; to_address?: string }): void {
  broadcastAdminMetrics('withdrawal_requested', withdrawal);
}

/** Convenience: P2P order created */
export function publishP2POrderCreated(order: { id?: string; ad_id?: string; buyer_id?: string; seller_id?: string; crypto_amount?: string }): void {
  broadcastAdminMetrics('p2p_order_created', order);
}

/** Convenience: AML alert triggered */
export function publishAmlAlertTriggered(alert: { id?: string; user_id?: string; alert_type?: string; severity?: string }): void {
  broadcastAdminMetrics('aml_alert_triggered', alert);
}

export function getAdminMetricsConnectionCount(): number {
  return connections.size;
}
