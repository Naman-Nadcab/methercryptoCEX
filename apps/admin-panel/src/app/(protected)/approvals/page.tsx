'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { exportStandardCsv, exportStandardJson, type StandardExportRow } from '@/lib/export-utils';
import { Modal } from '@/components/ui/Modal';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import {
  CheckSquare, Clock, ShieldCheck, AlertTriangle,
  RefreshCw, Check, X, Info, Download, ShieldAlert,
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
  action_executed?: boolean;
  approver_details?: Array<{ id: string; name: string; email: string; role: string }>;
}

type TabId = 'pending' | 'completed';
const APPROVALS_PAGE_SIZE = 20;

/* ── constants ────────────────────────────────────────────────────── */
const ACTION_TYPE_LABELS: Record<string, string> = {
  withdrawal_approve:       'Withdrawal Approval',
  manual_credit:            'Manual Credit',
  trading_halt:             'Trading Halt',
  global_control_action:    'Global Control Action',
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

function summarizePayload(payload: Record<string, unknown>): string {
  const action = typeof payload.action === 'string' ? payload.action : null;
  const market = typeof payload.market === 'string' ? payload.market : null;
  const reason = typeof payload.reason === 'string' ? payload.reason : null;
  if (action && market) return `${action} (${market})`;
  if (action) return action;
  if (reason) return reason.slice(0, 56);
  const keys = Object.keys(payload);
  if (!keys.length) return 'No payload';
  return keys.slice(0, 3).join(', ');
}

function toForensicsExportRows(bundle: Record<string, unknown>): StandardExportRow[] {
  const request = (bundle.request ?? {}) as Record<string, unknown>;
  const requestId = String(request.id ?? 'unknown');
  const actionType = String(request.action_type ?? 'unknown');
  const auditEntries = Array.isArray(bundle.audit_entries) ? (bundle.audit_entries as Array<Record<string, unknown>>) : [];
  const rows: StandardExportRow[] = [
    {
      timestamp: new Date().toISOString(),
      type: 'approval_request',
      service: 'admin_approval',
      admin: String(request.requested_by ?? 'unknown'),
      details: JSON.stringify({ request_id: requestId, action_type: actionType }),
    },
  ];
  for (const e of auditEntries) {
    rows.push({
      timestamp: String(e.created_at ?? new Date().toISOString()),
      type: String(e.action ?? 'audit_entry'),
      service: 'audit_logs',
      admin: String((e.details as Record<string, unknown> | null)?.actor_id ?? 'unknown'),
      details: JSON.stringify(e),
    });
  }
  return rows;
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
  const [page, setPage] = useState(1);
  const [actionModal, setActionModal] = useState<{ request: ApprovalRequest; type: 'approve' | 'reject' } | null>(null);
  const [detailRequest, setDetailRequest] = useState<ApprovalRequest | null>(null);
  const [retryReason, setRetryReason] = useState('');
  const [bgReason, setBgReason] = useState('');
  const [bgTicketId, setBgTicketId] = useState('');
  const [breakGlassAuthOpen, setBreakGlassAuthOpen] = useState(false);

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

  const detailImpactQ = useQuery({
    queryKey: ['admin', 'approval-impact-preview', token, detailRequest?.id],
    queryFn: () =>
      adminFetch<Record<string, unknown>>(`/approval-requests/${encodeURIComponent(detailRequest!.id)}/impact-preview`, {
        token,
      }),
    enabled: !!token && !!detailRequest?.id,
    staleTime: 15_000,
  });

  const detailForensicsQ = useQuery({
    queryKey: ['admin', 'approval-forensics', token, detailRequest?.id],
    queryFn: () =>
      adminFetch<Record<string, unknown>>(`/approval-requests/${encodeURIComponent(detailRequest!.id)}/forensics`, {
        token,
      }),
    enabled: !!token && !!detailRequest?.id,
    staleTime: 20_000,
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
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ id, reason: retryReasonValue }: { id: string; reason: string }) =>
      adminFetch<{ retried: boolean }>(`/approval-requests/${id}/retry-execution`, {
        method: 'POST',
        token,
        body: { reason: retryReasonValue },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      void detailImpactQ.refetch();
      void detailForensicsQ.refetch();
      setRetryReason('');
    },
  });

  const breakGlassMutation = useMutation({
    mutationFn: ({ id, reason: bgReasonValue, ticketId }: { id: string; reason: string; ticketId: string }) =>
      adminFetch<{ executed_via_break_glass: boolean }>(`/approval-requests/${id}/break-glass-execute`, {
        method: 'POST',
        token,
        body: { reason: bgReasonValue, ticket_id: ticketId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      void detailImpactQ.refetch();
      void detailForensicsQ.refetch();
      setBgReason('');
      setBgTicketId('');
    },
  });

  const allRequests   = data?.data?.requests ?? [];
  const requests      = tab === 'completed' ? allRequests.filter((r) => r.status !== 'pending') : allRequests;
  const totalPages = Math.max(1, Math.ceil(requests.length / APPROVALS_PAGE_SIZE));
  const pagedRequests = requests.slice((page - 1) * APPROVALS_PAGE_SIZE, page * APPROVALS_PAGE_SIZE);
  const pendingCount  = tab === 'pending' ? allRequests.length : allRequests.filter((r) => r.status === 'pending').length;

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
            key={id} type="button" onClick={() => { setTab(id); setPage(1); }}
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
                  {['Action', 'Payload', 'Requester', 'Status', 'Approvals', 'Created', 'Expires',
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
                {pagedRequests.map((req) => {
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

                      {/* Payload summary */}
                      <td className="px-4 py-3.5 max-w-[260px]">
                        <span className="text-xs text-admin-muted" title={JSON.stringify(req.action_payload ?? {})}>
                          {summarizePayload(req.action_payload ?? {})}
                        </span>
                      </td>

                      {/* Requester */}
                      <td className="px-4 py-3.5">
                        <div className="text-sm text-admin-text">{req.requester_name ?? '—'}</div>
                        <div className="text-xs text-admin-muted">{req.requester_email ?? ''}</div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusBadge status={expired ? 'expired' : req.status} />
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
                                <button
                                  type="button"
                                  onClick={() => setDetailRequest(req)}
                                  className="rounded-lg border border-admin-border/60 px-2.5 py-1.5 text-xs font-semibold text-admin-muted hover:text-admin-text"
                                >
                                  View
                                </button>
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
                          ) : req.status === 'approved' ? (
                            <span className={cn('text-xs font-semibold', req.action_executed ? 'text-emerald-400' : 'text-amber-300')}>
                              {req.action_executed ? 'Executed' : 'Approved (pending execution)'}
                            </span>
                          ) : (
                            <span className="text-xs text-admin-muted/40">—</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailRequest(req)}
                            className="mt-1 ml-auto block rounded-lg border border-admin-border/60 px-2 py-1 text-[11px] font-semibold text-admin-muted hover:text-admin-text"
                          >
                            View
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && requests.length > APPROVALS_PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-4 py-3 text-xs text-admin-muted">
            <span>
              {((page - 1) * APPROVALS_PAGE_SIZE) + 1}-{Math.min(page * APPROVALS_PAGE_SIZE, requests.length)} of {requests.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-admin-border/50 px-2 py-1 disabled:opacity-40 hover:text-admin-text"
              >
                Prev
              </button>
              <span>Page {page}/{totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-admin-border/50 px-2 py-1 disabled:opacity-40 hover:text-admin-text"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <ActionAuthModal
        open={!!actionModal}
        onClose={() => setActionModal(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!actionModal) return;
          if (actionModal.type === 'approve') {
            approveMutation.mutate(actionModal.request.id);
          } else {
            rejectMutation.mutate({ id: actionModal.request.id, reason: payload.reason });
          }
        }}
        title={actionModal?.type === 'approve' ? 'Authorize approval action' : 'Authorize rejection action'}
        actionLabel={
          actionModal
            ? `${ACTION_TYPE_LABELS[actionModal.request.action_type] ?? actionModal.request.action_type} · requested by ${actionModal.request.requester_name ?? 'Unknown'}`
            : 'Approval action'
        }
        description={
          actionModal?.type === 'approve'
            ? 'This adds your approval vote and may execute the action if threshold is met.'
            : 'This rejects the request and records your decision for audit.'
        }
        requireReason
        twofaRequired
        confirmationPhrase={actionModal?.type === 'approve' ? 'CONFIRM APPROVAL' : 'CONFIRM REJECTION'}
        externalError={approveMutation.error instanceof Error ? approveMutation.error.message : rejectMutation.error instanceof Error ? rejectMutation.error.message : null}
        isPending={isMutating}
        confirmLabel={isMutating ? 'Processing…' : actionModal?.type === 'approve' ? 'Approve request' : 'Reject request'}
        confirmVariant={actionModal?.type === 'approve' ? 'primary' : 'danger'}
      />

      <Modal
        open={!!detailRequest}
        onClose={() => setDetailRequest(null)}
        size="lg"
        title="Approval Request Details"
        description={detailRequest ? `${ACTION_TYPE_LABELS[detailRequest.action_type] ?? detailRequest.action_type} · ${detailRequest.id}` : ''}
      >
        {detailRequest ? (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-admin-border/60 p-2">
                <p className="text-admin-muted">Status</p>
                <p className="font-semibold text-admin-text">{detailRequest.status}</p>
              </div>
              <div className="rounded-lg border border-admin-border/60 p-2">
                <p className="text-admin-muted">Approvals</p>
                <p className="font-semibold text-admin-text">{detailRequest.current_approvals}/{detailRequest.required_approvals}</p>
              </div>
            </div>
            <div className="rounded-lg border border-admin-border/60 p-2">
              <p className="text-admin-muted mb-1">Approvers</p>
              {detailRequest.approver_details && detailRequest.approver_details.length > 0 ? (
                <div className="space-y-1">
                  {detailRequest.approver_details.map((a) => (
                    <p key={a.id} className="text-admin-text">
                      {a.name} ({a.role}) - {a.email}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-admin-text break-all">{(detailRequest.approved_by ?? []).join(', ') || 'None yet'}</p>
              )}
            </div>
            <div className="rounded-lg border border-admin-border/60 p-2">
              <p className="text-admin-muted mb-1">Action payload</p>
              <pre className="max-h-56 overflow-auto rounded border border-admin-border/40 bg-white/[0.02] p-2 text-[10px] text-admin-muted">
                {JSON.stringify(detailRequest.action_payload ?? {}, null, 2)}
              </pre>
            </div>
            <div className="rounded-lg border border-admin-border/60 p-2">
              <p className="text-admin-muted mb-1">Impact preview</p>
              {detailImpactQ.isLoading ? (
                <p className="text-admin-muted">Loading preview...</p>
              ) : detailImpactQ.isError ? (
                <p className="text-red-400">Failed to load impact preview.</p>
              ) : (
                <pre className="max-h-56 overflow-auto rounded border border-admin-border/40 bg-white/[0.02] p-2 text-[10px] text-admin-muted">
                  {JSON.stringify(detailImpactQ.data?.data ?? {}, null, 2)}
                </pre>
              )}
            </div>
            <div className="rounded-lg border border-admin-border/60 p-2">
              <p className="text-admin-muted mb-1">Forensics bundle</p>
              {detailForensicsQ.isLoading ? (
                <p className="text-admin-muted">Loading forensics...</p>
              ) : detailForensicsQ.isError ? (
                <p className="text-red-400">Failed to load forensics bundle.</p>
              ) : (
                <pre className="max-h-56 overflow-auto rounded border border-admin-border/40 bg-white/[0.02] p-2 text-[10px] text-admin-muted">
                  {JSON.stringify(detailForensicsQ.data?.data ?? {}, null, 2)}
                </pre>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!detailForensicsQ.data?.data}
                onClick={() => {
                  if (!detailForensicsQ.data?.data || !detailRequest) return;
                  const rows = toForensicsExportRows(detailForensicsQ.data.data as Record<string, unknown>);
                  exportStandardJson(rows, `approval-forensics-${detailRequest.id}`);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-admin-border/60 px-2 py-1 text-[11px] font-semibold text-admin-muted hover:text-admin-text disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" /> Export JSON
              </button>
              <button
                type="button"
                disabled={!detailForensicsQ.data?.data}
                onClick={() => {
                  if (!detailForensicsQ.data?.data || !detailRequest) return;
                  const rows = toForensicsExportRows(detailForensicsQ.data.data as Record<string, unknown>);
                  exportStandardCsv(rows, `approval-forensics-${detailRequest.id}`);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-admin-border/60 px-2 py-1 text-[11px] font-semibold text-admin-muted hover:text-admin-text disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
            </div>
            {detailRequest.status === 'approved' && detailRequest.action_executed !== true ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/15 p-2 space-y-2">
                <p className="text-[11px] font-semibold text-amber-300">Execution controls</p>
                <div className="flex gap-2">
                  <input
                    value={retryReason}
                    onChange={(e) => setRetryReason(e.target.value)}
                    placeholder="Retry reason (required)"
                    className="flex-1 rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
                  />
                  <button
                    type="button"
                    onClick={() => detailRequest && retryMutation.mutate({ id: detailRequest.id, reason: retryReason })}
                    disabled={retryMutation.isPending || retryReason.trim().length < 8}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300 disabled:opacity-40"
                  >
                    Retry Execution
                  </button>
                </div>
                <div className="flex flex-col gap-2 border-t border-amber-500/20 pt-2">
                  <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-300">
                    <ShieldAlert className="h-3.5 w-3.5" /> Break-glass override
                  </p>
                  <input
                    value={bgTicketId}
                    onChange={(e) => setBgTicketId(e.target.value)}
                    placeholder="Incident ticket id"
                    className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
                  />
                  <input
                    value={bgReason}
                    onChange={(e) => setBgReason(e.target.value)}
                    placeholder="Break-glass reason"
                    className="rounded-lg border border-admin-border bg-admin-surface px-2 py-1.5 text-xs text-admin-text"
                  />
                  <button
                    type="button"
                    onClick={() => setBreakGlassAuthOpen(true)}
                    disabled={breakGlassMutation.isPending || bgReason.trim().length < 8 || bgTicketId.trim().length < 4}
                    className="rounded-lg border border-red-500/40 bg-red-950/40 px-2 py-1 text-[11px] font-semibold text-red-300 disabled:opacity-40"
                  >
                    Break-Glass Execute
                  </button>
                </div>
                {(retryMutation.isError || breakGlassMutation.isError) ? (
                  <p className="text-[11px] text-red-300">Operation failed. Check permissions/session and retry.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <ActionAuthModal
        open={breakGlassAuthOpen}
        onClose={() => setBreakGlassAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (detailRequest) {
            breakGlassMutation.mutate({ id: detailRequest.id, reason: bgReason, ticketId: bgTicketId });
          }
          void payload;
          setBreakGlassAuthOpen(false);
        }}
        title="Authorize break-glass execution"
        actionLabel={detailRequest ? `Break-glass execute request ${detailRequest.id}` : 'Break-glass execution'}
        description="Break-glass bypasses normal execution controls and requires step-up authentication."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM BREAK_GLASS"
        externalError={breakGlassMutation.error instanceof Error ? breakGlassMutation.error.message : null}
        isPending={breakGlassMutation.isPending}
        confirmLabel={breakGlassMutation.isPending ? 'Executing…' : 'Execute break-glass'}
        confirmVariant="danger"
      />
    </AdminPageFrame>
  );
}
