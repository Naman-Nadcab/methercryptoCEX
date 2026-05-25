'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getConfigAuditLogs, type ConfigAuditLogRow } from '@/lib/audit-api';
import {
  ArrowLeft, Download, RefreshCw, Search, X, Filter,
  AlertTriangle, Settings, ChevronDown, ChevronRight, Copy, Check,
} from 'lucide-react';
import Link from 'next/link';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtRelative(s: string): string {
  try {
    const diff = Date.now() - new Date(s).getTime();
    if (Math.abs(diff) < 60_000) return 'just now';
    if (diff > 0 && diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
    if (diff > 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
  } catch { return s; }
}
function fmtFull(s: string): string {
  try { return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return s; }
}
function csvEsc(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

function ValueCell({ value, label }: { value: string | undefined; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const display = value?.trim() || null;
  if (!display) return <span className="text-admin-muted/50 italic text-xs">—</span>;
  const isLong = display.length > 40;

  let parsed: string | null = null;
  try { parsed = JSON.stringify(JSON.parse(display), null, 2); } catch { parsed = null; }

  return (
    <div className="max-w-[240px]">
      {expanded ? (
        <div className="relative">
          <pre className="rounded-xl border border-admin-border/40 bg-admin-bg p-2 text-[10px] font-mono text-admin-text overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
            {parsed ?? display}
          </pre>
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="mt-1 text-[10px] text-blue-400 hover:underline">Collapse</button>
        </div>
      ) : (
        <div className="flex items-start gap-1 group">
          <span className="block truncate text-xs text-admin-text font-mono" title={display}>
            {display.slice(0, 40)}{isLong ? '…' : ''}
          </span>
          {isLong && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              className="shrink-0 text-[10px] text-blue-400 hover:underline whitespace-nowrap">expand</button>
          )}
          <CopyBtn text={display} />
        </div>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const a = (action ?? '').toLowerCase();
  const cls =
    a.includes('delete') || a.includes('remove') || a.includes('disable') ? 'border-red-500/25 bg-red-950/15 text-red-400' :
    a.includes('update') || a.includes('change') || a.includes('edit') ? 'border-amber-500/25 bg-amber-950/15 text-amber-400' :
    a.includes('create') || a.includes('enable') || a.includes('add') ? 'border-emerald-500/25 bg-emerald-950/15 text-emerald-400' :
    'border-admin-border/40 bg-white/[0.03] text-admin-muted';
  return <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize', cls)}>{action.replace(/_/g, ' ')}</span>;
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

/* ── page ───────────────────────────────────────────────────────────── */
const PAGE_SIZE = 50;

export default function AuditConfigPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [filterAdmin,   setFilterAdmin]   = useState('');
  const [filterAction,  setFilterAction]  = useState('');
  const [filterKey,     setFilterKey]     = useState('');
  const [dateFrom,      setDateFrom]      = useState('');
  const [dateTo,        setDateTo]        = useState('');
  const [page,          setPage]          = useState(0);
  const [expandedIdx,   setExpandedIdx]   = useState<number | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'audit', 'config', token],
    queryFn: () => getConfigAuditLogs(token, 500),
    enabled: !!token,
    staleTime: 60_000,
  });

  const logs = (data?.data?.logs ?? []) as ConfigAuditLogRow[];

  const filtered = useMemo(() => {
    return logs.filter((row) => {
      if (filterAdmin && !row.admin.toLowerCase().includes(filterAdmin.toLowerCase())) return false;
      if (filterAction && row.action !== filterAction) return false;
      if (filterKey && !(row.setting_key || '').toLowerCase().includes(filterKey.toLowerCase())) return false;
      if (dateFrom || dateTo) {
        const t = row.timestamp ? new Date(row.timestamp).getTime() : 0;
        if (dateFrom) { const s = new Date(dateFrom); s.setHours(0,0,0,0); if (t < s.getTime()) return false; }
        if (dateTo)   { const e = new Date(dateTo);   e.setHours(23,59,59,999); if (t > e.getTime()) return false; }
      }
      return true;
    });
  }, [logs, filterAdmin, filterAction, filterKey, dateFrom, dateTo]);

  const actionTypes = useMemo(() => Array.from(new Set(logs.map((r) => r.action).filter(Boolean))).sort(), [logs]);
  const totalPages  = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows    = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayLogs  = logs.filter((l) => l.timestamp && new Date(l.timestamp) >= todayStart);
  const admins     = Array.from(new Set(todayLogs.map((l) => l.admin))).filter(Boolean);
  const lastChange = logs[0]?.timestamp;

  const handleExport = useCallback(() => {
    const header = 'Timestamp,Admin,Action,SettingKey,OldValue,NewValue';
    const rows = filtered.map((r) => [r.timestamp ?? '', csvEsc(r.admin ?? ''), csvEsc(r.action ?? ''), csvEsc(r.setting_key ?? ''), csvEsc(r.old_value ?? ''), csvEsc(r.new_value ?? '')].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `config-changes-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }, [filtered]);

  const clearFilters = () => { setFilterAdmin(''); setFilterAction(''); setFilterKey(''); setDateFrom(''); setDateTo(''); setPage(0); };
  const hasFilter = filterAdmin || filterAction || filterKey || dateFrom || dateTo;

  return (
    <AdminPageFrame
      title="Config Changes"
      description="Audit trail of all configuration changes — system settings, feature flags, and profile updates."
      status="active"
      error={isError ? (error instanceof Error ? error.message : 'Failed to load config audit logs.') : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
      quickActions={
        <>
          <button type="button" disabled={isFetching} onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
          <button type="button" onClick={handleExport} disabled={filtered.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <Link href="/audit">
            <button type="button"
              className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Audit Logs
            </button>
          </Link>
        </>
      }
    >
      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Config Changes', value: logs.length,       accent: 'border-blue-500/20',    top: 'bg-blue-500' },
          { label: 'Changes Today',        value: todayLogs.length,  accent: 'border-amber-500/20',   top: 'bg-amber-500' },
          { label: 'Admins Active Today',  value: admins.length,     accent: 'border-emerald-500/20', top: 'bg-emerald-500' },
        ].map(({ label, value, accent, top }) => (
          <div key={label} className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-4', accent)}>
            <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl', top)} />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-admin-text">
              {isLoading ? <span className="inline-block h-6 w-10 animate-pulse rounded-lg bg-white/[0.05]" /> : value}
            </p>
            {label === 'Total Config Changes' && lastChange && (
              <p className="mt-1 text-[10px] text-admin-muted">Last: {fmtRelative(lastChange)}</p>
            )}
          </div>
        ))}
      </div>

      {/* ── Main panel ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        {/* header */}
        <div className="flex items-center justify-between border-b border-admin-border/30 px-5 py-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-admin-muted" />
            <p className="text-sm font-semibold text-admin-text">Configuration Change History</p>
            {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
          </div>
          <span className="text-xs text-admin-muted">{filtered.length} entries</span>
        </div>

        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/20 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Admin…" value={filterAdmin} onChange={(e) => { setFilterAdmin(e.target.value); setPage(0); }}
              className="h-8 w-36 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
          </div>
          <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
            className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40">
            <option value="">All actions</option>
            {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Setting key…" value={filterKey} onChange={(e) => { setFilterKey(e.target.value); setPage(0); }}
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

        {/* error */}
        {isError && (
          <div className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-950/10 p-4">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300">Failed to load config audit log</p>
              <p className="text-xs text-red-300/70 mt-0.5">{error instanceof Error ? error.message : 'Request failed'}</p>
            </div>
            <button type="button" onClick={() => refetch()}
              className="ml-auto flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-950/15 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/25">
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        )}

        {/* table */}
        <div className="p-2">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({length:6}).map((_,i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border/50 bg-white/[0.01]">
                    <th className="w-8 px-2 py-3" />
                    {['Time', 'Admin', 'Action', 'Setting Key', 'Old Value', 'New Value'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-admin-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border/25">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-14 text-center">
                        <div className="flex flex-col items-center gap-2 text-admin-muted">
                          <Settings className="h-8 w-8 opacity-10" />
                          <p className="text-sm">{logs.length === 0 ? 'No config changes recorded.' : 'No entries match the current filters.'}</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row, i) => {
                      const absIdx = page * PAGE_SIZE + i;
                      const exp = expandedIdx === absIdx;
                      const hasChange = (row.old_value || row.new_value);
                      return (
                        <>
                          <tr key={absIdx}
                            onClick={() => setExpandedIdx((id) => id === absIdx ? null : absIdx)}
                            className={cn('cursor-pointer transition-colors hover:bg-white/[0.025]', exp && 'bg-white/[0.02]')}>
                            <td className="px-2 py-3 text-admin-muted">
                              {hasChange
                                ? (exp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)
                                : <span className="h-3.5 w-3.5 block" />}
                            </td>
                            {/* time */}
                            <td className="px-4 py-3 whitespace-nowrap" title={fmtFull(row.timestamp)}>
                              <span className="block text-sm text-admin-text">{fmtRelative(row.timestamp)}</span>
                              <span className="block text-[10px] font-mono text-admin-muted">{fmtFull(row.timestamp)}</span>
                            </td>
                            {/* admin */}
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm font-semibold text-admin-text">{row.admin || '—'}</span>
                            </td>
                            {/* action */}
                            <td className="px-4 py-3 whitespace-nowrap">
                              <ActionBadge action={row.action} />
                            </td>
                            {/* setting key */}
                            <td className="px-4 py-3 group">
                              <div className="flex items-center">
                                <span className="font-mono text-xs text-admin-text">{row.setting_key || '—'}</span>
                                {row.setting_key && <CopyBtn text={row.setting_key} />}
                              </div>
                            </td>
                            {/* old value */}
                            <td className="px-4 py-3">
                              <ValueCell value={row.old_value} label="Old" />
                            </td>
                            {/* new value */}
                            <td className="px-4 py-3">
                              <ValueCell value={row.new_value} label="New" />
                            </td>
                          </tr>
                          {exp && hasChange && (
                            <tr key={`${absIdx}-exp`} className="bg-white/[0.015]">
                              <td colSpan={7} className="px-8 py-4">
                                <p className="mb-2 text-xs font-semibold text-admin-text">Diff View</p>
                                <div className="grid gap-4 md:grid-cols-2 text-xs">
                                  <div>
                                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">Before</p>
                                    <pre className="rounded-xl border border-red-500/20 bg-red-950/10 p-3 text-[10px] font-mono text-admin-text overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                                      {row.old_value || '(empty)'}
                                    </pre>
                                  </div>
                                  <div>
                                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">After</p>
                                    <pre className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3 text-[10px] font-mono text-admin-text overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                                      {row.new_value || '(empty)'}
                                    </pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <Pager page={page} total={totalPages} onChange={setPage} />
          </div>
        )}
      </div>
    </AdminPageFrame>
  );
}
