'use client';

import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getDashboardStats } from '@/lib/api';
import { getUsers, updateUserStatus, type AdminUserRow } from '@/lib/users-api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { RiskBadge } from '@/components/users/RiskBadge';
import {
  Users, UserCheck, UserX, TrendingUp, Search, Download, ChevronLeft,
  ChevronRight, Eye, ShieldOff, Ban, KeyRound, Shield, Filter,
} from 'lucide-react';
import { cn } from '@/lib/cn';

function downloadCsv(rows: AdminUserRow[]) {
  const headers = ['Name', 'Email', 'KYC Level', 'Balance', 'Risk', '30d Volume', 'Status', 'Country', 'Created', 'ID'];
  const esc = (v: unknown) => (v == null ? '' : String(v).replace(/"/g, '""'));
  const toRow = (r: AdminUserRow) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || r.email || r.id?.slice(0, 8);
    return [name, r.email ?? '', kycLabel(r.kyc_level, r.kyc_status), r.total_balance ?? '', r.risk_level ?? 'low', r.volume_30d ?? '', r.status ?? '', r.country_code ?? '', r.created_at ?? '', r.id ?? ''];
  };
  const csv = [headers.join(','), ...rows.map((r) => toRow(r).map(esc).map((c) => `"${c}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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

function displayStatus(status: string): string {
  const s = (status ?? '').toLowerCase();
  if (s === 'locked') return 'Banned';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'locked', label: 'Banned' },
];
const KYC_OPTIONS = [
  { value: 'all', label: 'All KYC' },
  { value: '0', label: 'Not Started' },
  { value: '1', label: 'Level 1' },
  { value: '2', label: 'Level 2' },
  { value: '3', label: 'Level 3' },
];
const DATE_OPTIONS = [
  { value: 'all', label: 'Any Date' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export default function UsersPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kycFilter, setKycFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const queryParams = useMemo(() => {
    const p: Record<string, string | number> = { page, limit: pageSize };
    if (search.trim()) p.search = search.trim();
    if (statusFilter !== 'all') p.status = statusFilter;
    if (kycFilter !== 'all') p.kycLevel = kycFilter;
    return p;
  }, [search, statusFilter, kycFilter, page]);

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'dashboard-stats', token],
    queryFn: () => getDashboardStats(token),
    enabled: !!token, staleTime: 30000,
  });
  const us = statsData?.data?.users as { total?: number; newToday?: number; active?: number; suspended?: number; locked?: number } | undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', token, queryParams],
    staleTime: 30_000,
    queryFn: () => getUsers(token, queryParams),
    enabled: !!token, refetchInterval: 30_000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' | 'locked' }) =>
      updateUserStatus(token, id, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-stats'] }); },
  });

  const handleAction = useCallback((user: AdminUserRow, action: 'suspended' | 'locked') => {
    const label = action === 'suspended' ? 'Suspend' : 'Ban';
    if (confirm(`${label} user ${user.email ?? user.id}?`)) {
      updateStatus.mutate({ id: user.id, status: action });
    }
  }, [updateStatus]);

  const users = data?.data?.users ?? [];
  const total = data?.data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">User Management</h1>
          <p className="text-xs text-admin-muted mt-0.5">
            {total > 0 ? `${total.toLocaleString()} total users` : 'Manage all exchange users'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => downloadCsv(users)} icon={<Download className="h-3.5 w-3.5" />}>
          Export CSV
        </Button>
      </div>

      {/* KPI Row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Users" value={us?.total ?? '—'} icon={Users} accent="indigo" />
        <KpiCard label="New Today" value={us?.newToday ?? 0} icon={TrendingUp} accent="emerald" />
        <KpiCard label="Active" value={us?.active ?? '—'} icon={UserCheck} accent="blue" />
        <KpiCard label="Suspended / Banned" value={`${us?.suspended ?? 0} / ${us?.locked ?? 0}`} icon={UserX} accent="red"
          highlight={(us?.suspended ?? 0) > 0 || (us?.locked ?? 0) > 0} />
      </section>

      {/* Search + Filters */}
      <div className="rounded-xl border border-admin-border bg-admin-card">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="relative flex-1 min-w-[200px] max-w-[340px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-muted" />
            <input type="text" placeholder="Search email, username, ID..." value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-admin-border bg-white/[0.02] pl-9 pr-3 py-1.5 text-xs text-admin-text placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary" />
          </div>
          <SelectFilter options={STATUS_OPTIONS} value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1); }} />
          <SelectFilter options={KYC_OPTIONS} value={kycFilter} onChange={(v) => { setKycFilter(v); setPage(1); }} />
          <SelectFilter options={DATE_OPTIONS} value={dateFilter} onChange={(v) => { setDateFilter(v); setPage(1); }} />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-left text-xs">
            <thead>
              <tr className="border-y border-admin-border bg-white/[0.02]">
                <th className="px-4 py-2.5 font-medium text-admin-muted">User</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">KYC</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Balance</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Risk</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted text-right">30d Volume</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Status</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Country</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted">Joined</th>
                <th className="px-3 py-2.5 font-medium text-admin-muted text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-admin-border/50">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 w-20 rounded bg-white/5 animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <Shield className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-admin-muted">No users found</p>
                    <p className="text-[10px] text-gray-300 mt-1">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : users.map((u) => {
                const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '—';
                const st = (u.status ?? '').toLowerCase();
                return (
                  <tr key={u.id} className="border-b border-admin-border/50 hover:bg-white/5 cursor-pointer transition-colors"
                    onClick={() => router.push(`/users/${u.id}`)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[10px] font-bold text-admin-muted shrink-0">
                          {(name[0] ?? '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-admin-text truncate max-w-[160px]">{name}</p>
                          <p className="text-[10px] text-admin-muted truncate max-w-[160px]">{u.email ?? u.id.slice(0, 12)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <KycBadge level={u.kyc_level} status={u.kyc_status} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-admin-text">{fmtBal(u.total_balance as string | number)}</td>
                    <td className="px-3 py-2.5">
                      <RiskBadge level={(u.risk_level as 'low' | 'medium' | 'high') ?? 'low'} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-admin-muted">{fmtBal(u.volume_30d as string | number)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={displayStatus(u.status)} variant={st === 'active' ? 'success' : st === 'suspended' ? 'warning' : st === 'locked' ? 'danger' : 'default'} />
                    </td>
                    <td className="px-3 py-2.5 text-admin-muted">{u.country_code || '—'}</td>
                    <td className="px-3 py-2.5 text-admin-muted">{fmtDate(u.created_at)}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => router.push(`/users/${u.id}`)} title="View Details"
                          className="p-1.5 rounded-md text-admin-muted hover:text-admin-primary hover:bg-white/5 transition-colors">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {st !== 'suspended' && (
                          <button onClick={() => handleAction(u, 'suspended')} title="Suspend"
                            className="p-1.5 rounded-md text-admin-muted hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <ShieldOff className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {st !== 'locked' && (
                          <button onClick={() => handleAction(u, 'locked')} title="Ban"
                            className="p-1.5 rounded-md text-admin-muted hover:text-red-600 hover:bg-red-50 transition-colors">
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

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-admin-border px-4 py-2.5">
            <p className="text-[10px] text-admin-muted">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-admin-border text-admin-muted disabled:opacity-30 hover:bg-white/5 transition-colors">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-admin-muted tabular-nums px-2">Page {page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-admin-border text-admin-muted disabled:opacity-30 hover:bg-white/5 transition-colors">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

const ACCENT_MAP: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600',
  red: 'bg-red-50 text-red-600',
};

function KpiCard({ label, value, icon: Icon, accent = 'indigo', highlight }: {
  label: string; value: string | number; icon: React.ElementType; accent?: string; highlight?: boolean;
}) {
  return (
    <div className={cn('rounded-xl border bg-admin-card p-4', highlight ? 'border-red-200 bg-red-50/30' : 'border-admin-border')}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', ACCENT_MAP[accent] ?? ACCENT_MAP.indigo)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className={cn('text-xl font-bold tabular-nums', highlight ? 'text-red-600' : 'text-admin-text')}>{value}</p>
    </div>
  );
}

function KycBadge({ level, status }: { level?: number | null; status?: string | null }) {
  const s = (status ?? '').toLowerCase();
  const lv = level ?? 0;

  if (s === 'approved') {
    return <Badge variant="success" size="sm">L{lv} Verified</Badge>;
  }
  if (s === 'pending' || s === 'under_review') {
    return <Badge variant="warning" size="sm">L{lv} Pending</Badge>;
  }
  if (s === 'rejected') {
    return <Badge variant="danger" size="sm">Rejected</Badge>;
  }
  if (lv > 0) {
    return <Badge variant="info" size="sm">Level {lv}</Badge>;
  }
  return <span className="text-[10px] text-admin-muted">None</span>;
}

function SelectFilter({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-admin-border bg-white/[0.02] px-2.5 py-1.5 text-xs text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary">
      {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
