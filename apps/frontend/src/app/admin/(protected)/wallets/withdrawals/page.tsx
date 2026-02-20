'use client';

import { useState, useMemo } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  Panel,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
  ActionButton,
} from '@/components/admin/control-plane';
import {
  useAdminWithdrawals,
  useRejectWithdrawal,
  type WithdrawalRow,
  type WithdrawalsFilters,
} from '@/lib/admin-wallets-api';
import { formatAmountAdmin } from '@/lib/utils';
import { Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react';

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusVariant: Record<string, 'LIVE' | 'HALTED' | 'DEGRADED' | 'RISK' | 'NEUTRAL'> = {
  pending_approval: 'DEGRADED',
  pending: 'NEUTRAL',
  processing: 'NEUTRAL',
  completed: 'LIVE',
  failed: 'RISK',
  rejected: 'RISK',
  cancelled: 'NEUTRAL',
};

function WithdrawalStatusBadge({ status }: { status: string }) {
  const variant = statusVariant[status] ?? 'NEUTRAL';
  const label = status.replace(/_/g, ' ');
  return <StatusBadge variant={variant} label={label} showDot={variant !== 'NEUTRAL'} />;
}

function truncateAddress(addr: string | null | undefined, len = 6): string {
  if (!addr) return '—';
  if (addr.length <= len * 2 + 2) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}

export default function WalletsWithdrawalsPage() {
  const { accessToken } = useAdminAuthStore();
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmReject, setConfirmReject] = useState<WithdrawalRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const filters: WithdrawalsFilters = useMemo(
    () => ({
      page,
      limit: 20,
      user: userFilter.trim() || undefined,
      token_id: assetFilter.trim() || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
    }),
    [page, userFilter, assetFilter, statusFilter]
  );

  const { data, isLoading, isFetching, refetch } = useAdminWithdrawals(accessToken, filters);
  const rejectMutation = useRejectWithdrawal(accessToken);

  const withdrawals = data?.data?.withdrawals ?? [];
  const pagination = data?.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 };
  const canReject = (w: WithdrawalRow) => w.status === 'pending_approval';

  const handleReject = () => {
    if (!confirmReject || !rejectReason.trim()) return;
    rejectMutation.mutate(
      { withdrawalId: confirmReject.id, reason: rejectReason.trim() },
      {
        onSuccess: (res) => {
          if (res?.success) {
            setConfirmReject(null);
            setRejectReason('');
            refetch();
          }
        },
      }
    );
  };

  const rejectError = rejectMutation.isError
    ? String(rejectMutation.error)
    : !rejectMutation.data?.success && confirmReject
      ? rejectMutation.data?.error?.message ?? rejectMutation.data?.error?.code ?? 'Reject failed'
      : null;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Withdrawals Control Panel"
        subtitle="Review and control withdrawal requests. Reject only when appropriate; no direct balance changes."
        action={
          <ActionButton variant="secondary" onClick={() => refetch()} loading={isFetching} icon={!isFetching ? <span className="text-xs">↻</span> : undefined}>
            Refresh
          </ActionButton>
        }
      />

      <Panel className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">User ID / Email</label>
            <input
              type="text"
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
              placeholder="UUID or email"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Asset (token ID)</label>
            <input
              type="text"
              value={assetFilter}
              onChange={(e) => { setAssetFilter(e.target.value); setPage(1); }}
              placeholder="Optional token UUID"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      <DataTableContainer
        title="Withdrawals"
        subtitle={`${pagination.total} total`}
        headerAction={
          pagination.totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || isLoading}
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
                disabled={page >= pagination.totalPages || isLoading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : null
        }
        emptyMessage="No withdrawals found"
        isEmpty={!isLoading && withdrawals.length === 0}
      >
        <DataTableHead>
          <DataTableTh>Withdrawal ID</DataTableTh>
          <DataTableTh>User ID</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh align="right">Amount</DataTableTh>
          <DataTableTh>Address</DataTableTh>
          <DataTableTh>Status</DataTableTh>
          <DataTableTh>Failed / Rejection reason</DataTableTh>
          <DataTableTh>Created At</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {withdrawals.map((w) => (
            <DataTableRow key={w.id}>
              <DataTableCell mono className="text-gray-700 dark:text-gray-300" title={w.id}>
                {w.id.slice(0, 8)}…
              </DataTableCell>
              <DataTableCell>
                <span className="text-gray-900 dark:text-white">{w.user_id}</span>
                {(w.email ?? w.username) && (
                  <span className="text-gray-500 dark:text-gray-400 text-xs block truncate max-w-[140px]" title={w.email ?? w.username ?? undefined}>
                    {w.email ?? w.username}
                  </span>
                )}
              </DataTableCell>
              <DataTableCell>{w.currency_symbol ?? w.token_id ?? '—'}</DataTableCell>
              <DataTableCell align="right" mono>{formatAmountAdmin(w.amount)}</DataTableCell>
              <DataTableCell mono className="max-w-[120px] truncate" title={w.to_address ?? w.internal_recipient_email ?? undefined}>
                {w.withdrawal_type === 'internal' || w.chain_name === 'Internal'
                  ? truncateAddress(w.internal_recipient_email ?? null, 4)
                  : truncateAddress(w.to_address ?? undefined)}
              </DataTableCell>
              <DataTableCell>
                <WithdrawalStatusBadge status={w.status} />
              </DataTableCell>
              <DataTableCell className="max-w-[160px]">
                {w.status === 'failed' && w.failed_reason && (
                  <p className="text-xs text-red-600 dark:text-red-400 truncate" title={w.failed_reason}>{w.failed_reason}</p>
                )}
                {(w.status === 'rejected' || w.rejection_reason) && w.rejection_reason && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 truncate" title={w.rejection_reason}>{w.rejection_reason}</p>
                )}
                {!w.failed_reason && !w.rejection_reason && '—'}
              </DataTableCell>
              <DataTableCell className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(w.created_at).toLocaleString()}
              </DataTableCell>
              <DataTableCell align="right">
                {canReject(w) && (
                  <ActionButton
                    variant="danger"
                    icon={<X className="w-3.5 h-3.5" />}
                    onClick={() => { setConfirmReject(w); setRejectReason(''); }}
                    loading={rejectMutation.isPending && confirmReject?.id === w.id}
                    disabled={rejectMutation.isPending && confirmReject?.id !== w.id}
                  >
                    Reject
                  </ActionButton>
                )}
                {!canReject(w) && (w.status === 'pending' || w.status === 'processing') && (
                  <span className="text-xs text-gray-400 dark:text-gray-500" title="No admin Cancel/Retry endpoint">—</span>
                )}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>

      {isLoading && withdrawals.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      )}

      {confirmReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="reject-withdrawal-title">
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <X className="w-5 h-5 text-red-500 shrink-0" />
              <h2 id="reject-withdrawal-title" className="text-sm font-semibold text-gray-900 dark:text-white">Reject withdrawal</h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">Locked funds will be returned via backend. Operator reason is required.</p>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-3 space-y-1">
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">User</span><span className="text-gray-900 dark:text-white truncate max-w-[200px]" title={confirmReject.email ?? confirmReject.user_id}>{confirmReject.email ?? confirmReject.user_id}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Amount</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">{formatAmountAdmin(confirmReject.amount)} {confirmReject.currency_symbol ?? ''}</span></div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reason (required)</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Operator reason for rejection"
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
                />
              </div>
              {(rejectError || (rejectMutation.data && !rejectMutation.data.success)) && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">{rejectError ?? rejectMutation.data?.error?.message}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmReject(null); setRejectReason(''); rejectMutation.reset(); }}>Back</ActionButton>
              <ActionButton
                variant="danger"
                loading={rejectMutation.isPending}
                disabled={!rejectReason.trim()}
                onClick={handleReject}
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
