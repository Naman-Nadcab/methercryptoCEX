'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  Shield,
  Activity,
  Repeat,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Gift,
  TrendingUp,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  MetricWidget,
  ActionButton,
  Panel,
  StatusBadge,
} from '@/components/admin/control-plane';

interface DashboardStats {
  users: { total: number; newToday: number; active: number; verified: number };
  kyc: { pending: number; underReview: number; approvedToday: number; rejectedToday: number };
  p2p: { activeAds: number; activeOrders: number; openDisputes: number };
  referrals: { totalCodes: number; activeCodes: number };
}

export default function AdminDashboard() {
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tradingHalted, setTradingHalted] = useState<boolean | null>(null);
  const { accessToken } = useAdminAuthStore();

  const fetchStats = async () => {
    if (!accessToken) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const [statsRes, haltRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/admin/dashboard/stats`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${apiUrl}/api/v1/admin/trading-halt`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);
      const statsJson = await statsRes.json();
      const haltJson = await haltRes.json();
      if (statsJson?.success && statsJson?.data) setStats(statsJson.data);
      if (haltJson?.success && haltJson?.data != null)
        setTradingHalted(!!haltJson.data.halted);
    } catch {
      // leave state unchanged
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) fetchStats();
    else setLoading(false);
  }, [accessToken]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  if (loading && stats == null) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Dashboard"
        subtitle="Operator overview — real-time from backend"
        action={
          <ActionButton
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={handleRefresh}
            loading={refreshing}
            variant="primary"
          >
            Refresh
          </ActionButton>
        }
      />

      <Panel
        title="System status"
        subtitle="Trading halt state (GET /admin/trading-halt)"
        noPadding
        headerAction={
          tradingHalted === null ? (
            <span className="text-xs text-gray-500">—</span>
          ) : (
            <StatusBadge variant={tradingHalted ? 'HALTED' : 'LIVE'} />
          )
        }
      >
        <div className="px-4 py-3">
          {tradingHalted === null ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Unable to load</p>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Trading is {tradingHalted ? 'halted' : 'live'}.
            </p>
          )}
        </div>
      </Panel>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">
          User statistics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricWidget
            label="Total users"
            value={stats?.users.total ?? 0}
            sublabel="in database"
            icon={<Users className="w-5 h-5" />}
            href="/admin/users"
          />
          <MetricWidget
            label="New (24h)"
            value={stats?.users.newToday ?? 0}
            sublabel="registered"
            icon={<Users className="w-5 h-5" />}
          />
          <MetricWidget
            label="Active sessions"
            value={stats?.users.active ?? 0}
            sublabel="online now"
            icon={<Activity className="w-5 h-5" />}
          />
          <MetricWidget
            label="Verified"
            value={stats?.users.verified ?? 0}
            sublabel="email or phone"
            icon={<Shield className="w-5 h-5" />}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">
          KYC status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricWidget
            label="Pending KYC"
            value={stats?.kyc.pending ?? 0}
            sublabel="awaiting review"
            variant={stats && stats.kyc.pending > 0 ? 'warning' : 'neutral'}
            icon={<Shield className="w-5 h-5" />}
            href="/admin/kyc/pending"
          />
          <MetricWidget
            label="Under review"
            value={stats?.kyc.underReview ?? 0}
            sublabel="in progress"
            icon={<Shield className="w-5 h-5" />}
          />
          <MetricWidget
            label="Approved today"
            value={stats?.kyc.approvedToday ?? 0}
            sublabel="last 24h"
            variant="positive"
            icon={<Shield className="w-5 h-5" />}
          />
          <MetricWidget
            label="Rejected today"
            value={stats?.kyc.rejectedToday ?? 0}
            sublabel="last 24h"
            icon={<Shield className="w-5 h-5" />}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">
          P2P trading
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricWidget
            label="Active ads"
            value={stats?.p2p.activeAds ?? 0}
            sublabel="buy/sell listings"
            icon={<TrendingUp className="w-5 h-5" />}
            href="/admin/p2p/ads"
          />
          <MetricWidget
            label="Active orders"
            value={stats?.p2p.activeOrders ?? 0}
            sublabel="in progress"
            icon={<Repeat className="w-5 h-5" />}
          />
          <MetricWidget
            label="Open disputes"
            value={stats?.p2p.openDisputes ?? 0}
            sublabel={stats && stats.p2p.openDisputes > 0 ? 'needs attention' : 'none'}
            variant={stats && stats.p2p.openDisputes > 0 ? 'danger' : 'neutral'}
            icon={<AlertTriangle className="w-5 h-5" />}
            href="/admin/p2p/disputes"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">
          Referrals
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricWidget
            label="Total codes"
            value={stats?.referrals.totalCodes ?? 0}
            sublabel="created"
            icon={<Gift className="w-5 h-5" />}
            href="/admin/referrals/codes"
          />
          <MetricWidget
            label="Active codes"
            value={stats?.referrals.activeCodes ?? 0}
            sublabel="currently active"
            icon={<Gift className="w-5 h-5" />}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/users"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            Users
          </Link>
          <Link
            href="/admin/kyc/pending"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            Review KYC
          </Link>
          <Link
            href="/admin/p2p/disputes"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            Disputes
          </Link>
          <Link
            href="/admin/withdrawals?status=pending_approval"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            Withdrawals
          </Link>
          <Link
            href="/admin/wallets/funds-summary"
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
          >
            Funds summary
          </Link>
        </div>
      </section>
    </div>
  );
}
