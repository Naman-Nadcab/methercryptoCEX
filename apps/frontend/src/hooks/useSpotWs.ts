'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore } from '@/store/auth';
import type { OrderbookDeltaPayload } from '@/lib/orderbookDelta';

const getWsUrl = (): string => {
  let base = getApiBaseUrl();
  if (!base && typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL;
    base = envUrl && envUrl.trim() ? envUrl.trim().replace(/\/$/, '') : 'http://localhost:4000';
  }
  if (!base) base = 'http://localhost:4000';
  base = base.replace(/\/$/, '').replace(/^http/, 'ws');
  const url = new URL('/api/v1/spot/ws', base);
  return url.toString();
};

function isPrivateSpotChannel(channel: string): boolean {
  return (
    channel === 'user.orders' ||
    channel === 'user.trades' ||
    channel === 'user.p2p_orders' ||
    channel.startsWith('p2p.order.')
  );
}

export type OrderbookLevel = { price: string; quantity: string };
export type OrderbookSnapshot = { symbol: string; bids: OrderbookLevel[]; asks: OrderbookLevel[]; lastUpdateId?: number };
export type TradeMessage = { id: string; market: string; side: string; price: string; quantity: string; time: string };
export function normalizeTradeMessage(t: {
  id?: string;
  market?: string;
  side?: string;
  price?: string;
  quantity?: string;
  time?: string;
  created_at?: string;
}): TradeMessage {
  const time = t.time ?? t.created_at ?? '';
  return {
    id: t.id ?? '',
    market: t.market ?? '',
    side: t.side ?? '',
    price: t.price ?? '',
    quantity: t.quantity ?? '',
    time:
      typeof time === 'string'
        ? time
        : time && typeof (time as Date).toISOString === 'function'
          ? (time as Date).toISOString()
          : '',
  };
}
export type TickerMessage = {
  symbol: string;
  last_price: string | null;
  bid: string | null;
  ask: string | null;
  volume_24h?: string;
  base_volume_24h?: string;
  open_24h?: string | null;
  high_24h?: string | null;
  low_24h?: string | null;
  /** Wire format from server (unchanged). */
  price_change_pct_24h?: string | null;
  /** Parsed numeric mirror for UI; prefer this over re-parsing the string. */
  change_pct?: number | null;
  status?: string;
};

/** Parse WS `price_change_pct_24h` string to a number (no formula change). */
export function changePctFromWire(priceChangePct24h: string | null | undefined): number | null {
  if (priceChangePct24h == null || priceChangePct24h === '') return null;
  const n = parseFloat(priceChangePct24h);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

/** Normalize inbound ticker payloads so `change_pct` is always a number when the wire sends a parseable string. */
export function normalizeTickerMessage(data: TickerMessage): TickerMessage {
  const fromWire = changePctFromWire(data.price_change_pct_24h);
  const change_pct =
    typeof data.change_pct === 'number' && Number.isFinite(data.change_pct) ? data.change_pct : fromWire;
  return { ...data, change_pct };
}
export type OrderUpdateMessage = {
  id: string;
  status: string;
  displayStatus?: string;
  market?: string;
  filled_quantity?: string;
  quantity?: string;
};
export type TradeUpdateMessage = {
  id: string;
  order_id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  fee_asset: string | null;
  created_at: string;
};

export type AdaptiveModePayload = {
  ui_mode: 'normal' | 'eco' | 'minimal';
  server_shed_mode: number;
  lag_ms: number;
  pending: number;
  ticker_coalesce_ms: number;
  trades_batch_ms: number;
  orderbook_burst_coalesce: boolean;
  hint: string;
  pid_coalesce_mult?: number;
  network_inflation_ms?: number;
  render_budget_ob_hz?: number;
  render_budget_ticker_hz?: number;
  render_budget_trades_hz?: number;
};

export type SpotWsStreamPhase = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

type WsMessage =
  | { type: 'auth_result'; success?: boolean; error?: string; timestamp?: number }
  | { type: 'pong'; client_ts?: number; timestamp?: number }
  | { type: 'subscribed'; channel: string }
  | { type: 'unsubscribed'; channel: string }
  | { type: 'orderbook_update'; data: OrderbookSnapshot }
  | { type: 'orderbook_snapshot'; data: OrderbookSnapshot }
  | { type: 'orderbook_resync'; data: OrderbookSnapshot }
  | { type: 'orderbook_delta'; data: OrderbookDeltaPayload }
  | { type: 'trades'; data: TradeMessage[]; feed_seq?: number }
  | { type: 'ticker'; data: TickerMessage }
  | { type: 'order_update'; data: OrderUpdateMessage }
  | { type: 'user_trade'; data: TradeUpdateMessage }
  | { type: 'trade'; data: TradeUpdateMessage }
  | { type: 'adaptive_mode'; channel?: string; data: AdaptiveModePayload };

export type UseSpotWsOptions = {
  renderBudgets?: boolean;
};

export interface UseSpotWsCallbacks {
  onOrderbook?: (data: OrderbookSnapshot, type?: 'orderbook_snapshot' | 'orderbook_update') => void;
  onOrderbookDelta?: (data: OrderbookDeltaPayload) => void;
  onTrades?: (data: TradeMessage[], meta?: { feed_seq?: number }) => void;
  onTicker?: (data: TickerMessage) => void;
  onOrderUpdate?: (data: OrderUpdateMessage) => void;
  onTradeUpdate?: (data: TradeUpdateMessage) => void;
  onAdaptiveMode?: (data: AdaptiveModePayload) => void;
}

const MAX_RECONNECT_ATTEMPTS = 25;
const CONNECT_DEFER_MS = 300;
const PING_LOSS_TIMEOUT_MS = 12000;
const LOSS_EWMA_ALPHA = 0.18;
const BACKOFF_BASE_MS = 1500;
const BACKOFF_CAP_MS = 60_000;

function reconnectDelayMs(attemptNumber: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, Math.min(attemptNumber - 1, 12)));
  const jitter = Math.floor(Math.random() * 800);
  return exp + jitter;
}

