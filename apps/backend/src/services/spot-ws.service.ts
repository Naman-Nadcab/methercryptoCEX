/**
 * Spot WebSocket: in-process broadcast for orderbook, trades, ticker, user.orders, user.trades.
 * Optional Redis Pub/Sub for multi-instance scaling (REDIS_WS_PUBSUB_ENABLED=true).
 * Pre-serialized wire: broadcastSerialized / sendToUserSerialized avoid per-client JSON.stringify.
 */

import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import {
  spotWsDisconnectsTotal,
  spotWsLocalPerConnSkippedTotal,
} from '../lib/prometheus-metrics.js';

const SPOT_WS_BROADCAST_CH = 'spot:ws:broadcast';
const SPOT_WS_USER_CH = 'spot:ws:user';
/** Redis + local: fan-out to every spot WS connection (adaptive hints; no subscribe). */
export const SPOT_WS_SYSTEM_CHANNEL = '__spot_system__';

export type WsPublicPriority = 'orderbook' | 'ticker' | 'trades';

type OutboundQueued = { stream: WsPublicPriority; channel: string; wire: string };

type Connection = {
  id: string;
  socket: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
  /** Priority queue (orderbook < trades < ticker); drained when socket drains below soft. */
  outQueue?: OutboundQueued[];
  netRttMs?: number;
  netLossPct?: number;
  netAt?: number;
};

const connections = new Map<string, Connection>();

/** Monotonic per-market sequence for public trades WS frames (gap / reorder detection on clients). */
const tradesFeedSeqBySymbol = new Map<string, number>();

export function nextTradesFeedSeq(symbol: string): number {
  const s = symbol.toUpperCase().replace(/-/g, '_');
  const n = (tradesFeedSeqBySymbol.get(s) ?? 0) + 1;
  tradesFeedSeqBySymbol.set(s, n);
  return n;
}

/** If a trades wire omits feed_seq (legacy publisher / other node), assign one on ingest. */
export function stampTradesFeedSeqOnWireIfNeeded(channel: string, wire: string): string {
  if (!channel.startsWith('trades:')) return wire;
  try {
    const o = JSON.parse(wire) as { type?: string; feed_seq?: unknown; [k: string]: unknown };
    if (o.type !== 'trades') return wire;
    if (typeof o.feed_seq === 'number' && Number.isFinite(o.feed_seq)) return wire;
    const sym = channel.slice('trades:'.length);
    if (!sym) return wire;
    return JSON.stringify({ ...o, feed_seq: nextTradesFeedSeq(sym) });
  } catch {
    return wire;
  }
}

let outboundDrainTimer: ReturnType<typeof setInterval> | null = null;

function ensureOutboundDrainLoop(): void {
  const wl = config.wsWriterLocal;
  if (!wl.publicQueueEnabled || outboundDrainTimer) return;
  outboundDrainTimer = setInterval(() => {
    for (const conn of connections.values()) drainPublicOutboundOnce(conn);
  }, wl.queueDrainIntervalMs);
}

function drainPublicOutboundOnce(conn: Connection): void {
  const q = conn.outQueue;
  if (!q?.length) return;
  while (q.length > 0) {
    const item = q[0]!;
    const { hard } = perConnBufferThresholds(item.stream);
    let b = 0;
    try {
      b = conn.socket.bufferedAmount;
    } catch {
      return;
    }
    if (item.stream !== 'orderbook' && hard > 0 && b >= hard) return;
    q.shift();
    sendRaw(conn.socket, item.wire);
  }
}

function enqueuePublicOutbound(conn: Connection, channel: string, wire: string, stream: WsPublicPriority): void {
  const max = config.wsWriterLocal.publicQueueMax;
  if (!conn.outQueue) conn.outQueue = [];
  const q = conn.outQueue;
  q.push({ stream, channel, wire });
  q.sort((a, b) => {
    const rank = (s: WsPublicPriority) => (s === 'orderbook' ? 0 : s === 'trades' ? 1 : 2);
    return rank(a.stream) - rank(b.stream);
  });
  while (q.length > max) {
    let dropped = false;
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i]!.stream === 'ticker') {
        q.splice(i, 1);
        dropped = true;
        break;
      }
    }
    if (!dropped) q.shift();
  }
}

