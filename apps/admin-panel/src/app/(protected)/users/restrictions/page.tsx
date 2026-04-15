'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getUsers, updateUserStatus, type AdminUserRow } from '@/lib/users-api';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import {
  Ban, ShieldOff, Users, Search, RefreshCw, Eye, Check,
  ChevronLeft, ChevronRight, X, AlertTriangle,
} from 'lucide-react';

/* ── helpers ────────────────────────────────────────────────────────── */
function fmtDate(val: string | undefined | null): string {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); } catch { return '—'; }
}
function fmtRelative(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    const d = Date.now() - new Date(val).getTime();
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
    return fmtDate(val);
  } catch { return '—'; }
}

type Tab = 'suspended' | 'locked';

/* ── atoms ──────────────────────────────────────────────────────────── */
function KpiCard({ label, value, icon: Icon, accent, alert }: {
  label: string; value: string | number; icon: React.ElementType; accent: string; alert?: boolean;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5',
      alert ? 'border-red-500/30' : 'border-admin-border/50')}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
        accent === 'red' ? 'bg-red-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-indigo-500')} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          <p className={cn('mt-2 text-3xl font-bold tabular-nums', alert ? 'text-red-400' : 'text-admin-text')}>{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
          accent === 'red' ? 'border-red-500/25 bg-red-950/20 text-red-400' : accent === 'amber' ? 'border-amber-500/25 bg-amber-950/20 text-amber-400' : 'border-indigo-500/25 bg-indigo-950/20 text-indigo-400')}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = (status ?? '').toLowerCase();
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold',
      s === 'suspended' ? 'border-amber-500/30 bg-amber-950/20 text-amber-400' : 'border-red-500/30 bg-red-950/20 text-red-400')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s === 'suspended' ? 'bg-amber-400' : 'bg-red-400')} />
      {s === 'locked' ? 'Banned' : 'Suspended'}
    </span>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const pages = Array.from({ length: Math.min(5, total) }, (_, i) => start + i);
  return (
    <div className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {pages.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={cn('flex h-7 min-w-[28px] items-center justify-center rounded-lg border px-1.5 text-xs font-semibold',
            p === page ? 'border-red-500/50 bg-red-950/20 text-red-300' : 'border-admin-border/50 text-admin-muted hover:text-admin-text')}>
          {p}
        </button>
      ))}
      <button disabled={page >= total} onClick={() => onChange(page + 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────── */
export default function RestrictionsPage() {
  const token        = useAdminAuthStore((s) => s.accessToken);
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const [tab,    setTab]    = useState<Tab>('locked');
  const [search, setSearch] = useState('');
  const [suspPage, setSuspPage] = useState(1);
  const [bannPage, setBannPage] = useState(1);
  const pageSize = 25;

  /* Two independent queries — one per status — so counts & pages are accurate */
  const suspQ = useQuery({
    queryKey: ['admin', 'restrictions', 'suspended', token, search, suspPage],
    staleTime: 30_000,
    queryFn: () => getUsers(token, { page: suspPage, limit: pageSize, status: 'suspended', search: search.trim() || undefined }),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const bannQ = useQuery({
    queryKey: ['admin', 'restrictions', 'locked', token, search, bannPage],
    staleTime: 30_000,
    queryFn: () => getUsers(token, { page: bannPage, limit: pageSize, status: 'locked', search: search.trim() || undefined }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' }) =>
      updateUserStatus(token, id, { status, reason: 'Admin reactivation' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'restrictions'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
    },
  });

  const suspTotal   = suspQ.data?.data?.pagination?.total ?? 0;
  const bannTotal   = bannQ.data?.data?.pagination?.total ?? 0;
  const suspPages   = Math.max(1, Math.ceil(suspTotal / pageSize));
  const bannPages   = Math.max(1, Math.ceil(bannTotal / pageSize));

  const activeQ     = tab === 'suspended' ? suspQ : bannQ;
  const users       = activeQ.data?.data?.users ?? [];
  const total       = tab === 'suspended' ? suspTotal : bannTotal;
  const totalPages  = tab === 'suspended' ? suspPages : bannPages;
  const page        = tab === 'suspended' ? suspPage : bannPage;
  const setPage     = tab === 'suspended' ? setSuspPage : setBannPage;

  const isFetching  = suspQ.isFetching || bannQ.isFetching;
  const isError     = activeQ.isError;
  const error       = activeQ.error;

  return (
    <AdminPageFrame
      title="Restrictions & Bans"
      description="Manage suspended and permanently banned user accounts."
      status={bannTotal > 0 ? 'risk' : suspTotal > 0 ? 'warning' : 'active'}
      error={isError ? ((error as { message?: string })?.message ?? 'Failed to load users') : null}
      onRetry={() => { void suspQ.refetch(); void bannQ.refetch(); }}
      quickActions={
        <button type="button"
          onClick={() => { void suspQ.refetch(); void bannQ.refetch(); }}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </button>
      }
    >
      {/* KPI strip — counts come directly from pagination.total, not from the visible page */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Banned Users"    value={bannQ.isLoading ? '…' : bannTotal} icon={Ban}      accent="red"   alert={bannTotal > 0} />
        <KpiCard label="Suspended Users" value={suspQ.isLoading ? '…' : suspTotal} icon={ShieldOff} accent="amber" />
        <KpiCard label="Total Restricted" value={bannQ.isLoading || suspQ.isLoading ? '…' : bannTotal + suspTotal} icon={Users} accent="indigo" />
      </div>

      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        {/* Tabs + search */}
        <div className="flex flex-wrap items-center gap-3 border-b border-admin-border/30 px-5 py-3">
          <button type="button" onClick={() => setTab('locked')}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'locked' ? 'border-red-500/40 bg-red-950/15 text-red-300' : 'border-admin-border/40 text-admin-muted hover:text-admin-text')}>
            <Ban className="h-3 w-3" /> Banned
            <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold',
              tab === 'locked' ? 'bg-red-500/20 text-red-300' : 'bg-white/[0.05] text-admin-muted')}>
              {bannTotal}
            </span>
          </button>
          <button type="button" onClick={() => setTab('suspended')}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'suspended' ? 'border-amber-500/40 bg-amber-950/15 text-amber-300' : 'border-admin-border/40 text-admin-muted hover:text-admin-text')}>
            <ShieldOff className="h-3 w-3" /> Suspended
            <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold',
              tab === 'suspended' ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.05] text-admin-muted')}>
              {suspTotal}
            </span>
          </button>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Search email, username…" value={search}
              onChange={(e) => { setSearch(e.target.value); setSuspPage(1); setBannPage(1); }}
              className="h-8 w-52 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 pr-3 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-red-500/40" />
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSuspPage(1); setBannPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead>
              <tr className="border-b border-admin-border/50 bg-white/[0.015]">
                {['User', 'Email', 'Status', 'Risk', 'Country', 'Last Login', 'Joined', 'Actions'].map((h, i) => (
                  <th key={h} className={cn('px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-admin-muted', i === 7 && 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-admin-border/30">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-admin-muted">
                      <Check className="h-8 w-8 text-emerald-500/30" />
                      <p className="text-sm">No {tab === 'locked' ? 'banned' : 'suspended'} users</p>
                      <p className="text-xs opacity-60">{search ? 'Try adjusting your search' : 'All accounts are in good standing'}</p>
                    </div>
                  </td>
                </tr>
              ) : (users as AdminUserRow[]).map((u) => {
                const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '—';
                const st   = (u.status ?? '').toLowerCase();
                return (
                  <tr key={u.id}
                    className={cn('cursor-pointer border-b border-admin-border/25 transition-colors hover:bg-white/[0.02]',
                      st === 'locked' ? 'bg-red-950/[0.04]' : 'bg-amber-950/[0.03]')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                          st === 'locked' ? 'border-red-500/20 bg-red-950/20 text-red-400' : 'border-amber-500/20 bg-amber-950/20 text-amber-400')}>
                          {(name[0] ?? '?').toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold text-admin-text truncate max-w-[120px]">{name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-admin-muted truncate max-w-[180px]">{u.email ?? '—'}</td>
                    <td className="px-4 py-3"><StatusPill status={u.status} /></td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs font-semibold',
                        u.risk_level === 'high' ? 'text-red-400' : u.risk_level === 'medium' ? 'text-amber-400' : 'text-emerald-400')}>
                        {u.risk_level ?? 'low'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-admin-muted">{u.country_code || '—'}</td>
                    <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap" title={u.last_login_at ?? ''}>
                      {fmtRelative(u.last_login_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap">{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => router.push(`/users/${u.id}`)} title="View Profile"
                          className="p-1.5 rounded-lg text-admin-muted hover:text-blue-400 hover:bg-blue-950/15 transition-colors">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button type="button"
                          onClick={() => updateStatus.mutate({ id: u.id, status: 'active' })}
                          disabled={updateStatus.isPending}
                          title={st === 'locked' ? 'Unban & Reactivate' : 'Reactivate'}
                          className="flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-950/20 disabled:opacity-40 transition-colors">
                          <Check className="h-3 w-3" />
                          {st === 'locked' ? 'Unban' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
            <Pager page={page} total={totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-xs text-amber-400">
        <div className="flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">How Restrictions Work</p>
            <p className="opacity-70"><strong>Suspended</strong> — Temporarily blocked from login. Reversible. Use during investigations.</p>
            <p className="opacity-70"><strong>Banned</strong> — Permanently blocked. Every status change is recorded in the Audit Log.</p>
          </div>
        </div>
      </div>
    </AdminPageFrame>
  );
}
