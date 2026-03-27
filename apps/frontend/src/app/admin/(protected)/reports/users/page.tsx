'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getDashboardStats } from '@/lib/admin/users';
import { getUserGrowth } from '@/lib/admin/analytics';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { KPICard } from '@/components/admin/v2/dashboard';
import { Loader2, ArrowLeft, Users } from 'lucide-react';

export default function UserReportsPage() {
  const { accessToken } = useAdminAuthStore();
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [stats, setStats] = useState<{
    users?: { total?: number; newToday?: number; active?: number; verified?: number };
  } | null>(null);
  const [growthBuckets, setGrowthBuckets] = useState<Array<{ bucket?: string; count?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getDashboardStats(accessToken),
      getUserGrowth(accessToken, period),
    ])
      .then(([statsRes, growthRes]) => {
        if (cancelled) return;
        if (statsRes.success && statsRes.data) {
          setStats(statsRes.data as typeof stats);
        }
        const data = growthRes.data as { buckets?: Array<{ bucket?: string; count?: number }> } | undefined;
        setGrowthBuckets(data?.buckets ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [accessToken, period]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/reports"
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to reports
        </Link>
      </div>
      <SectionHeader
        title="User Reports"
        subtitle="Growth, retention, and activity from platform analytics"
      />
      <div className="flex flex-wrap gap-2">
        {(['7d', '30d'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === p
                ? 'bg-[#2563EB] text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {p === '7d' ? '7 days' : '30 days'}
          </button>
        ))}
      </div>
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center min-h-[240px]">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      ) : (
        <>
          <Panel title="User summary" subtitle="Current platform totals" accent="primary">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Total users"
                value={stats?.users?.total ?? '—'}
                icon={<Users className="w-5 h-5" />}
                accent="primary"
              />
              <KPICard title="New today" value={stats?.users?.newToday ?? '—'} accent="neutral" />
              <KPICard title="Active (sessions)" value={stats?.users?.active ?? '—'} accent="neutral" />
              <KPICard title="Verified (KYC)" value={stats?.users?.verified ?? '—'} accent="success" />
            </div>
          </Panel>
          <Panel title="New registrations by day" subtitle={`Period: ${period}`} accent="primary">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">New users</th>
                  </tr>
                </thead>
                <tbody>
                  {growthBuckets.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-gray-500 dark:text-gray-400">No data for this period</td>
                    </tr>
                  ) : (
                    growthBuckets.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 px-3 text-gray-900 dark:text-white">
                          {row.bucket ? new Date(row.bucket).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-gray-900 dark:text-white">
                          {row.count ?? 0}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
