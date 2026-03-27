'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getDashboardStats } from '@/lib/admin/users';
import { getAnalyticsAll, getRevenueBreakdown } from '@/lib/admin/analytics';
import { SectionHeader } from '@/components/admin/control-plane';
import { KPICard } from '@/components/admin/v2/dashboard';
import { Loader2, TrendingUp, Users, DollarSign } from 'lucide-react';

export default function ReportsPage() {
  const { accessToken } = useAdminAuthStore();
  const [stats, setStats] = useState<{ users?: { total?: number } } | null>(null);
  const [analytics, setAnalytics] = useState<{ tradingVolume?: number; newUsers?: number } | null>(null);
  const [revenue, setRevenue] = useState<{ total?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    Promise.all([
      getDashboardStats(accessToken),
      getAnalyticsAll(accessToken, '24h'),
      getRevenueBreakdown(accessToken, '7d'),
    ])
      .then(([statsRes, analyticsRes, revenueRes]) => {
        if (statsRes.success && statsRes.data) setStats(statsRes.data as { users?: { total?: number } });
        if (analyticsRes.success && analyticsRes.data) setAnalytics(analyticsRes.data as { tradingVolume?: number; newUsers?: number });
        if (revenueRes.success && revenueRes.data) setRevenue(revenueRes.data as { total?: number });
      })
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 className="w-8 h-8 text-[var(--admin-primary)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Reports & Analytics"
        subtitle="Generate and view platform reports"
      />
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="24h volume"
          value={analytics?.tradingVolume != null ? analytics.tradingVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          changeLabel="Spot trading"
          icon={<TrendingUp className="w-5 h-5" />}
          accent="primary"
        />
        <KPICard
          title="Total users"
          value={stats?.users?.total ?? '—'}
          icon={<Users className="w-5 h-5" />}
          accent="primary"
        />
        <KPICard
          title="Net revenue (7d)"
          value={revenue?.total != null ? revenue.total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
          icon={<DollarSign className="w-5 h-5" />}
          accent="success"
        />
      </section>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Link
          href="/admin/reports/financial"
          className="admin-card flex items-center gap-4 p-6 rounded-xl border-2 border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] hover:border-[var(--admin-success)]/50 hover:bg-[var(--admin-success)]/5 transition-all shadow-sm hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[var(--admin-success)]/15 flex items-center justify-center shrink-0">
            <DollarSign className="w-6 h-6 text-[var(--admin-success)]" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--admin-text)]">Financial Reports</h3>
            <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">Revenue, P&L, fee breakdown</p>
          </div>
        </Link>
        <Link
          href="/admin/reports/users"
          className="admin-card flex items-center gap-4 p-6 rounded-xl border-2 border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] hover:border-[var(--admin-primary)]/50 hover:bg-[var(--admin-primary)]/5 transition-all shadow-sm hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[var(--admin-primary)]/15 flex items-center justify-center shrink-0">
            <Users className="w-6 h-6 text-[var(--admin-primary)]" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--admin-text)]">User Reports</h3>
            <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">Growth, retention, activity</p>
          </div>
        </Link>
        <Link
          href="/admin/reports/trading"
          className="admin-card flex items-center gap-4 p-6 rounded-xl border-2 border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] hover:border-[var(--admin-primary)]/50 hover:bg-[var(--admin-primary)]/5 transition-all shadow-sm hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[var(--admin-primary)]/15 flex items-center justify-center shrink-0">
            <TrendingUp className="w-6 h-6 text-[var(--admin-primary)]" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--admin-text)]">Trading Reports</h3>
            <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">Volume, pairs, liquidity</p>
          </div>
        </Link>
      </section>
    </div>
  );
}
