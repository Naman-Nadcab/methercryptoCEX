'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Users,
  TrendingUp,
  DollarSign,
  BarChart3,
  ArrowUpFromLine,
  AlertTriangle,
  Repeat,
  Droplets,
  PauseCircle,
  Activity,
  Loader2,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import {
  getDashboardStats,
  getSystemHealth,
  getWithdrawals,
  getControlOverview,
  getTradingHalt,
} from '@/lib/api';
import { StatCard } from '@/components/dashboard/StatCard';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { TableCard } from '@/components/dashboard/TableCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
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
} from 'recharts';

const CHART_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#64748B'];

export default function DashboardPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard-stats', token],
    queryFn: () => getDashboardStats(token),
    enabled: !!token,
  });

  const { data: healthData } = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token,
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', token],
    queryFn: () => getWithdrawals(token, { limit: 5, status: 'pending_approval' }),
    enabled: !!token,
  });

  const { data: controlData } = useQuery({
    queryKey: ['admin', 'control', token],
    queryFn: () => getControlOverview(token),
    enabled: !!token,
  });

  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
  });

  const stats = statsData?.data as Record<string, unknown> | undefined;
  const users = stats?.users as { total?: number; newToday?: number; active?: number } | undefined;
  const p2p = stats?.p2p as { openDisputes?: number } | undefined;
  const withdrawals = (withdrawalsData?.data?.withdrawals ?? []) as Array<{
    id?: string;
    user_id?: string;
    amount?: string;
    status?: string;
    created_at?: string;
    token_id?: string;
  }>;
  const withdrawalStats = withdrawalsData?.data?.stats as { pending_approval?: number } | undefined;
  const markets = controlData?.data?.markets as { total?: number; active?: number } | undefined;
  const halted = haltData?.data?.halted ?? false;

  const totalUsers = users?.total ?? 0;
  const pendingWithdrawals = withdrawalStats?.pending_approval ?? 0;
  const openDisputes = p2p?.openDisputes ?? 0;
  const activeMarkets = markets?.active ?? markets?.total ?? 0;

  const volumeByAsset = [
    { name: 'BTC', value: 45 },
    { name: 'ETH', value: 30 },
    { name: 'SOL', value: 15 },
    { name: 'Other', value: 10 },
  ];

  const depositsVsWithdrawals = [
    { name: 'Deposits', value: 65, color: '#10B981' },
    { name: 'Withdrawals', value: 35, color: '#6366F1' },
  ];

  const liquidityData = [
    { market: 'BTC/USDT', spread: 0.01, depth: 1200, volume: 450 },
    { market: 'ETH/USDT', spread: 0.02, depth: 800, volume: 320 },
    { market: 'SOL/USDT', spread: 0.03, depth: 400, volume: 180 },
  ];

  const activityItems = [
    { id: '1', type: 'trade', message: 'Trade executed: BTC/USDT', time: '2 min ago' },
    { id: '2', type: 'deposit', message: 'Deposit confirmed for user', time: '5 min ago' },
    { id: '3', type: 'withdrawal', message: 'Withdrawal requested', time: '12 min ago' },
    { id: '4', type: 'aml', message: 'AML alert triggered', time: '18 min ago' },
  ];

  const amlAlerts = [
    { id: '1', user: 'user_1', type: 'Unusual volume', severity: 'medium', status: 'Open' },
    { id: '2', user: 'user_2', type: 'Velocity', severity: 'low', status: 'Reviewing' },
  ];

  const systemHealth = healthData?.data as {
    database?: { latency_ms?: number; latencyMs?: number };
    redis?: { latency_ms?: number; latencyMs?: number };
    websocket?: { connections?: number };
    queue?: { total_withdrawal_queue?: number; depth?: number };
  } | undefined;
  const dbLatency = systemHealth?.database?.latency_ms ?? systemHealth?.database?.latencyMs ?? 0;
  const redisLatency = systemHealth?.redis?.latency_ms ?? systemHealth?.redis?.latencyMs ?? 0;
  const wsConnections = systemHealth?.websocket?.connections ?? 0;
  const queueDepth = systemHealth?.queue?.total_withdrawal_queue ?? systemHealth?.queue?.depth ?? 0;

  if (statsLoading && !stats) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-admin-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-admin-muted">Dashboard / Admin Dashboard</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">Welcome back, {admin?.name ?? 'Admin'}</h1>
          <p className="mt-1 text-sm text-admin-muted">
            You have {pendingWithdrawals} Pending Withdrawals & {openDisputes} P2P Disputes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            onClick={() => {}}
            className="flex items-center gap-2"
          >
            <PauseCircle className="h-4 w-4" />
            Pause Trading
          </Button>
          <Link href="/withdrawals">
            <Button variant="secondary">View Withdrawals</Button>
          </Link>
          <Link href="/monitoring">
            <Button variant="secondary">Open Monitoring</Button>
          </Link>
        </div>
      </div>

      {/* KPI cards - 8 cards, 4 per row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={totalUsers}
          change={2.5}
          changeLabel="vs last month"
          icon={Users}
          iconBg="bg-blue-100 text-blue-600"
          href="/users"
        />
        <StatCard
          title="24h Trading Volume"
          value="$2.4M"
          change={5.2}
          changeLabel="vs last 24h"
          icon={TrendingUp}
          iconBg="bg-admin-primary/10 text-admin-primary"
          href="/trades"
        />
        <StatCard
          title="Exchange Revenue"
          value="$18.2K"
          change={-1.2}
          changeLabel="vs last 24h"
          icon={DollarSign}
          iconBg="bg-admin-success/10 text-admin-success"
          href="/analytics"
        />
        <StatCard
          title="Active Markets"
          value={activeMarkets}
          change={0}
          icon={BarChart3}
          iconBg="bg-admin-warning/10 text-admin-warning"
          href="/markets"
        />
        <StatCard
          title="Pending Withdrawals"
          value={pendingWithdrawals}
          icon={ArrowUpFromLine}
          iconBg="bg-admin-danger/10 text-admin-danger"
          href="/withdrawals"
        />
        <StatCard
          title="AML Alerts"
          value={amlAlerts.length}
          icon={AlertTriangle}
          iconBg="bg-admin-warning/10 text-admin-warning"
          href="/risk"
        />
        <StatCard
          title="Open P2P Disputes"
          value={openDisputes}
          icon={Repeat}
          iconBg="bg-admin-primary/10 text-admin-primary"
          href="/p2p"
        />
        <StatCard
          title="Liquidity Health"
          value={halted ? 'Paused' : 'Good'}
          icon={Droplets}
          iconBg="bg-admin-success/10 text-admin-success"
          href="/liquidity"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Trading Volume by Asset" subtitle="Last 24h">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={volumeByAsset}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {volumeByAsset.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Deposits vs Withdrawals" subtitle="Net flow">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={depositsVsWithdrawals}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              >
                {depositsVsWithdrawals.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Market Liquidity" subtitle="Spread, depth, volume">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={liquidityData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="market" width={70} />
              <Tooltip />
              <Bar dataKey="volume" fill="#6366F1" name="Volume" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Operational widgets + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TableCard title="Pending Withdrawals" href="/withdrawals" linkLabel="View all" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border text-left text-admin-muted">
                  <th className="pb-3 pr-4 font-medium">User</th>
                  <th className="pb-3 pr-4 font-medium">Asset</th>
                  <th className="pb-3 pr-4 font-medium">Amount</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.slice(0, 5).map((w) => (
                  <tr key={w.id} className="border-b border-admin-border last:border-0">
                    <td className="py-3 pr-4 text-gray-900">{w.email ?? w.username ?? String(w.user_id).slice(0, 8) + '…'}</td>
                    <td className="py-3 pr-4 text-admin-muted">{w.currency_symbol ?? '—'}</td>
                    <td className="py-3 pr-4 text-gray-900">{w.amount ?? '—'}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={w.status ?? 'pending'} variant="warning" />
                    </td>
                    <td className="py-3 text-admin-muted">
                      {w.created_at ? new Date(w.created_at).toLocaleTimeString() : '—'}
                    </td>
                  </tr>
                ))}
                {withdrawals.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-admin-muted">
                      No pending withdrawals
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TableCard>
        <ActivityFeed title="Recent Activity" items={activityItems} />
      </div>

      {/* AML Alerts + P2P + System Monitoring */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TableCard title="AML Alerts" href="/risk">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border text-left text-admin-muted">
                  <th className="pb-3 pr-4 font-medium">User</th>
                  <th className="pb-3 pr-4 font-medium">Type</th>
                  <th className="pb-3 pr-4 font-medium">Severity</th>
                  <th className="pb-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {amlAlerts.map((a) => (
                  <tr key={a.id} className="border-b border-admin-border last:border-0">
                    <td className="py-3 pr-4 text-gray-900">{a.user}</td>
                    <td className="py-3 pr-4 text-admin-muted">{a.type}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={a.severity} variant={a.severity === 'high' ? 'danger' : 'warning'} />
                    </td>
                    <td className="py-3">{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableCard>
        <div className="rounded-[12px] bg-white p-6 shadow-card">
          <h3 className="text-base font-semibold text-gray-900">P2P Activity</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-admin-muted">Open orders</span>
              <span className="font-medium">—</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">Escrow balance</span>
              <span className="font-medium">—</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">Active disputes</span>
              <span className="font-medium">{openDisputes}</span>
            </div>
          </div>
        </div>
        <div className="rounded-[12px] bg-white p-6 shadow-card">
          <h3 className="text-base font-semibold text-gray-900">System Monitoring</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-admin-muted">Database latency</span>
              <span className="font-medium">{dbLatency} ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">Redis latency</span>
              <span className="font-medium">{redisLatency} ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">WebSocket connections</span>
              <span className="font-medium">{wsConnections}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">Queue depth</span>
              <span className="font-medium">{queueDepth}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Traders */}
      <TableCard title="Top Traders" href="/trades">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-admin-border text-left text-admin-muted">
                <th className="pb-3 pr-4 font-medium">User</th>
                <th className="pb-3 pr-4 font-medium">Volume</th>
                <th className="pb-3 pr-4 font-medium">Trades</th>
                <th className="pb-3 font-medium">PnL</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-admin-border">
                <td className="py-3 pr-4 text-gray-900">—</td>
                <td className="py-3 pr-4 text-admin-muted">—</td>
                <td className="py-3 pr-4 text-admin-muted">—</td>
                <td className="py-3 text-admin-muted">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </TableCard>

      {/* Market Status + Treasury + Admin Tasks */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-[12px] bg-white p-6 shadow-card">
          <h3 className="text-base font-semibold text-gray-900">Market Status</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge status={halted ? 'Markets halted' : 'Markets running'} variant={halted ? 'danger' : 'success'} />
            <StatusBadge status={halted ? 'Bot paused' : 'Liquidity bot active'} variant={halted ? 'danger' : 'success'} />
          </div>
        </div>
        <div className="rounded-[12px] bg-white p-6 shadow-card">
          <h3 className="text-base font-semibold text-gray-900">Treasury Overview</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-admin-muted">Hot wallet balance</span>
              <span className="font-medium">—</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">Cold wallet balance</span>
              <span className="font-medium">—</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">User balances</span>
              <span className="font-medium">—</span>
            </div>
            <div className="flex justify-between">
              <span className="text-admin-muted">Total reserves</span>
              <span className="font-medium">—</span>
            </div>
          </div>
        </div>
        <div className="rounded-[12px] bg-white p-6 shadow-card">
          <h3 className="text-base font-semibold text-gray-900">Admin Tasks</h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <input type="checkbox" className="rounded border-admin-border" />
              <span>Review withdrawals</span>
            </li>
            <li className="flex items-center gap-2">
              <input type="checkbox" className="rounded border-admin-border" />
              <span>Resolve disputes</span>
            </li>
            <li className="flex items-center gap-2">
              <input type="checkbox" className="rounded border-admin-border" />
              <span>Review AML alerts</span>
            </li>
            <li className="flex items-center gap-2">
              <input type="checkbox" className="rounded border-admin-border" />
              <span>Check system health</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
