'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';

const WS_PATH = '/api/v1/spot/ws';
const INITIAL_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 30_000;

function buildWsUrl(): string {
  let base = getApiBaseUrl();
  if (!base && typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL;
    base = envUrl?.trim() ? envUrl.trim().replace(/\/$/, '') : 'http://localhost:4000';
  }
  if (!base) base = 'http://localhost:4000';
  base = base.replace(/\/$/, '').replace(/^http/, 'ws');
  const url = new URL(WS_PATH, base);
  return url.toString();
}

export type P2pOrderWsEvent = {
  type: string;
  channel?: string;
  data?: unknown;
  timestamp?: number;
};

export type UseP2pOrderWsOptions = {
  orderId: string | null | undefined;
  enabled: boolean;
  onEvent?: (ev: P2pOrderWsEvent) => void;
};

/**
 * Subscribe to `p2p.order.{orderId}` on the spot WS (JWT via first-message `auth`).
 * Reconnect with backoff; caller should keep REST polling as fallback when disconnected.
 */
export function useP2pOrderWs({ orderId, enabled, onEvent }: UseP2pOrderWsOptions): {
  connected: boolean;
  sendTyping: () => void;
} {
  const { accessToken, _hasHydrated } = useAuthStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const sendTyping = useCallback(() => {
    const ws = wsRef.current;
    const oid = orderId?.trim();
    if (!ws || ws.readyState !== WebSocket.OPEN || !oid) return;
    try {
      ws.send(JSON.stringify({ type: 'p2p_typing', channel: `p2p.order.${oid}` }));
    } catch {
      /* ignore */
    }
  }, [orderId]);

  useEffect(() => {
    const oid = orderId?.trim();
    if (!enabled || !oid || !_hasHydrated || !accessToken) {
      setConnected(false);
      return;
    }

    let stopped = false;
    let pingIv: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (stopped) return;
      clearTimers();
      try {
        const ws = new WebSocket(buildWsUrl());
        wsRef.current = ws;
        const tok = accessToken.trim();

        ws.onopen = () => {
          if (stopped) return;
          attemptRef.current = 0;
          setConnected(true);
          try {
            ws.send(JSON.stringify({ type: 'auth', data: { token: tok } }));
          } catch {
            /* ignore */
          }
          if (pingIv) clearInterval(pingIv);
          pingIv = setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping', client_ts: Date.now() }));
              }
            } catch {
              /* ignore */
            }
          }, 25_000);
        };

        ws.onmessage = (evt) => {
          try {
            const parsed = JSON.parse(String(evt.data)) as P2pOrderWsEvent & { success?: boolean };
            if (parsed.type === 'auth_result') {
              if (parsed.success === true && ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(JSON.stringify({ type: 'subscribe', channel: `p2p.order.${oid}` }));
                } catch {
                  /* ignore */
                }
              }
              return;
            }
            if (parsed.type === 'pong' || parsed.type === 'connected' || parsed.type === 'subscribed') return;
            const expected = `p2p.order.${oid}`;
            if (parsed.channel !== expected) return;
            onEventRef.current?.(parsed);
          } catch {
            /* ignore */
          }
        };

        ws.onerror = () => {
          /* onclose will reconnect */
        };

        ws.onclose = () => {
          if (pingIv) {
            clearInterval(pingIv);
            pingIv = null;
          }
          wsRef.current = null;
          if (stopped) return;
          setConnected(false);
          const n = ++attemptRef.current;
          const delay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(1.6, Math.min(n, 12)));
          reconnectTimerRef.current = setTimeout(connect, delay);
        };
      } catch {
        setConnected(false);
        const n = ++attemptRef.current;
        const delay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(1.6, Math.min(n, 12)));
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    connect();

    return () => {
      stopped = true;
      clearTimers();
      if (pingIv) {
        clearInterval(pingIv);
        pingIv = null;
      }
      const w = wsRef.current;
      wsRef.current = null;
      setConnected(false);
      try {
        w?.close();
      } catch {
        /* ignore */
      }
    };
  }, [orderId, enabled, accessToken, _hasHydrated, clearTimers]);

  return { connected, sendTyping };
}
