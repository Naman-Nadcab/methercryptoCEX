'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getDashboardStats } from '@/lib/api';
import { getUsers, updateUserStatus, type AdminUserRow } from '@/lib/users-api';
import { RiskBadge } from '@/components/users/RiskBadge';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import {
  Users, UserCheck, UserX, TrendingUp, Search, Download, Eye,
  ShieldOff, Ban, Shield, RefreshCw, X, Check, AlertTriangle,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

/* ── helpers ────────────────────────────────────────────────────────── */
function kycLabel(level?: number | null, status?: string | null): string {
  if (!status && !level) return 'None';
  const s = (status ?? '').toLowerCase();
  if (s === 'approved') return `L${level ?? 0} Verified`;
  if (s === 'pending' || s === 'under_review') return `L${level ?? 0} Pending`;
  if (s === 'rejected') return 'Rejected';
  if (level && level > 0) return `Level ${level}`;
  return 'Not Started';
}
function fmtBal(val: string | number | undefined): string {
  if (val === undefined || val === null) return '—';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (Number.isNaN(n) || n === 0) return '$0';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtDate(val: string | undefined): string {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); } catch { return '—'; }
}
function fmtRelative(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    const diff = Date.now() - new Date(val).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return fmtDate(val);
  } catch { return '—'; }
}
function displayStatus(status: string): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'locked' || s === 'banned') return 'Banned';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
}
function downloadCsv(rows: AdminUserRow[]) {
  const headers = ['Name', 'Email', 'KYC Level', 'Balance', 'Risk', '30d Volume', 'Status', 'Country', 'Last Login', 'Created', 'ID'];
  const esc = (v: unknown) => (v == null ? '' : String(v).replace(/"/g, '""'));
  const toRow = (r: AdminUserRow) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || r.email || r.id?.slice(0, 8);
    return [name, r.email ?? '', kycLabel(r.kyc_level, r.kyc_status), r.total_balance ?? '', r.risk_level ?? 'low', r.volume_30d ?? '', r.status ?? '', r.country_code ?? '', r.last_login_at ?? '', r.created_at ?? '', r.id ?? ''];
  };
  const csv = [headers.join(','), ...rows.map((r) => toRow(r).map(esc).map((c) => `"${c}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

/* ── filter options ─────────────────────────────────────────────────── */
const STATUS_OPTS = [
  { value: 'all', label: 'All Statuses' }, { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' }, { value: 'locked', label: 'Banned' },
];
const KYC_OPTS = [
  { value: 'all', label: 'All KYC' }, { value: '0', label: 'Not Started' },
  { value: '1', label: 'Level 1' }, { value: '2', label: 'Level 2' }, { value: '3', label: 'Level 3' },
];
const RISK_OPTS = [
  { value: 'all', label: 'All Risk' }, { value: 'high', label: 'High Risk' },
  { value: 'medium', label: 'Medium Risk' }, { value: 'low', label: 'Low Risk' },
];
const DATE_OPTS = [
  { value: 'all', label: 'Any Date' }, { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' },
];

/* ── atoms ──────────────────────────────────────────────────────────── */
function KpiCard({ label, value, icon: Icon, accent, alert = false }: {
  label: string; value: string | number; icon: React.ElementType; accent: string; alert?: boolean;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border bg-admin-card p-5', accent)}>
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
        accent.includes('red') ? 'bg-red-500' : accent.includes('emerald') ? 'bg-emerald-500' :
        accent.includes('blue') ? 'bg-blue-500' : 'bg-indigo-500')} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          <p className={cn('mt-2 text-3xl font-bold tabular-nums', alert ? 'text-red-400' : 'text-admin-text')}>{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
          accent.includes('red') ? 'border-red-500/25 bg-red-950/20 text-red-400' :
          accent.includes('emerald') ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-400' :
          accent.includes('blue') ? 'border-blue-500/25 bg-blue-950/20 text-blue-400' :
          'border-indigo-500/25 bg-indigo-950/20 text-indigo-400')}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {alert && <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-red-400">Needs attention</p>}
    </div>
  );
}

function KycBadge({ level, status }: { level?: number | null; status?: string | null }) {
  const s = (status ?? '').toLowerCase(); const lv = level ?? 0;
  if (s === 'approved') return <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-950/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">L{lv} ✓</span>;
  if (s === 'pending' || s === 'under_review') return <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-950/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">L{lv} Pending</span>;
  if (s === 'rejected') return <span className="inline-flex items-center rounded-md border border-red-500/30 bg-red-950/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">Rejected</span>;
  if (lv > 0) return <span className="inline-flex items-center rounded-md border border-blue-500/30 bg-blue-950/20 px-2 py-0.5 text-[10px] font-semibold text-blue-400">L{lv}</span>;
  return <span className="text-[10px] text-admin-muted/50">—</span>;
}

function StatusPill({ status }: { status: string }) {
  /**
   * Accept both the DB enum value (`banned`) and the legacy UI alias (`locked`).
   * Without this, rows with `status='banned'` from the API were falling through
   * to the neutral "unknown" style.
   */
  const s = (status ?? '').toLowerCase();
  const isBanned = s === 'banned' || s === 'locked';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold',
      s === 'active' ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400' :
      s === 'suspended' ? 'border-amber-500/30 bg-amber-950/20 text-amber-400' :
      s === 'pending' ? 'border-blue-500/30 bg-blue-950/20 text-blue-400' :
      isBanned ? 'border-red-500/30 bg-red-950/20 text-red-400' :
      'border-admin-border/50 bg-white/[0.03] text-admin-muted')}>
      <span className={cn('h-1.5 w-1.5 rounded-full',
        s === 'active' ? 'bg-emerald-400' :
        s === 'suspended' ? 'bg-amber-400' :
        s === 'pending' ? 'bg-blue-400' :
        isBanned ? 'bg-red-400' : 'bg-admin-muted/30')} />
      {displayStatus(status)}
    </span>
  );
}

function SelectFilter({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const pages = Array.from({ length: Math.min(5, total) }, (_, i) => start + i);
  return (
    <div className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text text-xs">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {pages.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={cn('flex h-7 min-w-[28px] items-center justify-center rounded-lg border px-1.5 text-xs font-semibold',
            p === page ? 'border-blue-500/50 bg-blue-950/20 text-blue-300' : 'border-admin-border/50 text-admin-muted hover:text-admin-text')}>
          {p}
        </button>
      ))}
      <button disabled={page >= total} onClick={() => onChange(page + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/50 text-admin-muted disabled:opacity-30 hover:text-admin-text text-xs">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── confirm modal ──────────────────────────────────────────────────── */
function ConfirmModal({ open, user, action, onClose, onConfirm, loading }: {
  open: boolean; user: AdminUserRow | null; action: 'suspended' | 'locked' | null;
  onClose: () => void; onConfirm: () => void; loading: boolean;
}) {
  if (!open || !user || !action) return null;
  const isBan = action === 'locked';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl">
        <div className={cn('mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border',
          isBan ? 'border-red-500/30 bg-red-950/20' : 'border-amber-500/30 bg-amber-950/20')}>
          {isBan ? <Ban className="h-6 w-6 text-red-400" /> : <ShieldOff className="h-6 w-6 text-amber-400" />}
        </div>
        <h3 className="mb-1 text-center text-sm font-semibold text-admin-text">{isBan ? 'Ban User' : 'Suspend User'}</h3>
        <p className="mb-5 text-center text-xs text-admin-muted">
          {isBan ? 'This will permanently ban' : 'This will suspend'} <span className="font-semibold text-admin-text">{user.email ?? user.id.slice(0, 12)}</span>
          {isBan ? '. They will not be able to login.' : '. They can be reactivated later.'}
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={loading}
            className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={cn('flex-1 rounded-xl py-2 text-xs font-semibold text-white transition-all disabled:opacity-40',
              isBan ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500')}>
            {loading ? 'Processing…' : isBan ? 'Ban User' : 'Suspend User'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────── */
export default function UsersPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kycFilter,    setKycFilter]    = useState('all');
  const [riskFilter,   setRiskFilter]   = useState('all');
  const [dateFilter,   setDateFilter]   = useState('all');
  const [page,         setPage]         = useState(1);
  const [confirmModal, setConfirmModal] = useState<{ user: AdminUserRow; action: 'suspended' | 'locked' } | null>(null);
  const pageSize = 20;

  useEffect(() => { setPage(1); }, [search, statusFilter, kycFilter, riskFilter, dateFilter]);

  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = { page, limit: pageSize };
    if (search.trim()) p.search = search.trim();
    if (statusFilter !== 'all') p.status = statusFilter;
    if (kycFilter !== 'all') p.kycLevel = kycFilter;
    if (riskFilter !== 'all') p.riskLevel = riskFilter;
    if (dateFilter !== 'all') p.joinedWithinDays = dateFilter;
    return p;
  }, [search, statusFilter, kycFilter, riskFilter, dateFilter, page]);

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'dashboard-stats', token],
    queryFn: () => getDashboardStats(token),
    enabled: !!token, staleTime: 30_000,
  });
  const us = statsData?.data?.users as { total?: number; newToday?: number; active?: number; activeUsers?: number; pending?: number; suspended?: number; banned?: number; locked?: number; verified?: number } | undefined;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'users', token, queryParams],
    staleTime: 30_000,
    queryFn: () => getUsers(token, queryParams),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' | 'locked' }) =>
      updateUserStatus(token, id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] });
      setConfirmModal(null);
    },
  });

  const users      = data?.data?.users ?? [];
  const total      = data?.data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilter  = search || statusFilter !== 'all' || kycFilter !== 'all' || riskFilter !== 'all' || dateFilter !== 'all';

  return (
    <AdminPageFrame
      title="Users"
      description="Manage all exchange users, accounts, and access control."
      status={(us?.locked ?? 0) > 0 ? 'risk' : (us?.suspended ?? 0) > 5 ? 'warning' : 'active'}
      error={isError ? ((error as { message?: string })?.message ?? 'Failed to load users') : null}
      onRetry={() => void refetch()}
      quickActions={
        <>
          <div className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-admin-muted">LIVE</span>
          </div>
          <button type="button" onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </button>
          <button type="button" onClick={() => downloadCsv(users)}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </>
      }
    >
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Users"       value={us?.total    ?? '—'} icon={Users}     accent="border-indigo-500/20" />
        <KpiCard label="New Today"         value={us?.newToday ?? 0}   icon={TrendingUp} accent="border-emerald-500/20" />
        <KpiCard label="Active"            value={us?.activeUsers ?? us?.active ?? '—'} icon={UserCheck}  accent="border-blue-500/20" />
        <KpiCard label="Suspended / Banned"
          value={`${us?.suspended ?? 0} / ${(us?.banned ?? 0) + (us?.locked ?? 0)}`}
          icon={UserX} accent="border-red-500/20"
          alert={(us?.suspended ?? 0) > 0 || (us?.locked ?? 0) > 0} />
      </div>

      {/* Filter + table panel */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
            <input type="text" placeholder="Search email, username, ID…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 pr-7 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
            {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text"><X className="h-3 w-3" /></button>}
          </div>
          <SelectFilter options={STATUS_OPTS} value={statusFilter} onChange={setStatusFilter} />
          <SelectFilter options={KYC_OPTS}    value={kycFilter}    onChange={setKycFilter} />
          <SelectFilter options={RISK_OPTS}   value={riskFilter}   onChange={setRiskFilter} />
          <SelectFilter options={DATE_OPTS}   value={dateFilter}   onChange={setDateFilter} />
          {hasFilter && (
            <button type="button"
              onClick={() => { setSearch(''); setStatusFilter('all'); setKycFilter('all'); setRiskFilter('all'); setDateFilter('all'); }}
              className="flex items-center gap-1 rounded-lg border border-red-500/25 bg-red-950/10 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/20 transition-colors">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
          <span className="ml-auto text-xs text-admin-muted">{total.toLocaleString()} users</span>
          {isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
        </div>

        {/* table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead>
              <tr className="border-b border-admin-border/50 bg-white/[0.015]">
                {['User', 'KYC', 'Balance', 'Risk', '30d Vol', 'Status', 'Country', 'Last Login', 'Joined', 'Actions'].map((h, i) => (
                  <th key={h} className={cn('px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-admin-muted',
                    i >= 2 && i <= 4 ? 'text-right' : i === 9 ? 'text-right' : '')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-admin-border/30">
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-2 text-admin-muted">
                      <Shield className="h-8 w-8 opacity-10" />
                      <p className="text-sm">No users found</p>
                      <p className="text-xs opacity-60">Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : users.map((u) => {
                const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '—';
                const st   = (u.status ?? '').toLowerCase();
                const isBannedRow = st === 'banned' || st === 'locked';
                return (
                  <tr key={u.id}
                    onClick={() => router.push(`/users/${u.id}`)}
                    className={cn('cursor-pointer border-b border-admin-border/25 transition-colors hover:bg-white/[0.02]',
                      isBannedRow && 'bg-red-950/[0.04]',
                      st === 'suspended' && 'bg-amber-950/[0.03]')}>
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-950/20 border border-blue-500/20 text-[10px] font-bold text-blue-400">
                          {(name[0] ?? '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-admin-text truncate max-w-[150px]">{name}</p>
                          <p className="text-[10px] text-admin-muted truncate max-w-[150px]">{u.email ?? u.id.slice(0, 12)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><KycBadge level={u.kyc_level} status={u.kyc_status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-admin-text">{fmtBal(u.total_balance as string | number)}</td>
                    <td className="px-4 py-3"><RiskBadge level={(u.risk_level as 'low' | 'medium' | 'high') ?? 'low'} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-admin-muted">{fmtBal(u.volume_30d as string | number)}</td>
                    <td className="px-4 py-3"><StatusPill status={u.status} /></td>
                    <td className="px-4 py-3 text-xs text-admin-muted">{u.country_code || '—'}</td>
                    <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap" title={u.last_login_at ?? ''}>
                      {fmtRelative(u.last_login_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-admin-muted whitespace-nowrap">{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => router.push(`/users/${u.id}`)} title="View Details"
                          className="p-1.5 rounded-lg text-admin-muted hover:text-blue-400 hover:bg-blue-950/15 transition-colors">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {(st === 'suspended' || isBannedRow) && (
                          <button onClick={() => updateStatus.mutate({ id: u.id, status: 'active' })} title="Reactivate"
                            className="p-1.5 rounded-lg text-admin-muted hover:text-emerald-400 hover:bg-emerald-950/15 transition-colors">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {st !== 'suspended' && !isBannedRow && (
                          <button onClick={() => setConfirmModal({ user: u, action: 'suspended' })} title="Suspend"
                            className="p-1.5 rounded-lg text-admin-muted hover:text-amber-400 hover:bg-amber-950/15 transition-colors">
                            <ShieldOff className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!isBannedRow && (
                          <button onClick={() => setConfirmModal({ user: u, action: 'locked' })} title="Ban"
                            className="p-1.5 rounded-lg text-admin-muted hover:text-red-400 hover:bg-red-950/15 transition-colors">
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-admin-border/30 px-5 py-3">
            <span className="text-xs text-admin-muted">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
            </span>
            <Pager page={page} total={totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Confirm modal */}
      <ConfirmModal
        open={!!confirmModal}
        user={confirmModal?.user ?? null}
        action={confirmModal?.action ?? null}
        onClose={() => setConfirmModal(null)}
        onConfirm={() => confirmModal && updateStatus.mutate({ id: confirmModal.user.id, status: confirmModal.action })}
        loading={updateStatus.isPending}
      />
    </AdminPageFrame>
  );
}
