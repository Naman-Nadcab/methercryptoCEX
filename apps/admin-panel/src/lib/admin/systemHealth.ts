/**
 * Admin System Health API — GET /admin/system-health
 */

import { adminFetch } from './apiClient';

export interface SystemHealthData {
  timestamp: string;
  api_latency_ms: number;
  database: { status: string; latency_ms: number };
  redis: { status: string; latency_ms: number };
  websocket: { connections: number; authenticated: number; status: string };
  node: { uptime_sec: number; memory_heap_mb: number; status: string };
  queue: {
    settlement_pending: number;
    withdrawal_pending: number;
    withdrawal_signing: number;
    withdrawal_broadcast: number;
    total_withdrawal_queue: number;
  };
}

export async function getSystemHealth(token: string | null) {
  return adminFetch<SystemHealthData>('/system-health', { token });
}
