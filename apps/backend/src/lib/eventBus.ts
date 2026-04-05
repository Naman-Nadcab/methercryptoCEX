/**
 * Centralized Event Bus — single publish/subscribe point for all admin real-time events.
 *
 * Unifies the two existing WS channels (metrics + control events) under one API.
 * Existing services continue calling broadcastAdminMetrics / broadcastAdminControlEvent
 * directly; this bus provides an additional layer for new event types and cross-cutting
 * concerns (logging, rate-limiting, batching).
 *
 * Usage:
 *   eventBus.publish('activity:update', { action: 'trade_executed', ... });
 *   const unsub = eventBus.subscribe('alert:new', (payload) => { ... });
 */

import { logger } from './logger.js';

export type EventChannel =
  | 'activity:update'
  | 'alert:new'
  | 'incident:update'
  | 'system:status'
  | 'trade:new'
  | 'withdrawal:update'
  | 'deposit:update'
  | 'admin:action';

export interface BusEvent<T = Record<string, unknown>> {
  channel: EventChannel;
  payload: T;
  timestamp: number;
  source?: string;
}

type Handler<T = Record<string, unknown>> = (event: BusEvent<T>) => void;

class AdminEventBus {
  private handlers = new Map<EventChannel, Set<Handler>>();
  private allHandlers = new Set<Handler>();

  /**
   * Publish an event to a specific channel.
   */
  publish<T extends Record<string, unknown>>(channel: EventChannel, payload: T, source?: string): void {
    const event: BusEvent<T> = {
      channel,
      payload,
      timestamp: Date.now(),
      source,
    };

    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      for (const handler of channelHandlers) {
        try {
          handler(event as BusEvent);
        } catch (err) {
          logger.warn('EventBus handler error', {
            channel,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    for (const handler of this.allHandlers) {
      try {
        handler(event as BusEvent);
      } catch (err) {
        logger.warn('EventBus global handler error', {
          channel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Subscribe to a specific channel. Returns an unsubscribe function.
   */
  subscribe<T extends Record<string, unknown>>(channel: EventChannel, handler: Handler<T>): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler as Handler);
    return () => { set!.delete(handler as Handler); };
  }

  /**
   * Subscribe to ALL channels. Returns an unsubscribe function.
   */
  subscribeAll(handler: Handler): () => void {
    this.allHandlers.add(handler);
    return () => { this.allHandlers.delete(handler); };
  }

  /**
   * Get handler count (for diagnostics).
   */
  getSubscriberCount(channel?: EventChannel): number {
    if (channel) return this.handlers.get(channel)?.size ?? 0;
    let total = this.allHandlers.size;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }
}

export const eventBus = new AdminEventBus();
