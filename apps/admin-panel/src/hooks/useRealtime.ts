'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { useRealtimeStore } from '@/store/realtime';
import { realtimeClient, type RealtimeEvent } from '@/lib/realtimeClient';

/**
 * Query key invalidation map — when a WS event arrives, invalidate the
 * matching React Query keys so data is refetched only where needed.
 */
const EVENT_QUERY_MAP: Record<string, string[][]> = {
  trade_executed:           [['admin', 'dashboard-stats'], ['admin', 'control'], ['admin', 'trading-trades'], ['admin', 'trading-overview'], ['admin', 'liquidity']],
  order_created:            [['admin', 'dashboard-stats'], ['admin', 'control'], ['admin', 'trading-orders'], ['admin', 'trading-overview']],
  order_cancelled:          [['admin', 'trading-orders'], ['admin', 'trading-overview']],
  order_filled:             [['admin', 'trading-orders'], ['admin', 'trading-overview']],
  deposit_confirmed:        [['admin', 'dashboard-stats'], ['admin', 'deposits'], ['admin', 'wallets']],
  withdrawal_requested:     [['admin', 'withdrawals'], ['admin', 'dashboard-stats']],
  withdrawal_completed:     [['admin', 'withdrawals'], ['admin', 'wallets']],
  p2p_order_created:        [['admin', 'dashboard-stats'], ['admin', 'p2p-orders'], ['admin', 'p2p-overview']],
  p2p_dispute_created:      [['admin', 'p2p-disputes'], ['admin', 'p2p-overview']],
  p2p_dispute_resolved:     [['admin', 'p2p-disputes'], ['admin', 'p2p-overview']],
  aml_alert_triggered:      [['admin', 'dashboard-stats'], ['admin', 'risk']],
  suspicious_trade:         [['admin', 'risk']],
  large_withdrawal:         [['admin', 'risk']],
  sanction_detected:        [['admin', 'risk']],
  market_created:           [['admin', 'markets']],
  market_updated:           [['admin', 'markets']],
  market_halted:            [['admin', 'markets']],
  wallet_balance_updated:   [['admin', 'treasury'], ['admin', 'treasury', 'reconciliation']],
  sweep_completed:          [['admin', 'treasury'], ['admin', 'treasury', 'reconciliation']],
  sweep_failed:             [['admin', 'treasury'], ['admin', 'treasury', 'reconciliation']],
  wallet_health_alert:      [['admin', 'treasury']],
  system_alert:             [['admin', 'monitoring']],
  rpc_timeout:              [['admin', 'monitoring']],
  queue_overflow:           [['admin', 'monitoring']],
  node_failure:             [['admin', 'monitoring']],
  kyc_submitted:            [['admin', 'kyc-pending'], ['admin', 'kyc-list'], ['admin', 'dashboard-stats']],
  kyc_approved:             [['admin', 'kyc-pending'], ['admin', 'kyc-list']],
  kyc_rejected:             [['admin', 'kyc-pending'], ['admin', 'kyc-list']],
  admin_login:              [['admin', 'security']],
  admin_action:             [['admin', 'security']],
  control_status_changed:   [['admin', 'control'], ['admin', 'trading-halt']],
  emergency_level_changed:  [['admin', 'control']],
  incident_created:         [['admin', 'control']],
  service_restarted:        [['admin', 'control']],
  liquidity_kill_activated: [['admin', 'control']],
  health_score_updated:     [['admin', 'control', 'health-score']],
  timeline_event:           [['admin', 'control'], ['admin', 'control', 'timeline']],
  mm_circuit_changed:       [['admin', 'control'], ['admin', 'trading-halt']],
  admin_session_terminated: [['admin', 'security'], ['admin', 'security', 'sessions']],
};

/**
 * Main hook that connects the realtime client, pipes events into the Zustand store,
 * and invalidates React Query keys. Should be called ONCE at the layout level.
 */
export function useRealtime() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const addEvent = useRealtimeStore((s) => s.addEvent);
  const setConnectionState = useRealtimeStore((s) => s.setConnectionState);
  const setShouldPoll = useRealtimeStore((s) => s.setShouldPoll);

  const addEventRef = useRef(addEvent);
  addEventRef.current = addEvent;
  const setConnectionStateRef = useRef(setConnectionState);
  setConnectionStateRef.current = setConnectionState;
  const setShouldPollRef = useRef(setShouldPoll);
  setShouldPollRef.current = setShouldPoll;

  const handleEvent = useCallback((event: RealtimeEvent) => {
    addEventRef.current(event);

    const queryKeys = EVENT_QUERY_MAP[event.type];
    if (queryKeys) {
      for (const key of queryKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }
  }, [queryClient]);

  useEffect(() => {
    if (!token) {
      realtimeClient.disconnect();
      setConnectionStateRef.current('disconnected');
      return;
    }

    const unsubEvent = realtimeClient.onEvent(handleEvent);
    const unsubState = realtimeClient.onStateChange((state) => {
      setConnectionStateRef.current(state);
      setShouldPollRef.current(realtimeClient.shouldFallbackToPoll);
    });

    realtimeClient.connect(token);

    return () => {
      unsubEvent();
      unsubState();
      realtimeClient.disconnect();
    };
  }, [token, handleEvent]);
}
