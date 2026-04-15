'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import {
  CheckSquare, Clock, ShieldCheck, AlertTriangle,
  RefreshCw, Check, X, Info,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

/* ── types ────────────────────────────────────────────────────────── */
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

/* ── constants ────────────────────────────────────────────────────── */
const ACTION_TYPE_LABELS: Record<string, string> = {
  withdrawal_approve:       'Withdrawal Approval',
  manual_credit:            'Manual Credit',
  trading_halt:             'Trading Halt',
  settlement_circuit_reset: 'Settlement Circuit Reset',
  system_config_change:     'System Config Change',
  admin_role_change:        'Admin Role Change',
};

/* ── helpers ──────────────────────────────────────────────────────── */
function fmtRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch { return iso; }
}
function fmtFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

/* ── status pill ──────────────────────────────────────────────────── */
function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
      status === 'pending'  && 'border-amber-500/30  bg-amber-950/20  text-amber-300',
      status === 'approved' && 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300',
      status === 'rejected' && 'border-red-500/30    bg-red-950/20    text-red-300',
      status === 'expired'  && 'border-admin-border/50 bg-white/[0.04] text-admin-muted',
    )}>
      {status}
    </span>
  );
}

/* ── progress bar ─────────────────────────────────────────────────── */
function ApprovalProgress({ current, required }: { current: number; required: number }) {
  const pct = Math.min(100, (current / Math.max(required, 1)) * 100);
  const met = current >= required;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={cn('h-full rounded-full transition-all', met ? 'bg-emerald-500' : 'bg-blue-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs font-semibold tabular-nums', met ? 'text-emerald-400' : 'text-admin-muted')}>
        {current}/{required}
      </span>
    </div>
  );
}

