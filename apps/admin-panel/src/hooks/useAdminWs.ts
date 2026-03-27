'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';

const WS_PATH = '/api/v1/admin/ws/metrics';

function getWsUrl(token: string): string {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

export type AdminWsEventType =
  | 'connected'
  | 'trade_executed'
  | 'order_created'
  | 'deposit_confirmed'
  | 'withdrawal_requested'
  | 'p2p_order_created'
  | 'aml_alert_triggered'
  | 'market_created'
  | 'market_updated'
  | 'market_halted'
  | 'wallet_balance_updated'
  | 'sweep_completed'
  | 'sweep_failed'
  | 'wallet_health_alert'
  | 'suspicious_trade'
  | 'large_withdrawal'
  | 'sanction_detected'
  | 'system_alert'
  | 'rpc_timeout'
  | 'queue_overflow'
  | 'node_failure';

export interface AdminWsEvent {
  type: AdminWsEventType;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export interface UseAdminWsOptions {
  onEvent?: (event: AdminWsEvent) => void;
}

export function useAdminWs(options?: UseAdminWsOptions) {
  const { onEvent } = options ?? {};
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (typeof window === 'undefined' || !token) return;
    const url = getWsUrl(token);
    if (!url) return;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as AdminWsEvent;
          onEventRef.current?.(payload);
          if (payload.type === 'trade_executed' || payload.type === 'order_created') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'control'] });
          }
          if (payload.type === 'withdrawal_requested') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
          }
          if (payload.type === 'deposit_confirmed') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
          }
          if (payload.type === 'p2p_order_created') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
          }
          if (payload.type === 'aml_alert_triggered') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
            queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
          }
          if (payload.type === 'suspicious_trade' || payload.type === 'large_withdrawal' || payload.type === 'sanction_detected') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
          }
          if (payload.type === 'market_created' || payload.type === 'market_updated' || payload.type === 'market_halted') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
          }
          if (payload.type === 'wallet_balance_updated' || payload.type === 'sweep_completed' || payload.type === 'sweep_failed' || payload.type === 'wallet_health_alert') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
          }
          if (payload.type === 'system_alert' || payload.type === 'rpc_timeout' || payload.type === 'queue_overflow' || payload.type === 'node_failure') {
            queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] });
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => {};
    } catch {
      reconnectRef.current = setTimeout(connect, 3000);
    }
  }, [token, queryClient]);

  useEffect(() => {
    if (token) connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, connect]);

  return null;
}