export function recordSpotWsNetMetrics(connectionId: string, rttMs?: number, lossPct?: number): void {
  const conn = connections.get(connectionId);
  if (!conn) return;
  if (typeof rttMs === 'number' && rttMs >= 0 && rttMs < 120_000) conn.netRttMs = rttMs;
  if (typeof lossPct === 'number' && lossPct >= 0 && lossPct <= 100) conn.netLossPct = lossPct;
  conn.netAt = Date.now();
}

/** Feeds PID process variable inflation from client-reported RTT / loss (EWMA). */
export function getSpotWsNetworkInflationMs(): number {
  const c = config.wsWriterLocal;
  if (!c.netAdaptEnabled) return 0;
  const now = Date.now();
  let sumRtt = 0;
  let n = 0;
  let maxLoss = 0;
  for (const conn of connections.values()) {
    if (!conn.netAt || now - conn.netAt > 120_000) continue;
    if (conn.netRttMs != null) {
      sumRtt += conn.netRttMs;
      n++;
    }
    if (conn.netLossPct != null) maxLoss = Math.max(maxLoss, conn.netLossPct);
  }
  const avgRtt = n > 0 ? sumRtt / n : 0;
  const inflated = avgRtt * c.netRttInflationPerMs + maxLoss * c.netLossInflationPerPct;
  return Math.min(c.netInflationCapMs, inflated);
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function wireEnvelope(
  type: string,
  channel: string,
  data: unknown,
  opts?: { feed_seq?: number }
): string {
  const payload: Record<string, unknown> = {
    type,
    channel,
    data,
    timestamp: Date.now(),
  };
  if (opts?.feed_seq != null && Number.isFinite(opts.feed_seq)) {
    payload.feed_seq = opts.feed_seq;
  }
  return JSON.stringify(payload);
}

function sendRaw(socket: WebSocket, wire: string): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(wire);
  } catch (e) {
    logger.debug('Spot WS send failed', { error: e instanceof Error ? e.message : 'Unknown' });
  }
}

function broadcastRawLocal(channel: string, wire: string): void {
  for (const conn of connections.values()) {
    if (conn.subscriptions.has(channel)) sendRaw(conn.socket, wire);
  }
}

/** Single-node / no Redis WS pubsub: fan-out to subscribed connections on this process. */
export function broadcastToChannelLocal(channel: string, wire: string): void {
  broadcastRawLocal(channel, wire);
}

export function isPublicSpotMarketChannel(channel: string): boolean {
  return (
    channel.startsWith('orderbook:') || channel.startsWith('ticker:') || channel.startsWith('trades:')
  );
}

export function inferWsPublicPriority(
  channel: string,
  explicit?: string | null
): WsPublicPriority {
  if (explicit === 'orderbook' || explicit === 'ticker' || explicit === 'trades') return explicit;
  if (channel.startsWith('orderbook:')) return 'orderbook';
  if (channel.startsWith('ticker:')) return 'ticker';
  if (channel.startsWith('trades:')) return 'trades';
  return 'orderbook';
}

function perConnBufferThresholds(priority: WsPublicPriority): { soft: number; hard: number } {
  const wl = config.wsWriterLocal;
  if (priority === 'ticker') {
    return {
      soft: wl.perConnSoftTickerBytes > 0 ? wl.perConnSoftTickerBytes : wl.perConnSoftBufferBytes,
      hard: wl.perConnHardTickerBytes > 0 ? wl.perConnHardTickerBytes : wl.perConnHardBufferBytes,
    };
  }
  if (priority === 'trades') {
    return {
      soft: wl.perConnSoftTradesBytes > 0 ? wl.perConnSoftTradesBytes : wl.perConnSoftBufferBytes,
      hard: wl.perConnHardTradesBytes > 0 ? wl.perConnHardTradesBytes : wl.perConnHardBufferBytes,
    };
  }
  return { soft: wl.perConnSoftBufferBytes, hard: wl.perConnHardBufferBytes };
}

