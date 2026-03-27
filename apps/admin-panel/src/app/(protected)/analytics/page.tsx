'use client';

import { useState, useMemo } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/dashboard/StatCard';
import {
  DollarSign,
  TrendingUp,
  Wallet,
  Receipt,
  Users,
  Download,
  Loader2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import { cn } from '@/lib/cn';

const CHART_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#64748B', '#EC4899'];

function relativeTime(iso: string) {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec} seconds ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'trading', label: 'Trading' },
  { id: 'users', label: 'User growth' },
  { id: 'deposits', label: 'Deposits & withdrawals' },
  { id: 'markets', label: 'Market performance' },
  { id: 'whale', label: 'Whale activity' },
  { id: 'volatility', label: 'Volatility' },
  { id: 'activity', label: 'Activity heatmap' },
  { id: 'export', label: 'Export reports' },
] as const;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AnalyticsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('overview');
  const [exporting, setExporting] = useState<string | null>(null);

  const { data: revenueData } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue', token],
    queryFn: () => getRevenueAnalytics(token),
    enabled: !!token,
  });
  const { data: volumeData } = useQuery({
    queryKey: ['admin', 'analytics', 'volume', token],
    queryFn: () => getVolumeAnalytics(token),
    enabled: !!token,
  });
  const { data: liquidityData } = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity', token],
    queryFn: () => getLiquidityAnalytics(token),
    enabled: !!token,
  });
  const { data: userGrowthData } = useQuery({
    queryKey: ['admin', 'analytics', 'user-growth', token],
    queryFn: () => getUserGrowthAnalytics(token),
    enabled: !!token,
  });
  const { data: depositsData } = useQuery({
    queryKey: ['admin', 'analytics', 'deposits-withdrawals', token],
    queryFn: () => getDepositsWithdrawalsAnalytics(token),
    enabled: !!token,
  });
  const { data: marketsData } = useQuery({
    queryKey: ['admin', 'analytics', 'markets', token],
    queryFn: () => getMarketsPerformance(token),
    enabled: !!token,
  });
  const { data: whaleData } = useQuery({
    queryKey: ['admin', 'analytics', 'whale', token],
    queryFn: () => getWhaleTrades(token, 30),
    enabled: !!token,
  });
  const { data: revenueHistoryData } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue-history', token],
    queryFn: () => getRevenueHistory(token),
    enabled: !!token,
  });
  const [liquidityMarket, setLiquidityMarket] = useState('BTC/USDT');
  const { data: liquidityHistoryData } = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity-history', token, liquidityMarket],
    queryFn: () => getLiquidityHistory(token, liquidityMarket),
    enabled: !!token,
  });
  const { data: heatmapData } = useQuery({
    queryKey: ['admin', 'analytics', 'activity-heatmap', token],
    queryFn: () => getActivityHeatmap(token),
    enabled: !!token && activeTab === 'activity',
  });
  const { data: whaleAlertsData } = useQuery({
    queryKey: ['admin', 'analytics', 'whale-alerts', token],
    queryFn: () => getWhaleAlerts(token),
    enabled: !!token,
  });
  const { data: volatilityData } = useQuery({
    queryKey: ['admin', 'analytics', 'volatility', token],
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

  const marketDominance = useMemo(() => {
    const byMarket = volume?.volume_by_market ?? [];
    const total = byMarket.reduce((s, m) => s + m.volume_usd, 0);
    if (total === 0) return [];
    return byMarket.map((m) => ({ name: m.market, value: Math.round((m.volume_usd / total) * 100), volume_usd: m.volume_usd }));
  }, [volume?.volume_by_market]);

  const handleExport = async (report: AnalyticsReportType, format: AnalyticsExportFormat) => {
    const key = `${report}-${format}`;
    setExporting(key);
    try {
      await downloadAnalyticsExport(token, report, format);
    } catch {
      // error handled by download
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Exchange Analytics Command Center</h1>
        <p className="mt-1 text-sm text-admin-muted">
          Track revenue, trading volume, liquidity, user growth, and export business reports.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-admin-border pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium',
              activeTab === tab.id ? 'bg-admin-primary/10 text-admin-primary' : 'text-admin-muted hover:bg-gray-100'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Revenue cards - show on overview and when revenue relevant */}
      {(activeTab === 'overview' || activeTab === 'export') && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Revenue (24h)"
            value={revenue != null ? `$${revenue.total_revenue_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            icon={DollarSign}
          />
          <StatCard
            title="Trading Fee Revenue"
            value={revenue != null ? `$${revenue.trading_fee_revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            icon={TrendingUp}
          />
          <StatCard
            title="Withdrawal Fee Revenue"
            value={revenue != null ? `$${revenue.withdrawal_fee_revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            icon={Wallet}
          />
          <StatCard
            title="Other Fees"
            value={revenue != null ? `$${revenue.other_fees.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            icon={Receipt}
          />
        </div>
      )}

      {activeTab === 'overview' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Revenue over time (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={(revenueHistory ?? []).map((d) => ({ ...d, dateLabel: d.date.slice(5) }))} margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} labelFormatter={(l) => `Date: ${l}`} />
                    <Legend />
                    <Line type="monotone" dataKey="trading_fee" name="Trading fee" stroke="#6366F1" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="withdrawal_fee" name="Withdrawal fee" stroke="#10B981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name="Total revenue" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Volume by market (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(volume?.volume_by_market ?? []).slice(0, 8)} margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="market" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Volume']} />
                    <Bar dataKey="volume_usd" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Liquidity (spread by market)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(liquidity.slice(0, 6)).map((item) => (
                    <div key={item.market} className="flex items-center justify-between rounded-lg border border-admin-border px-3 py-2">
                      <span className="font-medium">{item.market}</span>
                      <span className="text-admin-muted">Spread {item.spread_percent}% · Depth {item.orderbook_depth.toLocaleString()} · Score {item.liquidity_score}</span>
                    </div>
                  ))}
                  {liquidity.length === 0 && <p className="py-4 text-center text-admin-muted">No liquidity data</p>}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>User growth</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <StatCard title="New users today" value={userGrowth?.new_users_today ?? '—'} icon={Users} className="flex-1 min-w-[140px]" />
                  <StatCard title="Active users" value={userGrowth?.active_users ?? '—'} icon={Users} className="flex-1 min-w-[140px]" />
                  <StatCard title="Retention rate" value={userGrowth != null ? `${userGrowth.retention_rate_percent}%` : '—'} icon={TrendingUp} className="flex-1 min-w-[140px]" />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {activeTab === 'trading' && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Volume by market</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={volume?.volume_by_market ?? []} margin={{ left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis dataKey="market" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                      <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Volume']} />
                      <Bar dataKey="volume_usd" fill="#6366F1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Volume by asset</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={volume?.volume_by_asset ?? []}
                        dataKey="volume_usd"
                        nameKey="asset"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ asset, volume_usd }: { asset: string; volume_usd: number }) => `${asset} $${(volume_usd / 1e6).toFixed(1)}M`}
                      >
                        {(volume?.volume_by_asset ?? []).map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Volume']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Market dominance (volume share)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={marketDominance}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, value }) => `${name} ${value}%`}
                      >
                        {marketDominance.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`${v}%`, 'Share']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Liquidity score over time (14 days)</CardTitle>
              <div className="mt-2">
                <select
                  value={liquidityMarket}
                  onChange={(e) => setLiquidityMarket(e.target.value)}
                  className="rounded-lg border border-admin-border px-3 py-1.5 text-sm"
                >
                  {(liquidity.length ? liquidity : [{ market: 'BTC/USDT' }]).map((m) => (
                    <option key={m.market} value={m.market}>{m.market}</option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={(liquidityHistory ?? []).map((d) => ({ ...d, dateLabel: d.date.slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="liquidity_score" name="Liquidity score" stroke="#6366F1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Volume over time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={(volume?.volume_over_time ?? []).map((d) => ({ ...d, dateLabel: d.date.slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Volume']} />
                    <Line type="monotone" dataKey="volume_usd" stroke="#10B981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Liquidity analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-admin-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 font-medium text-admin-muted">Market</th>
                      <th className="px-4 py-3 font-medium text-admin-muted">Spread</th>
                      <th className="px-4 py-3 font-medium text-admin-muted">Orderbook depth</th>
                      <th className="px-4 py-3 font-medium text-admin-muted">Liquidity score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liquidity.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">No data</td>
                      </tr>
                    ) : (
                      liquidity.map((row) => (
                        <tr key={row.market} className="border-t border-admin-border">
                          <td className="px-4 py-3 font-medium">{row.market}</td>
                          <td className="px-4 py-3">{row.spread_percent}%</td>
                          <td className="px-4 py-3">{row.orderbook_depth.toLocaleString()}</td>
                          <td className="px-4 py-3">{row.liquidity_score}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === 'users' && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="New users today" value={userGrowth?.new_users_today ?? '—'} icon={Users} />
            <StatCard title="Active users" value={userGrowth?.active_users ?? '—'} icon={Users} />
            <StatCard title="Retention rate" value={userGrowth != null ? `${userGrowth.retention_rate_percent}%` : '—'} icon={TrendingUp} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>New users per day</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(userGrowth?.new_users_per_day ?? []).map((d) => ({ ...d, dateLabel: d.date.slice(5) }))} margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === 'deposits' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Deposits vs withdrawals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={deposits?.deposits_vs_withdrawals ?? []}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, value }) => `${name} ${value}%`}
                    >
                      {(deposits?.deposits_vs_withdrawals ?? []).map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top deposit assets</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {(deposits?.top_deposit_assets ?? []).map((a) => (
                    <li key={a.asset} className="flex justify-between rounded-lg border border-admin-border px-3 py-2">
                      <span className="font-medium">{a.asset}</span>
                      <span>${a.amount_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </li>
                  ))}
                  {(deposits?.top_deposit_assets ?? []).length === 0 && <p className="py-4 text-center text-admin-muted">No data</p>}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top withdrawal assets</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {(deposits?.top_withdrawal_assets ?? []).map((a) => (
                    <li key={a.asset} className="flex justify-between rounded-lg border border-admin-border px-3 py-2">
                      <span className="font-medium">{a.asset}</span>
                      <span>${a.amount_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </li>
                  ))}
                  {(deposits?.top_withdrawal_assets ?? []).length === 0 && <p className="py-4 text-center text-admin-muted">No data</p>}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {activeTab === 'markets' && (
        <Card>
          <CardHeader>
            <CardTitle>Market performance dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Market</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Volume (24h)</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Trades</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Spread</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Liquidity score</th>
                  </tr>
                </thead>
                <tbody>
                  {markets.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">No market data</td>
                    </tr>
                  ) : (
                    markets.map((row) => (
                      <tr key={row.market} className="border-t border-admin-border hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium">{row.market}</td>
                        <td className="px-4 py-3">${row.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3">{row.trades.toLocaleString()}</td>
                        <td className="px-4 py-3">{row.spread_percent}%</td>
                        <td className="px-4 py-3">{row.liquidity_score}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'whale' && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              title="Whale trades (24h)"
              value={whaleAlerts?.whale_trades_24h ?? 0}
              icon={AlertCircle}
            />
            <StatCard
              title="Largest trade today"
              value={whaleAlerts?.largest_trade?.size_usd != null && whaleAlerts.largest_trade.size_usd > 0
                ? `$${(whaleAlerts.largest_trade.size_usd / 1e6).toFixed(2)}M ${whaleAlerts.largest_trade.market}`
                : '—'}
              icon={TrendingUp}
            />
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm font-medium text-admin-muted">Top whale users (7d)</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{(whaleAlerts?.top_whale_users ?? []).length}</p>
              </CardContent>
            </Card>
          </div>
          {(whaleAlerts?.top_whale_users ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top whale users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-xl border border-admin-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 font-medium text-admin-muted">User</th>
                        <th className="px-4 py-3 font-medium text-admin-muted">Trade count</th>
                        <th className="px-4 py-3 font-medium text-admin-muted">Total volume (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(whaleAlerts?.top_whale_users ?? []).map((u, i) => (
                        <tr key={i} className="border-t border-admin-border">
                          <td className="px-4 py-3 font-medium">{u.user}</td>
                          <td className="px-4 py-3">{u.trade_count}</td>
                          <td className="px-4 py-3">${u.total_volume_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Whale trades</CardTitle>
              <p className="text-sm text-admin-muted">Trades over $100,000 in the last 7 days</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">User</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Market</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Trade size</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {whaleTrades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">No whale trades in the last 7 days</td>
                    </tr>
                  ) : (
                    whaleTrades.map((row, i) => (
                      <tr key={i} className="border-t border-admin-border hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium">{row.user}</td>
                        <td className="px-4 py-3">{row.market}</td>
                        <td className="px-4 py-3">${row.trade_size_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className="px-4 py-3 text-admin-muted text-xs">{relativeTime(row.time)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </>
      )}

      {activeTab === 'volatility' && (
        <Card>
          <CardHeader>
            <CardTitle>Market volatility monitoring</CardTitle>
            <p className="text-sm text-admin-muted">Price, spread, and volume volatility (24h)</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[500px] text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Market</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Price volatility (24h)</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Spread volatility</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Volume volatility</th>
                  </tr>
                </thead>
                <tbody>
                  {volatility.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">No volatility data</td>
                    </tr>
                  ) : (
                    volatility.map((row) => (
                      <tr key={row.market} className="border-t border-admin-border hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium">{row.market}</td>
                        <td className="px-4 py-3">{row.price_volatility_24h}%</td>
                        <td className="px-4 py-3">{row.spread_volatility}%</td>
                        <td className="px-4 py-3">{row.volume_volatility}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'activity' && (
        <Card>
          <CardHeader>
            <CardTitle>User activity heatmap</CardTitle>
            <p className="text-sm text-admin-muted">Peak trading hours and activity (last 7 days)</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <div className="inline-block min-w-[600px]">
                <div className="mb-2 flex gap-1 text-xs text-admin-muted">
                  <span className="w-10 shrink-0">Hour</span>
                  {DAY_LABELS.map((d) => (
                    <span key={d} className="flex-1 text-center">{d}</span>
                  ))}
                </div>
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="mb-0.5 flex items-center gap-1">
                    <span className="w-10 shrink-0 text-xs text-admin-muted">{hour}:00</span>
                    <div className="flex flex-1 gap-0.5">
                      {DAY_LABELS.map((_, dayOfWeek) => {
                        const cell = heatmap.find((c) => c.hour === hour && c.day_of_week === dayOfWeek);
                        const trading = cell?.trading_count ?? 0;
                        const maxTrading = Math.max(...heatmap.map((c) => c.trading_count), 1);
                        const intensity = maxTrading > 0 ? Math.min(1, trading / maxTrading) : 0;
                        return (
                          <div
                            key={dayOfWeek}
                            className="h-6 flex-1 rounded border border-admin-border"
                            style={{ backgroundColor: `rgba(99, 102, 241, ${0.15 + intensity * 0.85})` }}
                            title={`Trading: ${trading}, Logins: ${cell?.logins_count ?? 0}, Deposits: ${cell?.deposits_count ?? 0}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="mt-2 text-xs text-admin-muted">Darker = more trading activity. Hover for counts.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'export' && (
        <Card>
          <CardHeader>
            <CardTitle>Export analytics reports</CardTitle>
            <p className="text-sm text-admin-muted">Download trading, revenue, or user growth data as CSV or JSON.</p>
            <Link href="/analytics/scheduled-reports" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-admin-primary hover:underline">
              <Calendar className="h-4 w-4" />
              Schedule report exports
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(['trading', 'revenue', 'user-growth'] as AnalyticsReportType[]).map((report) => (
                <div key={report} className="rounded-xl border border-admin-border p-4">
                  <h4 className="font-medium capitalize">{report.replace('-', ' ')} report</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['csv', 'json'] as AnalyticsExportFormat[]).map((format) => (
                      <Button
                        key={format}
                        variant="secondary"
                        size="sm"
                        onClick={() => handleExport(report, format)}
                        disabled={exporting !== null}
                      >
                        {exporting === `${report}-${format}` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                        {format.toUpperCase()}
                      </Button>
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleExport(report, 'pdf')}
                      disabled
                      title="PDF export not available"
                    >
                      PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-admin-muted">PDF export is not implemented; use CSV or JSON.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
