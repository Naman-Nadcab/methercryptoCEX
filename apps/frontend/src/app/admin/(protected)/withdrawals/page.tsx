'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, ActionButton, StatusBadge } from '@/components/admin/control-plane';
import { KPICard } from '@/components/admin/v2/dashboard';
import { DataTable } from '@/components/admin/v2/tables';
import { Check, X, Clock, Send, CheckCircle, XCircle } from 'lucide-react';
import { formatAmountAdmin } from '@/lib/utils';
import { canApproveWithdrawals } from '@/lib/admin/permissions';
import { useWithdrawalsList } from '@/hooks/admin/useAdminDashboard';
import type { ColumnDef } from '@tanstack/react-table';

interface WithdrawalRow {
  id: string;
  user_id: string;
  email: string;
  username?: string | null;
  currency_symbol: string;
  amount: string;
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
  const queryClient = useQueryClient();
  const { accessToken } = useAdminAuthStore();
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? 'all');
  const [page, setPage] = useState(() => Math.max(1, parseInt(searchParams.get('page') ?? '1', 10)));
  const [pageSize, setPageSize] = useState(20);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [confirmReject, setConfirmReject] = useState<WithdrawalRow | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<WithdrawalRow | null>(null);

  const canApprove = canApproveWithdrawals();

  const { data, isLoading, refetch } = useWithdrawalsList({
    limit: pageSize,
    page,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const stats = data?.data?.stats as Record<string, string> | undefined;
  const withdrawals = (data?.data?.withdrawals ?? []) as WithdrawalRow[];
  const pagination = data?.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 };
  const total = pagination.total;
  const pendingApproval = parseInt(stats?.pending_approval ?? '0', 10) || 0;
  const signing = parseInt(stats?.pending ?? '0', 10) || 0;
  const broadcasted = parseInt(stats?.completed ?? '0', 10) || 0;
  const failed = parseInt(stats?.failed ?? '0', 10) || 0;

  // Sync URL with filters
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
      const result = await res.json();
      if (result?.success) {
        setConfirmApprove(null);
        await queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
        refetch();
      } else {
        setActionError({ id, message: result?.error?.message ?? result?.error?.code ?? 'Approve failed' });
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
      const result = await res.json();
      if (result?.success) {
        setConfirmReject(null);
        await queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
        refetch();
      } else {
        setActionError({ id, message: result?.error?.message ?? result?.error?.code ?? 'Reject failed' });
      }
    } catch {
      setActionError({ id, message: 'Request failed' });
    } finally {
      setActingId(null);
    }
  };

  const columns = useMemo<ColumnDef<WithdrawalRow>[]>(
    () => [
      {
        id: 'id',
        header: 'Withdrawal ID',
        accessorKey: 'id',
        cell: ({ getValue }) => {
          const id = getValue() as string;
          return (
            <span className="font-mono text-[var(--admin-text)]" title={id}>
              {id?.slice(0, 8)}…
            </span>
          );
        },
        enableSorting: false,
      },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => {
          const w = row.original;
          return (
            <div>
              <span className="text-[var(--admin-text)]">{w.email}</span>
              {w.username && (
                <span className="text-[var(--admin-text-muted)] text-xs block">{w.username}</span>
              )}
            </div>
          );
        },
        enableSorting: false,
      },
      {
        id: 'currency_symbol',
        header: 'Asset',
        accessorKey: 'currency_symbol',
        enableSorting: false,
      },
      {
        id: 'amount',
        header: 'Amount',
        accessorKey: 'amount',
        cell: ({ getValue }) => (
          <span className="font-mono tabular-nums text-[var(--admin-text)]">
            {formatAmountAdmin(String(getValue() ?? ''))}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'address',
        header: 'Address',
        cell: ({ row }) => {
          const w = row.original;
          const addr =
            w.withdrawal_type === 'internal' || w.chain_name === 'Internal'
              ? w.internal_recipient_email ?? null
              : w.to_address ?? null;
          return (
            <span className="font-mono max-w-[120px] truncate block text-[var(--admin-text-muted)]" title={addr ?? undefined}>
              {truncateAddress(addr, 4)}
            </span>
          );
        },
        enableSorting: false,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => {
          const w = row.original;
          return (
            <div>
              <WithdrawalStatusBadge status={w.status} />
              {w.status === 'failed' && w.failed_reason && (
                <p className="text-xs text-[var(--admin-danger)] mt-1 truncate max-w-[180px]" title={w.failed_reason}>
                  {w.failed_reason}
                </p>
              )}
              {(w.status === 'rejected' || w.rejection_reason) && w.rejection_reason && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 truncate max-w-[180px]" title={w.rejection_reason}>
                  {w.rejection_reason}
                </p>
              )}
            </div>
          );
        },
        enableSorting: false,
      },
      {
        id: 'created_at',
        header: 'Created',
        accessorKey: 'created_at',
        cell: ({ getValue }) => (
          <span className="text-xs text-[var(--admin-text-muted)]">
            {getValue() ? new Date(String(getValue())).toLocaleString() : '—'}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const w = row.original;
          if (w.status !== 'pending_approval')
            return <span className="text-[var(--admin-text-muted)] text-xs">—</span>;
          return (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <ActionButton
                  variant="primary"
                  icon={<Check className="w-3.5 h-3.5" />}
                  onClick={() => { setActionError(null); setConfirmApprove(w); }}
                  loading={actingId === w.id}
                  disabled={!canApprove || (actingId != null && actingId !== w.id)}
                  title={!canApprove ? 'You do not have permission to approve withdrawals' : undefined}
                >
                  Approve
                </ActionButton>
                <ActionButton
                  variant="danger"
                  icon={<X className="w-3.5 h-3.5" />}
                  onClick={() => { setActionError(null); setConfirmReject(w); }}
                  loading={actingId === w.id}
                  disabled={!canApprove || (actingId != null && actingId !== w.id)}
                  title={!canApprove ? 'You do not have permission to reject withdrawals' : undefined}
                >
                  Reject
                </ActionButton>
              </div>
              {actionError?.id === w.id && (
                <span className="text-xs text-[var(--admin-danger)]" role="alert">{actionError.message}</span>
              )}
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [actingId, actionError, canApprove]
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Withdrawals Command Center"
        subtitle="Approve moves to signing queue; Reject returns funds to user."
        action={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] px-2.5 py-1.5 text-xs text-[var(--admin-text)]"
            >
              <option value="all">All statuses</option>
              <option value="pending_approval">Pending approval</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ActionButton variant="secondary" onClick={() => refetch()} loading={isLoading}>
              Refresh
            </ActionButton>
          </div>
        }
      />

      {pendingApproval > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
          <strong>{pendingApproval} withdrawal{pendingApproval !== 1 ? 's' : ''}</strong> awaiting approval.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pending approval"
          value={pendingApproval}
          changeLabel="Awaiting action"
          icon={<Clock className="w-5 h-5" />}
          accent={pendingApproval > 0 ? 'warning' : 'neutral'}
        />
        <KPICard title="Signing" value={signing} changeLabel="in queue" icon={<Send className="w-5 h-5" />} accent="primary" />
        <KPICard title="Broadcasted" value={broadcasted} changeLabel="Completed" icon={<CheckCircle className="w-5 h-5" />} accent="success" />
        <KPICard title="Failed" value={failed} icon={<XCircle className="w-5 h-5" />} accent={failed > 0 ? 'danger' : 'neutral'} />
      </div>

      <DataTable<WithdrawalRow>
        data={withdrawals}
        columns={columns}
        rowCount={total}
        manualPagination
        manualSorting={false}
        pageSize={pageSize}
        pagination={{ pageIndex: page - 1, pageSize }}
        onPaginationChange={(updater) => {
          const next = updater({ pageIndex: page - 1, pageSize });
          setPage(next.pageIndex + 1);
          setPageSize(next.pageSize);
        }}
        showSearch={false}
        showExport
        exportFilename="admin-withdrawals"
        title="Withdrawals"
        subtitle={`${total} total`}
        emptyMessage="No withdrawals found"
        isLoading={isLoading}
        toolbarExtra={null}
      />

      {confirmApprove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="approve-withdrawal-title"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] shadow-xl">
            <div className="px-4 py-3 border-b border-[var(--admin-card-border)] flex items-center gap-2">
              <Check className="w-5 h-5 text-green-500 shrink-0" />
              <h2 id="approve-withdrawal-title" className="text-sm font-semibold text-[var(--admin-text)]">Approve withdrawal</h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-[var(--admin-text-muted)]">This will send the withdrawal to the signing queue.</p>
              <div className="rounded-lg bg-[var(--admin-input-bg)] p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--admin-text-muted)]">User</span>
                  <span className="text-[var(--admin-text)] truncate max-w-[200px]" title={confirmApprove.email}>{confirmApprove.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--admin-text-muted)]">Amount</span>
                  <span className="font-mono text-[var(--admin-text)] tabular-nums">{formatAmountAdmin(confirmApprove.amount)} {confirmApprove.currency_symbol}</span>
                </div>
              </div>
              {actionError?.id === confirmApprove.id && (
                <p className="text-xs text-[var(--admin-danger)]" role="alert">{actionError.message}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-[var(--admin-card-border)] flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmApprove(null); setActionError(null); }}>Cancel</ActionButton>
              <ActionButton variant="primary" icon={<Check className="w-3.5 h-3.5" />} loading={actingId === confirmApprove.id} disabled={actingId != null && actingId !== confirmApprove.id} onClick={() => handleApprove(confirmApprove.id)}>
                Approve & send to queue
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {confirmReject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-withdrawal-title"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] shadow-xl">
            <div className="px-4 py-3 border-b border-[var(--admin-card-border)] flex items-center gap-2">
              <X className="w-5 h-5 text-red-500 shrink-0" />
              <h2 id="reject-withdrawal-title" className="text-sm font-semibold text-[var(--admin-text)]">Reject withdrawal</h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-[var(--admin-text-muted)]">Locked funds will be returned to the user.</p>
              <div className="rounded-lg bg-[var(--admin-input-bg)] p-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--admin-text-muted)]">User</span>
                  <span className="text-[var(--admin-text)] truncate max-w-[200px]" title={confirmReject.email}>{confirmReject.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--admin-text-muted)]">Amount</span>
                  <span className="font-mono text-[var(--admin-text)] tabular-nums">{formatAmountAdmin(confirmReject.amount)} {confirmReject.currency_symbol}</span>
                </div>
              </div>
              {actionError?.id === confirmReject.id && (
                <p className="text-xs text-[var(--admin-danger)]" role="alert">{actionError.message}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-[var(--admin-card-border)] flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmReject(null); setActionError(null); }}>Back</ActionButton>
              <ActionButton variant="danger" loading={actingId === confirmReject.id} disabled={actingId != null && actingId !== confirmReject.id} onClick={() => handleReject(confirmReject.id)}>
                Reject withdrawal
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
