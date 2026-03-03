'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import {
  BarChart3,
  ArrowUpFromLine,
  Loader2,
  FileText,
  Calendar,
  PieChart,
  TrendingUp,
} from 'lucide-react';

const API_URL = getApiBaseUrl();

interface WithdrawalStats {
  total: string;
  pending_approval: string;
  pending: string;
  processing: string;
  completed: string;
  failed: string;
  cancelled: string;
}

interface ReportData {
  stats: WithdrawalStats;
  by_type: { internal: string; onchain: string };
  period: { today: string; last_7_days: string; last_30_days: string };
  volume: { completed_count: string; completed_volume: string };
  by_currency: Array<{ symbol: string; count: string; total_amount: string }>;
  date_range: { date_from: string | null; date_to: string | null } | null;
}

const emptyReport: ReportData = {
  stats: {
    total: '0',
    pending_approval: '0',
    pending: '0',
    processing: '0',
    completed: '0',
    failed: '0',
    cancelled: '0',
  },
  by_type: { internal: '0', onchain: '0' },
  period: { today: '0', last_7_days: '0', last_30_days: '0' },
  volume: { completed_count: '0', completed_volume: '0' },
  by_currency: [],
  date_range: null,
};

export default function WithdrawalReportsPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<ReportData>(emptyReport);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string } | null>(null);

  const fetchReport = (from?: string, to?: string) => {
    setLoadError(null);
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    const url = `${API_URL}/api/v1/admin/withdrawals/reports?${params}`;
    const opts: RequestInit = {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      credentials: 'include',
    };
    fetch(url, opts)
      .then((r) => r.json())
      .then((res) => {
        if (res?.success && res?.data) {
          setData(res.data);
          setAppliedRange(from || to ? { from: from ?? '', to: to ?? '' } : null);
        } else {
          setData(emptyReport);
          setLoadError(res?.error?.message || 'Report could not be loaded.');
        }
      })
      .catch(() => {
        setData(emptyReport);
        setLoadError('Network error. Check connection and try again.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReport();
  }, [accessToken]);

  const applyDateFilter = () => {
    const from = dateFrom.trim() || undefined;
    const to = dateTo.trim() || undefined;
    fetchReport(from, to);
  };

  const clearDateFilter = () => {
    setDateFrom('');
    setDateTo('');
    setAppliedRange(null);
    fetchReport();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Withdrawal Reports</h1>
        <p className="text-gray-400 text-sm mt-1">
          Full withdrawal analytics: counts by status, type, period, volume, and by currency. Use date range to filter.
        </p>
      </div>

      {loadError && (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-amber-700 dark:text-amber-300 text-sm">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => fetchReport(appliedRange?.from || undefined, appliedRange?.to || undefined)}
            className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && (
        <>
      {/* Date range filter */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <Calendar className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Date range</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From</label>
            <input
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To</label>
            <input
              type="datetime-local"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
            />
          </div>
          <button
            type="button"
            onClick={applyDateFilter}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={clearDateFilter}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => fetchReport(dateFrom.trim() || undefined, dateTo.trim() || undefined)}
            disabled={loading}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium disabled:opacity-50"
            title="Reload report"
          >
            Refresh
          </button>
        </div>
        {appliedRange && (appliedRange.from || appliedRange.to) && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Showing data from {appliedRange.from || 'start'} to {appliedRange.to || 'now'}
          </p>
        )}
      </div>

          {/* Stats by status */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">By status</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{data.stats?.total ?? '0'}</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
                <p className="text-xs text-amber-600 dark:text-amber-400">Pending approval</p>
                <p className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">{data.stats?.pending_approval ?? '0'}</p>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl p-4">
                <p className="text-xs text-yellow-600 dark:text-yellow-400">Pending</p>
                <p className="text-xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{data.stats?.pending ?? '0'}</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
                <p className="text-xs text-blue-600 dark:text-blue-400">Processing</p>
                <p className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1">{data.stats?.processing ?? '0'}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
                <p className="text-xs text-green-600 dark:text-green-400">Completed</p>
                <p className="text-xl font-bold text-green-700 dark:text-green-300 mt-1">{data.stats?.completed ?? '0'}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                <p className="text-xs text-red-600 dark:text-red-400">Failed</p>
                <p className="text-xl font-bold text-red-700 dark:text-red-300 mt-1">{data.stats?.failed ?? '0'}</p>
              </div>
              <div className="bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-4">
                <p className="text-xs text-gray-600 dark:text-gray-400">Cancelled</p>
                <p className="text-xl font-bold text-gray-700 dark:text-gray-300 mt-1">{data.stats?.cancelled ?? '0'}</p>
              </div>
            </div>
          </div>

          {/* By type + Period + Volume */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <PieChart className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">By type</h2>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">On-chain</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{data.by_type?.onchain ?? '0'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">Internal transfers</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{data.by_type?.internal ?? '0'}</span>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">By period</h2>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">Today</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{data.period?.today ?? '0'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">Last 7 days</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{data.period?.last_7_days ?? '0'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-400">Last 30 days</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{data.period?.last_30_days ?? '0'}</span>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Completed volume</h2>
              </div>
              <div className="space-y-2">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{data.volume?.completed_count ?? '0'} withdrawals</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Total amount: <span className="font-medium text-gray-900 dark:text-white">{Number(data.volume?.completed_volume ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}</span> (all currencies)
                </p>
              </div>
            </div>
          </div>

          {/* By currency */}
          {(data.by_currency?.length ?? 0) > 0 ? (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
                <BarChart3 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">By currency (top 20)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Currency</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Count</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_currency.map((row) => (
                      <tr key={row.symbol} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.symbol}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{row.count}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{Number(row.total_amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
                <BarChart3 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">By currency (top 20)</h2>
              </div>
              <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">No withdrawal data by currency in this period.</div>
            </div>
          )}

          {/* Quick links + Export note */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <ArrowUpFromLine className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Withdrawal overview</h2>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                For full list, filters, and per-withdrawal details use <strong>All Withdrawals</strong>. Pending Approval and Internal Transfers open filtered views.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/admin/withdrawals"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
                >
                  <ArrowUpFromLine className="w-4 h-4" />
                  All Withdrawals
                </Link>
                <Link
                  href="/admin/withdrawals/pending-approval"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
                >
                  Pending Approval
                </Link>
                <Link
                  href="/admin/withdrawals?type=internal"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
                >
                  Internal Transfers
                </Link>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Export</h2>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Use All Withdrawals with status/type/date filters, then export from the table (CSV/Excel) when the feature is enabled. Reports align with Spot and P2P operations.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
