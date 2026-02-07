'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/admin/security/DataTable';
import { WithdrawalDetailDialog } from './withdrawal-detail-dialog';
import { toast } from '@/components/ui/toaster';
import { formatDateTime } from '@/lib/utils';
import {
  securityApi,
  type PendingWithdrawalItem,
} from '@/lib/securityApi';
import { cn } from '@/lib/utils';

const LIMIT = 50;
const ADDRESS_TRUNCATE_LEN = 6;

function truncateAddress(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length <= ADDRESS_TRUNCATE_LEN * 2 + 3) return addr;
  return `${addr.slice(0, ADDRESS_TRUNCATE_LEN)}…${addr.slice(-4)}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      {status.replace('_', ' ')}
    </span>
  );
}

export default function WithdrawalSecurityPage() {
  const queryClient = useQueryClient();
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<PendingWithdrawalItem | null>(null);
  const [approveOnOpen, setApproveOnOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectWithdrawal, setRejectWithdrawal] = useState<PendingWithdrawalItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'security', 'withdrawals', 'pending'],
    queryFn: () => securityApi.pendingWithdrawals({ limit: LIMIT, offset: 0 }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'withdrawals'] });

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      securityApi.approveWithdrawal(id, note),
    onSuccess: () => {
      toast({ title: 'Withdrawal approved', variant: 'success' });
      invalidate();
      setDetailOpen(false);
      setSelectedWithdrawal(null);
      setApproveOnOpen(false);
    },
    onError: (e) => {
      toast({
        title: 'Approval failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      securityApi.rejectWithdrawal(id, reason),
    onSuccess: () => {
      toast({ title: 'Withdrawal rejected', variant: 'success' });
      invalidate();
      setRejectDialogOpen(false);
      setRejectWithdrawal(null);
      setRejectReason('');
      setDetailOpen(false);
      setSelectedWithdrawal(null);
    },
    onError: (e) => {
      toast({
        title: 'Rejection failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const handleApprove = async (id: string, note?: string) => {
    await approveMutation.mutateAsync({ id, note });
  };

  const handleReject = async (id: string, reason: string) => {
    await rejectMutation.mutateAsync({ id, reason });
  };

  const handleRejectConfirm = async () => {
    const reason = rejectReason.trim();
    if (!reason || !rejectWithdrawal) return;
    await handleReject(rejectWithdrawal.id, reason);
  };

  const withdrawals = data?.withdrawals ?? [];
  const total = data?.total ?? 0;

  const columns = useMemo(
    () => [
      {
        id: 'created_at',
        header: 'Created at',
        cell: (row: PendingWithdrawalItem) => (
          <span className="text-slate-700 dark:text-slate-300">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        id: 'user_id',
        header: 'User ID',
        cell: (row: PendingWithdrawalItem) => (
          <span className="font-mono text-sm">{row.user_id}</span>
        ),
      },
      {
        id: 'asset',
        header: 'Asset',
        cell: (row: PendingWithdrawalItem) => (
          <span className="font-medium">{row.asset ?? '—'}</span>
        ),
      },
      {
        id: 'amount',
        header: 'Amount',
        cell: (row: PendingWithdrawalItem) => (
          <span className="tabular-nums">{row.amount}</span>
        ),
      },
      {
        id: 'to_address',
        header: 'Destination address',
        cell: (row: PendingWithdrawalItem) => (
          <span className="font-mono text-sm text-slate-600 dark:text-slate-400" title={row.to_address ?? ''}>
            {truncateAddress(row.to_address)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row: PendingWithdrawalItem) => <StatusBadge status={row.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        className: 'text-right',
        cell: (row: PendingWithdrawalItem) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setSelectedWithdrawal(row);
                setApproveOnOpen(false);
                setDetailOpen(true);
              }}
              title="View details"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400"
              onClick={() => {
                setSelectedWithdrawal(row);
                setApproveOnOpen(true);
                setDetailOpen(true);
              }}
              title="Approve (opens detail)"
            >
              <CheckCircle className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setRejectWithdrawal(row);
                setRejectReason('');
                setRejectDialogOpen(true);
              }}
              title="Reject"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Withdrawal Security
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Review withdrawals flagged by security controls
        </p>
      </header>

      {isError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error instanceof Error ? error.message : 'Failed to load pending withdrawals'}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          <span className="text-sm text-slate-500">Loading…</span>
        </div>
      ) : (
        <DataTable<PendingWithdrawalItem>
          columns={columns}
          data={withdrawals}
          keyExtractor={(row) => row.id}
          emptyMessage="No withdrawals pending security approval"
        />
      )}

      {!isLoading && withdrawals.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Showing {withdrawals.length} of {total} pending withdrawal{total !== 1 ? 's' : ''}
        </p>
      )}

      <WithdrawalDetailDialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedWithdrawal(null);
            setApproveOnOpen(false);
          }
        }}
        withdrawal={selectedWithdrawal}
        openApproveOnMount={approveOnOpen}
        onClearApproveOnMount={() => setApproveOnOpen(false)}
        onApprove={handleApprove}
        onReject={handleReject}
        approveLoading={approveMutation.isPending}
        rejectLoading={rejectMutation.isPending}
      />

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject withdrawal</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Provide a reason for rejection. This will be recorded and may be shown to the user.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm min-h-[100px]"
              placeholder="Enter rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialogOpen(false);
                setRejectWithdrawal(null);
                setRejectReason('');
              }}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleRejectConfirm}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Reject withdrawal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
