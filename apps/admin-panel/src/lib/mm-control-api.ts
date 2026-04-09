import { adminFetch, type AdminApiResponse } from '@/lib/api';

export type MMGlobalMode = 'safe' | 'normal' | 'aggressive';
export type SpreadMode = 'auto' | 'manual';
export type FlowMode = 'aggressive' | 'neutral' | 'defensive';
export type RefreshMode = 'slow' | 'normal' | 'fast';
export type VolatilityMode = 'low' | 'medium' | 'high';

export type MMGlobalRuntimeConfig = {
  enabled: boolean;
  mode: MMGlobalMode;
  max_position_usd?: number;
  max_daily_loss_usd?: number;
  daily_target_usd?: number;
};

export type MMPairRuntimeConfig = {
  enabled: boolean;
  spread_mode: SpreadMode;
  spread_bps: number;
  order_size: number;
  ladder_levels: number;
  refresh_mode: RefreshMode;
  volatility_mode: VolatilityMode;
  flow_mode: FlowMode;
  max_position_usd?: number;
  max_daily_loss_usd?: number;
  pair_capital_usd?: number;
};

export type MmControlStatus = {
  global: MMGlobalRuntimeConfig;
  pairKeys: string[];
  pairs: Record<string, MMPairRuntimeConfig>;
  capital_per_pair?: Record<string, { base_usd: number; effective_usd: number }>;
  pair_performance?: Record<string, { pnl_1h: number; trades: number }>;
  daily_target_progress?: {
    target_usd: number;
    pnl_today_usd: number;
    progress: number;
  };
  spread_learning?: Record<string, { adj_bps: number }>;
  bot: {
    enabled: boolean;
    symbols: string[];
    envSpreadBps: number;
    envOrderSize: number;
    envLadderLevels: number;
  };
  live: Array<{
    symbol: string;
    openOrders: number;
    positionUsd: string;
    skipBidPlacement: boolean;
    skipAskPlacement: boolean;
    pnl1hUsd: number | null;
    fill_rate?: number;
    toxic_flow?: boolean;
  }>;
};

export async function getMmControlGlobal(token: string | null) {
  return adminFetch<MMGlobalRuntimeConfig>('/mm-control/global', { token });
}

export async function postMmControlGlobal(token: string | null, body: Partial<MMGlobalRuntimeConfig>) {
  return adminFetch<MMGlobalRuntimeConfig>('/mm-control/global', { method: 'POST', body, token });
}

export async function getMmControlPair(token: string | null, symbol: string) {
  return adminFetch<{ symbol: string; configured: boolean; config: MMPairRuntimeConfig }>(
    `/mm-control/pair/${encodeURIComponent(symbol)}`,
    { token }
  );
}

export async function postMmControlPair(
  token: string | null,
  symbol: string,
  body: Partial<MMPairRuntimeConfig>
) {
  return adminFetch<{ symbol: string; config: MMPairRuntimeConfig }>(
    `/mm-control/pair/${encodeURIComponent(symbol)}`,
    { method: 'POST', body, token }
  );
}

export async function getMmControlStatus(token: string | null) {
  return adminFetch<MmControlStatus>('/mm-control/status', { token });
}

export function isMmControlOk<T>(
  r: AdminApiResponse<T> | undefined
): r is AdminApiResponse<T> & { success: true; data: T } {
  return Boolean(r && r.success && r.data !== undefined);
}
