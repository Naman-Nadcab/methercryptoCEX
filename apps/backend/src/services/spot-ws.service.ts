/**
 * Spot WebSocket: in-process broadcast for orderbook, trades, ticker, user.orders, user.trades.
 * Used by Fastify WS route and spot routes after order/cancel/match.
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';

type Connection = {
  id: string;
  socket: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
};

const connections = new Map<string, Connection>();

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function send(socket: WebSocket, payload: object): void {
  if (socket.readyState !== 1) return; // OPEN = 1
  try {
    socket.send(JSON.stringify({ ...payload, timestamp: Date.now() }));
  } catch (e) {
    logger.debug('Spot WS send failed', { error: e instanceof Error ? e.message : 'Unknown' });
  }
}

export function registerConnection(socket: WebSocket, userId?: string): string {
  const id = genId();
  connections.set(id, { id, socket, userId, subscriptions: new Set() });
  return id;
}

export function unregisterConnection(connectionId: string): void {
  connections.delete(connectionId);
}

export function subscribe(connectionId: string, channel: string): boolean {
  const conn = connections.get(connectionId);
  if (!conn) return false;
  // user.orders and user.trades require auth
  if ((channel === 'user.orders' || channel === 'user.trades') && !conn.userId) return false;
  conn.subscriptions.add(channel);
  return true;
}

export function unsubscribe(connectionId: string, channel: string): void {
  const conn = connections.get(connectionId);
  if (conn) conn.subscriptions.delete(channel);
}

export function setUserId(connectionId: string, userId: string): void {
  const conn = connections.get(connectionId);
  if (conn) conn.userId = userId;
}

/** Broadcast to all connections subscribed to this channel (e.g. orderbook:BTC_USDT, trades:BTC_USDT, ticker:BTC_USDT). */
export function broadcast(channel: string, type: string, data: unknown): void {
  const payload = { type, channel, data };
  for (const conn of connections.values()) {
    if (conn.subscriptions.has(channel)) send(conn.socket, payload);
  }
}

/** Send to all connections for this user subscribed to user.orders or user.trades. */
export function sendToUser(userId: string, channel: 'user.orders' | 'user.trades', type: string, data: unknown): void {
  const payload = { type, channel, data };
  for (const conn of connections.values()) {
    if (conn.userId === userId && conn.subscriptions.has(channel)) send(conn.socket, payload);
  }
}

export function getStats(): { connections: number; withUser: number } {
  let withUser = 0;
  for (const c of connections.values()) {
    if (c.userId) withUser++;
  }
  return { connections: connections.size, withUser };
}