/**
 * Deliver to subscribers with per-connection backpressure for non-orderbook streams.
 * Orderbook is always sent (latency + recovery); ticker/trades skip hot sockets.
 * Ticker vs trades use separate soft/hard limits when configured.
 */
export function deliverPublicWireLocal(channel: string, wire: string, priority: WsPublicPriority): void {
  const { soft, hard } = perConnBufferThresholds(priority);
  const useQueue = config.wsWriterLocal.publicQueueEnabled;
  for (const conn of connections.values()) {
    if (!conn.subscriptions.has(channel)) continue;
    if (priority === 'orderbook') {
      sendRaw(conn.socket, wire);
      continue;
    }
    if (soft <= 0 && hard <= 0) {
      sendRaw(conn.socket, wire);
      continue;
    }
    let b = 0;
    try {
      b = conn.socket.bufferedAmount;
    } catch {
      sendRaw(conn.socket, wire);
      continue;
    }
    if (hard > 0 && b >= hard) {
      spotWsLocalPerConnSkippedTotal.labels('hard', priority).inc();
      continue;
    }
    if (soft > 0 && b >= soft) {
      if (useQueue) {
        enqueuePublicOutbound(conn, channel, wire, priority);
        continue;
      }
      spotWsLocalPerConnSkippedTotal.labels('soft', priority).inc();
      continue;
    }
    sendRaw(conn.socket, wire);
  }
}

/** Push to every open spot WS (adaptive UI hints). */
export function deliverSystemWireToAllConnections(wire: string): void {
  for (const conn of connections.values()) {
    sendRaw(conn.socket, wire);
  }
}

export function publishSystemWireToAll(wire: string): void {
  if (config.redis.wsPubSubEnabled) {
    redis
      .publish(SPOT_WS_BROADCAST_CH, JSON.stringify({ channel: SPOT_WS_SYSTEM_CHANNEL, wire }))
      .catch((e) => logger.warn('Spot WS system publish failed', { error: e instanceof Error ? e.message : String(e) }));
  } else {
    deliverSystemWireToAllConnections(wire);
  }
}

export function publishSpotBroadcastPayload(payload: {
  channel: string;
  wire: string;
  priority?: WsPublicPriority;
}): void {
  redis
    .publish(SPOT_WS_BROADCAST_CH, JSON.stringify(payload))
    .catch((e) => logger.warn('Spot WS Redis publish failed', { error: e instanceof Error ? e.message : String(e) }));
}

/** Sum of `bufferedAmount` for all open spot WS connections (approx outbound queue pressure). */
export function getSpotWsBroadcastBacklogBytes(): number {
  let sum = 0;
  for (const conn of connections.values()) {
    try {
      sum += conn.socket.bufferedAmount;
    } catch {
      /* ignore */
    }
  }
  return sum;
}

function normalizeUserIdKey(s: string): string {
  return String(s).toLowerCase().replace(/-/g, '');
}

function sendRawToUser(userId: string, channel: string, wire: string): void {
  const want = normalizeUserIdKey(userId);
  for (const conn of connections.values()) {
    if (conn.userId && normalizeUserIdKey(conn.userId) === want && conn.subscriptions.has(channel)) sendRaw(conn.socket, wire);
  }
}

function wireToString(wire: string | Uint8Array): string {
  return typeof wire === 'string' ? wire : new TextDecoder('utf-8', { fatal: false }).decode(wire);
}

/** Pre-serialized JSON wire; pass `Uint8Array` to avoid an extra string allocation upstream. */
export function broadcastSerialized(channel: string, wire: string | Uint8Array): void {
  const s = wireToString(wire);
  if (config.redis.wsPubSubEnabled) {
    redis
      .publish(SPOT_WS_BROADCAST_CH, JSON.stringify({ channel, wire: s }))
      .catch((e) => logger.warn('Spot WS Redis publish failed', { error: e instanceof Error ? e.message : String(e) }));
  } else {
    broadcastRawLocal(channel, s);
  }
}

