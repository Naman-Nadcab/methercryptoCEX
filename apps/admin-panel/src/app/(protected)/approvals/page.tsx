'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { CheckSquare, Clock, XCircle, ShieldCheck, AlertTriangle } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';

interface ApprovalRequest {
  id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  required_approvals: number;
  current_approvals: number;
  approved_by: string[] | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  expires_at: string;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  requester_name?: string;
  requester_email?: string;
}

type TabId = 'pending' | 'completed';

const TAB_ITEMS: TabItem<TabId>[] = [
  { id: 'pending', label: 'Pending', icon: <Clock className="h-3.5 w-3.5" /> },
  { id: 'completed', label: 'Completed / Rejected', icon: <CheckSquare className="h-3.5 w-3.5" /> },
];

const ACTION_TYPE_LABELS: Record<string, string> = {
  withdrawal_approve: 'Withdrawal Approval',
  manual_credit: 'Manual Credit',
  trading_halt: 'Trading Halt',
  settlement_circuit_reset: 'Settlement Circuit Reset',
  system_config_change: 'System Config Change',
  admin_role_change: 'Admin Role Change',
};

const STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  pending:  { variant: 'warning', label: 'Pending' },
  approved: { variant: 'success', label: 'Approved' },
  rejected: { variant: 'danger',  label: 'Rejected' },
  expired:  { variant: 'default', label: 'Expired' },
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ApprovalsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabId>('pending');
  const [actionModal, setActionModal] = useState<{ request: ApprovalRequest; type: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');

  const statusParam = tab === 'pending' ? 'pending' : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'approval-requests', token, statusParam],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ requests: ApprovalRequest[]; total: number }>('/approval-requests', {
        token,
        params: { status: statusParam, limit: 100 },
      }),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ message: string }>(`/approval-requests/${id}/approve`, {
        method: 'POST',
        token,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      setActionModal(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason: r }: { id: string; reason: string }) =>
      adminFetch<{ message: string }>(`/approval-requests/${id}/reject`, {
        method: 'POST',
        token,
        body: { reason: r },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      setActionModal(null);
      setReason('');
    },
  });

  const allRequests = data?.data?.requests ?? [];
  const requests = tab === 'completed'
    ? allRequests.filter((r) => r.status !== 'pending')
    : allRequests;

  const pendingCount = tab === 'pending'
    ? allRequests.length
    : undefined;

  const handleConfirm = () => {
    if (!actionModal) return;
    if (actionModal.type === 'approve') {
      approveMutation.mutate(actionModal.request.id);
    } else {
      rejectMutation.mutate({ id: actionModal.request.id, reason });
    }
  };

  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Approvals</h1>
        <p className="text-xs text-admin-muted mt-0.5">
          Multi-admin approval workflow for sensitive operations.
        </p>
      </div>

      <Tabs
        items={TAB_ITEMS.map((t) =>
          t.id === 'pending' && pendingCount != null
            ? { ...t, badge: pendingCount }
            : t
        )}
        active={tab}
        onChange={setTab}
        size="sm"
      />

      <div className="rounded-xl border border-admin-border bg-admin-card">
        {isError && (
          <div className="px-4 py-3 text-sm text-admin-danger flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Failed to load approval requests.
          </div>
        )}

        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-admin-muted">
            <ShieldCheck className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm font-medium">No {tab === 'pending' ? 'pending' : 'completed'} approval requests</p>
            <p className="text-xs mt-0.5 opacity-70">
              {tab === 'pending'
                ? 'All caught up — no actions waiting for approval.'
                : 'Completed and rejected requests will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-admin-border text-[11px] font-semibold uppercase tracking-wider text-admin-muted">
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Expires</th>
                  {tab === 'pending' && <th className="px-4 py-3 text-right">Actions</th>}
                  {tab === 'completed' && <th className="px-4 py-3">Reason</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border">
                {requests.map((req) => {
                  const badge = STATUS_BADGE[req.status] ?? STATUS_BADGE.pending;
                  const isOwnRequest = admin?.id === req.requested_by;

                  return (
                    <tr key={req.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-admin-text text-xs">
                          {ACTION_TYPE_LABELS[req.action_type] ?? req.action_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-admin-text">{req.requester_name ?? '—'}</div>
                        <div className="text-[11px] text-admin-muted">{req.requester_email ?? ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-admin-primary transition-all"
                              style={{
                                width: `${Math.min(100, (req.current_approvals / req.required_approvals) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-admin-muted">
                            {req.current_approvals}/{req.required_approvals}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap">
                        {formatDate(req.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap">
                        {formatDate(req.expires_at)}
                      </td>
                      {tab === 'pending' && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <ProtectedAction permission="all" fallback="hidden">
                              <Button
                                size="xs"
                                variant="success"
                                disabled={isOwnRequest}
                                title={isOwnRequest ? 'Cannot approve your own request' : 'Approve'}
                                onClick={() => setActionModal({ request: req, type: 'approve' })}
                              >
                                Approve
                              </Button>
                            </ProtectedAction>
                            <ProtectedAction permission="all" fallback="hidden">
                              <Button
                                size="xs"
                                variant="danger"
                                onClick={() => setActionModal({ request: req, type: 'reject' })}
                              >
                                Reject
                              </Button>
                            </ProtectedAction>
                          </div>
                        </td>
                      )}
                      {tab === 'completed' && (
                        <td className="px-4 py-3 text-xs text-admin-muted max-w-[200px] truncate">
                          {req.rejection_reason ?? '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approve / Reject Modal */}
      <Modal
        open={!!actionModal}
        onClose={() => { setActionModal(null); setReason(''); }}
        size="sm"
        title={actionModal?.type === 'approve' ? 'Confirm Approval' : 'Reject Request'}
        description={
          actionModal
            ? `${ACTION_TYPE_LABELS[actionModal.request.action_type] ?? actionModal.request.action_type} requested by ${actionModal.request.requester_name ?? 'Unknown'}`
            : ''
        }
      >
        {actionModal?.type === 'reject' && (
          <div className="mb-2">
            <label className="block text-xs font-medium text-admin-text mb-1">Rejection reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this request is being rejected…"
              rows={3}
              className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted/40 focus:outline-none focus:ring-2 focus:ring-admin-primary/30 focus:border-admin-primary"
            />
          </div>
        )}

        {actionModal?.type === 'approve' && (
          <p className="text-sm text-admin-muted">
            This will add your approval to the request. If the threshold is met, the action will be executed automatically.
          </p>
        )}

        {(approveMutation.isError || rejectMutation.isError) && (
          <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">
            Action failed. Please try again.
          </div>
        )}

        <ModalFooter className="px-0 border-0 mt-4 pt-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setActionModal(null); setReason(''); }}
            disabled={isMutating}
          >
            Cancel
          </Button>
          <Button
            variant={actionModal?.type === 'approve' ? 'success' : 'danger'}
            size="sm"
            loading={isMutating}
            onClick={handleConfirm}
            disabled={actionModal?.type === 'reject' && !reason.trim()}
          >
            {actionModal?.type === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
