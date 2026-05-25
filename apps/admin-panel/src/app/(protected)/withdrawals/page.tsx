'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getWithdrawalsList,
  approveWithdrawal,
  bulkApproveWithdrawals,
  bulkRejectWithdrawals,
  rejectWithdrawal,
  type WithdrawalRow,
} from '@/lib/withdrawals-api';
import { WithdrawalsTable } from '@/components/withdrawals/WithdrawalsTable';
import { ApproveWithdrawalModal } from '@/components/withdrawals/ApproveWithdrawalModal';
import { RejectWithdrawalModal } from '@/components/withdrawals/RejectWithdrawalModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import {
  ArrowUpFromLine, Clock, XCircle, CheckCircle2, DollarSign,
  Search, X, RefreshCw, ChevronLeft, ChevronRight, Wifi, Download,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import { BulkActionResultPanel } from '@/components/ops/BulkActionResultPanel';

/* ── tiny helpers ────────────────────────────────────── */
function fmtMoney(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function exportWithdrawalsCsv(rows: WithdrawalRow[]) {
  const headers = ['Withdrawal ID', 'User', 'Asset', 'Amount', 'Status', 'Address', 'Tx Hash', 'Risk Score', 'Created At'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.id,
    r.email ?? r.username ?? r.user_id,
    r.currency_symbol ?? '',
    r.amount ?? '',
    r.status ?? '',
    r.to_address ?? '',
    r.tx_hash ?? '',
    r.risk_score ?? '',
    r.created_at ?? '',
  ]);
  const csv = [headers.join(','), ...lines.map((line) => line.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `withdrawals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── KPI card ────────────────────────────────────────── */
interface KpiProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent: string;   // gradient class
  ring: string;     // icon bubble classes
  alert?: boolean;
  loading: boolean;
}
function KpiCard({ label, value, sub, icon, accent, ring, alert, loading }: KpiProps) {
  return (
    <div className={cn(
      'relative overflow-hidden rounded-2xl border bg-admin-card p-5',
      alert ? 'border-red-500/25' : 'border-admin-border/60'
    )}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', accent)} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          {loading ? (
            <div className="mt-2 h-7 w-20 animate-pulse rounded-lg bg-white/[0.06]" />
          ) : (
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', alert ? 'text-red-400' : 'text-admin-text')}>
              {value}
            </p>
          )}
          {sub && !loading && <p className="mt-0.5 text-[10px] text-admin-muted">{sub}</p>}
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', ring)}>
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ── page ────────────────────────────────────────────── */
export default function WithdrawalsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const [page, setPage]               = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch]           = useState('');
  const [liveFlash, setLiveFlash]     = useState(false);
  const [approveModal, setApproveModal] = useState<WithdrawalRow | null>(null);
  const [rejectModal, setRejectModal]   = useState<WithdrawalRow | null>(null);
  const [selectedWithdrawalIds, setSelectedWithdrawalIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'approve' | 'reject' | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    action: 'approve' | 'reject';
    successCount: number;
    failed: Array<{ id: string; code: string; message: string }>;
  } | null>(null);

  useEffect(() => {
    const s = searchParams.get('status');
    if (s) setStatusFilter(s);
  }, [searchParams]);

  useEffect(() => { setPage(1); }, [statusFilter, search]);
  useEffect(() => { setSelectedWithdrawalIds([]); }, [statusFilter, search, page]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'withdrawals', token, page, statusFilter, search],
    staleTime: 30_000,
    queryFn: () => getWithdrawalsList(token, {
      page, limit: 25,
      status: statusFilter === 'all' ? undefined : statusFilter,
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['withdrawal_requested', 'withdrawal_approved', 'withdrawal_rejected'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
        setLiveFlash(true);
        setTimeout(() => setLiveFlash(false), 800);
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      approveWithdrawal(token, id, { admin_note: adminNote }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] }); setApproveModal(null); },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason, adminNote }: { id: string; reason: string; adminNote?: string }) =>
      rejectWithdrawal(token, id, { reason, admin_note: adminNote }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] }); setRejectModal(null); },
  });
  const bulkMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: 'approve' | 'reject'; reason: string }) => {
      if (action === 'approve') {
        const res = await bulkApproveWithdrawals(token, { withdrawal_ids: selectedWithdrawalIds, admin_note: reason });
        if (!res.success) throw new Error(res.error?.message ?? 'Bulk approval failed');
        return {
          action,
          successCount: Number(res.data?.approved_count ?? 0),
          failed: Array.isArray(res.data?.failed) ? res.data.failed : [],
        };
      }
      const res = await bulkRejectWithdrawals(token, { withdrawal_ids: selectedWithdrawalIds, reason });
      if (!res.success) throw new Error(res.error?.message ?? 'Bulk rejection failed');
      return {
        action,
        successCount: Number(res.data?.rejected_count ?? 0),
        failed: Array.isArray(res.data?.failed) ? res.data.failed : [],
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      setSelectedWithdrawalIds([]);
      setBulkAction(null);
      setBulkResult(result ?? null);
    },
  });

  const handleApprove = useCallback(
    (adminNote: string) => { if (approveModal) approveMutation.mutate({ id: approveModal.id, adminNote: adminNote || undefined }); },
    [approveModal, approveMutation]
  );
  const handleReject = useCallback(
    (reason: string, adminNote?: string) => { if (rejectModal) rejectMutation.mutate({ id: rejectModal.id, reason, adminNote }); },
    [rejectModal, rejectMutation]
  );

  const withdrawals  = (data?.data?.withdrawals ?? []) as WithdrawalRow[];
  const selectableIds = withdrawals
    .filter((w) => {
      const s = String(w.status ?? '');
      return s === 'pending_approval' || s === 'pending';
    })
    .map((w) => w.id);
  const selectedCount = selectedWithdrawalIds.length;
  const stats        = data?.data?.stats as Record<string, number> | undefined;
  const pagination   = data?.data?.pagination as { total?: number; totalPages?: number } | undefined;
  const total        = pagination?.total ?? 0;
  const totalPages   = pagination?.totalPages ?? 1;
  const pendingCount = stats?.pending_approval ?? 0;
  /** Prefer 24h bucket when the KPI says "(24h)"; fall back to all-time count. */
  const completed24h = stats?.completed_24h ?? stats?.completed ?? 0;
  const failedCount  = stats?.failed_24h ?? stats?.failed ?? 0;

  const kpis: Omit<KpiProps, 'loading'>[] = [
    {
      label: 'Pending Approval',
      value: pendingCount,
      sub: pendingCount > 0 ? 'needs review' : 'queue empty',
      icon: <Clock className="h-4 w-4 text-amber-400" />,
      accent: pendingCount > 10
        ? 'bg-gradient-to-r from-amber-500/70 to-transparent'
        : 'bg-gradient-to-r from-amber-500/30 to-transparent',
      ring: 'border-amber-500/20 bg-amber-950/20',
      alert: pendingCount > 50,
    },
    {
      label: 'Processing',
      value: stats?.processing ?? 0,
      sub: 'in flight',
      icon: <ArrowUpFromLine className="h-4 w-4 text-blue-400" />,
      accent: 'bg-gradient-to-r from-blue-500/50 to-transparent',
      ring: 'border-blue-500/20 bg-blue-950/20',
    },
    {
      label: 'Completed (24h)',
      value: completed24h,
      sub: 'settled successfully',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
      accent: 'bg-gradient-to-r from-emerald-500/50 to-transparent',
      ring: 'border-emerald-500/20 bg-emerald-950/20',
    },
    {
      label: 'Failed (24h)',
      value: failedCount,
      sub: failedCount > 0 ? 'need investigation' : 'none',
      icon: <XCircle className="h-4 w-4 text-red-400" />,
      accent: failedCount > 0
        ? 'bg-gradient-to-r from-red-500/70 to-transparent'
        : 'bg-gradient-to-r from-red-500/20 to-transparent',
      ring: 'border-red-500/20 bg-red-950/20',
      alert: failedCount > 5,
    },
    {
      label: 'Volume (24h)',
      value: fmtMoney(stats?.volume_24h),
      sub: 'USD equivalent',
      icon: <DollarSign className="h-4 w-4 text-emerald-400" />,
      accent: 'bg-gradient-to-r from-emerald-500/40 to-transparent',
      ring: 'border-emerald-500/20 bg-emerald-950/20',
    },
  ];

  const STATUS_OPTIONS = [
    ['all', 'All statuses'],
    ['pending_approval', 'Pending Approval'],
    ['pending', 'Pending'],
    ['processing', 'Processing'],
    ['completed', 'Completed'],
    ['rejected', 'Rejected'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
  ];

  const handleExportCsv = useCallback(async () => {
    if (!token || exportingCsv) return;
    setExportingCsv(true);
    try {
      const all: WithdrawalRow[] = [];
      let currentPage = 1;
      let totalPagesForExport = 1;
      do {
        const res = await getWithdrawalsList(token, {
          page: currentPage,
          limit: 200,
          status: statusFilter === 'all' ? undefined : statusFilter,
          ...(search.trim() ? { search: search.trim() } : {}),
        });
        const rows = res.data?.withdrawals ?? [];
        all.push(...rows);
        totalPagesForExport = Math.max(1, Number(res.data?.pagination?.totalPages ?? 1));
        currentPage += 1;
      } while (currentPage <= totalPagesForExport && currentPage <= 200);
      exportWithdrawalsCsv(all);
    } finally {
      setExportingCsv(false);
    }
  }, [token, exportingCsv, statusFilter, search]);

  return (
    <AdminPageFrame
      title="Withdrawals"
      description="Review, approve, and monitor outgoing withdrawal requests."
      status={failedCount > 5 ? 'warning' : pendingCount > 50 ? 'warning' : 'active'}
      error={isError ? ((error as { message?: string })?.message ?? 'Failed to load withdrawals') : null}
      onRetry={() => void refetch()}
      quickActions={
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all',
            liveFlash ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-300' : 'border-admin-border/50 text-admin-muted'
          )}>
            <Wifi className="h-3 w-3" /> LIVE
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center gap-1.5 rounded-xl border border-admin-border/60 px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => { void handleExportCsv(); }}
            disabled={exportingCsv}
            className="flex items-center gap-1.5 rounded-xl border border-admin-border/60 px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            {exportingCsv ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      }
    >

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => <KpiCard key={k.label} {...k} loading={isLoading} />)}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-admin-border/60 bg-admin-card px-4 py-3.5">
        {/* Search */}
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, address, TX hash…"
            className="w-full rounded-xl border border-admin-border/60 bg-white/[0.03] py-2 pl-9 pr-8 text-sm text-admin-text placeholder-admin-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-admin-border/60 bg-white/[0.03] px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all"
        >
          {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        {/* Active filter badge */}
        {(search || statusFilter !== 'all') && (
          <button
            type="button"
            onClick={() => { setSearch(''); setStatusFilter('all'); }}
            className="flex items-center gap-1 rounded-xl border border-red-500/25 bg-red-950/15 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/25 transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
        <BulkActionResultPanel
          result={bulkResult ? { kind: 'generic', actionLabel: `Bulk ${bulkResult.action}`, ...bulkResult } : null}
          onDismiss={() => setBulkResult(null)}
        />
        {selectedCount > 0 && (
          <div className="flex items-center gap-1">
            <span className="rounded-lg border border-admin-border/40 px-2 py-1 text-[10px] font-semibold text-admin-muted">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={() => setBulkAction('approve')}
              className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-950/25"
            >
              Bulk approve
            </button>
            <button
              type="button"
              onClick={() => setBulkAction('reject')}
              className="rounded-lg border border-red-500/30 bg-red-950/15 px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-950/25"
            >
              Bulk reject
            </button>
          </div>
        )}
      </div>

      {/* ── Table card ── */}
      <div className="rounded-2xl border border-admin-border/60 bg-admin-card">

        {/* Table toolbar */}
        <div className="flex items-center justify-between border-b border-admin-border/50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-admin-text">
              {isLoading ? 'Loading…' : `${total.toLocaleString()} withdrawal${total !== 1 ? 's' : ''}`}
            </p>
            {isFetching && !isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
            {pendingCount > 0 && (
              <span className="rounded-full border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                {pendingCount} need approval
              </span>
            )}
          </div>
          <span className="text-xs text-admin-muted">Page {page} of {Math.max(1, totalPages)}</span>
        </div>

        {/* Error banner */}
        {isError && (
          <div className="flex items-center gap-2 border-b border-admin-border/50 bg-red-950/15 px-5 py-3 text-sm text-red-300">
            {(error as { message?: string })?.message ?? 'Failed to load withdrawals'}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-20 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-4 w-14 animate-pulse rounded bg-white/[0.05]" />
                <div className="h-4 w-24 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-4 w-20 animate-pulse rounded bg-white/[0.03]" />
              </div>
            ))}
          </div>
        ) : (
          <WithdrawalsTable
            rows={withdrawals}
            onApprove={(w) => setApproveModal(w)}
            onReject={(w) => setRejectModal(w)}
            selectedIds={selectedWithdrawalIds}
            onToggleSelect={(withdrawalId, checked) => {
              if (checked) setSelectedWithdrawalIds((prev) => Array.from(new Set([...prev, withdrawalId])));
              else setSelectedWithdrawalIds((prev) => prev.filter((id) => id !== withdrawalId));
            }}
            onToggleSelectAll={(checked) => {
              if (checked) setSelectedWithdrawalIds(selectableIds);
              else setSelectedWithdrawalIds([]);
            }}
          />
        )}

        {/* ── Pagination ── */}
        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/50 px-5 py-3.5">
            <p className="text-xs text-admin-muted">
              {total > 0 ? `${((page - 1) * 25) + 1}–${Math.min(page * 25, total)} of ${total.toLocaleString()}` : '0 results'}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border/60 text-admin-muted hover:text-admin-text hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pg = totalPages <= 5 ? i + 1
                  : page <= 3 ? i + 1
                  : page >= totalPages - 2 ? totalPages - 4 + i
                  : page - 2 + i;
                return (
                  <button key={pg} type="button" onClick={() => setPage(pg)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-medium transition-colors',
                      pg === page
                        ? 'border-blue-500/40 bg-blue-950/30 text-blue-300'
                        : 'border-admin-border/60 text-admin-muted hover:text-admin-text hover:bg-white/[0.04]'
                    )}>
                    {pg}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-border/60 text-admin-muted hover:text-admin-text hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
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
      <ActionAuthModal
        open={bulkAction !== null}
        onClose={() => setBulkAction(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!bulkAction) return;
          bulkMutation.mutate({ action: bulkAction, reason: payload.reason });
        }}
        title={bulkAction === 'approve' ? 'Bulk approve withdrawals' : 'Bulk reject withdrawals'}
        actionLabel={`${bulkAction === 'approve' ? 'Approve' : 'Reject'} ${selectedCount} selected withdrawals`}
        description="Bulk withdrawal moderation is applied server-side and fully audit logged."
        requireReason
        twofaRequired
        confirmationPhrase={bulkAction === 'reject' ? 'CONFIRM BULK_REJECT_WITHDRAWALS' : undefined}
        externalError={bulkMutation.error instanceof Error ? bulkMutation.error.message : null}
        isPending={bulkMutation.isPending}
        confirmLabel={bulkMutation.isPending ? 'Processing…' : 'Apply bulk action'}
        confirmVariant={bulkAction === 'reject' ? 'danger' : 'primary'}
      />
    </AdminPageFrame>
  );
}