function decayLossEwmaOnSuccess(prev: number): number {
  return Math.max(0, prev * (1 - LOSS_EWMA_ALPHA));
}

function bumpLossEwmaOnTimeout(prev: number): number {
  return Math.min(100, prev * (1 - LOSS_EWMA_ALPHA) + LOSS_EWMA_ALPHA * 100);
}

export function useSpotWs(callbacks: UseSpotWsCallbacks = {}, options: UseSpotWsOptions = {}) {
  const { renderBudgets = true } = options;
  const [connected, setConnected] = useState(false);
  const [privateChannelsReady, setPrivateChannelsReady] = useState(false);
  /** Increments on each scheduled reconnect (effect dependency); successful open does not bump this. */
  const [connectGeneration, setConnectGeneration] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [streamPhase, setStreamPhase] = useState<SpotWsStreamPhase>('connecting');
  const [lastRttMs, setLastRttMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const connectCleanupRef = useRef<(() => void) | null>(null);
  const channelsRef = useRef<Set<string>>(new Set());
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const adaptiveRef = useRef<AdaptiveModePayload | null>(null);
  const renderBudgetRef = useRef({ windowStart: 0, tk: 0, tr: 0 });
  const pongCountRef = useRef(0);
  const pendingPingsRef = useRef<Map<number, number>>(new Map());
  const lossEwmaRef = useRef(0);
  const token = useAuthStore((s) => s.accessToken);
  const authDoneRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const lastTokenRef = useRef<string | null | undefined>(undefined);

  const allowTickerRender = useCallback((): boolean => {
    if (!renderBudgets) return true;
    const ad = adaptiveRef.current;
    const cap = ad?.render_budget_ticker_hz ?? 48;
    const b = renderBudgetRef.current;
    const now = Date.now();
    if (now - b.windowStart >= 1000) {
      b.windowStart = now;
      b.tk = 0;
      b.tr = 0;
    }
    if (b.tk >= cap) return false;
    b.tk += 1;
    return true;
  }, [renderBudgets]);

  const allowTradesRender = useCallback((): boolean => {
    if (!renderBudgets) return true;
    const ad = adaptiveRef.current;
    const cap = ad?.render_budget_trades_hz ?? 36;
    const b = renderBudgetRef.current;
    const now = Date.now();
    if (now - b.windowStart >= 1000) {
      b.windowStart = now;
      b.tk = 0;
      b.tr = 0;
    }
    if (b.tr >= cap) return false;
    b.tr += 1;
    return true;
  }, [renderBudgets]);

  const subscribe = useCallback((channel: string) => {
    channelsRef.current.add(channel);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (isPrivateSpotChannel(channel) && !authDoneRef.current) return;
    try {
      ws.send(JSON.stringify({ type: 'subscribe', channel }));
    } catch {
      /* ignore */
    }
  }, []);

  const flushPrivateSubscriptions = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    channelsRef.current.forEach((ch) => {
      if (!isPrivateSpotChannel(ch)) return;
      try {
        ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
      } catch {
        /* ignore */
      }
    });
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

    if (lastTokenRef.current !== token) {
      lastTokenRef.current = token;
      reconnectCountRef.current = 0;
      setReconnectAttempt(0);
    }

    intentionalCloseRef.current = false;
    setStreamPhase((p) => (p === 'live' ? p : 'connecting'));

    const connect = () => {
      const url = getWsUrl();
      const ws = new WebSocket(url);
      const tok = token?.trim() || null;

      ws.onopen = () => {
        authDoneRef.current = !tok;
        setPrivateChannelsReady(!tok);
        reconnectCountRef.current = 0;
        setReconnectAttempt(0);
        setConnected(true);
        setStreamPhase('live');
        wsRef.current = ws;
        pendingPingsRef.current.clear();
        lossEwmaRef.current = 0;
        pongCountRef.current = 0;
        channelsRef.current.forEach((ch) => {
          if (isPrivateSpotChannel(ch) && !authDoneRef.current) return;
          try {
            ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
          } catch {
            // ignore
          }
        });
        if (tok) {
          try {
            ws.send(JSON.stringify({ type: 'auth', data: { token: tok } }));
          } catch {
            /* ignore */
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        authDoneRef.current = false;
        setPrivateChannelsReady(false);
        wsRef.current = null;
        if (intentionalCloseRef.current) {
          setStreamPhase('disconnected');
          return;
        }
        if (reconnectCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setStreamPhase('disconnected');
          return;
        }
        setStreamPhase('reconnecting');
        reconnectCountRef.current += 1;
        setReconnectAttempt(reconnectCountRef.current);
        const delay = reconnectDelayMs(reconnectCountRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          setConnectGeneration((g) => g + 1);
        }, delay);
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
            case 'orderbook_resync':
              c.onOrderbook?.(msg.data, msg.type === 'orderbook_resync' ? 'orderbook_snapshot' : msg.type);
              break;
            case 'orderbook_delta':
              if (msg.data && typeof msg.data === 'object' && 'symbol' in msg.data && 'seq' in msg.data) {
                c.onOrderbookDelta?.(msg.data as OrderbookDeltaPayload);
              }
              break;
            case 'trades': {
              if (!allowTradesRender()) break;
              const raw = Array.isArray(msg.data) ? msg.data : [];
              const feedSeq = typeof (msg as { feed_seq?: unknown }).feed_seq === 'number' ? (msg as { feed_seq: number }).feed_seq : undefined;
              c.onTrades?.(
                raw.map((row) => normalizeTradeMessage(row as Record<string, unknown>)),
                feedSeq != null ? { feed_seq: feedSeq } : undefined
              );
              break;
            }
            case 'ticker':
              if (!allowTickerRender()) break;
              c.onTicker?.(normalizeTickerMessage(msg.data as TickerMessage));
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
            case 'adaptive_mode':
              if (msg.data && typeof msg.data === 'object') {
                const payload = msg.data as AdaptiveModePayload;
                adaptiveRef.current = payload;
                c.onAdaptiveMode?.(payload);
              }
              break;
            case 'auth_result': {
              const ar = msg as { success?: boolean; error?: string };
              if (ar.success === true) {
                authDoneRef.current = true;
                setPrivateChannelsReady(true);
                flushPrivateSubscriptions();
              } else {
                authDoneRef.current = false;
                setPrivateChannelsReady(false);
              }
              break;
            }
            case 'pong': {
              const m = msg as { client_ts?: number };
              if (typeof m.client_ts === 'number' && ws.readyState === WebSocket.OPEN) {
                if (pendingPingsRef.current.has(m.client_ts)) {
                  pendingPingsRef.current.delete(m.client_ts);
                  lossEwmaRef.current = decayLossEwmaOnSuccess(lossEwmaRef.current);
                }
                const rtt = performance.now() - m.client_ts;
                setLastRttMs(Math.round(rtt));
                pongCountRef.current += 1;
                if (pongCountRef.current % 4 === 0) {
                  try {
                    ws.send(
                      JSON.stringify({
                        type: 'net_metrics',
                        rtt_ms: Math.round(rtt),
                        loss_pct: Math.round(lossEwmaRef.current),
                      }),
                    );
                  } catch {
                    // ignore
                  }
                }
              }
              break;
            }
            default:
              break;
          }
        } catch {
          // ignore
        }
      };

      const pingInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const now = performance.now();
        const pend = pendingPingsRef.current;
        const stale: number[] = [];
        pend.forEach((sentAt, clientTs) => {
          if (now - sentAt > PING_LOSS_TIMEOUT_MS) stale.push(clientTs);
        });
        for (let i = 0; i < stale.length; i++) {
          pend.delete(stale[i]!);
          lossEwmaRef.current = bumpLossEwmaOnTimeout(lossEwmaRef.current);
        }
        const clientTs = performance.now();
        pend.set(clientTs, clientTs);
        try {
          ws.send(JSON.stringify({ type: 'ping', client_ts: clientTs }));
        } catch {
          pend.delete(clientTs);
        }
      }, 25000);

      const cleanup = () => {
        clearInterval(pingInterval);
        intentionalCloseRef.current = true;
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
  }, [token, connectGeneration, allowTickerRender, allowTradesRender, flushPrivateSubscriptions]);

  return {
    connected,
    privateChannelsReady,
    subscribe,
    unsubscribe,
    reconnectAttempt,
    streamPhase,
    lastRttMs,
  };
}
