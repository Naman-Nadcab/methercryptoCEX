'use client';

import { useState, useRef, useEffect } from 'react';
import { useAdminMetricsWs, type AdminMetricsEvent } from '@/hooks/useAdminMetricsWs';
import { Panel } from '@/components/admin/control-plane';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Repeat, ShoppingCart, AlertTriangle } from 'lucide-react';

export interface StreamEvent {
  id: string;
  type: string;
  label: string;
  message: string;
  timestamp: number;
  icon: React.ReactNode;
}

const EVENT_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  trade_executed: { label: 'Trade', icon: <Activity className="w-3.5 h-3.5" /> },
  order_created: { label: 'Order', icon: <ShoppingCart className="w-3.5 h-3.5" /> },
  deposit_confirmed: { label: 'Deposit', icon: <ArrowDownToLine className="w-3.5 h-3.5" /> },
  withdrawal_requested: { label: 'Withdrawal', icon: <ArrowUpFromLine className="w-3.5 h-3.5" /> },
  p2p_order_created: { label: 'P2P', icon: <Repeat className="w-3.5 h-3.5" /> },
  aml_alert_triggered: { label: 'AML', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  connected: { label: 'Connected', icon: <Activity className="w-3.5 h-3.5" /> },
};

const MAX_EVENTS = 30;

export function AdminEventStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  useAdminMetricsWs({
    trade_executed: (ev: AdminMetricsEvent) => pushEvent(ev, 'trade_executed', 'Trade executed'),
    order_created: (ev: AdminMetricsEvent) => pushEvent(ev, 'order_created', 'Order created'),
    deposit_confirmed: (ev: AdminMetricsEvent) => pushEvent(ev, 'deposit_confirmed', 'Deposit confirmed'),
    withdrawal_requested: (ev: AdminMetricsEvent) => pushEvent(ev, 'withdrawal_requested', 'Withdrawal requested'),
    p2p_order_created: (ev: AdminMetricsEvent) => pushEvent(ev, 'p2p_order_created', 'P2P order created'),
    aml_alert_triggered: (ev: AdminMetricsEvent) => pushEvent(ev, 'aml_alert_triggered', 'AML alert'),
    connected: (ev: AdminMetricsEvent) => pushEvent(ev, 'connected', 'WebSocket connected'),
  });

  function pushEvent(ev: AdminMetricsEvent, type: string, defaultMessage: string) {
    const config = EVENT_CONFIG[type] ?? { label: type, icon: <Activity className="w-3.5 h-3.5" /> };
    const msg = (ev.data as { message?: string; market?: string })?.message ?? (ev.data as { market?: string })?.market ?? defaultMessage;
    setEvents((prev) => [
      {
        id: `${ev.type}-${ev.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        label: config.label,
        message: String(msg).slice(0, 80),
        timestamp: ev.timestamp,
        icon: config.icon,
      },
      ...prev.slice(0, MAX_EVENTS - 1),
    ]);
  }

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [events.length]);

  return (
    <Panel title="Live event stream" subtitle="Trades, orders, deposits, withdrawals, P2P, AML" noPadding>
      <ul
        ref={listRef}
        className="max-h-[280px] overflow-y-auto divide-y divide-[#E5E7EB] text-sm"
        role="list"
      >
        {events.length === 0 ? (
          <li className="px-5 py-8 text-center text-[#6B7280] text-[13px]">
            Waiting for events… WebSocket connected. Events will appear here in real time.
          </li>
        ) : (
          events.map((e) => (
            <li key={e.id} className="px-5 py-3 flex items-center gap-3 hover:bg-[#F9FAFB] transition-colors">
              <span className="text-[#6B7280] shrink-0">{e.icon}</span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-[#111827]">{e.label}</span>
                <span className="text-[#6B7280] ml-1.5 truncate block">{e.message}</span>
              </div>
              <span className="text-[11px] text-[#6B7280] shrink-0">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))
        )}
      </ul>
    </Panel>
  );
}
