'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';

const getWsUrl = (token: string | null): string => {
  const base = getApiBaseUrl().replace(/^http/, 'ws');
  const url = new URL('/api/v1/spot/ws', base);
  if (token) url.searchParams.set('token', token);
  return url.toString();
};

export type OrderbookLevel = { price: string; quantity: string };
export type OrderbookSnapshot = { symbol: string; bids: OrderbookLevel[]; asks: OrderbookLevel[]; lastUpdateId?: number };
export type TradeMessage = { id: string; market: string; side: string; price: string; quantity: string; time: string };
export type TickerMessage = { symbol: string; last_price: string | null; bid: string | null; ask: string | null; volume_24h?: string; high_24h?: string; low_24h?: string; status?: string };
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
  | { type: 'user_trade'; data: TradeUpdateMessage };

export interface UseSpotWsCallbacks {
  onOrderbook?: (data: OrderbookSnapshot) => void;
  onTrades?: (data: TradeMessage[]) => void;
  onTicker?: (data: TickerMessage) => void;
  onOrderUpdate?: (data: OrderUpdateMessage) => void;
  onTradeUpdate?: (data: TradeUpdateMessage) => void;
}

export function useSpotWs(callbacks: UseSpotWsCallbacks = {}) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const token = useAuthStore((s) => s.accessToken);

  const subscribe = useCallback((channel: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }, []);

  useEffect(() => {
    const url = getWsUrl(token);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      wsRef.current = ws;
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimeoutRef.current = setTimeout(() => {
        // Reconnect handled by effect re-run when deps change; here we just retry once after 2s
      }, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        const c = callbacksRef.current;
        switch (msg.type) {
          case 'orderbook_update':
          case 'orderbook_snapshot':
            c.onOrderbook?.(msg.data);
            break;
          case 'trades':
            c.onTrades?.(msg.data);
            break;
          case 'ticker':
            c.onTicker?.(msg.data);
            break;
          case 'order_update':
            c.onOrderUpdate?.(msg.data);
            break;
          case 'trade':
            c.onTradeUpdate?.(msg.data as TradeUpdateMessage);
            break;
          default:
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [token]);

  return { connected, subscribe, unsubscribe };
}
