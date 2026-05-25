import { adminFetch, type AdminApiResponse } from './api';

export type HedgeRiskOverviewData = {
  flags: {
    hedge_emergency_stop: boolean;
    hedge_global_enabled: boolean;
  };
  limits: {
    max_hedge_notional_usd_per_order: string;
    max_net_hedge_exposure_usd: string;
    hedge_max_daily_loss_usd: string;
  } | null;
  pnlToday: { signed_realized_usd: string; adverse_usd: string };
  exposures: Array<{
    market: string;
    exposure_usd: string;
    realized_pnl: string;
    unrealized_pnl: string;
    updated_at: string;
  }>;
  /** Server trips a provider circuit after this many consecutive failures */
  circuit_trip_failure_count: number;
};

export async function fetchHedgeRiskOverview(
  token: string | null
): Promise<AdminApiResponse<HedgeRiskOverviewData>> {
  return adminFetch<HedgeRiskOverviewData>('/hybrid/risk/overview', { token });
}

/** Rows from `GET /hybrid/config` (`market NULLS FIRST` = global defaults first). */
export type HybridConfigRowAdmin = {
  id: string;
  market: string | null;
  enabled: boolean;
  small_trade_max_notional_usd: string;
  large_trade_min_notional_usd: string;
  between_band_policy: string;
  hedge_enabled: boolean;
  fallback_to_internal: boolean;
  max_slippage_bps: number;
  max_hedge_notional_usd_per_order: string;
  max_net_hedge_exposure_usd: string;
  hedge_max_daily_loss_usd: string;
  system_counterparty_user_id: string | null;
  updated_at: string;
};

export type PatchHybridConfigPayload = {
  id: string;
  enabled?: boolean;
  small_trade_max_notional_usd?: string;
  large_trade_min_notional_usd?: string;
  between_band_policy?: string;
  hedge_enabled?: boolean;
  fallback_to_internal?: boolean;
  max_slippage_bps?: number;
  max_hedge_notional_usd_per_order?: string;
  max_net_hedge_exposure_usd?: string;
  hedge_max_daily_loss_usd?: string;
  /** Omit to leave unchanged; pass `null` to clear. */
  system_counterparty_user_id?: string | null;
};

export async function fetchHybridConfigs(
  token: string | null
): Promise<AdminApiResponse<HybridConfigRowAdmin[]>> {
  return adminFetch<HybridConfigRowAdmin[]>('/hybrid/config', { token });
}

export async function patchHybridConfig(
  token: string | null,
  payload: PatchHybridConfigPayload,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ id: string }>> {
  return adminFetch<{ id: string }>('/hybrid/config', { method: 'PATCH', body: { ...payload, reason, ...(twofa_code ? { twofa_code } : {}) }, token });
}

/** Clone global hybrid defaults into a row for `market` (active spot symbol). */
export async function createHybridMarketRow(
  token: string | null,
  market: string,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ id: string; market: string }>> {
  return adminFetch<{ id: string; market: string }>('/hybrid/config', {
    method: 'POST',
    body: { market, reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

/** Drops per-market override only; global row cannot be deleted. */
export async function deleteHybridMarketRow(
  token: string | null,
  rowId: string,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ id: string }>> {
  return adminFetch<{ id: string }>(`/hybrid/config/${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
    body: { reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

export async function postHedgeEmergencyStop(
  token: string | null,
  active: boolean,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ hedge_emergency_stop: boolean }>> {
  return adminFetch<{ hedge_emergency_stop: boolean }>('/hybrid/risk/emergency-stop', {
    method: 'POST',
    body: { active, reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

export async function postHedgeGlobalEnabled(
  token: string | null,
  enabled: boolean,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ hedge_global_enabled: boolean }>> {
  return adminFetch<{ hedge_global_enabled: boolean }>('/hybrid/risk/global-enabled', {
    method: 'POST',
    body: { enabled, reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

/** Mirrors `listAllProvidersForAdmin()` rows from the backend. */
export type ExternalLiquidityProviderAdmin = {
  id: string;
  provider_name: string;
  enabled: boolean;
  base_url: string;
  is_testnet: boolean;
  priority: number;
  api_key_configured: boolean;
  api_secret_configured: boolean;
  last_health_ok_at: string | null;
  consecutive_failures: number;
  last_successful_execution_at: string | null;
  last_failure_reason: string | null;
  active_hedge_jobs: number;
  failover_count_7d: number;
  created_at: string;
  updated_at: string;
};

export type ExternalLiquidityFailoverHistoryRow = {
  id: string;
  from_provider_id: string | null;
  from_provider_name: string | null;
  to_provider_id: string;
  to_provider_name: string;
  mode: string;
  reason: string;
  actor_admin_id: string | null;
  metadata: unknown;
  created_at: string;
};

export async function fetchExternalLiquidityProviders(
  token: string | null
): Promise<AdminApiResponse<ExternalLiquidityProviderAdmin[]>> {
  return adminFetch<ExternalLiquidityProviderAdmin[]>('/external-liquidity/providers', { token });
}

export async function resetProviderCircuit(
  token: string | null,
  providerId: string,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ id: string; consecutive_failures: number; enabled: boolean }>> {
  return adminFetch(`/external-liquidity/providers/${encodeURIComponent(providerId)}/circuit-reset`, {
    method: 'POST',
    body: { reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

export async function createExternalLiquidityProvider(
  token: string | null,
  body: {
    provider_name: string;
    base_url: string;
    api_key: string;
    api_secret: string;
    enabled?: boolean;
    is_testnet?: boolean;
    priority?: number;
  },
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ id: string }>> {
  return adminFetch<{ id: string }>('/external-liquidity/providers', {
    method: 'POST',
    body: { ...body, reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

export async function patchExternalLiquidityProvider(
  token: string | null,
  providerId: string,
  body: Partial<{
    provider_name: string;
    base_url: string;
    enabled: boolean;
    is_testnet: boolean;
    priority: number;
    api_key: string;
    api_secret: string;
  }>,
  reason: string,
  twofa_code?: string
): Promise<AdminApiResponse<{ id: string }>> {
  return adminFetch<{ id: string }>(`/external-liquidity/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    body: { ...body, reason, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

export async function testExternalLiquidityProvider(
  token: string | null,
  providerId: string
): Promise<AdminApiResponse<unknown>> {
  return adminFetch(`/external-liquidity/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    body: {},
    token,
  });
}

export async function manualFailoverProvider(
  token: string | null,
  providerId: string,
  reason: string,
  reset_circuit = true,
  twofa_code?: string
): Promise<AdminApiResponse<{ from_provider_id: string | null; to_provider_id: string; to_provider_name: string; new_priority: number }>> {
  return adminFetch(`/external-liquidity/providers/${encodeURIComponent(providerId)}/failover`, {
    method: 'POST',
    body: { reason, reset_circuit, ...(twofa_code ? { twofa_code } : {}) },
    token,
  });
}

export async function fetchExternalLiquidityFailoverHistory(
  token: string | null,
  limit = 50
): Promise<AdminApiResponse<ExternalLiquidityFailoverHistoryRow[]>> {
  return adminFetch<ExternalLiquidityFailoverHistoryRow[]>(
    `/external-liquidity/failover/history?limit=${encodeURIComponent(String(limit))}`,
    { token }
  );
}
