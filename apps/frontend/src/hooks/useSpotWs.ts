'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';

const getWsUrl = (token: string | null): string => {
  let base = getApiBaseUrl();
  // WebSocket needs a valid base URL; getApiBaseUrl() returns '' in browser for same-origin
  if (!base && typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL;
    base = (envUrl && envUrl.trim()) ? envUrl.trim().replace(/\/$/, '') : 'http://localhost:4000';
  }
  if (!base) base = 'http://localhost:4000';
  base = base.replace(/\/$/, '').replace(/^http/, 'ws');
  const url = new URL('/api/v1/spot/ws', base);
  if (token) url.searchParams.set('token', token);
  return url.toString();
};

export type OrderbookLevel = { price: string; quantity: string };
export type OrderbookSnapshot = { symbol: string; bids: OrderbookLevel[]; asks: OrderbookLevel[]; lastUpdateId?: number };
export type TradeMessage = { id: string; market: string; side: string; price: string; quantity: string; time: string };
/** Normalize backend trade (created_at) to UI shape (time) so timestamps always display. */
export function normalizeTradeMessage(t: { id?: string; market?: string; side?: string; price?: string; quantity?: string; time?: string; created_at?: string }): TradeMessage {
  const time = t.time ?? t.created_at ?? '';
  return {
    id: t.id ?? '',
    market: t.market ?? '',
    side: t.side ?? '',
    price: t.price ?? '',
    quantity: t.quantity ?? '',
    time: typeof time === 'string' ? time : (time && typeof (time as Date).toISOString === 'function' ? (time as Date).toISOString() : ''),
  };
}
export type TickerMessage = {
  symbol: string;
  last_price: string | null;
  bid: string | null;
  ask: string | null;
  /** 24h quote turnover Σ(qty × price). */
  volume_24h?: string;
  /** 24h base-asset volume Σ(qty). */
  base_volume_24h?: string;
  /** First trade price in 24h window (for change %). */
  open_24h?: string | null;
  high_24h?: string | null;
  low_24h?: string | null;
  status?: string;
};
export type OrderUpdateMessage = { id: string; status: string; displayStatus?: string; market?: string; filled_quantity?: string; quantity?: string };
export type TradeUpdateMessage = { id: string; order_id: string; market: string; side: string; price: string; quantity: string; fee: string; fee_asset: string | null; created_at: string };

type WsMessage =
  | { type: 'pong' }
  | { type: 'subscribed'; channel: string }
  | { type: 'unsubscribed'; channel: string }
  | { type: 'orderbook_update'; data: OrderbookSnapshot }
  | { type: 'orderbook_snapshot'; data: OrderbookSnapshot }
  | { type: 'trades'; data: TradeMessage[] }
  | { type: 'ticker'; data: TickerMessage }
  | { type: 'order_update'; data: OrderUpdateMessage }
  | { type: 'user_trade'; data: TradeUpdateMessage }
  | { type: 'trade'; data: TradeUpdateMessage }; // Legacy alias for user_trade

export interface UseSpotWsCallbacks {
  /** data, and optional type: 'orderbook_snapshot' | 'orderbook_update' (snapshot = initial, apply immediately) */
  onOrderbook?: (data: OrderbookSnapshot, type?: 'orderbook_snapshot' | 'orderbook_update') => void;
  onTrades?: (data: TradeMessage[]) => void;
  onTicker?: (data: TickerMessage) => void;
  onOrderUpdate?: (data: OrderUpdateMessage) => void;
  onTradeUpdate?: (data: TradeUpdateMessage) => void;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 20;
/** Defer connection to avoid "interrupted while page loading" (e.g. React Strict Mode unmount). */
const CONNECT_DEFER_MS = 300;

export function useSpotWs(callbacks: UseSpotWsCallbacks = {}) {
  const [connected, setConnected] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const connectCleanupRef = useRef<(() => void) | null>(null);
  const channelsRef = useRef<Set<string>>(new Set());
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const token = useAuthStore((s) => s.accessToken);

  const subscribe = useCallback((channel: string) => {
    channelsRef.current.add(channel);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    channelsRef.current.delete(channel);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const connect = () => {
      const url = getWsUrl(token);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        wsRef.current = ws;
        channelsRef.current.forEach((ch) => {
          try {
            ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
          } catch {
            // ignore
          }
        });
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempt((r) => r + 1);
          }, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          const c = callbacksRef.current;
          switch (msg.type) {
            case 'orderbook_update':
            case 'orderbook_snapshot':
              c.onOrderbook?.(msg.data, msg.type);
              break;
            case 'trades': {
              const raw = Array.isArray(msg.data) ? msg.data : [];
              c.onTrades?.(raw.map((row) => normalizeTradeMessage(row as Record<string, unknown>)));
              break;
            }
            case 'ticker':
              c.onTicker?.(msg.data);
              break;
            case 'order_update':
              c.onOrderUpdate?.(msg.data);
              break;
            case 'trade':
              c.onTradeUpdate?.(msg.data as TradeUpdateMessage);
              break;
            case 'user_trade':
              c.onTradeUpdate?.(msg.data as TradeUpdateMessage);
              break;
            default:
              break;
          }
        } catch {
          // ignore
        }
      };

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);

      const cleanup = () => {
        clearInterval(pingInterval);
        ws.close();
        wsRef.current = null;
        setConnected(false);
        connectCleanupRef.current = null;
      };
      connectCleanupRef.current = cleanup;
    };

    deferRef.current = window.setTimeout(() => {
      deferRef.current = null;
      connect();
    }, CONNECT_DEFER_MS);

    return () => {
      if (deferRef.current != null) {
        clearTimeout(deferRef.current);
        deferRef.current = null;
      }
      if (reconnectTimeoutRef.current != null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      const cleanup = connectCleanupRef.current;
      if (cleanup) {
        cleanup();
      }
    };
  }, [token, reconnectAttempt]);

  return { connected, subscribe, unsubscribe, reconnectAttempt };
}
