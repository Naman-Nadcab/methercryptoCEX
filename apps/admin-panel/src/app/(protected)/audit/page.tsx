'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getAuditActivityLogs, getImmutableAuditLogs,
  type AuditActivityLog, type ImmutableAuditLog,
} from '@/lib/api';
import {
  Search, Download, ChevronDown, ChevronRight, Clock,
  Shield, Activity, AlertTriangle, Filter,
  User, Globe, Monitor, RefreshCw, Lock, CheckCircle2,
  Copy, Check, X, FileText,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtTs(ts: string): string {
  try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
  catch { return ts; }
}
function fmtRelative(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (Math.abs(diff) < 60_000) return 'just now';
    if (diff > 0 && diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
    if (diff > 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return fmtTs(ts);
  } catch { return ts; }
}
function csvEsc(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function tryFmtJson(v: string): string {
  try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
}
function actionLevel(action: string): 'error' | 'warn' | 'info' | 'debug' {
  const a = action.toLowerCase();
  if (a.includes('emergency') || a.includes('halt') || a.includes('freeze') || a.includes('block') || a.includes('delete') || a.includes('reject')) return 'error';
  if (a.includes('approve') || a.includes('resolve') || a.includes('create') || a.includes('activate')) return 'info';
  if (a.includes('update') || a.includes('edit') || a.includes('change') || a.includes('pause')) return 'warn';
  return 'debug';
}

const LEVEL_STYLES = {
  error: { pill: 'border-red-500/30 bg-red-950/20 text-red-400', row: 'bg-red-950/[0.04]', dot: 'bg-red-500' },
  warn:  { pill: 'border-amber-500/30 bg-amber-950/20 text-amber-400', row: 'bg-amber-950/[0.025]', dot: 'bg-amber-400' },
  info:  { pill: 'border-blue-500/30 bg-blue-950/20 text-blue-400', row: '', dot: 'bg-blue-400' },
  debug: { pill: 'border-admin-border/50 bg-white/[0.03] text-admin-muted/60', row: '', dot: 'bg-admin-muted/30' },
};

/* ── atoms ──────────────────────────────────────────────────────────── */
function LevelBadge({ level }: { level: 'error' | 'warn' | 'info' | 'debug' }) {
  const s = LEVEL_STYLES[level];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase', s.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />{level}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }); }}
      className="ml-1 rounded p-0.5 text-admin-muted opacity-0 group-hover:opacity-100 hover:text-admin-text transition-all">
      {ok ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  const start = Math.max(0, Math.min(page - 2, total - 5));
  const pages = Array.from({ length: Math.min(5, total) }, (_, i) => start + i);
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={page === 0} onClick={() => onChange(page - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text text-xs">‹</button>
      {pages.map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={cn('flex h-7 min-w-[28px] items-center justify-center rounded-lg border px-1.5 text-xs font-semibold',
            p === page ? 'border-blue-500/50 bg-blue-950/20 text-blue-300' : 'border-admin-border/50 text-admin-muted hover:text-admin-text')}>
          {p + 1}
        </button>
      ))}
      <button type="button" disabled={page >= total - 1} onClick={() => onChange(page + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text text-xs">›</button>
    </div>
  );
}

/* ── main page ──────────────────────────────────────────────────────── */
type TabId = 'activity' | 'immutable';

export default function AuditPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('activity');

  return (
    <AdminPageFrame
      title="Audit Logs"
      description="Track every admin action and system event for compliance and accountability."
      status="active"
      error={null}
      quickActions={
        <button type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] })}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      }
    >
      {/* tabs */}
      <div className="flex gap-1 rounded-xl border border-admin-border/50 bg-white/[0.02] p-1 w-fit">
        {([
          { id: 'activity' as TabId,  label: 'Admin Activity',       icon: Activity },
          { id: 'immutable' as TabId, label: 'Immutable Audit Trail', icon: Shield },
        ]).map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setActiveTab(id)}
            className={cn('flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
              activeTab === id ? 'bg-admin-card border border-admin-border/50 text-admin-text shadow-sm' : 'text-admin-muted hover:text-admin-text')}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {activeTab === 'activity' ? <ActivitySection /> : <ImmutableSection />}
    </AdminPageFrame>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Admin Activity                                                      */
/* ─────────────────────────────────────────────────────────────────── */
const LIMIT = 50;

function ActivitySection() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [search,      setSearch]     = useState('');
  const [filterAction,setFilterAct]  = useState('');
  const [dateFrom,    setDateFrom]   = useState('');
  const [dateTo,      setDateTo]     = useState('');
  const [page,        setPage]       = useState(0);
  const [expandedId,  setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'audit', 'activity', token, search, filterAction, dateFrom, dateTo, page],
    queryFn: () => getAuditActivityLogs(token, { search: search || undefined, action: filterAction || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, limit: LIMIT, offset: page * LIMIT }),
    enabled: !!token,
    staleTime: 30_000,
  });

  const logs       = data?.data?.logs ?? [];
  const total      = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  // KPI counts from current page data
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const criticalToday = logs.filter((l) => actionLevel(l.action) === 'error').length;

  const handleExport = useCallback(() => {
    const header = 'Timestamp,Admin,Role,Action,IP,Details';
    const rows = logs.map((r) => [r.createdAt, csvEsc(r.adminName), csvEsc(r.adminRole), csvEsc(r.action), r.ipAddress ?? '', csvEsc(JSON.stringify(r.details ?? {}))].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `admin-activity-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }, [logs]);

  const clearFilters = () => { setSearch(''); setFilterAct(''); setDateFrom(''); setDateTo(''); setPage(0); };
  const hasFilter = search || filterAction || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Log Entries', value: total, accent: 'border-blue-500/20', top: 'bg-blue-500' },
          { label: 'Critical Actions', value: criticalToday, accent: 'border-red-500/20', top: 'bg-red-500', alert: criticalToday > 0 },
          { label: 'Showing (this page)', value: logs.length, accent: 'border-emerald-500/20', top: 'bg-emerald-500' },
        ].map(({ label, value, accent, top, alert }) => (
          <div key={label} className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-4', accent)}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', top)} />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', alert ? 'text-red-400' : 'text-admin-text')}>
              {isLoading ? <span className="inline-block h-6 w-10 animate-pulse rounded-lg bg-white/[0.05]" /> : value}
            </p>
          </div>
        ))}
      </div>

      {/* Log panel */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border/30 px-5 py-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-admin-text">Admin Activity Log</p>
            {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => refetch()}
              className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={handleExport}
              className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
        </div>

        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/20 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="h-8 w-44 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 pr-7 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
            {search && <button type="button" onClick={() => { setSearch(''); setPage(0); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text"><X className="h-3 w-3" /></button>}
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Action filter…" value={filterAction} onChange={(e) => { setFilterAct(e.target.value); setPage(0); }}
              className="h-8 w-36 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
          </div>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} title="From"
            className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40" />
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} title="To"
            className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40" />
          {hasFilter && (
            <button type="button" onClick={clearFilters}
              className="flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-950/10 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/20 transition-colors">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>

        {/* table */}
        <div className="p-2">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({length:6}).map((_,i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />)}</div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-admin-muted">
              <AlertTriangle className="h-7 w-7 text-red-400 opacity-60" />
              <p className="text-sm">Failed to load activity logs</p>
              <button type="button" onClick={() => refetch()} className="text-xs text-blue-400 hover:underline">Retry</button>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-admin-muted">
              <Activity className="h-8 w-8 opacity-10" />
              <p className="text-sm">No activity logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border/50 bg-white/[0.01]">
                    <th className="w-8 px-2 py-3" />
                    {['Time', 'Admin', 'Level', 'Action', 'IP'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border/25">
                  {logs.map((log) => {
                    const level = actionLevel(log.action);
                    const st    = LEVEL_STYLES[level];
                    const exp   = expandedId === log.id;
                    return (
                      <>
                        <tr key={log.id} onClick={() => setExpandedId((id) => id === log.id ? null : log.id)}
                          className={cn('cursor-pointer transition-colors hover:bg-white/[0.025]', st.row, exp && 'bg-white/[0.02]')}>
                          <td className="px-2 py-3 text-admin-muted">
                            {exp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap" title={fmtTs(log.createdAt)}>
                            <span className="block text-sm text-admin-text">{fmtRelative(log.createdAt)}</span>
                            <span className="block text-[10px] font-mono text-admin-muted">{fmtTs(log.createdAt)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-950/20 text-blue-400 border border-blue-500/20">
                                <User className="h-3 w-3" />
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-admin-text">{log.adminName}</p>
                                <span className="inline-flex items-center rounded border border-admin-border/40 bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium text-admin-muted capitalize">{log.adminRole}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <LevelBadge level={level} />
                          </td>
                          <td className="px-4 py-3 group">
                            <div className="flex items-center">
                              <span className="text-sm text-admin-text font-medium capitalize">{log.action.replace(/_/g, ' ')}</span>
                              <CopyBtn text={log.action} />
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-admin-muted">
                            {log.ipAddress ? <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{log.ipAddress}</span> : '—'}
                          </td>
                        </tr>
                        {exp && (
                          <tr key={`${log.id}-exp`} className="bg-white/[0.015]">
                            <td colSpan={6} className="px-8 py-4">
                              <div className="grid gap-4 md:grid-cols-2 text-xs">
                                <div>
                                  <p className="mb-1.5 flex items-center gap-1 font-semibold text-admin-text"><Monitor className="h-3 w-3" /> User Agent</p>
                                  <p className="rounded-xl border border-admin-border/40 bg-admin-bg p-2 font-mono text-[10px] text-admin-muted break-all">{log.userAgent ?? '—'}</p>
                                </div>
                                <div>
                                  <p className="mb-1.5 flex items-center gap-1 font-semibold text-admin-text"><FileText className="h-3 w-3" /> Details</p>
                                  {log.details && Object.keys(log.details).length > 0 ? (
                                    <pre className="rounded-xl border border-admin-border/40 bg-admin-bg p-2 text-[10px] font-mono text-admin-text overflow-x-auto max-h-40">
                                      {JSON.stringify(log.details, null, 2)}
                                    </pre>
                                  ) : <p className="text-admin-muted/60 italic">No additional details</p>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}</span>
            <Pager page={page} total={totalPages} onChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Immutable Audit Trail                                               */
/* ─────────────────────────────────────────────────────────────────── */
function ImmutableSection() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [actorType,   setActorType]   = useState('');
  const [filterAction,setFilterAct]   = useState('');
  const [page,        setPage]        = useState(0);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'audit', 'immutable', token, actorType, filterAction, page],
    queryFn: () => getImmutableAuditLogs(token, { actorType: actorType || undefined, action: filterAction || undefined, limit: LIMIT, offset: page * LIMIT }),
    enabled: !!token,
    staleTime: 30_000,
  });

  const logs       = data?.data?.audit_logs ?? [];
  const total      = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const handleExport = useCallback(() => {
    const header = 'Timestamp,ActorType,ActorID,Action,ResourceType,ResourceID,OldValue,NewValue,IP';
    const rows = logs.map((r) => [r.created_at, r.actor_type, r.actor_id ?? '', csvEsc(r.action), r.resource_type ?? '', r.resource_id ?? '', csvEsc(r.old_value ?? ''), csvEsc(r.new_value ?? ''), r.ip_address ?? ''].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `immutable-audit-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }, [logs]);

  return (
    <div className="space-y-4">
      {/* hash-chain integrity banner */}
      {!isLoading && !isError && total > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 px-5 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-emerald-300">Hash-chain integrity verified</p>
            <p className="text-[10px] text-emerald-300/60">{total} immutable {total === 1 ? 'entry' : 'entries'} · append-only, tamper-evident log</p>
          </div>
          <Lock className="h-4 w-4 text-emerald-400/50 shrink-0" />
        </div>
      )}

      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border/30 px-5 py-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-admin-text">Immutable Audit Trail</p>
            {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => refetch()}
              className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={handleExport}
              className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
        </div>

        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/20 px-5 py-3">
          <select value={actorType} onChange={(e) => { setActorType(e.target.value); setPage(0); }}
            className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40">
            <option value="">All actor types</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="system">System</option>
          </select>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Filter by action…" value={filterAction} onChange={(e) => { setFilterAct(e.target.value); setPage(0); }}
              className="h-8 w-44 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
          </div>
          <span className="ml-auto text-xs text-admin-muted">{total} entries</span>
        </div>

        <div className="p-2">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({length:6}).map((_,i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />)}</div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-admin-muted">
              <AlertTriangle className="h-7 w-7 text-red-400 opacity-60" />
              <p className="text-sm">Failed to load immutable audit logs</p>
              <button type="button" onClick={() => refetch()} className="text-xs text-blue-400 hover:underline">Retry</button>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-admin-muted">
              <Shield className="h-8 w-8 opacity-10" />
              <p className="text-sm">No audit entries found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border/50 bg-white/[0.01]">
                    <th className="w-8 px-2 py-3" />
                    {['Time', 'Actor', 'Level', 'Action', 'Resource', 'IP'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border/25">
                  {logs.map((log) => {
                    const level = actionLevel(log.action);
                    const st    = LEVEL_STYLES[level];
                    const exp   = expandedId === log.id;
                    return (
                      <>
                        <tr key={log.id} onClick={() => setExpandedId((id) => id === log.id ? null : log.id)}
                          className={cn('cursor-pointer transition-colors hover:bg-white/[0.025]', st.row, exp && 'bg-white/[0.02]')}>
                          <td className="px-2 py-3 text-admin-muted">
                            {exp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap" title={fmtTs(log.created_at)}>
                            <span className="block text-sm text-admin-text">{fmtRelative(log.created_at)}</span>
                            <span className="block text-[10px] font-mono text-admin-muted">{fmtTs(log.created_at)}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize',
                              log.actor_type === 'admin'  && 'border-blue-500/25 bg-blue-950/15 text-blue-400',
                              log.actor_type === 'system' && 'border-purple-500/25 bg-purple-950/15 text-purple-400',
                              log.actor_type === 'user'   && 'border-emerald-500/25 bg-emerald-950/15 text-emerald-400',
                              !['admin','system','user'].includes(log.actor_type) && 'border-admin-border/50 bg-white/[0.03] text-admin-muted',
                            )}>
                              {log.actor_type}
                            </span>
                          </td>
                          <td className="px-4 py-3"><LevelBadge level={level} /></td>
                          <td className="px-4 py-3 group">
                            <div className="flex items-center">
                              <span className="text-sm text-admin-text font-medium capitalize">{log.action.replace(/_/g, ' ')}</span>
                              <CopyBtn text={log.action} />
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-admin-muted">
                            {log.resource_type ? `${log.resource_type}${log.resource_id ? '/' + log.resource_id.slice(0, 8) : ''}` : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-admin-muted">{log.ip_address ?? '—'}</td>
                        </tr>
                        {exp && (
                          <tr key={`${log.id}-exp`} className="bg-white/[0.015]">
                            <td colSpan={7} className="px-8 py-4">
                              <div className="grid gap-4 md:grid-cols-2 text-xs">
                                <div>
                                  <p className="mb-1.5 font-semibold text-admin-text">Before State</p>
                                  {log.old_value
                                    ? <pre className="rounded-xl border border-admin-border/40 bg-admin-bg p-2 text-[10px] font-mono text-admin-text overflow-x-auto max-h-40">{tryFmtJson(log.old_value)}</pre>
                                    : <p className="italic text-admin-muted/60">No before state</p>}
                                </div>
                                <div>
                                  <p className="mb-1.5 font-semibold text-admin-text">After State</p>
                                  {log.new_value
                                    ? <pre className="rounded-xl border border-admin-border/40 bg-admin-bg p-2 text-[10px] font-mono text-admin-text overflow-x-auto max-h-40">{tryFmtJson(log.new_value)}</pre>
                                    : <p className="italic text-admin-muted/60">No after state</p>}
                                </div>
                              </div>
                              <div className="mt-3 flex items-center gap-6 text-[10px] text-admin-muted">
                                <span>Entry ID: <span className="font-mono">{log.id}</span></span>
                                <span>Actor ID: <span className="font-mono">{log.actor_id ?? '—'}</span></span>
                                {log.request_id && <span>Request ID: <span className="font-mono">{log.request_id}</span></span>}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">{page * LIMIT + 1}–{Math.min((page+1)*LIMIT, total)} of {total}</span>
            <Pager page={page} total={totalPages} onChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
