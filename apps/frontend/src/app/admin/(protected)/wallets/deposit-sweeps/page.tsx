'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  ArrowDownToLine,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Info,
  Bug,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SweepRow {
  id: string;
  chain_id: string;
  chain_name: string;
  from_address: string;
  to_address: string;
  amount: string;
  amount_raw: string | null;
  tx_hash: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Sweep eligibility insight (admin visibility only). */
interface EligibilityInsight {
  credited_deposit_addresses: number;
  min_wei: string;
  gas_reserve_wei: string;
  skip_reason_counts: Record<string, number>;
}

function formatWei(wei: string): string {
  try {
    const n = BigInt(wei);
    if (n >= 10n ** 18n) return `${Number(Number(n) / 1e18).toFixed(4)} ETH`;
    if (n >= 10n ** 15n) return `${(Number(n) / 1e15).toFixed(2)}e15 wei`;
    return `${wei} wei`;
  } catch {
    return wei;
  }
}

export default function DepositSweepsPage() {
  const { accessToken } = useAdminAuthStore();
  const [sweeps, setSweeps] = useState<SweepRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityInsight | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  const fetchSweeps = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pagination.page), limit: String(pagination.limit) });
      const res = await fetch(`${API_URL}/api/v1/admin/deposit-sweeps?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSweeps(Array.isArray(data.data?.sweeps) ? data.data.sweeps : []);
        if (data.data?.pagination) {
          setPagination((p) => ({
            ...p,
            page: data.data.pagination.page,
            limit: data.data.pagination.limit,
            total: data.data.pagination.total,
            totalPages: data.data.pagination.totalPages ?? 1,
          }));
        }
        setError(null);
      } else {
        setError(data?.error?.message || 'Failed to load deposit sweeps');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [accessToken, pagination.page, pagination.limit]);

  const fetchEligibility = useCallback(async () => {
    if (!accessToken) return;
    setEligibilityLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/deposit-sweeps/eligibility`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.success && data.data) {
        setEligibility(data.data as EligibilityInsight);
      } else {
        setEligibility(null);
      }
    } catch {
      setEligibility(null);
    } finally {
      setEligibilityLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchSweeps();
  }, [fetchSweeps]);

  useEffect(() => {
    if (!loading && sweeps.length === 0 && accessToken) {
      fetchEligibility();
    } else if (sweeps.length > 0) {
      setEligibility(null);
    }
  }, [loading, sweeps.length, accessToken, fetchEligibility]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-amber-500" />;
    }
  };

  const shorten = (addr: string, head = 6, tail = 4) =>
    addr.length <= head + tail ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposit Sweeps</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            User deposit address → hot wallet consolidation. Runs in the background; sweeps appear here after execution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchSweeps()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/10 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900 dark:text-blue-100">
          Deposit sweeps are currently supported for EVM chains only. Bitcoin, Solana, and other non-EVM chains use user deposit addresses and are not swept.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-2 text-red-200">
          {error}
          <button type="button" onClick={() => fetchSweeps()} className="underline">Retry</button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading && !sweeps.length ? (
          <div className="flex items-center justify-center min-h-[280px]">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : !sweeps.length ? (
          <div className="p-12">
            <div className="text-center">
              <ArrowDownToLine className="w-12 h-12 text-gray-500 mx-auto mb-4 opacity-60" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">No deposit sweeps yet.</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2 max-w-md mx-auto">
                Sweeps run automatically for EVM chains when user deposit balances exceed the threshold.
              </p>
            </div>
            {/* Admin-only: sweep eligibility insight — explains why user balance ≠ sweep eligibility */}
            {(eligibilityLoading || eligibility) && (
              <div className="mt-8 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-3">
                  <Bug className="w-4 h-4 text-gray-500" />
                  Sweep eligibility (admin)
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  User balance ≠ sweep eligibility. Addresses are swept only when on-chain balance ≥ threshold and gas reserve is covered.
                </p>
                {eligibilityLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading…
                  </div>
                ) : eligibility ? (
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Credited deposit addresses</dt>
                      <dd className="font-mono font-medium text-gray-900 dark:text-white">{eligibility.credited_deposit_addresses}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Sweep threshold (min wei)</dt>
                      <dd className="font-mono text-gray-900 dark:text-white">{formatWei(eligibility.min_wei)}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500 dark:text-gray-400">Gas reserve (wei)</dt>
                      <dd className="font-mono text-gray-900 dark:text-white">{formatWei(eligibility.gas_reserve_wei)}</dd>
                    </div>
                    {Object.keys(eligibility.skip_reason_counts).length > 0 && (
                      <div className="sm:col-span-2">
                        <dt className="text-gray-500 dark:text-gray-400 mb-1">Addresses skipped (by reason)</dt>
                        <dd className="flex flex-wrap gap-2 mt-1">
                          {Object.entries(eligibility.skip_reason_counts).map(([key, count]) => (
                            <span key={key} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-xs">
                              {key.replace(/_/g, ' ')}: <strong>{count}</strong>
                            </span>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Chain</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">From (user)</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tx Hash</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {sweeps.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{s.chain_name || s.chain_id}</td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-600 dark:text-gray-400" title={s.from_address}>
                        {shorten(s.from_address)}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-900 dark:text-white">
                        {s.amount_raw ?? parseFloat(s.amount || '0').toFixed(0)}
                      </td>
                      <td className="px-4 py-3">
                        {s.tx_hash ? (
                          <a
                            href={`https://etherscan.io/tx/${s.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-500 hover:underline font-mono text-xs"
                          >
                            {shorten(s.tx_hash)}
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          {statusIcon(s.status)}
                          <span className="capitalize">{s.status}</span>
                        </span>
                        {s.error_message && (
                          <p className="text-xs text-red-400 mt-0.5 truncate max-w-[200px]" title={s.error_message}>
                            {s.error_message}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
