'use client';

import { useState, useMemo, useDeferredValue, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Search } from 'lucide-react';
import { getKycList, getKycPending, reviewKyc, getDashboardStats } from '@/lib/admin';
import { useAdminAuthStore } from '@/store/auth';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Input,
  Modal,
  ModalFooter,
  Textarea,
  TableSkeleton,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { useAdminWs } from '@/hooks/useAdminWs';

const PAGE_SIZE = 20;
const REFETCH_MS = 30000;

type StatusTab = 'all' | 'pending' | 'approved' | 'rejected';

type KycApplicationRow = {
  id: string;
  user_id: string;
  email?: string | null;
  username?: string | null;
  kyc_level?: number | null;
  document_type?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  legal_first_name?: string | null;
  legal_last_name?: string | null;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function formatUserLabel(row: KycApplicationRow): string {
  const name = [row.legal_first_name, row.legal_last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (row.username) return row.username;
  return `${String(row.user_id).slice(0, 8)}…`;
}

function formatSubmitted(row: KycApplicationRow): string {
  const raw = row.submitted_at || row.created_at;
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtDocType(t: string | null | undefined): string {
  if (!t) return '—';
  return String(t).replace(/_/g, ' ');
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'pending':
      return 'warning';
    case 'under_review':
      return 'info';
    default:
      return 'default';
  }
}

function listTotal(stats: Record<string, unknown> | undefined, tab: StatusTab): number {
  if (!stats) return 0;
  if (tab === 'all') return n(stats.total);
  return n(stats[tab]);
}

const TABS: { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

export default function KycManagementPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['kyc_submitted', 'kyc_approved', 'kyc_rejected'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'kyc-list'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'kyc-pending'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'kyc-dashboard-stats'] });
      }
    },
  });
  const [page, setPage] = useState(1);
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const [rejectRow, setRejectRow] = useState<KycApplicationRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [statusTab, searchInput]);

  const { data: dashRes } = useQuery({
    queryKey: ['admin', 'kyc-dashboard-stats', token],
    staleTime: 30_000,
    queryFn: () => getDashboardStats(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const { data: pendingRes } = useQuery({
    queryKey: ['admin', 'kyc-pending', token],
    staleTime: 30_000,
    queryFn: () => getKycPending(token, { limit: 1000 }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const {
    data: listRes,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'kyc-list', token, page, statusTab],
    staleTime: 30_000,
    queryFn: () =>
      getKycList(token, {
        page,
        limit: PAGE_SIZE,
        ...(statusTab !== 'all' ? { status: statusTab } : {}),
      }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const payload = listRes?.data as
    | {
        stats?: Record<string, unknown>;
        applications?: KycApplicationRow[];
        pagination?: { page?: number; limit?: number; total?: number };
      }
    | undefined;

  const stats = payload?.stats as Record<string, unknown> | undefined;
  const applications = (payload?.applications ?? []) as KycApplicationRow[];

  const filtered = useMemo(() => {
    if (!deferredSearch) return applications;
    return applications.filter((row) => {
      const email = String(row.email ?? '').toLowerCase();
      const uid = String(row.user_id ?? '').toLowerCase();
      const un = String(row.username ?? '').toLowerCase();
      return email.includes(deferredSearch) || uid.includes(deferredSearch) || un.includes(deferredSearch);
    });
  }, [applications, deferredSearch]);

  const dashData = dashRes?.data as { kyc?: Record<string, unknown> } | undefined;
  const kycDash = dashData?.kyc;

  const pendingFromQueue = pendingRes?.success && Array.isArray(pendingRes.data) ? pendingRes.data.length : null;
  const pendingReviews =
    stats != null
      ? n(stats.pending) + n(stats.under_review)
      : pendingFromQueue != null
        ? pendingFromQueue
        : kycDash != null
          ? n(kycDash.pending) + n(kycDash.underReview)
          : null;
  const approvedToday = kycDash != null ? n(kycDash.approvedToday) : null;
  const rejectedToday = kycDash != null ? n(kycDash.rejectedToday) : null;
  const totalVerified = stats != null ? n(stats.approved) : null;

  const totalCount = listTotal(stats, statusTab);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const reviewMutation = useMutation({
    mutationFn: async (args: { id: string; action: 'approve' | 'reject'; reason?: string }) => {
      const res = await reviewKyc(token, args.id, { action: args.action, reason: args.reason });
      if (!res.success) throw new Error(res.error?.message ?? 'KYC review failed');
    },
    onSuccess: () => {
      setActionError(null);
      setRejectRow(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'kyc-list'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'kyc-pending'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'kyc-dashboard-stats'] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const canAct = (row: KycApplicationRow) => {
    const s = String(row.status ?? '').toLowerCase();
    return s === 'pending' || s === 'under_review';
  };

  return (
    <AdminPageFrame title="KYC Verification" description="Review identity submissions, approve or reject with documented reasons." status="active" error={isError ? ((error as Error)?.message ?? 'Failed to load KYC submissions') : null} onRetry={refetch}>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Pending Reviews', value: pendingReviews != null ? String(pendingReviews) : '—', alert: (pendingReviews ?? 0) > 0, accent: 'amber' },
          { label: 'Approved Today',  value: approvedToday  != null ? String(approvedToday)  : '—', alert: false, accent: 'emerald' },
          { label: 'Rejected Today',  value: rejectedToday  != null ? String(rejectedToday)  : '—', alert: false, accent: 'red' },
          { label: 'Total Verified',  value: totalVerified  != null ? String(totalVerified)  : '—', alert: false, accent: 'indigo' },
        ].map((kpi) => (
          <div key={kpi.label} className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5',
            kpi.alert ? 'border-amber-500/30' : 'border-admin-border/50')}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
              kpi.accent === 'amber' ? 'bg-amber-500' : kpi.accent === 'emerald' ? 'bg-emerald-500' : kpi.accent === 'red' ? 'bg-red-500' : 'bg-indigo-500')} />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{kpi.label}</p>
            <p className={cn('mt-2 text-3xl font-bold tabular-nums',
              kpi.alert ? 'text-amber-400' : 'text-admin-text')}>{kpi.value}</p>
            {kpi.alert && <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400">Action needed</p>}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setStatusTab(t.id)}
                  className={cn(
                    'rounded-ds-md px-3 py-1.5 text-sm font-medium transition-colors',
                    statusTab === t.id
                      ? 'bg-admin-primary/10 text-admin-primary ring-1 ring-admin-primary/25'
                      : 'text-admin-muted hover:bg-white/5 hover:text-admin-text'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="w-full max-w-md">
              <Input
                placeholder="Search email, user ID, or username…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                iconLeft={<Search className="h-3.5 w-3.5" />}
              />
              <p className="mt-1 text-xs text-admin-muted">Search filters the current page of results.</p>
            </div>
          </div>

          {actionError && (
            <p className="rounded-lg border border-red-500/30 bg-red-950/10 px-3 py-2 text-xs text-red-400">{actionError}</p>
          )}

          {isError && (
            <p className="text-sm text-admin-danger">
              {(error as Error)?.message ?? 'Failed to load KYC submissions'}
            </p>
          )}

          {isLoading && !payload ? (
            <TableSkeleton rows={6} cols={5} />
          ) : filtered.length === 0 ? (
            <div className="rounded-ds-md border border-dashed border-admin-border py-16 text-center text-sm text-admin-muted">
              No submissions match your filters.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-ds-md border border-admin-border">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="border-b border-admin-border bg-white/[0.02]">
                  <tr>
                    {['User', 'Email', 'Level', 'Document Type', 'Submitted', 'Status', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-2.5 font-medium text-admin-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {filtered.map((row) => {
                    const st = String(row.status ?? 'unknown');
                    return (
                      <tr key={row.id} className="bg-admin-card hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-admin-text">{formatUserLabel(row)}</td>
                        <td className="px-4 py-3 text-admin-text">{row.email ?? '—'}</td>
                        <td className="px-4 py-3 tabular-nums">{row.kyc_level ?? '—'}</td>
                        <td className="px-4 py-3 capitalize text-admin-text">{fmtDocType(row.document_type ?? undefined)}</td>
                        <td className="px-4 py-3 text-admin-muted whitespace-nowrap">{formatSubmitted(row)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant(st)}>{st.replace(/_/g, ' ')}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <ProtectedAction permission="kyc:review" fallback="disabled">
                              <Button
                                type="button"
                                variant="success"
                                size="sm"
                                disabled={!canAct(row) || reviewMutation.isPending}
                                onClick={() => reviewMutation.mutate({ id: row.id, action: 'approve' })}
                              >
                                Approve
                              </Button>
                            </ProtectedAction>
                            <ProtectedAction permission="kyc:review" fallback="disabled">
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                disabled={!canAct(row) || reviewMutation.isPending}
                                onClick={() => {
                                  setRejectRow(row);
                                  setRejectReason('');
                                }}
                              >
                                Reject
                              </Button>
                            </ProtectedAction>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex flex-col gap-2 border-t border-admin-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-admin-muted">
                Page {page} of {totalPages} · {totalCount} total
                {isFetching && !isLoading ? <span className="ml-2 text-admin-primary">Updating…</span> : null}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={!!rejectRow}
        onClose={() => !reviewMutation.isPending && setRejectRow(null)}
        title="Reject KYC"
        description="Provide a reason visible to compliance records."
        persistent={reviewMutation.isPending}
      >
        <Textarea
          label="Rejection reason"
          placeholder="e.g. Document unreadable, information mismatch…"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={4}
          className="resize-y"
        />
        <ModalFooter>
          <Button type="button" variant="ghost" size="sm" disabled={reviewMutation.isPending} onClick={() => setRejectRow(null)}>
            Cancel
          </Button>
          <ProtectedAction permission="kyc:review" fallback="disabled">
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={reviewMutation.isPending}
              disabled={!rejectReason.trim()}
              onClick={() => {
                if (!rejectRow || !rejectReason.trim()) return;
                reviewMutation.mutate({ id: rejectRow.id, action: 'reject', reason: rejectReason.trim() });
              }}
            >
              Reject submission
            </Button>
          </ProtectedAction>
        </ModalFooter>
      </Modal>
    </AdminPageFrame>
  );
}
