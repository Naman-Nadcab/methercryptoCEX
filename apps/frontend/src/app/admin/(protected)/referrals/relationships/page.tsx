'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Users, Loader2, Search, RefreshCw } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface RelationshipRow {
  id: string;
  referrer_id: string;
  referee_id: string;
  referrer_email: string;
  referrer_username: string | null;
  referee_email: string;
  referee_username: string | null;
  referral_code: string;
  status: string;
  locked_referrer_commission: string;
  locked_referee_discount: string;
  total_commission_earned: string;
  total_trades_count: number;
  total_trading_volume: string;
  created_at: string;
  activated_at: string | null;
}

export default function ReferralRelationshipsPage() {
  const { accessToken } = useAdminAuthStore();
  const [rows, setRows] = useState<RelationshipRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [referrerEmail, setReferrerEmail] = useState('');
  const [refereeEmail, setRefereeEmail] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRelationships = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (referrerEmail) params.set('referrer_email', referrerEmail);
      if (refereeEmail) params.set('referee_email', refereeEmail);
      if (statusFilter) params.set('status', statusFilter);
      const response = await fetch(`${apiUrl}/api/v1/admin/referrals/relationships?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setRows(result.data.relationships);
        setTotal(result.data.total);
      }
    } catch (error) {
      console.error('Failed to fetch relationships:', error);
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, limit, referrerEmail, refereeEmail, statusFilter]);

  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships]);

  const totalPages = Math.ceil(total / limit) || 1;
  const formatDate = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Referral Relationships</h1>
        <p className="text-gray-400 text-sm mt-1">View referrer–referee links, status, and commission locked at signup.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 whitespace-nowrap">Referrer email</label>
          <input
            type="text"
            placeholder="Filter by referrer..."
            value={referrerEmail}
            onChange={(e) => setReferrerEmail(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white w-48"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 whitespace-nowrap">Referee email</label>
          <input
            type="text"
            placeholder="Filter by referee..."
            value={refereeEmail}
            onChange={(e) => setRefereeEmail(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white w-48"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
        >
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
        </select>
        <button
          onClick={() => fetchRelationships()}
          disabled={loading}
          className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
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
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No relationships found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Referrer</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Referee</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Code</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Commission %</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Earned</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Trades</th>
                    <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Linked at</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      <td className="px-6 py-4">
                        <p className="text-gray-900 dark:text-white font-medium">{row.referrer_email}</p>
                        {row.referrer_username && <p className="text-xs text-gray-500">@{row.referrer_username}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-gray-900 dark:text-white font-medium">{row.referee_email}</p>
                        {row.referee_username && <p className="text-xs text-gray-500">@{row.referee_username}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{row.referral_code}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-1 rounded ${
                          row.status === 'active' ? 'bg-green-500/20 text-green-500' :
                          row.status === 'pending' ? 'bg-amber-500/20 text-amber-500' :
                          'bg-gray-500/20 text-gray-500'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-700 dark:text-gray-300">{(parseFloat(row.locked_referrer_commission) * 100).toFixed(1)}%</td>
                      <td className="px-6 py-4 text-green-600 dark:text-green-400">${parseFloat(row.total_commission_earned || '0').toFixed(2)}</td>
                      <td className="px-6 py-4 text-gray-900 dark:text-white">{row.total_trades_count}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm">{formatDate(row.created_at)}</td>
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
