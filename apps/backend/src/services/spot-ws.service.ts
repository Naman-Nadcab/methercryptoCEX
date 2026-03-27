/**
 * Spot WebSocket: in-process broadcast for orderbook, trades, ticker, user.orders, user.trades.
 * Optional Redis Pub/Sub for multi-instance scaling (REDIS_WS_PUBSUB_ENABLED=true).
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';

const SPOT_WS_BROADCAST_CH = 'spot:ws:broadcast';
const SPOT_WS_USER_CH = 'spot:ws:user';

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

function countConnectionsForUser(userId: string): number {
  let n = 0;
  for (const c of connections.values()) {
    if (c.userId === userId) n++;
  }
  return n;
}

/**
 * Register a new connection. Returns connection id, or null if at capacity (DoS protection).
 */
export function registerConnection(socket: WebSocket, userId?: string): string | null {
  if (connections.size >= config.ws.maxConnectionsGlobal) {
    logger.warn('Spot WS: global connection limit reached', { limit: config.ws.maxConnectionsGlobal });
    return null;
  }
  if (userId && countConnectionsForUser(userId) >= config.ws.maxConnectionsPerUser) {
    logger.warn('Spot WS: per-user connection limit reached', { userId, limit: config.ws.maxConnectionsPerUser });
    return null;
  }
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
  // user.orders, user.trades, user.p2p_orders require auth
  if ((channel === 'user.orders' || channel === 'user.trades' || channel === 'user.p2p_orders') && !conn.userId) return false;
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

function doBroadcast(channel: string, type: string, data: unknown): void {
  const payload = { type, channel, data };
  for (const conn of connections.values()) {
    if (conn.subscriptions.has(channel)) send(conn.socket, payload);
  }
}

type UserChannel = 'user.orders' | 'user.trades' | 'user.p2p_orders';

function doSendToUser(userId: string, channel: UserChannel, type: string, data: unknown): void {
  const payload = { type, channel, data };
  for (const conn of connections.values()) {
    if (conn.userId === userId && conn.subscriptions.has(channel)) send(conn.socket, payload);
  }
}

/** Broadcast to all connections subscribed to this channel. Uses Redis Pub/Sub when REDIS_WS_PUBSUB_ENABLED. */
export function broadcast(channel: string, type: string, data: unknown): void {
  if (config.redis.wsPubSubEnabled) {
    redis.publish(SPOT_WS_BROADCAST_CH, JSON.stringify({ channel, type, data })).catch((e) =>
      logger.warn('Spot WS Redis publish failed', { error: e instanceof Error ? e.message : String(e) })
    );
  } else {
    doBroadcast(channel, type, data);
  }
}

/** Send to user connections. Uses Redis Pub/Sub when REDIS_WS_PUBSUB_ENABLED. */
export function sendToUser(userId: string, channel: UserChannel, type: string, data: unknown): void {
  if (config.redis.wsPubSubEnabled) {
    redis.publish(SPOT_WS_USER_CH, JSON.stringify({ userId, channel, type, data })).catch((e) =>
      logger.warn('Spot WS Redis publish failed', { error: e instanceof Error ? e.message : String(e) })
    );
  } else {
    doSendToUser(userId, channel, type, data);
  }
}

/** Send P2P order update to user. Subscribe to channel "user.p2p_orders". */
export function sendP2POrderUpdate(userId: string, order: { id: string; status: string; [k: string]: unknown }): void {
  sendToUser(userId, 'user.p2p_orders', 'p2p_order_update', order);
}

/** Start Redis Pub/Sub subscriber for multi-instance WS. Call once at server startup. */
export async function startSpotWsPubSub(): Promise<void> {
  if (!config.redis.wsPubSubEnabled) return;
  try {
    await redis.subscribe(SPOT_WS_BROADCAST_CH, (message: string) => {
      try {
        const { channel, type, data } = JSON.parse(message);
        if (channel && type) doBroadcast(channel, type, data);
      } catch (e) {
        logger.warn('Spot WS Redis message parse failed', { error: e instanceof Error ? e.message : String(e) });
      }
    });
    await redis.subscribe(SPOT_WS_USER_CH, (message: string) => {
      try {
        const { userId, channel, type, data } = JSON.parse(message);
        if (userId && channel && type) doSendToUser(userId, channel as UserChannel, type, data);
      } catch (e) {
        logger.warn('Spot WS Redis message parse failed', { error: e instanceof Error ? e.message : String(e) });
      }
    });
    logger.info('Spot WS Redis Pub/Sub enabled');
  } catch (e) {
    logger.warn('Spot WS Redis Pub/Sub failed to start', { error: e instanceof Error ? e.message : String(e) });
  }
}

export function getStats(): { connections: number; withUser: number } {
  let withUser = 0;
  for (const c of connections.values()) {
    if (c.userId) withUser++;
  }
  return { connections: connections.size, withUser };
}
