'use client';

import { useEffect, useRef } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';

const getWsUrl = () => {
  if (typeof window === 'undefined') return null;
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '';
  const base = apiUrl.trim().replace(/\/$/, '');
  if (base) {
    const proto = base.startsWith('https') ? 'wss' : 'ws';
    const host = base.replace(/^https?:\/\//, '');
    return `${proto}://${host}/api/v1/admin/ws/metrics`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/v1/admin/ws/metrics`;
};

export type AdminMetricsEventType =
  | 'connected'
  | 'trade_executed'
  | 'order_created'
  | 'deposit_confirmed'
  | 'withdrawal_requested'
  | 'p2p_order_created'
  | 'aml_alert_triggered';

export interface AdminMetricsEvent {
  type: AdminMetricsEventType;
  data: Record<string, unknown>;
  timestamp: number;
}

type Handler = (event: AdminMetricsEvent) => void;

export function useAdminMetricsWs(handlers: Partial<Record<AdminMetricsEventType, Handler>>) {
  const { accessToken } = useAdminAuthStore();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!accessToken) return;
    const url = getWsUrl();
    if (!url) return;

    const fullUrl = `${url}?token=${encodeURIComponent(accessToken)}`;
    const ws = new WebSocket(fullUrl);

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as AdminMetricsEvent;
        const h = handlersRef.current[ev.type];
        if (h) h(ev);
      } catch {
        // ignore
      }
    };

    return () => {
      clearInterval(pingInterval);
      ws.close();
    };
  }, [accessToken]);
}
