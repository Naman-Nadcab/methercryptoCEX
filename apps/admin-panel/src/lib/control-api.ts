import { adminFetch } from './api';

export interface ControlStatus {
  exchange_status: string;
  trading_status: string;
  withdrawals_status: string;
  deposits_status: string;
  liquidity_engine_status: string;
}

export interface AssetFreezeRow {
  asset: string;
  deposits_frozen: boolean;
  withdrawals_frozen: boolean;
  trading_frozen: boolean;
}

export interface ControlIncidentRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  created_at: string | null;
  resolved_at: string | null;
}

export interface ControlEventRow {
  event: string;
  service: string;
  severity: string;
  timestamp: string;
}

export function getControlStatus(token: string | null) {
  return adminFetch<ControlStatus>('/control/status', { token });
}

export function postControlCircuit(token: string | null, action: string) {
  return adminFetch<{ action: string }>('/control/circuit', {
    method: 'POST',
    token,
    body: { action },
  });
}

export function getControlAssetFreeze(token: string | null) {
  return adminFetch<{ assets: AssetFreezeRow[] }>('/control/asset-freeze', { token });
}

export function patchControlAssetFreeze(
  token: string | null,
  body: { asset: string; deposits_frozen?: boolean; withdrawals_frozen?: boolean; trading_frozen?: boolean }
) {
  return adminFetch<{ updated: boolean }>('/control/asset-freeze', {
    method: 'PATCH',
    token,
    body,
  });
}

export function postControlLiquidityKill(token: string | null, enabled: boolean) {
  return adminFetch<{ liquidity_kill: boolean }>('/control/liquidity-kill', {
    method: 'POST',
    token,
    body: { enabled },
  });
}

export function postControlEmergencyMode(token: string | null, enabled: boolean) {
  return adminFetch<{ emergency_mode: boolean }>('/control/emergency-mode', {
    method: 'POST',
    token,
    body: { enabled },
  });
}

export function getControlIncidents(token: string | null, params?: { limit?: number; status?: string }) {
  return adminFetch<{ incidents: ControlIncidentRow[] }>('/control/incidents', {
    token,
    params: params as Record<string, string | number | undefined>,
  });
}

export function acknowledgeControlIncident(token: string | null, id: string) {
  return adminFetch<{ acknowledged: boolean }>(`/control/incidents/${encodeURIComponent(id)}/acknowledge`, {
    method: 'PATCH',
    token,
  });
}

export function resolveControlIncident(token: string | null, id: string) {
  return adminFetch<{ resolved: boolean }>(`/control/incidents/${encodeURIComponent(id)}/resolve`, {
    method: 'PATCH',
    token,
  });
}

export function createControlIncident(
  token: string | null,
  body: { type: string; severity: string; description?: string }
) {
  return adminFetch<{ id: string; type: string; severity: string; description?: string }>('/control/incidents', {
    method: 'POST',
    token,
    body,
  });
}

export function postControlCommand(token: string | null, command: string) {
  return adminFetch<{ command: string; triggered: boolean }>('/control/commands', {
    method: 'POST',
    token,
    body: { command },
  });
}

export interface ControlCommandHistoryRow {
  command: string;
  triggered_by: string;
  status: string;
  timestamp: string;
}

export function getControlCommandHistory(token: string | null, limit?: number) {
  return adminFetch<{ history: ControlCommandHistoryRow[] }>('/control/commands/history', {
    token,
    params: limit != null ? { limit } : undefined,
  });
}

export function getControlEvents(token: string | null, limit?: number) {
  return adminFetch<{ events: ControlEventRow[] }>('/control/events', {
    token,
    params: limit != null ? { limit } : undefined,
  });
}

export interface HealthScoreData {
  score: number;
  metrics: {
    api_latency: number;
    matching_latency: number;
    rpc_health: number;
    queue_backlog: number;
  };
}

export interface ServiceStatusRow {
  service: string;
  status: string;
  uptime: string;
  last_restart: string | null;
}

export type WorkerHealthStatus = 'healthy' | 'warning' | 'down';

export interface WorkerHealthRow {
  service: string;
  status: WorkerHealthStatus;
  uptime: number;
  last_restart: string | null;
}

export function getControlHealth(token: string | null) {
  return adminFetch<{ services: WorkerHealthRow[] }>('/control/health', { token });
}

export interface AssetFreezeHistoryRow {
  asset: string;
  action: string;
  changed_by: string | null;
  created_at: string;
}

export interface CircuitHistoryRow {
  event: string;
  service: string | null;
  created_at: string;
}

export interface TimelineItem {
  event: string;
  service: string;
  severity: string;
  timestamp: string;
  triggered_by?: string;
}

export interface TimelineEventPayload {
  event: string;
  timestamp: string;
  triggered_by?: string;
  service: string;
  severity: string;
}

export interface SafetyTriggerRow {
  id: string;
  trigger_type: string;
  threshold_value: string;
  action: string;
  enabled: number;
  metric?: string | null;
}

export function getControlHealthScore(token: string | null) {
  return adminFetch<HealthScoreData>('/control/health-score', { token });
}

export function getControlServices(token: string | null) {
  return adminFetch<{ services: ServiceStatusRow[] }>('/control/services', { token });
}

export function getControlAssetFreezeHistory(token: string | null, limit?: number) {
  return adminFetch<{ history: AssetFreezeHistoryRow[] }>('/control/asset-freeze/history', {
    token,
    params: limit != null ? { limit } : undefined,
  });
}

export function getControlCircuitHistory(token: string | null, limit?: number) {
  return adminFetch<{ history: CircuitHistoryRow[] }>('/control/circuit-history', {
    token,
    params: limit != null ? { limit } : undefined,
  });
}

export function getControlTimeline(token: string | null, limit?: number, offset?: number) {
  const params: Record<string, number> = {};
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  return adminFetch<{ timeline: TimelineItem[]; hasMore: boolean }>('/control/timeline', {
    token,
    params: Object.keys(params).length ? params : undefined,
  });
}

export function getControlEmergencyLevel(token: string | null) {
  return adminFetch<{ level: number }>('/control/emergency-level', { token });
}

export function postControlEmergencyLevel(token: string | null, level: number) {
  return adminFetch<{ level: number }>('/control/emergency-level', {
    method: 'POST',
    token,
    body: { level },
  });
}

export function getControlSafetyTriggers(token: string | null) {
  return adminFetch<{ triggers: SafetyTriggerRow[] }>('/control/safety-triggers', { token });
}

export function patchControlSafetyTriggers(
  token: string | null,
  triggers: Array<{ trigger_type: string; metric?: string; threshold_value: number; action: string; enabled: boolean }>
) {
  return adminFetch<{ triggers: SafetyTriggerRow[] }>('/control/safety-triggers', {
    method: 'PATCH',
    token,
    body: { triggers },
  });
}

export type GlobalActionType =
  | 'halt_trading'
  | 'resume_trading'
  | 'disable_withdrawals'
  | 'enable_withdrawals'
  | 'disable_deposits'
  | 'enable_deposits'
  | 'pause_market_making'
  | 'resume_market_making';

export function postControlGlobalAction(
  token: string | null,
  body: { action: GlobalActionType; reason?: string; twofa_code?: string },
) {
  return adminFetch<{ action: string } & Record<string, unknown>>('/control/global-action', {
    method: 'POST',
    token,
    body,
  });
}
