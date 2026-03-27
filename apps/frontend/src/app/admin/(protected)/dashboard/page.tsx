'use client';

import {
  TrendingUp,
  Users,
  DollarSign,
  BarChart2,
  ArrowUpFromLine,
  Waves,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDashboardStats,
  useAnalyticsAll,
  useRevenue,
  useTradingVolume,
  useLiquidity,
  useWithdrawalsList,
  useControlOverview,
} from '@/hooks/admin/useAdminDashboard';
import { KPICard } from '@/components/admin/v2/dashboard/KPICard';
import { ExchangeControls } from '@/components/admin/v2/dashboard/ExchangeControls';
import { SystemHealthPanel } from '@/components/admin/v2/dashboard/SystemHealthPanel';
import { RiskSecurityPanel } from '@/components/admin/v2/dashboard/RiskSecurityPanel';
import { ActivityStream } from '@/components/admin/v2/dashboard/ActivityStream';
import { Button } from '@/components/ui/button';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const CHART_COLORS = ['var(--admin-primary)', 'var(--admin-success)', 'var(--chart-secondary)', 'var(--admin-warning)'];

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const { data: statsData, isLoading: statsLoading } = useDashboardStats();
  const { data: analytics24Data } = useAnalyticsAll('24h');
  const { data: analytics7Data } = useAnalyticsAll('7d');
  const { data: revenue7Data } = useRevenue('7d');
  const { data: volume7Data } = useTradingVolume('7d');
  const { data: liquidityData } = useLiquidity('24h');
  const { data: withdrawData } = useWithdrawalsList({ limit: 1 });
  const { data: controlData } = useControlOverview();

  const stats = statsData?.data as {
    users?: { total?: number; newToday?: number; active?: number };
    p2p?: { openDisputes?: number };
  } | undefined;
  const analytics24 = analytics24Data?.data;
  const analytics7 = analytics7Data?.data;
  const revenueBuckets = (revenue7Data?.data?.buckets ?? []) as Array<{ bucket?: string; revenue?: number }>;
  const volumeBuckets = (volume7Data?.data?.buckets ?? []) as Array<{ date?: string; volume?: number }>;
  const byMarket = (liquidityData?.data?.by_market ?? []) as Array<{ market: string; volume: number }>;
  const pendingWithdrawals =
    withdrawData?.data?.stats && typeof (withdrawData.data.stats as { pending_approval?: number }).pending_approval === 'number'
      ? (withdrawData.data.stats as { pending_approval: number }).pending_approval
      : 0;
  const markets = controlData?.data?.markets as { total?: number; active?: number } | undefined;

  const volume24h = Number(analytics24?.tradingVolume ?? 0);
  const totalUsers = stats?.users?.total ?? 0;
  const revenue24h = revenueBuckets.reduce((a, b) => a + Number(b.revenue ?? 0), 0);
  const activeMarkets = markets?.active ?? markets?.total ?? 0;
  const volumeSparkline = volumeBuckets.map((b) => ({ value: Number(b.volume ?? 0) }));
  const revenueSparkline = revenueBuckets.map((b) => ({ value: Number(b.revenue ?? 0) }));

  const marketDistribution = byMarket.slice(0, 6).map((m, i) => ({
    name: m.market,
    value: m.volume,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const volumeChartData = volumeBuckets.map((b) => ({
    name: (b.date ?? '').slice(5, 10) || '—',
    volume: Number(b.volume ?? 0),
  }));

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  if (statsLoading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-[var(--admin-primary)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--admin-text)]">Dashboard</h1>
          <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">Exchange analytics and control center</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="rounded-[var(--admin-radius)]">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Row 1 – KPI cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          title="Total Trading Volume"
          value={volume24h > 0 ? volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          changeLabel="24h"
          sparklineData={volumeSparkline}
          sparklineKey="value"
          icon={<TrendingUp className="w-5 h-5" />}
          accent="primary"
        />
        <KPICard
          title="Total Users"
          value={totalUsers.toLocaleString()}
          changeLabel="Registered"
          icon={<Users className="w-5 h-5" />}
          href="/admin/users"
          accent="primary"
        />
        <KPICard
          title="Exchange Revenue"
          value={revenue24h > 0 ? `$${revenue24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
          changeLabel="24h"
          sparklineData={revenueSparkline}
          sparklineKey="value"
          icon={<DollarSign className="w-5 h-5" />}
          accent="success"
        />
        <KPICard
          title="Active Markets"
          value={String(activeMarkets)}
          changeLabel="Spot pairs"
          icon={<BarChart2 className="w-5 h-5" />}
          accent="neutral"
        />
        <KPICard
          title="Pending Withdrawals"
          value={String(pendingWithdrawals)}
          changeLabel="Awaiting approval"
          icon={<ArrowUpFromLine className="w-5 h-5" />}
          href="/admin/withdrawals?status=pending_approval"
          accent={pendingWithdrawals > 0 ? 'warning' : 'neutral'}
        />
        <KPICard
          title="Liquidity Depth"
          value={liquidityData?.data?.total_volume != null ? Number(liquidityData.data.total_volume).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          changeLabel="24h volume"
          icon={<Waves className="w-5 h-5" />}
          accent="neutral"
        />
      </section>

      {/* Row 2 – Analytics charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
          <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Trading Volume</h3>
          <div className="h-[240px]">
            {volumeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeChartData}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--admin-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--admin-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--admin-text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--admin-text-muted)' }} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--admin-card-bg)', border: '1px solid var(--admin-card-border)' }} />
                  <Area type="monotone" dataKey="volume" stroke="var(--admin-primary)" fill="url(#volGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--admin-text-muted)]">No volume data</div>
            )}
          </div>
        </div>
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
          <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Market Distribution</h3>
          <div className="h-[240px]">
            {marketDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={marketDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {marketDistribution.map((_, i) => (
                      <Cell key={i} fill={marketDistribution[i].fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'var(--admin-card-bg)', border: '1px solid var(--admin-card-border)' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--admin-text-muted)]">No market data</div>
            )}
          </div>
        </div>
      </section>

      {/* Row 3 – System Health + Controls */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SystemHealthPanel />
        </div>
        <div>
          <ExchangeControls />
        </div>
      </section>

      {/* Row 4 – Risk & Security */}
      <section>
        <RiskSecurityPanel />
      </section>

      {/* Row 5 – Activity */}
      <section>
        <ActivityStream />
      </section>
    </div>
  );
}