/* ── action type badge ────────────────────────────────────────────── */
function ActionTypeBadge({ type }: { type: string }) {
  const label = ACTION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
  const isHigh = type === 'trading_halt' || type === 'system_config_change' || type === 'admin_role_change';
  return (
    <div className="flex items-center gap-1.5">
      {isHigh && <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />}
      <span className="text-sm font-medium text-admin-text capitalize">{label}</span>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function ApprovalsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();

  const [tab,         setTab]         = useState<TabId>('pending');
  const [actionModal, setActionModal] = useState<{ request: ApprovalRequest; type: 'approve' | 'reject' } | null>(null);
  const [reason,      setReason]      = useState('');

  const statusParam = tab === 'pending' ? 'pending' : undefined;

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'approval-requests', token, statusParam],
    staleTime: 30_000,
    queryFn: () => adminFetch<{ requests: ApprovalRequest[]; total: number }>('/approval-requests', {
      token,
      params: { status: statusParam, limit: 100 },
    }),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      adminFetch<{ message: string }>(`/approval-requests/${id}/approve`, { method: 'POST', token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      setActionModal(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason: r }: { id: string; reason: string }) =>
      adminFetch<{ message: string }>(`/approval-requests/${id}/reject`, {
        method: 'POST', token, body: { reason: r },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      setActionModal(null);
      setReason('');
    },
  });

  const allRequests   = data?.data?.requests ?? [];
  const requests      = tab === 'completed' ? allRequests.filter((r) => r.status !== 'pending') : allRequests;
  const pendingCount  = tab === 'pending' ? allRequests.length : allRequests.filter((r) => r.status === 'pending').length;

  const handleConfirm = () => {
    if (!actionModal) return;
    if (actionModal.type === 'approve') approveMutation.mutate(actionModal.request.id);
    else rejectMutation.mutate({ id: actionModal.request.id, reason });
  };

  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  return (
    <AdminPageFrame
      title="Approvals"
      description="Multi-admin approval workflow for sensitive and high-impact operations."
      quickActions={
        <>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-950/10 px-2.5 py-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-amber-400">{pendingCount} pending</span>
            </div>
          )}
          <button
            type="button" onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
        </>
      }
    >

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-admin-border/50 bg-white/[0.02] p-1 w-fit">
        {[
          { id: 'pending' as TabId,   label: 'Pending',             icon: Clock },
          { id: 'completed' as TabId, label: 'Completed / Rejected', icon: CheckSquare },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id} type="button" onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
              tab === id
                ? 'bg-admin-card border border-admin-border/50 text-admin-text shadow-sm'
                : 'text-admin-muted hover:text-admin-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === 'pending' && pendingCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-black">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Error ───────────────────────────────────────────────────── */}
      {isError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-950/10 p-4">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">Failed to load approval requests.</p>
          <button type="button" onClick={() => refetch()}
            className="ml-auto rounded-lg border border-red-500/25 bg-red-950/15 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/25">
            Retry
          </button>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-admin-muted" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-admin-muted">
            <ShieldCheck className="h-10 w-10 mb-3 opacity-15" />
            <p className="text-sm font-semibold">
              No {tab === 'pending' ? 'pending' : 'completed'} approval requests
            </p>
            <p className="text-xs mt-1 opacity-60">
              {tab === 'pending'
                ? 'All caught up — no actions are waiting for approval.'
                : 'Completed and rejected requests will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border/50 bg-white/[0.015]">
                  {['Action', 'Requester', 'Status', 'Approvals', 'Created', 'Expires',
                    tab === 'pending' ? 'Actions' : 'Outcome',
                  ].map((h) => (
                    <th key={h} className={cn(
                      'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-admin-muted',
                      h === 'Actions' || h === 'Outcome' ? 'text-right' : 'text-left',
                    )}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border/30">
                {requests.map((req) => {
                  const isOwnRequest = admin?.id === req.requested_by;
                  const expired = req.status === 'pending' && isExpired(req.expires_at);

                  return (
                    <tr key={req.id} className={cn(
                      'transition-colors hover:bg-white/[0.025]',
                      req.status === 'pending' && !expired && 'bg-amber-950/[0.04]',
                    )}>
                      {/* Action */}
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <ActionTypeBadge type={req.action_type} />
                      </td>

                      {/* Requester */}
                      <td className="px-4 py-3.5">
                        <div className="text-sm text-admin-text">{req.requester_name ?? '—'}</div>
                        <div className="text-xs text-admin-muted">{req.requester_email ?? ''}</div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusPill status={expired ? 'expired' : req.status} />
                      </td>

                      {/* Progress */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <ApprovalProgress current={req.current_approvals} required={req.required_approvals} />
                      </td>

                      {/* Created */}
                      <td className="px-4 py-3.5 whitespace-nowrap" title={fmtFull(req.created_at)}>
                        <span className="text-sm text-admin-text">{fmtRelative(req.created_at)}</span>
                      </td>

                      {/* Expires */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={cn('text-sm', expired ? 'text-red-400' : 'text-admin-muted')}>
                          {expired ? 'Expired' : fmtRelative(req.expires_at)}
                        </span>
                        <span className="block text-xs text-admin-muted/60">{fmtFull(req.expires_at)}</span>
                      </td>

                      {/* Pending actions */}
                      {tab === 'pending' && (
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {expired ? (
                              <span className="text-xs text-admin-muted italic">Expired</span>
                            ) : (
                              <>
                                <ProtectedAction permission="all" fallback="hidden">
                                  <button
                                    type="button"
                                    disabled={isOwnRequest}
                                    title={isOwnRequest ? 'Cannot approve your own request' : 'Approve'}
                                    onClick={() => setActionModal({ request: req, type: 'approve' })}
                                    className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-950/35 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                  >
                                    <Check className="h-3.5 w-3.5" /> Approve
                                  </button>
                                </ProtectedAction>
                                <ProtectedAction permission="all" fallback="hidden">
                                  <button
                                    type="button"
                                    onClick={() => setActionModal({ request: req, type: 'reject' })}
                                    className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-950/20 px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-950/35 transition-colors"
                                  >
                                    <X className="h-3.5 w-3.5" /> Reject
                                  </button>
                                </ProtectedAction>
                              </>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Completed tab: outcome */}
                      {tab === 'completed' && (
                        <td className="px-4 py-3.5 max-w-[200px] text-right">
                          {req.rejection_reason ? (
                            <span className="text-xs text-admin-muted truncate block" title={req.rejection_reason}>
                              {req.rejection_reason}
                            </span>
                          ) : (
                            <span className="text-xs text-admin-muted/40">—</span>
                          )}
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

      {/* ── Approve / Reject modal ────────────────────────────────────── */}
      <Modal
        open={!!actionModal}
        onClose={() => { setActionModal(null); setReason(''); }}
        size="sm"
        title={actionModal?.type === 'approve' ? 'Confirm Approval' : 'Reject Request'}
        description={
          actionModal
            ? `${ACTION_TYPE_LABELS[actionModal.request.action_type] ?? actionModal.request.action_type} · requested by ${actionModal.request.requester_name ?? 'Unknown'}`
            : ''
        }
      >
        {actionModal?.type === 'reject' && (
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-semibold text-admin-text">Rejection reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this request is being rejected…"
              rows={3}
              className="w-full rounded-xl border border-admin-border/60 bg-white/[0.04] px-3 py-2.5 text-sm text-admin-text placeholder:text-admin-muted/40 focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/40 transition-colors"
            />
          </div>
        )}

        {actionModal?.type === 'approve' && (
          <div className="flex gap-2.5 rounded-xl border border-blue-500/20 bg-blue-950/10 p-3.5 mb-3">
            <Info className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
            <p className="text-xs text-blue-300/80">
              This will add your approval to the request. If the threshold is met, the action will be executed automatically.
            </p>
          </div>
        )}

        {(approveMutation.isError || rejectMutation.isError) && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-950/10 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <p className="text-xs text-red-300">Action failed. Please try again.</p>
          </div>
        )}

        <ModalFooter className="px-0 border-0 mt-2 pt-0">
          <button
            type="button"
            disabled={isMutating}
            onClick={() => { setActionModal(null); setReason(''); }}
            className="rounded-xl border border-admin-border/50 bg-white/[0.02] px-4 py-2 text-sm font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isMutating || (actionModal?.type === 'reject' && !reason.trim())}
            onClick={handleConfirm}
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all disabled:opacity-40',
              actionModal?.type === 'approve'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-red-600 hover:bg-red-500 text-white',
            )}
          >
            {isMutating
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Processing…</>
              : actionModal?.type === 'approve'
                ? <><Check className="h-4 w-4" /> Approve</>
                : <><X className="h-4 w-4" /> Reject</>}
          </button>
        </ModalFooter>
      </Modal>
    </AdminPageFrame>
  );
}
