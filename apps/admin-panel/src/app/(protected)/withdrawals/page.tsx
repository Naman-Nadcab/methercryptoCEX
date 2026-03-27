'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getWithdrawalsList,
  approveWithdrawal,
  rejectWithdrawal,
  type WithdrawalRow,
} from '@/lib/withdrawals-api';
import { WithdrawalsTable } from '@/components/withdrawals/WithdrawalsTable';
import { ApproveWithdrawalModal } from '@/components/withdrawals/ApproveWithdrawalModal';
import { RejectWithdrawalModal } from '@/components/withdrawals/RejectWithdrawalModal';
import { useAdminWs } from '@/hooks/useAdminWs';

export default function WithdrawalsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [approveModal, setApproveModal] = useState<WithdrawalRow | null>(null);
  const [rejectModal, setRejectModal] = useState<WithdrawalRow | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'withdrawals', token, page, statusFilter],
    queryFn: () =>
      getWithdrawalsList(token, {
        page,
        limit: 20,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    enabled: !!token,
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
  const pagination = data?.data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Withdrawals</h1>
        <p className="mt-1 text-sm text-admin-muted">
          Review, approve, or reject user withdrawals. Large withdrawal alerts and risk flags from backend.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-admin-primary"
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

      <div className="rounded-[12px] bg-white p-6 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
        {isError && (
          <p className="mb-4 text-sm text-admin-danger">
            {(error as { message?: string })?.message ?? 'Failed to load withdrawals'}
          </p>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-admin-muted">Loading withdrawals…</div>
        ) : (
          <>
            <WithdrawalsTable
              rows={withdrawals}
              onApprove={(w) => setApproveModal(w)}
              onReject={(w) => setRejectModal(w)}
              canApproveReject={true}
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
                    className="rounded border border-admin-border bg-white px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-admin-border bg-white px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-gray-50"
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
