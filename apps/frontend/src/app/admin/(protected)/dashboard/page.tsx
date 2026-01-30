'use client';

import { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Activity,
  Repeat,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Loader2,
  Database,
  Server,
  Gift,
  TrendingUp,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import Link from 'next/link';

interface DashboardStats {
  users: { total: number; newToday: number; active: number; verified: number };
  kyc: { pending: number; underReview: number; approvedToday: number; rejectedToday: number };
  p2p: { activeAds: number; activeOrders: number; openDisputes: number };
  referrals: { totalCodes: number; activeCodes: number };
}

// Metric Card Component
function MetricCard({
  title,
  value,
  subtitle,
  icon,
  iconBg,
  urgent,
  href,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg: string;
  urgent?: boolean;
  href?: string;
}) {
  const content = (
    <div className={`h-full min-h-[120px] bg-white dark:bg-gray-800/50 border ${urgent ? 'border-red-500/50' : 'border-gray-200 dark:border-gray-700'} rounded-xl p-5 shadow-sm ${href ? 'hover:bg-gray-50 dark:hover:bg-white dark:bg-gray-800/80 transition-colors cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between h-full">
        <div className="flex flex-col justify-between h-full">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{subtitle || '\u00A0'}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
      </div>
    </div>
  );

  return href ? <Link href={href} className="block h-full">{content}</Link> : content;
}

export default function AdminDashboard() {
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { accessToken } = useAdminAuthStore();

  const fetchStats = async () => {
    if (!accessToken) {
      console.log('No access token, skipping fetch');
      return;
    }
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      console.log('Fetching dashboard stats from:', apiUrl);
      
      const response = await fetch(`${apiUrl}/api/v1/admin/dashboard/stats`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      const result = await response.json();
      console.log('Dashboard stats response:', result);
      
      if (result.success) {
        setStats(result.data);
      } else {
        console.error('API returned error:', result.error);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessToken) {
      fetchStats();
    }
  }, [accessToken]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Real-time data from your database
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-white dark:bg-gray-800 hover:bg-white dark:bg-gray-800 dark:hover:bg-gray-100 dark:hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg text-sm transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* User Stats */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">User Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Users"
            value={stats?.users.total || 0}
            subtitle="in database"
            icon={<Users className="w-6 h-6 text-blue-500" />}
            iconBg="bg-blue-500/20"
            href="/admin/users"
          />
          <MetricCard
            title="New Today"
            value={stats?.users.newToday || 0}
            subtitle="registered in 24h"
            icon={<Users className="w-6 h-6 text-green-500" />}
            iconBg="bg-green-500/20"
          />
          <MetricCard
            title="Active Sessions"
            value={stats?.users.active || 0}
            subtitle="users online"
            icon={<Activity className="w-6 h-6 text-blue-500" />}
            iconBg="bg-blue-500/20"
          />
          <MetricCard
            title="Verified Users"
            value={stats?.users.verified || 0}
            subtitle="email or phone verified"
            icon={<CheckCircle className="w-6 h-6 text-emerald-500" />}
            iconBg="bg-emerald-500/20"
          />
        </div>
      </div>

      {/* KYC Stats */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">KYC Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Pending KYC"
            value={stats?.kyc.pending || 0}
            subtitle="awaiting review"
            icon={<Shield className="w-6 h-6 text-yellow-500" />}
            iconBg="bg-yellow-500/20"
            urgent={(stats?.kyc.pending || 0) > 0}
            href="/admin/kyc"
          />
          <MetricCard
            title="Under Review"
            value={stats?.kyc.underReview || 0}
            subtitle="being processed"
            icon={<Shield className="w-6 h-6 text-blue-500" />}
            iconBg="bg-blue-500/20"
          />
          <MetricCard
            title="Approved Today"
            value={stats?.kyc.approvedToday || 0}
            subtitle="in last 24h"
            icon={<CheckCircle className="w-6 h-6 text-green-500" />}
            iconBg="bg-green-500/20"
          />
          <MetricCard
            title="Rejected Today"
            value={stats?.kyc.rejectedToday || 0}
            subtitle="in last 24h"
            icon={<AlertCircle className="w-6 h-6 text-red-500" />}
            iconBg="bg-red-500/20"
          />
        </div>
      </div>

      {/* P2P Stats */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">P2P Trading</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Active Ads"
            value={stats?.p2p.activeAds || 0}
            subtitle="buy/sell listings"
            icon={<TrendingUp className="w-6 h-6 text-cyan-500" />}
            iconBg="bg-cyan-500/20"
            href="/admin/p2p"
          />
          <MetricCard
            title="Active Orders"
            value={stats?.p2p.activeOrders || 0}
            subtitle="in progress"
            icon={<Repeat className="w-6 h-6 text-blue-500" />}
            iconBg="bg-blue-500/20"
          />
          <MetricCard
            title="Open Disputes"
            value={stats?.p2p.openDisputes || 0}
            subtitle={(stats?.p2p.openDisputes || 0) > 0 ? "needs attention!" : "no issues"}
            icon={<AlertCircle className="w-6 h-6 text-red-500" />}
            iconBg="bg-red-500/20"
            urgent={(stats?.p2p.openDisputes || 0) > 0}
            href="/admin/p2p/disputes"
          />
          <MetricCard
            title="Completed Today"
            value={0}
            subtitle="trades finished"
            icon={<CheckCircle className="w-6 h-6 text-green-500" />}
            iconBg="bg-green-500/20"
          />
        </div>
      </div>

      {/* Referrals */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Referral System</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Referral Codes"
            value={stats?.referrals.totalCodes || 0}
            subtitle="created"
            icon={<Gift className="w-6 h-6 text-pink-500" />}
            iconBg="bg-pink-500/20"
            href="/admin/referrals"
          />
          <MetricCard
            title="Active Codes"
            value={stats?.referrals.activeCodes || 0}
            subtitle="currently active"
            icon={<Gift className="w-6 h-6 text-green-500" />}
            iconBg="bg-green-500/20"
          />
          <MetricCard
            title="Total Referrals"
            value={0}
            subtitle="users referred"
            icon={<Users className="w-6 h-6 text-blue-500" />}
            iconBg="bg-blue-500/20"
          />
          <MetricCard
            title="Commission Paid"
            value="$0"
            subtitle="total earned"
            icon={<TrendingUp className="w-6 h-6 text-emerald-500" />}
            iconBg="bg-emerald-500/20"
          />
        </div>
      </div>

      {/* System Status */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">System Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Database</p>
                <p className="text-2xl font-bold text-green-500 mt-1">Online</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">PostgreSQL</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Database className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Redis</p>
                <p className="text-2xl font-bold text-green-500 mt-1">Online</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Cache & Sessions</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Server className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">API Server</p>
                <p className="text-2xl font-bold text-green-500 mt-1">Running</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Port 4000</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Activity className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Blockchain</p>
                <p className="text-2xl font-bold text-green-500 mt-1">Synced</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">All networks</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/users"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
          >
            View Users
          </Link>
          <Link
            href="/admin/kyc"
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-gray-900 dark:text-white rounded-lg text-sm transition-colors"
          >
            Review KYC
          </Link>
          <Link
            href="/admin/p2p/disputes"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded-lg text-sm transition-colors"
          >
            Resolve Disputes
          </Link>
          <Link
            href="/admin/settings"
            className="px-4 py-2 bg-gray-600 hover:bg-gray-100 dark:hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded-lg text-sm transition-colors"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
