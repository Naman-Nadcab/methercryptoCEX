'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Receipt, Loader2, RefreshCw } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface CommissionRow {
  id: string;
  referrer_id: string;
  referee_id: string;
  referrer_email: string;
  referrer_username: string | null;
  referee_email: string;
  referee_username: string | null;
  source_type: string;
  commission_rate: string;
  commission_amount: string;
  commission_currency: string;
  status: string;
  created_at: string;
  credited_at: string | null;
}

interface CommissionStats {
  total_credited: string;
  total_pending: string;
  count_credited: string;
  count_pending: string;
}

export default function ReferralCommissionsPage() {
  const { accessToken } = useAdminAuthStore();
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [stats, setStats] = useState<CommissionStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchCommissions = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`${apiUrl}/api/v1/admin/referrals/commissions?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setRows(result.data.commissions);
        setTotal(result.data.total);
        setStats(result.data.stats || null);
      }
    } catch (error) {
      console.error('Failed to fetch commissions:', error);
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, limit, statusFilter]);

  useEffect(() => {
    fetchCommissions();
  }, [fetchCommissions]);

  const totalPages = Math.ceil(total / limit) || 1;
  const formatDate = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Referral Commissions</h1>
        <p className="text-gray-400 text-sm mt-1">Monitor commission payouts from spot/P2P and status (pending/credited).</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
            <p className="text-sm text-green-600 dark:text-green-400">Total Credited</p>
            <p className="text-xl font-bold text-green-700 dark:text-green-300">${parseFloat(stats.total_credited || '0').toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-1">{stats.count_credited || 0} records</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4">
            <p className="text-sm text-amber-600 dark:text-amber-400">Total Pending</p>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300">${parseFloat(stats.total_pending || '0').toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-1">{stats.count_pending || 0} records</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        >
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="credited">Credited</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button onClick={() => fetchCommissions()} disabled={loading} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
          <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No commissions found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Referrer</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Referee</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Source</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Credited</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      <td className="px-6 py-4">
                        <p className="text-gray-900 dark:text-white text-sm">{row.referrer_email}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-gray-900 dark:text-white text-sm">{row.referee_email}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">{row.source_type}</span>
                      </td>
                      <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{(parseFloat(row.commission_rate) * 100).toFixed(1)}%</td>
                      <td className="px-6 py-4 text-green-600 dark:text-green-400 font-medium">{row.commission_amount} {row.commission_currency}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-1 rounded ${
                          row.status === 'credited' ? 'bg-green-500/20 text-green-500' :
                          row.status === 'pending' ? 'bg-amber-500/20 text-amber-500' :
                          'bg-gray-500/20 text-gray-500'
                        }`}>{row.status}</span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{formatDate(row.created_at)}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{formatDate(row.credited_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50">Previous</button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
