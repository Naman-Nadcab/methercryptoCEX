'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getWithdrawalsList,
  approveWithdrawal,
  rejectWithdrawal,
  type WithdrawalRow,
} from '@/lib/withdrawals-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { WithdrawalsTable } from '@/components/withdrawals/WithdrawalsTable';
import { ApproveWithdrawalModal } from '@/components/withdrawals/ApproveWithdrawalModal';
import { RejectWithdrawalModal } from '@/components/withdrawals/RejectWithdrawalModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import { ArrowUpFromLine, Clock, XCircle, CheckCircle2, DollarSign } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';

export default function WithdrawalsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    const s = searchParams.get('status');
    if (s) setStatusFilter(s);
  }, [searchParams]);
  const [approveModal, setApproveModal] = useState<WithdrawalRow | null>(null);
  const [rejectModal, setRejectModal] = useState<WithdrawalRow | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'withdrawals', token, page, statusFilter],
    staleTime: 30_000,
    queryFn: () =>
      getWithdrawalsList(token, {
        page,
        limit: 20,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['withdrawal_requested', 'withdrawal_approved', 'withdrawal_rejected'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      approveWithdrawal(token, id, { admin_note: adminNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      setApproveModal(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason, adminNote }: { id: string; reason: string; adminNote?: string }) =>
      rejectWithdrawal(token, id, { reason, admin_note: adminNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      setRejectModal(null);
    },
  });

  const handleApprove = useCallback(
    (adminNote: string) => {
      if (!approveModal) return;
      approveMutation.mutate({ id: approveModal.id, adminNote: adminNote || undefined });
    },
    [approveModal, approveMutation]
  );

  const handleReject = useCallback(
    (reason: string, adminNote?: string) => {
      if (!rejectModal) return;
      rejectMutation.mutate({ id: rejectModal.id, reason, adminNote });
    },
    [rejectModal, rejectMutation]
  );

  const withdrawals = (data?.data?.withdrawals ?? []) as WithdrawalRow[];
  const stats = data?.data?.stats as Record<string, number> | undefined;
  const pagination = data?.data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Withdrawals</h1>
        <p className="text-xs text-admin-muted mt-0.5">Review, approve, or reject user withdrawals.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Pending Approval"
          value={stats?.pending_approval ?? '0'}
          icon={Clock}
          iconBg="bg-admin-warning/10 text-admin-warning"
        />
        <StatCard
          title="Processing"
          value={stats?.processing ?? '0'}
          icon={ArrowUpFromLine}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
        <StatCard
          title="Completed (24h)"
          value={stats?.completed ?? '0'}
          icon={CheckCircle2}
          iconBg="bg-admin-success/10 text-admin-success"
        />
        <StatCard
          title="Failed"
          value={stats?.failed ?? '0'}
          icon={XCircle}
          iconBg="bg-admin-danger/10 text-admin-danger"
        />
        <StatCard
          title="Volume (24h)"
          value={
            stats?.volume_24h != null
              ? `$${Number(stats.volume_24h).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : '—'
          }
          icon={DollarSign}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
          <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-admin-border bg-white/[0.02] px-2.5 py-1.5 text-xs text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
        >
          <option value="all">All statuses</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="rounded-xl border border-admin-border bg-admin-card">
        {isError && (
          <p className="mb-4 text-sm text-admin-danger">
            {(error as { message?: string })?.message ?? 'Failed to load withdrawals'}
          </p>
        )}
        {isLoading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
          <>
            <WithdrawalsTable
              rows={withdrawals}
              onApprove={(w) => setApproveModal(w)}
              onReject={(w) => setRejectModal(w)}
            />
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-admin-border pt-4">
                <span className="text-sm text-admin-muted">
                  Page {page} of {totalPages} · {total} total
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded border border-admin-border bg-admin-card px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-white/5"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-admin-border bg-admin-card px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-white/5"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ApproveWithdrawalModal
        open={!!approveModal}
        onClose={() => setApproveModal(null)}
        onConfirm={handleApprove}
        withdrawalId={approveModal?.id ?? ''}
        asset={approveModal?.currency_symbol}
        amount={approveModal?.amount}
        isLoading={approveMutation.isPending}
      />

      <RejectWithdrawalModal
        open={!!rejectModal}
        onClose={() => setRejectModal(null)}
        onConfirm={handleReject}
        withdrawalId={rejectModal?.id ?? ''}
        asset={rejectModal?.currency_symbol}
        amount={rejectModal?.amount}
        isLoading={rejectMutation.isPending}
      />
    </div>
  );
}
