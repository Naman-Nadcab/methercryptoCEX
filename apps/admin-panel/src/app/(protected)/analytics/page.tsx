'use client';

import { useState, useMemo, memo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getRevenueAnalytics,
  getRevenueHistory,
  getVolumeAnalytics,
  getLiquidityAnalytics,
  getLiquidityHistory,
  getActivityHeatmap,
  getUserGrowthAnalytics,
  getDepositsWithdrawalsAnalytics,
  getMarketsPerformance,
  getWhaleTrades,
  getWhaleAlerts,
  getVolatility,
  downloadAnalyticsExport,
  type AnalyticsReportType,
  type AnalyticsExportFormat,
} from '@/lib/analytics-api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  DollarSign, TrendingUp, Wallet, Receipt, Users, Download, Loader2,
  Calendar, AlertCircle, BarChart3, Droplets, ArrowRight, ArrowUpRight,
  ArrowDownRight, Activity, FileText, Clock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area,
} from 'recharts';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

const CHART_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#64748B', '#EC4899', '#14B8A6', '#8B5CF6'];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'trading', label: 'Trading' },
  { id: 'users', label: 'User Growth' },
  { id: 'deposits', label: 'Deposits & Withdrawals' },
  { id: 'markets', label: 'Market Performance' },
  { id: 'whale', label: 'Whale Activity' },
  { id: 'volatility', label: 'Volatility' },
  { id: 'activity', label: 'Activity Heatmap' },
  { id: 'export', label: 'Export' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function relativeTime(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function fmtUsd(n: number, compact = false): string {
  if (compact) {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function EmptyChart({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <BarChart3 className="h-8 w-8 text-admin-muted mb-2" />
      <p className="text-xs text-admin-muted">{message}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [exporting, setExporting] = useState<string | null>(null);

  const { data: revenueData } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue', token],
    queryFn: () => getRevenueAnalytics(token),
    enabled: !!token, refetchInterval: 60000, staleTime: 30_000,
  });
  const { data: volumeData } = useQuery({
    queryKey: ['admin', 'analytics', 'volume', token],
    queryFn: () => getVolumeAnalytics(token),
    enabled: !!token, refetchInterval: 60000, staleTime: 30_000,
  });
  const { data: liquidityData } = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity', token],
    staleTime: 30_000,
    queryFn: () => getLiquidityAnalytics(token),
    enabled: !!token,
  });
  const { data: userGrowthData } = useQuery({
    queryKey: ['admin', 'analytics', 'user-growth', token],
    staleTime: 30_000,
    queryFn: () => getUserGrowthAnalytics(token),
    enabled: !!token,
  });
  const { data: depositsData } = useQuery({
    queryKey: ['admin', 'analytics', 'deposits-withdrawals', token],
    staleTime: 30_000,
    queryFn: () => getDepositsWithdrawalsAnalytics(token),
    enabled: !!token,
  });
  const { data: marketsData } = useQuery({
    queryKey: ['admin', 'analytics', 'markets', token],
    staleTime: 30_000,
    queryFn: () => getMarketsPerformance(token),
    enabled: !!token,
  });
  const { data: whaleData } = useQuery({
    queryKey: ['admin', 'analytics', 'whale', token],
    staleTime: 30_000,
    queryFn: () => getWhaleTrades(token, 30),
    enabled: !!token,
  });
  const { data: revenueHistoryData } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue-history', token],
    staleTime: 30_000,
    queryFn: () => getRevenueHistory(token),
    enabled: !!token,
  });
  const [liquidityMarket, setLiquidityMarket] = useState('BTC/USDT');
  const { data: liquidityHistoryData } = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity-history', token, liquidityMarket],
    staleTime: 30_000,
    queryFn: () => getLiquidityHistory(token, liquidityMarket),
    enabled: !!token,
  });
  const { data: heatmapData } = useQuery({
    queryKey: ['admin', 'analytics', 'activity-heatmap', token],
    staleTime: 30_000,
    queryFn: () => getActivityHeatmap(token),
    enabled: !!token && activeTab === 'activity',
  });
  const { data: whaleAlertsData } = useQuery({
    queryKey: ['admin', 'analytics', 'whale-alerts', token],
    staleTime: 30_000,
    queryFn: () => getWhaleAlerts(token),
    enabled: !!token,
  });
  const { data: volatilityData } = useQuery({
    queryKey: ['admin', 'analytics', 'volatility', token],
    staleTime: 30_000,
    queryFn: () => getVolatility(token),
    enabled: !!token,
  });

  const revenue = revenueData?.data;
  const volume = volumeData?.data;
  const liquidity = liquidityData?.data?.liquidity ?? [];
  const userGrowth = userGrowthData?.data;
  const deposits = depositsData?.data;
  const markets = marketsData?.data?.markets ?? [];
  const whaleTrades = whaleData?.data?.whale_trades ?? [];
  const revenueHistory = revenueHistoryData?.data?.history ?? [];
  const liquidityHistory = liquidityHistoryData?.data?.history ?? [];
  const heatmap = heatmapData?.data?.heatmap ?? [];
  const whaleAlerts = whaleAlertsData?.data;
  const volatility = volatilityData?.data?.volatility ?? [];

  const totalVolume24h = useMemo(() => (volume?.volume_by_market ?? []).reduce((s, m) => s + m.volume_usd, 0), [volume]);

  const marketDominance = useMemo(() => {
    const byMarket = volume?.volume_by_market ?? [];
    const total = byMarket.reduce((s, m) => s + m.volume_usd, 0);
    if (total === 0) return [];
    return byMarket.map((m) => ({ name: m.market, value: Math.round((m.volume_usd / total) * 100), volume_usd: m.volume_usd }));
  }, [volume?.volume_by_market]);

  const handleExport = async (report: AnalyticsReportType, format: AnalyticsExportFormat) => {
    const key = `${report}-${format}`;
    setExporting(key);
    try { await downloadAnalyticsExport(token, report, format); } catch { /* handled */ } finally { setExporting(null); }
  };

  return (
    <AdminPageFrame title="Exchange Analytics" description="Revenue, volume, liquidity, user growth, and business intelligence" quickActions={
        <Link href="/analytics/scheduled-reports">
          <Button variant="secondary" size="sm" icon={<Calendar className="h-3.5 w-3.5" />}>Scheduled Reports</Button>
        </Link>
      }>

      {/* Tabs */}
      <div className="border-b border-admin-border overflow-x-auto">
        <nav className="flex gap-0 min-w-max">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className={cn('border-b-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap',
                activeTab === tab.id ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-text')}>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === 'overview' && (
        <>
          {/* KPI Row */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Total Revenue (24h)" value={revenue != null ? fmtUsd(revenue.total_revenue_24h) : '—'} icon={DollarSign} accent="indigo" />
            <KpiCard label="Trading Volume (24h)" value={totalVolume24h > 0 ? fmtUsd(totalVolume24h, true) : '—'} icon={Activity} accent="emerald" />
            <KpiCard label="Active Users" value={userGrowth?.active_users ?? '—'} icon={Users} accent="blue" sub={userGrowth ? `+${userGrowth.new_users_today} today` : undefined} />
            <KpiCard label="Retention Rate" value={userGrowth != null ? `${userGrowth.retention_rate_percent}%` : '—'} icon={TrendingUp} accent="amber" />
          </section>

          {/* Revenue Breakdown */}
          <section className="grid grid-cols-3 gap-3">
            <MiniKpi label="Trading Fees" value={revenue != null ? fmtUsd(revenue.trading_fee_revenue) : '—'} icon={TrendingUp} />
            <MiniKpi label="Withdrawal Fees" value={revenue != null ? fmtUsd(revenue.withdrawal_fee_revenue) : '—'} icon={Wallet} />
            <MiniKpi label="Other Fees" value={revenue != null ? fmtUsd(revenue.other_fees) : '—'} icon={Receipt} />
          </section>

          {/* Charts Row */}
          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Revenue Trend (30d)">
              {revenueHistory.length === 0 ? <EmptyChart message="No revenue data yet" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueHistory.map((d) => ({ ...d, dateLabel: d.date.slice(5) }))} margin={{ left: 10, right: 10, top: 5, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366F1" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: CHART_TICK }} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtUsd(v), '']} />
                    <Area type="monotone" dataKey="total" name="Revenue" stroke="#6366F1" strokeWidth={2} fill="url(#revGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Volume by Market (30d)">
              {(volume?.volume_by_market ?? []).length === 0 ? <EmptyChart message="No volume data yet" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(volume?.volume_by_market ?? []).slice(0, 8)} margin={{ left: 10, right: 10, top: 5, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="market" tick={{ fontSize: 10, fill: CHART_TICK }} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtUsd(v), 'Volume']} />
                    <Bar dataKey="volume_usd" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </section>

          {/* Quick Links */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <QuickLink label="Liquidity Dashboard" sub="Spread, depth, order book" href="/liquidity" icon={Droplets} />
            <QuickLink label="Whale Monitoring" sub={`${whaleAlerts?.whale_trades_24h ?? 0} whale trades (24h)`} onClick={() => setActiveTab('whale')} icon={AlertCircle} />
            <QuickLink label="Market Performance" sub={`${markets.length} active markets`} onClick={() => setActiveTab('markets')} icon={BarChart3} />
            <QuickLink label="Export Reports" sub="CSV, JSON downloads" onClick={() => setActiveTab('export')} icon={FileText} />
          </section>
        </>
      )}

      {/* ===== TRADING TAB ===== */}
      {activeTab === 'trading' && (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Volume by Market">
              {(volume?.volume_by_market ?? []).length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volume?.volume_by_market ?? []} margin={{ left: 10, right: 10, top: 5, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="market" tick={{ fontSize: 10, fill: CHART_TICK }} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtUsd(v), 'Volume']} />
                    <Bar dataKey="volume_usd" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Volume by Asset">
              {(volume?.volume_by_asset ?? []).length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={volume?.volume_by_asset ?? []} dataKey="volume_usd" nameKey="asset" cx="50%" cy="50%" outerRadius={75} innerRadius={40}
                      label={({ asset, volume_usd }: { asset: string; volume_usd: number }) => `${asset} ${fmtUsd(volume_usd, true)}`}>
                      {(volume?.volume_by_asset ?? []).map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtUsd(v), 'Volume']} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Market Dominance (Volume Share)">
              {marketDominance.length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={marketDominance} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40}
                      label={({ name, value }) => `${name} ${value}%`}>
                      {marketDominance.map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, 'Share']} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Volume Over Time">
              {(volume?.volume_over_time ?? []).length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={(volume?.volume_over_time ?? []).map((d) => ({ ...d, dateLabel: d.date.slice(5) }))} margin={{ left: 10, right: 10, top: 5, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: CHART_TICK }} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtUsd(v), 'Volume']} />
                    <Area type="monotone" dataKey="volume_usd" stroke="#10B981" strokeWidth={2} fill="url(#volGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </section>

          {/* Liquidity Score */}
          <div className="rounded-xl border border-admin-border bg-admin-card">
            <div className="flex items-center justify-between px-5 py-3 border-b border-admin-border">
              <h3 className="text-sm font-semibold text-admin-text">Liquidity Score (14d)</h3>
              <select value={liquidityMarket} onChange={(e) => setLiquidityMarket(e.target.value)}
                className="rounded-lg border border-admin-border px-2.5 py-1 text-xs text-admin-text bg-white/[0.02]">
                {(liquidity.length ? liquidity : [{ market: 'BTC/USDT' }]).map((m) => (
                  <option key={m.market} value={m.market}>{m.market}</option>
                ))}
              </select>
            </div>
            <div className="p-4 h-[220px]">
              {liquidityHistory.length === 0 ? <EmptyChart message="No liquidity history" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={liquidityHistory.map((d) => ({ ...d, dateLabel: d.date.slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: CHART_TICK }} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="liquidity_score" name="Score" stroke="#6366F1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <Link href="/liquidity" className="flex items-center gap-2 rounded-xl border border-admin-border bg-admin-card px-5 py-3 text-sm font-medium text-admin-primary hover:bg-white/[0.02] transition-colors">
            <Droplets className="h-4 w-4" /> Detailed Liquidity Dashboard <ArrowRight className="h-3.5 w-3.5 ml-auto" />
          </Link>
        </>
      )}

      {/* ===== USER GROWTH TAB ===== */}
      {activeTab === 'users' && (
        <>
          <section className="grid grid-cols-3 gap-3">
            <KpiCard label="New Users Today" value={userGrowth?.new_users_today ?? '—'} icon={Users} accent="indigo" />
            <KpiCard label="Active Users" value={userGrowth?.active_users ?? '—'} icon={Users} accent="emerald" />
            <KpiCard label="Retention Rate" value={userGrowth != null ? `${userGrowth.retention_rate_percent}%` : '—'} icon={TrendingUp} accent="amber" />
          </section>
          <ChartCard title="New Users Per Day" height={300}>
            {(userGrowth?.new_users_per_day ?? []).length === 0 ? <EmptyChart message="No user growth data" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(userGrowth?.new_users_per_day ?? []).map((d) => ({ ...d, dateLabel: d.date.slice(5) }))} margin={{ left: 10, right: 10, top: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: CHART_TICK }} />
                  <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="New Users" fill="#6366F1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </>
      )}

      {/* ===== DEPOSITS & WITHDRAWALS TAB ===== */}
      {activeTab === 'deposits' && (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Deposits vs Withdrawals">
              {(deposits?.deposits_vs_withdrawals ?? []).length === 0 ? <EmptyChart /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={deposits?.deposits_vs_withdrawals ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={40}
                      label={({ name, value }) => `${name} ${value}%`}>
                      {(deposits?.deposits_vs_withdrawals ?? []).map((entry, i) => (
                        <Cell key={i} fill={entry.color || CHART_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <div className="space-y-4">
              <AssetList title="Top Deposit Assets" items={deposits?.top_deposit_assets ?? []} />
              <AssetList title="Top Withdrawal Assets" items={deposits?.top_withdrawal_assets ?? []} />
            </div>
          </section>
        </>
      )}

      {/* ===== MARKET PERFORMANCE TAB ===== */}
      {activeTab === 'markets' && (
        <div className="rounded-xl border border-admin-border bg-admin-card">
          <div className="px-5 py-3 border-b border-admin-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-admin-text">Market Performance</h3>
            <Badge variant="info" size="sm">{markets.length} markets</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead>
                <tr className="border-b border-admin-border bg-white/[0.03]">
                  <th className="px-5 py-2.5 font-medium text-admin-muted">Market</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Volume (24h)</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Trades</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Spread</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted">Liquidity</th>
                </tr>
              </thead>
              <tbody>
                {markets.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-admin-muted">No market data available</td></tr>
                ) : markets.map((row) => (
                  <tr key={row.market} className="border-b border-admin-border/50 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-5 py-2.5 font-medium text-admin-text">{row.market}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-admin-text">{fmtUsd(row.volume_24h, true)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-admin-text">{row.trades.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-admin-text">{row.spread_percent}%</td>
                    <td className="px-3 py-2.5">
                      <LiquidityBar score={row.liquidity_score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== WHALE ACTIVITY TAB ===== */}
      {activeTab === 'whale' && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard label="Whale Trades (24h)" value={whaleAlerts?.whale_trades_24h ?? 0} icon={AlertCircle} accent="red" />
            <KpiCard label="Largest Trade Today" value={
              whaleAlerts?.largest_trade?.size_usd != null && whaleAlerts.largest_trade.size_usd > 0
                ? `${fmtUsd(whaleAlerts.largest_trade.size_usd, true)} ${whaleAlerts.largest_trade.market}` : '—'
            } icon={TrendingUp} accent="amber" />
            <KpiCard label="Top Whale Users (7d)" value={(whaleAlerts?.top_whale_users ?? []).length} icon={Users} accent="indigo" />
          </section>

          {(whaleAlerts?.top_whale_users ?? []).length > 0 && (
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text">Top Whale Users</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-admin-border bg-white/[0.03]">
                      <th className="px-5 py-2.5 font-medium text-admin-muted">User</th>
                      <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Trades</th>
                      <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Total Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(whaleAlerts?.top_whale_users ?? []).map((u, i) => (
                      <tr key={i} className="border-b border-admin-border/50 last:border-0 hover:bg-white/[0.03]">
                        <td className="px-5 py-2.5 font-medium text-admin-text">{u.user}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-admin-text">{u.trade_count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-admin-text">{fmtUsd(u.total_volume_usd, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-admin-border bg-admin-card">
            <div className="px-5 py-3 border-b border-admin-border">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-admin-text">Whale Trades</h3>
                <span className="text-[10px] text-admin-muted">Trades over $100K · Last 7 days</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[550px] text-left text-xs">
                <thead>
                  <tr className="border-b border-admin-border bg-white/[0.03]">
                    <th className="px-5 py-2.5 font-medium text-admin-muted">User</th>
                    <th className="px-3 py-2.5 font-medium text-admin-muted">Market</th>
                    <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Size</th>
                    <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {whaleTrades.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-10 text-center text-admin-muted">No whale trades in the last 7 days</td></tr>
                  ) : whaleTrades.map((row, i) => (
                    <tr key={i} className="border-b border-admin-border/50 last:border-0 hover:bg-white/[0.03]">
                      <td className="px-5 py-2.5 font-medium text-admin-text">{row.user}</td>
                      <td className="px-3 py-2.5 text-admin-text">{row.market}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-admin-text">{fmtUsd(row.trade_size_usd, true)}</td>
                      <td className="px-3 py-2.5 text-right text-admin-muted">{relativeTime(row.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===== VOLATILITY TAB ===== */}
      {activeTab === 'volatility' && (
        <div className="rounded-xl border border-admin-border bg-admin-card">
          <div className="px-5 py-3 border-b border-admin-border">
            <h3 className="text-sm font-semibold text-admin-text">Market Volatility (24h)</h3>
            <p className="text-[10px] text-admin-muted mt-0.5">Price, spread, and volume volatility metrics</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[550px] text-left text-xs">
              <thead>
                <tr className="border-b border-admin-border bg-white/[0.03]">
                  <th className="px-5 py-2.5 font-medium text-admin-muted">Market</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Price Volatility</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Spread Volatility</th>
                  <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Volume Volatility</th>
                </tr>
              </thead>
              <tbody>
                {volatility.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-10 text-center text-admin-muted">No volatility data</td></tr>
                ) : volatility.map((row) => (
                  <tr key={row.market} className="border-b border-admin-border/50 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-5 py-2.5 font-medium text-admin-text">{row.market}</td>
                    <td className="px-3 py-2.5 text-right">
                      <VolatilityBadge value={row.price_volatility_24h} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <VolatilityBadge value={row.spread_volatility} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <VolatilityBadge value={row.volume_volatility} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== ACTIVITY HEATMAP TAB ===== */}
      {activeTab === 'activity' && (
        <div className="rounded-xl border border-admin-border bg-admin-card">
          <div className="px-5 py-3 border-b border-admin-border">
            <h3 className="text-sm font-semibold text-admin-text">User Activity Heatmap</h3>
            <p className="text-[10px] text-admin-muted mt-0.5">Peak trading hours and activity (last 7 days). Hover for details.</p>
          </div>
          <div className="p-5 overflow-x-auto">
            <div className="inline-block min-w-[600px]">
              <div className="mb-2 flex gap-1 text-[10px] text-admin-muted font-medium">
                <span className="w-12 shrink-0" />
                {DAY_LABELS.map((d) => (<span key={d} className="flex-1 text-center">{d}</span>))}
              </div>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="mb-0.5 flex items-center gap-1">
                  <span className="w-12 shrink-0 text-[10px] text-admin-muted text-right pr-2 tabular-nums">{String(hour).padStart(2, '0')}:00</span>
                  <div className="flex flex-1 gap-0.5">
                    {DAY_LABELS.map((_, dayOfWeek) => {
                      const cell = heatmap.find((c) => c.hour === hour && c.day_of_week === dayOfWeek);
                      const trading = cell?.trading_count ?? 0;
                      const maxTrading = Math.max(...heatmap.map((c) => c.trading_count), 1);
                      const intensity = maxTrading > 0 ? Math.min(1, trading / maxTrading) : 0;
                      return (
                        <div key={dayOfWeek} className="h-5 flex-1 rounded-sm transition-colors"
                          style={{ backgroundColor: `rgba(99, 102, 241, ${0.08 + intensity * 0.85})` }}
                          title={`Trading: ${trading}, Logins: ${cell?.logins_count ?? 0}, Deposits: ${cell?.deposits_count ?? 0}`} />
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="mt-3 flex items-center gap-2 text-[10px] text-admin-muted">
                <span>Low</span>
                <div className="flex gap-0.5">{[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
                  <div key={v} className="h-3 w-6 rounded-sm" style={{ backgroundColor: `rgba(99, 102, 241, ${v})` }} />
                ))}</div>
                <span>High</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== EXPORT TAB ===== */}
      {activeTab === 'export' && (
        <>
          <div className="rounded-xl border border-admin-border bg-admin-card">
            <div className="px-5 py-3 border-b border-admin-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-admin-text">Export Analytics Reports</h3>
                <p className="text-[10px] text-admin-muted mt-0.5">Download trading, revenue, or user growth data</p>
              </div>
              <Link href="/analytics/scheduled-reports">
                <Button variant="secondary" size="sm" icon={<Clock className="h-3.5 w-3.5" />}>Schedule Exports</Button>
              </Link>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-3">
              {(['trading', 'revenue', 'user-growth'] as AnalyticsReportType[]).map((report) => (
                <div key={report} className="rounded-lg border border-admin-border p-4">
                  <h4 className="text-xs font-semibold text-admin-text capitalize">{report.replace('-', ' ')} Report</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['csv', 'json'] as AnalyticsExportFormat[]).map((format) => (
                      <Button key={format} variant="secondary" size="sm" onClick={() => handleExport(report, format)} disabled={exporting !== null}
                        icon={exporting === `${report}-${format}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}>
                        {format.toUpperCase()}
                      </Button>
                    ))}
                    <span className="inline-flex items-center rounded-lg border border-dashed border-admin-border px-2.5 py-1 text-[10px] font-medium text-admin-muted">
                      PDF — Coming soon
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </AdminPageFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

const tooltipStyle: React.CSSProperties = { fontSize: 11, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#0F1117', color: '#E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' };

const CHART_GRID = '#1F2937';
const CHART_TICK = '#6B7280';

const ACCENT_MAP: Record<string, string> = {
  indigo: 'bg-indigo-500/15 text-indigo-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  blue: 'bg-blue-500/15 text-blue-400',
  amber: 'bg-amber-500/15 text-amber-400',
  red: 'bg-red-500/15 text-red-400',
};

function KpiCard({ label, value, icon: Icon, accent = 'indigo', sub }: {
  label: string; value: string | number; icon: React.ElementType; accent?: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', ACCENT_MAP[accent] ?? ACCENT_MAP.indigo)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="text-xl font-bold tabular-nums text-admin-text">{value}</p>
      {sub && <p className="text-[10px] text-admin-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniKpi({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-admin-border bg-admin-card px-3.5 py-2.5">
      <Icon className="h-4 w-4 text-admin-muted shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-admin-muted font-medium">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-admin-text truncate">{value}</p>
      </div>
    </div>
  );
}

function ChartCard({ title, children, height = 240 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card">
      <div className="px-5 py-3 border-b border-admin-border">
        <h3 className="text-sm font-semibold text-admin-text">{title}</h3>
      </div>
      <div className="p-4" style={{ height }}>{children}</div>
    </div>
  );
}

function QuickLink({ label, sub, href, icon: Icon, onClick }: {
  label: string; sub?: string; href?: string; icon: React.ElementType; onClick?: () => void;
}) {
  const inner = (
    <div className="flex items-center gap-3 rounded-xl border border-admin-border bg-admin-card px-4 py-3 hover:border-admin-border hover:shadow-sm transition-all cursor-pointer group">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.02] text-admin-muted group-hover:bg-admin-primary/5 group-hover:text-admin-primary transition-colors shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-admin-text">{label}</p>
        {sub && <p className="text-[10px] text-admin-muted truncate">{sub}</p>}
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-admin-muted group-hover:text-admin-primary transition-colors shrink-0" />
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return <button type="button" onClick={onClick} className="text-left w-full">{inner}</button>;
}

function AssetList({ title, items }: { title: string; items: Array<{ asset: string; amount_usd: number }> }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card">
      <div className="px-5 py-3 border-b border-admin-border">
        <h3 className="text-sm font-semibold text-admin-text">{title}</h3>
      </div>
      <div className="px-5 py-3">
        {items.length === 0 ? (
          <p className="py-3 text-center text-xs text-admin-muted">No data</p>
        ) : (
          <div className="space-y-2">
            {items.map((a) => (
              <div key={a.asset} className="flex items-center justify-between">
                <span className="text-xs font-medium text-admin-text">{a.asset}</span>
                <span className="text-xs tabular-nums text-admin-muted">{fmtUsd(a.amount_usd, true)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LiquidityBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-white/5 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-admin-muted w-6 text-right">{score}</span>
    </div>
  );
}

function VolatilityBadge({ value }: { value: number }) {
  const v = typeof value === 'number' ? value : 0;
  const isHigh = v > 5;
  const isMed = v > 2;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs tabular-nums font-medium',
      isHigh ? 'text-red-400' : isMed ? 'text-amber-400' : 'text-admin-muted')}>
      {isHigh && <ArrowUpRight className="h-3 w-3" />}
      {v}%
    </span>
  );
}
