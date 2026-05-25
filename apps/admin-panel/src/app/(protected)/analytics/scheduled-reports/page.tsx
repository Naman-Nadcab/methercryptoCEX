'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/auth';
import {
  getScheduledReports,
  createScheduledReport,
  deleteScheduledReport,
  type ScheduledReportRow,
} from '@/lib/analytics-api';
import {
  ArrowLeft, Plus, Trash2, Loader2, Info, Calendar,
  CheckCircle2, AlertTriangle, X, Clock, FileText,
  BarChart3, Users, DollarSign, RefreshCw,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const REPORT_TYPES = [
  { id: 'trading', label: 'Trading', icon: BarChart3, desc: 'Volume, trades, market activity' },
  { id: 'revenue', label: 'Revenue', icon: DollarSign, desc: 'Fees, revenue breakdown' },
  { id: 'user-growth', label: 'User Growth', icon: Users, desc: 'Signups, retention, active users' },
];

const FREQUENCIES = [
  { id: 'daily', label: 'Daily', desc: '06:00 UTC' },
  { id: 'weekly', label: 'Weekly', desc: 'Monday 07:00 UTC' },
  { id: 'monthly', label: 'Monthly', desc: '1st of month 08:00 UTC' },
];

const FORMATS = [
  { id: 'csv', label: 'CSV', disabled: false },
  { id: 'json', label: 'JSON', disabled: false },
  { id: 'pdf', label: 'PDF', disabled: true },
];

const FREQ_COLORS: Record<string, string> = {
  daily: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  weekly: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  monthly: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
};

const REPORT_ICONS: Record<string, typeof BarChart3> = {
  trading: BarChart3,
  revenue: DollarSign,
  'user-growth': Users,
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ScheduledReportsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);

  // Plain state — no React Query cache layer
  const [reports, setReports] = useState<ScheduledReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledReportRow | null>(null);
  const [createAuthOpen, setCreateAuthOpen] = useState(false);
  const [deleteAuthOpen, setDeleteAuthOpen] = useState(false);

  const [reportType, setReportType] = useState('trading');
  const [frequency, setFrequency] = useState('daily');
  const [format, setFormat] = useState('csv');

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, msg });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  /* ---- Load reports ---- */
  const loadReports = useCallback(async (showSpinner = false) => {
    if (!token) return;
    if (showSpinner) setRefreshing(true);
    try {
      const res = await getScheduledReports(token);
      const list = res?.data?.scheduled_reports ?? [];
      setReports(list);
    } catch {
      showToast('error', 'Failed to load reports');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, showToast]);

  useEffect(() => { loadReports(); }, [loadReports]);

  /* ---- Refresh ---- */
  const handleRefresh = useCallback(() => {
    loadReports(true).then(() => showToast('success', 'Refreshed'));
  }, [loadReports, showToast]);

  /* ---- Create ---- */
  const handleCreate = useCallback(async () => {
    if (!token || creating) return;
    setCreating(true);
    try {
      await createScheduledReport(token, { report_type: reportType, frequency, format });
      showToast('success', 'Schedule created');
      await loadReports();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }, [token, creating, reportType, frequency, format, showToast, loadReports]);

  /* ---- Delete ---- */
  const handleConfirmDelete = useCallback(async () => {
    if (!token || !deleteTarget) return;
    const id = deleteTarget.id;
    setDeletingId(id);

    // Immediately close modal and remove from UI
    setDeleteTarget(null);
    setReports((prev) => prev.filter((r) => r.id !== id));

    try {
      await deleteScheduledReport(token, id);
      showToast('success', 'Schedule deleted');
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
      // Reload on failure to restore correct state
      await loadReports();
    } finally {
      setDeletingId(null);
    }
  }, [token, deleteTarget, showToast, loadReports]);

  return (
    <AdminPageFrame
      title="Scheduled Reports"
      description="Configure automated report delivery."
      quickActions={
        <Link href="/analytics"
          className="flex items-center gap-1.5 rounded-lg border border-admin-border px-3 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text hover:bg-white/5 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Analytics
        </Link>
      }
    >
      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium shadow-lg pointer-events-auto',
            toast.type === 'success' ? 'border-emerald-500/30 bg-[#0B0E14] text-emerald-400' : 'border-red-500/30 bg-[#0B0E14] text-red-400'
          )}
          style={{ position: 'fixed', top: 16, right: 16, zIndex: 99999 }}
        >
          {toast.type === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {toast.msg}
          <button type="button" onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-admin-border bg-admin-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-admin-muted" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Schedules</span>
        </div>
        <CountPill label="Total" count={reports.length} color="text-admin-text" />
        <CountPill label="Daily" count={reports.filter((r) => r.frequency === 'daily').length} color="text-blue-400" />
        <CountPill label="Weekly" count={reports.filter((r) => r.frequency === 'weekly').length} color="text-purple-400" />
        <CountPill label="Monthly" count={reports.filter((r) => r.frequency === 'monthly').length} color="text-amber-400" />
        <button type="button" onClick={handleRefresh} disabled={refreshing}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-admin-border px-2.5 py-1.5 text-[10px] font-medium text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors disabled:opacity-50">
          <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Active Schedules */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="px-5 py-3 border-b border-admin-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-admin-primary" />
            <h3 className="text-xs font-semibold text-admin-text">Active Schedules</h3>
          </div>
          <span className="text-[10px] text-admin-muted tabular-nums">{reports.length} active</span>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center">
            <Loader2 className="h-5 w-5 mx-auto animate-spin text-admin-muted" />
            <p className="text-[11px] text-admin-muted mt-2">Loading schedules...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Calendar className="h-8 w-8 mx-auto mb-3 text-admin-muted/40" />
            <p className="text-sm font-medium text-admin-muted">No scheduled reports yet</p>
            <p className="text-[11px] text-admin-muted/70 mt-1">Create one below to get automated report delivery.</p>
          </div>
        ) : (
          <div className="divide-y divide-admin-border/50">
            {reports.map((r) => {
              const Icon = REPORT_ICONS[r.report_type] ?? FileText;
              const isDeleting = deletingId === r.id;
              return (
                <div key={r.id} className={cn('flex items-center gap-4 px-5 py-3 hover:bg-white/[0.015] transition-all', isDeleting && 'opacity-40')}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] text-admin-muted shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-admin-text capitalize">{r.report_type.replace('-', ' ')}</span>
                      <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        FREQ_COLORS[r.frequency] ?? 'bg-white/5 text-admin-muted border-admin-border')}>
                        {r.frequency}
                      </span>
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-admin-muted uppercase">
                        {r.format}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-admin-muted">
                      <Clock className="h-2.5 w-2.5" />
                      <span>Last run: {r.last_run_at ? new Date(r.last_run_at).toLocaleString() : 'Never'}</span>
                    </div>
                  </div>
                  <ProtectedAction permission="analytics:view" fallback="disabled">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(r)}
                      disabled={isDeleting}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-admin-muted hover:bg-red-500/10 hover:text-red-400 transition-colors shrink-0 disabled:opacity-40"
                    >
                      {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </ProtectedAction>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create new schedule */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="px-5 py-3 border-b border-admin-border">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-admin-text">Create Schedule</h3>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-2">Report Type</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {REPORT_TYPES.map((rt) => {
                const isSelected = reportType === rt.id;
                const RtIcon = rt.icon;
                return (
                  <button type="button" key={rt.id} onClick={() => setReportType(rt.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                      isSelected
                        ? 'border-admin-primary/40 bg-admin-primary/5 ring-1 ring-admin-primary/20'
                        : 'border-admin-border hover:border-admin-border/80 hover:bg-white/[0.02]'
                    )}>
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                      isSelected ? 'bg-admin-primary/15 text-admin-primary' : 'bg-white/[0.04] text-admin-muted')}>
                      <RtIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className={cn('text-xs font-semibold', isSelected ? 'text-admin-text' : 'text-admin-muted')}>{rt.label}</p>
                      <p className="text-[10px] text-admin-muted/70">{rt.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-2">Frequency</label>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => {
                const isSelected = frequency === f.id;
                return (
                  <button type="button" key={f.id} onClick={() => setFrequency(f.id)}
                    className={cn(
                      'rounded-xl border px-4 py-2.5 text-left transition-all',
                      isSelected
                        ? 'border-admin-primary/40 bg-admin-primary/5 ring-1 ring-admin-primary/20'
                        : 'border-admin-border hover:border-admin-border/80 hover:bg-white/[0.02]'
                    )}>
                    <p className={cn('text-xs font-semibold', isSelected ? 'text-admin-text' : 'text-admin-muted')}>{f.label}</p>
                    <p className="text-[10px] text-admin-muted/70 mt-0.5">{f.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-2">Format</label>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => {
                const isSelected = format === f.id;
                return (
                  <button type="button" key={f.id} onClick={() => { if (!f.disabled) setFormat(f.id); }} disabled={f.disabled}
                    className={cn(
                      'rounded-lg border px-4 py-2 text-xs font-semibold transition-all',
                      f.disabled
                        ? 'border-dashed border-admin-border text-admin-muted/40 cursor-not-allowed'
                        : isSelected
                          ? 'border-admin-primary/40 bg-admin-primary/5 text-admin-primary ring-1 ring-admin-primary/20'
                          : 'border-admin-border text-admin-muted hover:border-admin-border/80 hover:bg-white/[0.02]'
                    )}>
                    {f.label}{f.disabled ? ' (soon)' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-admin-border">
            <div className="flex items-center gap-2 text-[11px] text-admin-muted">
              <Info className="h-3.5 w-3.5 text-admin-primary shrink-0" />
              <span>
                <b className="text-admin-text capitalize">{reportType.replace('-', ' ')}</b> report, delivered <b className="text-admin-text">{frequency}</b> as <b className="text-admin-text uppercase">{format}</b>
              </span>
            </div>
            <ProtectedAction permission="analytics:view" fallback="disabled">
              <button
                type="button"
                onClick={() => setCreateAuthOpen(true)}
                disabled={creating || format === 'pdf'}
                className="flex items-center gap-2 rounded-lg bg-admin-primary/15 border border-admin-primary/30 px-5 py-2 text-xs font-semibold text-admin-primary hover:bg-admin-primary/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {creating ? 'Creating...' : 'Create Schedule'}
              </button>
            </ProtectedAction>
          </div>
        </div>
      </div>

      {/* Cron reference */}
      <div className="flex gap-3 rounded-xl border border-admin-border bg-white/[0.02] px-4 py-3">
        <Info className="h-4 w-4 shrink-0 text-admin-primary mt-0.5" />
        <div className="text-[11px] text-admin-muted space-y-1">
          <p className="font-medium text-admin-text">Cron Reference (documentation only)</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Daily 06:00 UTC <code className="rounded bg-white/5 px-1 font-mono text-[10px] text-admin-text">0 6 * * *</code></span>
            <span>Weekly Mon 07:00 <code className="rounded bg-white/5 px-1 font-mono text-[10px] text-admin-text">0 7 * * 1</code></span>
            <span>Monthly 1st 08:00 <code className="rounded bg-white/5 px-1 font-mono text-[10px] text-admin-text">0 8 1 * *</code></span>
          </div>
          <p className="text-admin-muted/60">Delivery execution depends on your backend job worker configuration.</p>
        </div>
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onMouseDown={() => setDeleteTarget(null)}
        >
          <div
            style={{ width: '100%', maxWidth: 380, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: '#0B0E14', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Trash2 style={{ width: 16, height: 16, color: '#f87171' }} />
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#E5E7EB', margin: 0 }}>Delete Schedule</h3>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#9CA3AF' }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 12px 0' }}>
                Delete the <b style={{ color: '#E5E7EB', textTransform: 'capitalize' }}>{deleteTarget.report_type.replace('-', ' ')}</b> ({deleteTarget.frequency}) schedule?
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', padding: '8px 12px' }}>
                <AlertTriangle style={{ width: 14, height: 14, color: '#f87171', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#f87171' }}>This action cannot be undone.</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid rgba(255,255,255,0.08)', padding: '12px 20px' }}>
              <button type="button" onClick={() => setDeleteTarget(null)}
                style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'none', padding: '8px 16px', fontSize: 12, fontWeight: 500, color: '#9CA3AF', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setDeleteAuthOpen(true)}
                style={{ borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.15)', padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#f87171', cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <ActionAuthModal
        open={createAuthOpen}
        onClose={() => setCreateAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          void handleCreate();
          setCreateAuthOpen(false);
        }}
        title="Authorize report schedule creation"
        actionLabel={`Create ${reportType.replace('-', ' ')} ${frequency} schedule`}
        description="Scheduled reports may include sensitive financial and user data."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM REPORT_SCHEDULE_CREATE"
        externalError={toast?.type === 'error' ? toast.msg : null}
        isPending={creating}
        confirmLabel={creating ? 'Creating…' : 'Create schedule'}
        confirmVariant="primary"
      />
      <ActionAuthModal
        open={deleteAuthOpen}
        onClose={() => setDeleteAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) => {
          void payload;
          void handleConfirmDelete();
          setDeleteAuthOpen(false);
        }}
        title="Authorize schedule deletion"
        actionLabel={deleteTarget ? `Delete ${deleteTarget.report_type.replace('-', ' ')} schedule` : 'Delete schedule'}
        description="Deleting stops automated delivery for this report schedule."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM REPORT_SCHEDULE_DELETE"
        externalError={toast?.type === 'error' ? toast.msg : null}
        isPending={deletingId !== null}
        confirmLabel={deletingId ? 'Deleting…' : 'Delete schedule'}
        confirmVariant="danger"
      />
    </AdminPageFrame>
  );
}

function CountPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-admin-muted">{label}</span>
      <span className={cn('text-xs font-bold tabular-nums', color)}>{count}</span>
    </div>
  );
}
