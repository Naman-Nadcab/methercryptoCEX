'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getRevenueBreakdown, getRevenue } from '@/lib/admin/analytics';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { KPICard } from '@/components/admin/v2/dashboard';
import { Loader2, ArrowLeft, DollarSign, TrendingUp, Wallet, Repeat, Gift } from 'lucide-react';

export default function FinancialReportsPage() {
  const { accessToken } = useAdminAuthStore();
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [breakdown, setBreakdown] = useState<{
    tradingFees?: number;
    withdrawalFees?: number;
    p2pCommission?: number;
    referralPayouts?: number;
    total?: number;
  } | null>(null);
  const [revenueBuckets, setRevenueBuckets] = useState<Array<{ bucket?: string; revenue?: number }>>([]);
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
      getRevenueBreakdown(accessToken, period),
      getRevenue(accessToken, period),
    ])
      .then(([breakdownRes, revenueRes]) => {
        if (cancelled) return;
        if (breakdownRes.success && breakdownRes.data) {
          setBreakdown(breakdownRes.data as typeof breakdown);
        }
        if (revenueRes.success && revenueRes.data?.buckets) {
          setRevenueBuckets((revenueRes.data.buckets as Array<{ bucket?: string; revenue?: number }>) ?? []);
        }
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
        title="Financial Reports"
        subtitle="Revenue, P&L, fee breakdown from platform analytics"
      />
      <div className="flex flex-wrap gap-2">
        {(['24h', '7d', '30d'] as const).map((p) => (
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
            {p === '24h' ? '24 hours' : p === '7d' ? '7 days' : '30 days'}
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
          <Panel title="Revenue breakdown" subtitle={`Period: ${period}`} accent="success">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <KPICard
                title="Trading fees"
                value={breakdown?.tradingFees != null ? breakdown.tradingFees.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                icon={<TrendingUp className="w-5 h-5" />}
                accent="primary"
              />
              <KPICard
                title="Withdrawal fees"
                value={breakdown?.withdrawalFees != null ? breakdown.withdrawalFees.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                icon={<Wallet className="w-5 h-5" />}
                accent="neutral"
              />
              <KPICard
                title="P2P commission"
                value={breakdown?.p2pCommission != null ? breakdown.p2pCommission.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                icon={<Repeat className="w-5 h-5" />}
                accent="neutral"
              />
              <KPICard
                title="Referral payouts"
                value={breakdown?.referralPayouts != null ? breakdown.referralPayouts.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                icon={<Gift className="w-5 h-5" />}
                accent="neutral"
              />
              <KPICard
                title="Net total"
                value={breakdown?.total != null ? breakdown.total.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                icon={<DollarSign className="w-5 h-5" />}
                accent="success"
              />
            </div>
          </Panel>
          <Panel title="Revenue by day" subtitle="Spot trading fees per day" accent="primary">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Date</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueBuckets.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-gray-500 dark:text-gray-400">No data for this period</td>
                    </tr>
                  ) : (
                    revenueBuckets.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 px-3 text-gray-900 dark:text-white">
                          {row.bucket ? new Date(row.bucket).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-gray-900 dark:text-white">
                          {row.revenue != null ? row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
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
