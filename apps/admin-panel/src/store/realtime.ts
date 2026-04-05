/**
 * Realtime Store — Zustand store for WebSocket connection state and live event stream.
 * Bridges the RealtimeClient into React with proper state management.
 */

import { create } from 'zustand';
import { type ConnectionState, type RealtimeEvent } from '@/lib/realtimeClient';

const MAX_EVENTS = 100;

export interface RealtimeActivity {
  id: string;
  type: string;
  channel: 'metrics' | 'control';
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface RealtimeState {
  connectionState: ConnectionState;
  shouldPoll: boolean;
  liveEvents: RealtimeActivity[];
  eventCount: number;

  setConnectionState: (state: ConnectionState) => void;
  setShouldPoll: (val: boolean) => void;
  addEvent: (event: RealtimeEvent) => void;
  clearEvents: () => void;
}

function eventToActivity(event: RealtimeEvent): RealtimeActivity {
  return {
    id: `${event.channel}-${event.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    type: event.type,
    channel: event.channel,
    message: formatEventMessage(event),
    data: event.data,
    timestamp: event.timestamp,
  };
}

function formatEventMessage(event: RealtimeEvent): string {
  const d = event.data;
  switch (event.type) {
    case 'trade_executed':
      return `Trade: ${d.market ?? 'unknown'} ${d.side ?? ''} ${d.quantity ?? ''} @ ${d.price ?? ''}`.trim();
    case 'order_created':
      return `Order: ${d.market ?? 'unknown'} ${d.side ?? ''} ${d.type ?? 'limit'}`;
    case 'deposit_confirmed':
      return `Deposit confirmed: ${d.amount ?? '?'} ${d.currency_id ?? ''}`.trim();
    case 'withdrawal_requested':
      return `Withdrawal requested: ${d.amount ?? '?'}`;
    case 'p2p_order_created':
      return `P2P order created: ${d.crypto_amount ?? '?'}`;
    case 'aml_alert_triggered':
      return `AML alert: ${d.alert_type ?? 'unknown'} (${d.severity ?? 'unknown'})`;
    case 'control_status_changed':
      return 'System control status changed';
    case 'emergency_level_changed':
      return `Emergency level changed`;
    case 'incident_created':
      return `Incident created: ${d.title ?? 'unknown'}`;
    case 'service_restarted':
      return `Service restarted: ${d.service ?? 'unknown'}`;
    case 'liquidity_kill_activated':
      return 'Liquidity kill switch activated';
    case 'health_score_updated':
      return `Health score: ${d.score ?? '?'}`;
    default:
      return `${event.type.replace(/_/g, ' ')}`;
  }
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  connectionState: 'disconnected',
  shouldPoll: false,
  liveEvents: [],
  eventCount: 0,

  setConnectionState: (connectionState) => set({ connectionState }),
  setShouldPoll: (shouldPoll) => set({ shouldPoll }),

  addEvent: (event) => set((s) => {
    const activity = eventToActivity(event);
    return {
      liveEvents: [activity, ...s.liveEvents].slice(0, MAX_EVENTS),
      eventCount: s.eventCount + 1,
    };
  }),

  clearEvents: () => set({ liveEvents: [], eventCount: 0 }),
}));