export function countConnectionsForUser(userId: string): number {
  let n = 0;
  for (const c of connections.values()) {
    if (c.userId === userId) n++;
  }
  return n;
}

export function getConnectionUserId(connectionId: string): string | undefined {
  return connections.get(connectionId)?.userId;
}

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
  ensureOutboundDrainLoop();
  return id;
}

export function unregisterConnection(connectionId: string): void {
  if (connections.has(connectionId)) {
    connections.delete(connectionId);
    spotWsDisconnectsTotal.inc();
  }
}

export function subscribe(connectionId: string, channel: string): boolean {
  const conn = connections.get(connectionId);
  if (!conn) return false;
  if ((channel === 'user.orders' || channel === 'user.trades' || channel === 'user.p2p_orders') && !conn.userId) return false;
  if (channel.startsWith('p2p.order.') && !conn.userId) return false;
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

/** Legacy: stringify once then fan out. */
export function broadcast(channel: string, type: string, data: unknown): void {
  broadcastSerialized(channel, wireEnvelope(type, channel, data));
}

type UserChannel = 'user.orders' | 'user.trades' | 'user.p2p_orders';

export function sendToUser(userId: string, channel: UserChannel, type: string, data: unknown): void {
  sendToUserSerialized(userId, channel, wireEnvelope(type, channel, data));
}

export function sendToUserSerialized(userId: string, channel: UserChannel, wire: string): void {
  if (config.redis.wsPubSubEnabled) {
    redis
      .publish(SPOT_WS_USER_CH, JSON.stringify({ userId, channel, wire }))
      .catch((e) => logger.warn('Spot WS Redis publish failed', { error: e instanceof Error ? e.message : String(e) }));
  } else {
    sendRawToUser(userId, channel, wire);
  }
}

export function sendP2POrderUpdate(userId: string, order: { id: string; status: string; [k: string]: unknown }): void {
  sendToUser(userId, 'user.p2p_orders', 'p2p_order_update', order);
}

export async function startSpotWsPubSub(): Promise<void> {
  if (!config.redis.wsPubSubEnabled) return;
  try {
    await redis.subscribe(SPOT_WS_BROADCAST_CH, (message: string) => {
      try {
        const parsed = JSON.parse(message) as {
          channel?: string;
          wire?: string;
          type?: string;
          data?: unknown;
          priority?: string;
        };
        if (parsed.channel && typeof parsed.wire === 'string') {
          if (parsed.channel === SPOT_WS_SYSTEM_CHANNEL) {
            deliverSystemWireToAllConnections(parsed.wire);
            return;
          }
          const stampedWire = stampTradesFeedSeqOnWireIfNeeded(parsed.channel, parsed.wire);
          if (isPublicSpotMarketChannel(parsed.channel)) {
            const prio = inferWsPublicPriority(parsed.channel, parsed.priority ?? null);
            deliverPublicWireLocal(parsed.channel, stampedWire, prio);
          } else {
            broadcastRawLocal(parsed.channel, stampedWire);
          }
          return;
        }
        if (parsed.channel && parsed.type) {
          broadcastRawLocal(parsed.channel, wireEnvelope(parsed.type, parsed.channel, parsed.data));
        }
      } catch (e) {
        logger.warn('Spot WS Redis message parse failed', { error: e instanceof Error ? e.message : String(e) });
      }
    });
    await redis.subscribe(SPOT_WS_USER_CH, (message: string) => {
      try {
        const parsed = JSON.parse(message) as {
          userId?: string;
          channel?: string;
          wire?: string;
          type?: string;
          data?: unknown;
        };
        if (parsed.userId && parsed.channel && typeof parsed.wire === 'string') {
          sendRawToUser(parsed.userId, parsed.channel, parsed.wire);
          return;
        }
        if (parsed.userId && parsed.channel && parsed.type) {
          sendRawToUser(parsed.userId, parsed.channel, wireEnvelope(parsed.type, parsed.channel, parsed.data));
        }
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
