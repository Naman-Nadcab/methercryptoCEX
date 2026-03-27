import { adminFetch } from './api';

export const INTEGRATION_CATEGORIES = [
  'blockchain_nodes',
  'price_oracles',
  'compliance_providers',
  'kyc_providers',
  'email_sms_gateways',
  'webhook_endpoints',
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export interface IntegrationRow {
  id: string;
  provider_name: string;
  category: string;
  endpoint_url: string;
  api_key: string;
  secret_key: string;
  webhook_secret: string;
  status: string;
  event_type: string | null;
  assets_covered: string | null;
  update_interval_sec: number | null;
  updated_at: string | null;
  latency_ms?: number | null;
  last_successful_request?: string | null;
  error_count?: number;
  failover_priority?: number;
}

export interface IntegrationHealth {
  active_integrations: number;
  failed_integrations: number;
  average_latency_ms: number;
  webhook_delivery_rate_percent: number;
}

export interface IntegrationRateLimitRow {
  integration_id: string;
  provider_name: string;
  category: string;
  requests_per_min: number;
  remaining_quota: number | null;
  resets_at: string | null;
}

export interface WebhookDeliveryRow {
  id: string;
  integration_id: string;
  webhook_url: string;
  event_type: string;
  delivery_status: string;
  response_code: number | null;
  retry_count: number;
  time: string;
}

export interface IntegrationEventLogRow {
  integration: string;
  event: string;
  status: string;
  latency_ms: number | null;
  timestamp: string;
}

export interface TestConnectionResult {
  latency_ms: number;
  status: string;
  error?: string;
}

export function getIntegrations(token: string | null, category?: string) {
  return adminFetch<{ integrations: IntegrationRow[] }>('/integrations', {
    token,
    params: category ? { category } : undefined,
  });
}

export function createIntegration(
  token: string | null,
  body: {
    provider_name: string;
    category: string;
    endpoint_url?: string;
    api_key?: string;
    secret_key?: string;
    webhook_secret?: string;
    status?: string;
    event_type?: string;
    assets_covered?: string;
    update_interval_sec?: number;
  }
) {
  return adminFetch<{ id: string }>('/integrations', { method: 'POST', token, body });
}

export function updateIntegration(
  token: string | null,
  id: string,
  body: Partial<{
    provider_name: string;
    category: string;
    endpoint_url: string;
    api_key: string;
    secret_key: string;
    webhook_secret: string;
    status: string;
    event_type: string;
    assets_covered: string;
    update_interval_sec: number;
    failover_priority: number;
  }>
) {
  return adminFetch<{ id: string }>(`/integrations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    body,
  });
}

export function testIntegrationConnection(token: string | null, payload: { id?: string; url?: string }) {
  return adminFetch<TestConnectionResult>('/integrations/test', {
    method: 'POST',
    token,
    body: payload,
  });
}

export function getIntegrationsHealth(token: string | null) {
  return adminFetch<IntegrationHealth>('/integrations/health', { token });
}

export function getIntegrationsRateLimits(token: string | null) {
  return adminFetch<{ rate_limits: IntegrationRateLimitRow[] }>('/integrations/rate-limits', { token });
}

export function getWebhookDeliveries(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch<{ deliveries: WebhookDeliveryRow[] }>('/integrations/webhook-deliveries', {
    token,
    params: params as Record<string, string> | undefined,
  });
}

export function retryWebhookDelivery(token: string | null, deliveryId: string) {
  return adminFetch<{ message: string }>(`/integrations/webhooks/${encodeURIComponent(deliveryId)}/retry`, {
    method: 'POST',
    token,
  });
}

export function getIntegrationEventLogs(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch<{ logs: IntegrationEventLogRow[] }>('/integrations/event-logs', {
    token,
    params: params as Record<string, string> | undefined,
  });
}

export function switchIntegrationProvider(token: string | null, category: string, providerId: string) {
  return adminFetch<{ category: string; provider_id: string }>('/integrations/switch', {
    method: 'POST',
    token,
    body: { category, provider_id: providerId },
  });
}
