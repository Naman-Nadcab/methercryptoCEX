'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { realtimeClient, type RealtimeEvent } from '@/lib/realtimeClient';

export type AdminWsEventType =
  | 'connected'
  | 'trade_executed'
  | 'order_created'
  | 'order_cancelled'
  | 'order_filled'
  | 'deposit_confirmed'
  | 'withdrawal_requested'
  | 'withdrawal_completed'
  | 'p2p_order_created'
  | 'p2p_dispute_created'
  | 'p2p_dispute_resolved'
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
  | 'node_failure'
  | 'kyc_submitted'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'admin_login'
  | 'admin_action';

export interface AdminWsEvent {
  type: AdminWsEventType;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export interface UseAdminWsOptions {
  onEvent?: (event: AdminWsEvent) => void;
}

/**
 * Piggybacks on the singleton realtimeClient. Does NOT create its own WebSocket.
 * Global query invalidation is handled centrally; pages only need onEvent for
 * page-specific invalidation.
 */
export function useAdminWs(options?: UseAdminWsOptions) {
  const { onEvent } = options ?? {};
  const queryClient = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const unsub = realtimeClient.onEvent((evt: RealtimeEvent) => {
      const adapted: AdminWsEvent = {
        type: evt.type as AdminWsEventType,
        data: evt.data,
        timestamp: evt.timestamp,
      };
      onEventRef.current?.(adapted);
    });
    return unsub;
  }, [queryClient]);

  return null;
}
