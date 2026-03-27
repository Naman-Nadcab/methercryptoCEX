'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';

const WS_PATH = '/api/v1/admin/ws/metrics';

function getWsUrl(token: string): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const BACKOFF_MULTIPLIER = 1.5;

export type AdminMetricsEventType =
  | 'connected'
  | 'trade_executed'
  | 'order_created'
  | 'deposit_confirmed'
  | 'withdrawal_requested'
  | 'p2p_order_created'
  | 'aml_alert_triggered'
  | 'pong'
  | 'error';

export interface AdminMetricsEvent {
  type: AdminMetricsEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Reusable hook: connect to admin WebSocket and update React Query cache on events.
 * Use once in dashboard layout. Handles reconnect with exponential backoff.
 */
export function useAdminRealtime() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (typeof window === 'undefined' || !token) return;
    const url = getWsUrl(token);
    if (!url) return;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === 1) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30_000);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as AdminMetricsEvent;
          const { type, data, timestamp } = payload;

          if (!mountedRef.current) return;

          switch (type) {
            case 'trade_executed':
            case 'order_created': {
              queryClient.setQueriesData(
                { queryKey: ['admin', 'analytics-all'], exact: false },
                (old: { data?: { tradingVolume?: number } } | undefined) => {
                  if (!old?.data) return old;
                  const prev = Number(old.data.tradingVolume ?? 0);
                  return { ...old, data: { ...old.data, tradingVolume: prev + 1 } };
                }
              );
              queryClient.invalidateQueries({ queryKey: ['admin', 'trading-volume'] });
              queryClient.invalidateQueries({ queryKey: ['admin', 'liquidity'] });
              queryClient.invalidateQueries({ queryKey: ['admin', 'control-overview'] });
              break;
            }
            case 'withdrawal_requested': {
              const w = data as { id?: string; user_id?: string; amount?: string; to_address?: string };
              const newItem = {
                id: w.id ?? `ws-${timestamp}`,
                user_id: w.user_id,
                amount: w.amount,
                to_address: w.to_address,
                status: 'pending_approval',
                created_at: new Date(timestamp).toISOString(),
              };
              queryClient.setQueriesData(
                { queryKey: ['admin', 'withdrawals'], exact: false },
                (old: { data?: { withdrawals?: unknown[]; stats?: { pending_approval?: number } } } | undefined) => {
                  if (!old?.data) return old;
                  const list = Array.isArray(old.data.withdrawals) ? [...old.data.withdrawals] : [];
                  const pending = Number((old.data.stats as { pending_approval?: number })?.pending_approval ?? 0);
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      withdrawals: [newItem, ...list].slice(0, 50),
                      stats: { ...old.data.stats, pending_approval: pending + 1 },
                    },
                  };
                }
              );
              queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
              break;
            }
            case 'deposit_confirmed': {
              const d = data as { id?: string; user_id?: string; amount?: string; currency_id?: string };
              const newItem = {
                id: d.id ?? `ws-${timestamp}`,
                user_id: d.user_id,
                amount: d.amount,
                currency_id: d.currency_id,
                status: 'confirmed',
                created_at: new Date(timestamp).toISOString(),
              };
              queryClient.setQueriesData(
                { queryKey: ['admin', 'deposits'], exact: false },
                (old: { data?: { deposits?: unknown[] } } | undefined) => {
                  if (!old?.data) return old;
                  const list = Array.isArray(old.data.deposits) ? [...old.data.deposits] : [];
                  return {
                    ...old,
                    data: { ...old.data, deposits: [newItem, ...list].slice(0, 50) },
                  };
                }
              );
              queryClient.invalidateQueries({ queryKey: ['admin', 'analytics-all'] });
              queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
              break;
            }
            case 'p2p_order_created': {
              queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
              queryClient.invalidateQueries({ queryKey: ['admin', 'analytics-all'] });
              break;
            }
            case 'aml_alert_triggered': {
              queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
              queryClient.invalidateQueries({ queryKey: ['admin', 'compliance'] });
              break;
            }
            case 'connected': {
              queryClient.invalidateQueries({ queryKey: ['admin'] });
              break;
            }
            case 'pong':
              break;
            case 'error':
              break;
            default:
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        if (!mountedRef.current) return;
        const delay = Math.min(
          INITIAL_RECONNECT_MS * Math.pow(BACKOFF_MULTIPLIER, reconnectAttemptRef.current),
          MAX_RECONNECT_MS
        );
        reconnectAttemptRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // close will fire and trigger reconnect
      };
    } catch {
      reconnectAttemptRef.current += 1;
      const delay = Math.min(
        INITIAL_RECONNECT_MS * Math.pow(BACKOFF_MULTIPLIER, reconnectAttemptRef.current),
        MAX_RECONNECT_MS
      );
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    }
  }, [token, queryClient]);

  useEffect(() => {
    mountedRef.current = true;
    if (token) connect();
    return () => {
      mountedRef.current = false;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, connect]);

  return null;
}
