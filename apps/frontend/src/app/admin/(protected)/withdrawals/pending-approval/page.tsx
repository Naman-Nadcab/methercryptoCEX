'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import Link from 'next/link';
import { ArrowUpFromLine, Loader2, Check, X, Eye, AlertCircle } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface Withdrawal {
  id: string;
  user_id: string;
  to_address: string | null;
  amount: string;
  fee: string;
  net_amount: string;
  status: string;
  email: string;
  username: string | null;
  currency_symbol: string;
  token_name: string;
  chain_name: string;
  tx_hash: string | null;
  memo: string | null;
  created_at: string;
}

export default function PendingApprovalWithdrawalsPage() {
  const { accessToken } = useAdminAuthStore();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const apiUrl = getApiBaseUrl();

  const fetchList = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/v1/admin/withdrawals?status=pending_approval&limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const result = await res.json();
      if (result.success) {
        setWithdrawals(result.data?.withdrawals ?? []);
      } else {
        setFeedback({ type: 'error', message: result.error?.message ?? 'Failed to load' });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setLoading(false);
    }
  }, [accessToken, apiUrl]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const clearFeedback = () => {
    setFeedback(null);
  };

  const handleApprove = async (id: string) => {
    if (!accessToken) return;
    setActionLoading(id);
    setFeedback(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/withdrawals/${id}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const result = await res.json();
      if (result.success) {
        setFeedback({ type: 'success', message: 'Withdrawal approved. It will be processed for signing.' });
        setDetailId(null);
        fetchList();
      } else {
        setFeedback({
          type: 'error',
          message: result.error?.message ?? result.error?.code ?? 'Approve failed',
        });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!accessToken) return;
    setActionLoading(id);
    setFeedback(null);
    const reason = rejectReason.trim() || 'Rejected by admin';
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
      });
      const result = await res.json();
      if (result.success) {
        setFeedback({ type: 'success', message: 'Withdrawal rejected. User balance has been released.' });
        setDetailId(null);
        setRejectReason('');
        fetchList();
      } else {
        setFeedback({
          type: 'error',
          message: result.error?.message ?? result.error?.code ?? 'Reject failed',
        });
      }
    } catch (e) {
      setFeedback({ type: 'error', message: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setActionLoading(null);
    }
  };

  const selected = detailId ? withdrawals.find((w) => w.id === detailId) : null;

  if (loading && withdrawals.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pending Approval</h1>
        <p className="text-gray-400 text-sm mt-1">
          Withdrawals awaiting admin approval. Approve to enqueue for signing; reject to release the locked balance.
        </p>
        <Link href="/admin/withdrawals" className="text-sm text-blue-500 hover:underline mt-2 inline-block">
          View all withdrawals
        </Link>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg ${
            feedback.type === 'success'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30'
              : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
          }`}
        >
          {feedback.type === 'success' ? (
            <Check className="w-5 h-5 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0" />
          )}
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={clearFeedback}
            className="ml-auto text-current opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {withdrawals.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowUpFromLine className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No withdrawals pending approval</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">User</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Chain</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Token</th>
                  <th className="text-right px-6 py-4 text-xs font-medium text-gray-400 uppercase">Amount</th>
                  <th className="text-right px-6 py-4 text-xs font-medium text-gray-400 uppercase">Fee</th>
                  <th className="text-right px-6 py-4 text-xs font-medium text-gray-400 uppercase">Net amount</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Created</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <React.Fragment key={w.id}>
                    <tr
                      key={w.id}
                      className="border-b border-gray-200 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20"
                    >
                      <td className="px-6 py-4">
                        <p className="text-gray-900 dark:text-white font-medium">{w.email}</p>
                        {w.username && <p className="text-xs text-gray-500">{w.username}</p>}
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{w.chain_name}</td>
                      <td className="px-6 py-4 text-gray-900 dark:text-white">{w.currency_symbol}</td>
                      <td className="px-6 py-4 text-right font-mono text-gray-900 dark:text-white">
                        {parseFloat(w.amount).toFixed(8)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-gray-500 dark:text-gray-400">
                        {parseFloat(w.fee || '0').toFixed(8)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-gray-900 dark:text-white">
                        {parseFloat(w.net_amount || w.amount).toFixed(8)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(w.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => setDetailId(detailId === w.id ? null : w.id)}
                          className="text-blue-500 hover:underline flex items-center gap-1 text-sm"
                        >
                          <Eye className="w-4 h-4" />
                          {detailId === w.id ? 'Hide' : 'View'}
                        </button>
                      </td>
                    </tr>
                    {detailId === w.id && selected?.id === w.id && (
                      <tr key={`${w.id}-detail`} className="bg-gray-50 dark:bg-gray-800/80">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                              <p>
                                <span className="text-gray-500 dark:text-gray-400">To address:</span>{' '}
                                <span className="font-mono break-all text-gray-900 dark:text-white">
                                  {selected.to_address || '—'}
                                </span>
                              </p>
                              {selected.memo && (
                                <p>
                                  <span className="text-gray-500 dark:text-gray-400">Memo:</span>{' '}
                                  <span className="text-gray-900 dark:text-white">{selected.memo}</span>
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => handleApprove(selected.id)}
                                disabled={actionLoading !== null}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:pointer-events-none"
                              >
                                {actionLoading === selected.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4" />
                                )}
                                Approve
                              </button>
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <input
                                  type="text"
                                  placeholder="Reject reason (optional)"
                                  value={rejectReason}
                                  onChange={(e) => setRejectReason(e.target.value)}
                                  className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleReject(selected.id)}
                                  disabled={actionLoading !== null}
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:pointer-events-none shrink-0"
                                >
                                  {actionLoading === selected.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <X className="w-4 h-4" />
                                  )}
                                  Reject
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
