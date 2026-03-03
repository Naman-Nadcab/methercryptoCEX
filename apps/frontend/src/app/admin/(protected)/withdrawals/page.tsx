'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  MetricWidget,
  Panel,
  ActionButton,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
} from '@/components/admin/control-plane';
import { Loader2, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { formatAmountAdmin } from '@/lib/utils';

interface WithdrawalStats {
  total?: number;
  pending_approval?: number;
  pending?: number;
  processing?: number;
  completed?: number;
  failed?: number;
  cancelled?: number;
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  email: string;
  username?: string | null;
  currency_symbol: string;
  amount: string;
  fee?: string;
  net_amount?: string;
  to_address?: string | null;
  status: string;
  created_at: string;
  chain_name?: string;
  withdrawal_type?: string;
  internal_recipient_email?: string | null;
  failed_reason?: string | null;
  rejection_reason?: string | null;
}

const withdrawalStatusVariant: Record<string, 'LIVE' | 'HALTED' | 'DEGRADED' | 'RISK' | 'NEUTRAL'> = {
  pending_approval: 'DEGRADED',
  pending: 'NEUTRAL',
  processing: 'NEUTRAL',
  completed: 'LIVE',
  failed: 'RISK',
  cancelled: 'NEUTRAL',
};

function WithdrawalStatusBadge({ status }: { status: string }) {
  const variant = withdrawalStatusVariant[status] ?? 'NEUTRAL';
  const label = status.replace(/_/g, ' ');
  return <StatusBadge variant={variant} label={label} showDot={variant !== 'NEUTRAL'} />;
}

function truncateAddress(addr: string | null | undefined, len = 6): string {
  if (!addr) return '—';
  if (addr.length <= len * 2 + 2) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}

export default function WithdrawalsCommandCenter() {
  const searchParams = useSearchParams();
  const { accessToken } = useAdminAuthStore();
  const [stats, setStats] = useState<WithdrawalStats | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? 'all');
  const [page, setPage] = useState(() => Math.max(1, parseInt(searchParams.get('page') ?? '1', 10)));
  const [pagination, setPagination] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  } | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [confirmReject, setConfirmReject] = useState<WithdrawalRow | null>(null);

  const fetchWithdrawals = useCallback(async () => {
    setLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const params = new URLSearchParams({ limit: '20', page: String(page) });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`${apiUrl}/api/v1/admin/withdrawals?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (result?.success && result?.data) {
        setStats(result.data.stats ?? {});
        setWithdrawals(result.data.withdrawals ?? []);
        setPagination(result.data.pagination ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter, page]);

  useEffect(() => {
    fetchWithdrawals();
  }, [fetchWithdrawals]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (statusFilter !== 'all') next.set('status', statusFilter);
    else next.delete('status');
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    const q = next.toString();
    const url = q ? `?${q}` : '';
    if (typeof window !== 'undefined' && (window.location.search || '') !== url) {
      window.history.replaceState(null, '', `${window.location.pathname}${url}`);
    }
  }, [statusFilter, page, searchParams]);

  const apiUrl = getApiBaseUrl();

  const handleApprove = async (id: string) => {
    if (!accessToken) return;
    setActionError(null);
    setActingId(id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/withdrawals/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data?.success) {
        await fetchWithdrawals();
      } else {
        setActionError({ id, message: data?.error?.message ?? data?.error?.code ?? 'Approve failed' });
      }
    } catch {
      setActionError({ id, message: 'Request failed' });
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!accessToken || !confirmReject) return;
    setActionError(null);
    setActingId(id);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by operator' }),
      });
      const data = await res.json();
      if (data?.success) {
        setConfirmReject(null);
        await fetchWithdrawals();
      } else {
        setActionError({ id, message: data?.error?.message ?? data?.error?.code ?? 'Reject failed' });
      }
    } catch {
      setActionError({ id, message: 'Request failed' });
    } finally {
      setActingId(null);
    }
  };

  const pendingApproval = stats?.pending_approval ?? 0;
  const signing = stats?.pending ?? 0;
  const broadcasted = stats?.completed ?? 0;
  const failed = stats?.failed ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Withdrawals Command Center"
        subtitle="Monitor approvals, signing, and failures"
        action={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 dark:text-white"
            >
              <option value="all">All statuses</option>
              <option value="pending_approval">Pending approval</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ActionButton
              variant="secondary"
              onClick={() => fetchWithdrawals()}
              loading={loading}
              icon={!loading ? <span className="text-xs">↻</span> : undefined}
            >
              Refresh
            </ActionButton>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricWidget
          label="Pending approval"
          value={pendingApproval}
          variant={pendingApproval > 0 ? 'warning' : 'neutral'}
          statusBadge={pendingApproval > 0 ? 'DEGRADED' : undefined}
        />
        <MetricWidget label="Signing" value={signing} sublabel="in queue" />
        <MetricWidget label="Broadcasted" value={broadcasted} variant="positive" />
        <MetricWidget
          label="Failed"
          value={failed}
          variant={failed > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <DataTableContainer
        title="Withdrawals"
        subtitle={`${pagination?.total ?? 0} total`}
        headerAction={
          pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={pagination.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 px-2">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : null
        }
        emptyMessage="No withdrawals found"
        isEmpty={!loading && withdrawals.length === 0}
      >
        <DataTableHead>
          <DataTableTh>Withdrawal ID</DataTableTh>
          <DataTableTh>User</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh align="right">Amount</DataTableTh>
          <DataTableTh>Address</DataTableTh>
          <DataTableTh>Status</DataTableTh>
          <DataTableTh>Created</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {withdrawals.map((w) => (
            <DataTableRow key={w.id} className="cursor-default">
              <DataTableCell mono>
                <span className="text-gray-700 dark:text-gray-300" title={w.id}>
                  {w.id.slice(0, 8)}…
                </span>
              </DataTableCell>
              <DataTableCell>
                <div>
                  <span className="text-gray-900 dark:text-white">{w.email}</span>
                  {w.username && (
                    <span className="text-gray-500 dark:text-gray-400 text-xs block">
                      {w.username}
                    </span>
                  )}
                </div>
              </DataTableCell>
              <DataTableCell>{w.currency_symbol}</DataTableCell>
              <DataTableCell align="right" mono>
                {formatAmountAdmin(w.amount)}
              </DataTableCell>
              <DataTableCell mono className="max-w-[120px] truncate" title={w.to_address ?? undefined}>
                {w.withdrawal_type === 'internal' || w.chain_name === 'Internal'
                  ? truncateAddress(w.internal_recipient_email ?? null, 4)
                  : truncateAddress(w.to_address ?? undefined)}
              </DataTableCell>
              <DataTableCell>
                <div>
                  <WithdrawalStatusBadge status={w.status} />
                  {(w.status === 'failed' && w.failed_reason) && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 truncate max-w-[180px]" title={w.failed_reason}>
                      {w.failed_reason}
                    </p>
                  )}
                  {(w.status === 'rejected' || w.rejection_reason) && w.rejection_reason && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 truncate max-w-[180px]" title={w.rejection_reason}>
                      {w.rejection_reason}
                    </p>
                  )}
                </div>
              </DataTableCell>
              <DataTableCell className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(w.created_at).toLocaleString()}
              </DataTableCell>
              <DataTableCell align="right">
                {w.status === 'pending_approval' && (
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center justify-end gap-1">
                      <ActionButton
                        variant="primary"
                        icon={<Check className="w-3.5 h-3.5" />}
                        onClick={() => { setActionError(null); handleApprove(w.id); }}
                        loading={actingId === w.id}
                        disabled={actingId != null && actingId !== w.id}
                      >
                        Approve
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        icon={<X className="w-3.5 h-3.5" />}
                        onClick={() => { setActionError(null); setConfirmReject(w); }}
                        loading={actingId === w.id}
                        disabled={actingId != null && actingId !== w.id}
                      >
                        Reject
                      </ActionButton>
                    </div>
                    {actionError?.id === w.id && (
                      <span className="text-xs text-red-600 dark:text-red-400" role="alert">{actionError.message}</span>
                    )}
                  </div>
                )}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>

      {loading && withdrawals.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      )}

      {confirmReject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-withdrawal-title"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <X className="w-5 h-5 text-red-500 shrink-0" />
              <h2 id="reject-withdrawal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                Reject withdrawal
              </h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">
                Locked funds will be returned to the user. This cannot be undone.
              </p>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">User</span>
                  <span className="text-gray-900 dark:text-white truncate max-w-[200px]" title={confirmReject.email}>{confirmReject.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Amount</span>
                  <span className="font-mono text-gray-900 dark:text-white tabular-nums">{formatAmountAdmin(confirmReject.amount)} {confirmReject.currency_symbol}</span>
                </div>
              </div>
              {actionError?.id === confirmReject.id && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">{actionError.message}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmReject(null); setActionError(null); }}>
                Back
              </ActionButton>
              <ActionButton
                variant="danger"
                loading={actingId === confirmReject.id}
                disabled={actingId != null && actingId !== confirmReject.id}
                onClick={() => handleReject(confirmReject.id)}
              >
                Reject withdrawal
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
