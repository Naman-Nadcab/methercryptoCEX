import { adminFetch, getAdminApiBaseUrl } from './api';

export interface RevenueAnalytics {
  total_revenue_24h: number;
  trading_fee_revenue: number;
  withdrawal_fee_revenue: number;
  other_fees: number;
}

export interface VolumeByMarket {
  market: string;
  volume_usd: number;
}

export interface VolumeByAsset {
  asset: string;
  volume_usd: number;
}

export interface VolumeOverTime {
  date: string;
  volume_usd: number;
}

export interface VolumeAnalytics {
  volume_by_market: VolumeByMarket[];
  volume_by_asset: VolumeByAsset[];
  volume_over_time: VolumeOverTime[];
}

export interface LiquidityItem {
  market: string;
  spread_percent: number;
  orderbook_depth: number;
  liquidity_score: number;
}

export interface UserGrowthAnalytics {
  new_users_per_day: { date: string; count: number }[];
  new_users_today: number;
  active_users: number;
  retention_rate_percent: number;
}

export interface DepositsWithdrawalsAnalytics {
  deposits_vs_withdrawals: { name: string; value: number; color: string }[];
  top_deposit_assets: { asset: string; amount_usd: number }[];
  top_withdrawal_assets: { asset: string; amount_usd: number }[];
}

export interface MarketPerformanceRow {
  market: string;
  volume_24h: number;
  trades: number;
  spread_percent: number;
  liquidity_score: number;
}

export interface WhaleTradeRow {
  user: string;
  market: string;
  trade_size_usd: number;
  time: string;
}

export function getRevenueAnalytics(token: string | null) {
  return adminFetch<RevenueAnalytics>('/analytics/revenue', { token });
}

export function getVolumeAnalytics(token: string | null) {
  return adminFetch<VolumeAnalytics>('/analytics/volume', { token });
}

export function getLiquidityAnalytics(token: string | null) {
  return adminFetch<{ liquidity: LiquidityItem[] }>('/analytics/liquidity', { token });
}

export function getUserGrowthAnalytics(token: string | null) {
  return adminFetch<UserGrowthAnalytics>('/analytics/user-growth', { token });
}

export function getDepositsWithdrawalsAnalytics(token: string | null) {
  return adminFetch<DepositsWithdrawalsAnalytics>('/analytics/deposits-withdrawals', { token });
}

export function getMarketsPerformance(token: string | null) {
  return adminFetch<{ markets: MarketPerformanceRow[] }>('/analytics/markets', { token });
}

export function getWhaleTrades(token: string | null, limit?: number) {
  return adminFetch<{ whale_trades: WhaleTradeRow[] }>('/analytics/whale-trades', {
    token,
    params: limit != null ? { limit } : undefined,
  });
}

export interface RevenueHistoryPoint {
  date: string;
  trading_fee: number;
  withdrawal_fee: number;
  total: number;
}

export interface LiquidityHistoryPoint {
  date: string;
  liquidity_score: number;
}

export interface ActivityHeatmapCell {
  hour: number;
  day_of_week: number;
  trading_count: number;
  logins_count: number;
  deposits_count: number;
}

export interface WhaleAlerts {
  whale_trades_24h: number;
  largest_trade: { market: string; size_usd: number };
  top_whale_users: { user: string; trade_count: number; total_volume_usd: number }[];
}

export interface VolatilityRow {
  market: string;
  price_volatility_24h: number;
  spread_volatility: number;
  volume_volatility: number;
}

export interface ScheduledReportRow {
  id: string;
  report_type: string;
  frequency: string;
  format: string;
  enabled: boolean;
  last_run_at: string | null;
}

export function getRevenueHistory(token: string | null) {
  return adminFetch<{ history: RevenueHistoryPoint[] }>('/analytics/revenue-history', { token });
}

export function getLiquidityHistory(token: string | null, market?: string) {
  return adminFetch<{ market: string; history: LiquidityHistoryPoint[] }>('/analytics/liquidity-history', {
    token,
    params: market ? { market } : undefined,
  });
}

export function getActivityHeatmap(token: string | null) {
  return adminFetch<{ heatmap: ActivityHeatmapCell[] }>('/analytics/activity-heatmap', { token });
}

export function getWhaleAlerts(token: string | null) {
  return adminFetch<WhaleAlerts>('/analytics/whale-alerts', { token });
}

export function getVolatility(token: string | null) {
  return adminFetch<{ volatility: VolatilityRow[] }>('/analytics/volatility', { token });
}

export function getScheduledReports(token: string | null) {
  return adminFetch<{ scheduled_reports: ScheduledReportRow[] }>('/analytics/scheduled-reports', { token });
}

export function createScheduledReport(
  token: string | null,
  body: { report_type: string; frequency: string; format?: string }
) {
  return adminFetch<{ id: string }>('/analytics/scheduled-reports', { method: 'POST', token, body });
}

export function deleteScheduledReport(token: string | null, id: string) {
  return adminFetch<{ deleted: boolean }>(`/analytics/scheduled-reports/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  });
}

export type AnalyticsReportType = 'trading' | 'revenue' | 'user-growth' | 'users' | 'aml-alerts';
export type AnalyticsExportFormat = 'csv' | 'json' | 'pdf';

export async function downloadAnalyticsExport(
  token: string | null,
  report: AnalyticsReportType,
  format: AnalyticsExportFormat
) {
  if (!token) return;
  const url = `${getAdminApiBaseUrl()}/api/v1/admin/analytics/export?report=${report}&format=${format}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Export failed');
  if (format === 'json') {
    const json = await res.json();
    const blob = new Blob([JSON.stringify(json.data ?? {}, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `analytics-${report}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `analytics-${report}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
