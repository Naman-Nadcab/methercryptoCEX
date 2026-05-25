'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Search, RefreshCw, Shield, ShieldOff, Check,
  X, UserCog, Clock, Mail, KeyRound, MoreHorizontal,
  Users, AlertTriangle, Activity,
} from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import { StatusBadge } from '@/components/dashboard/StatusBadge';

/* ── types ──────────────────────────────────────────────────────────── */
type AdminAccountRow = {
  id: string;
  name?: string;
  email: string;
  role: string;
  status?: string;
  lastLogin?: string;
  last_login_at?: string;
  two_factor_enabled?: boolean;
  permissions?: string[];
  is_active?: boolean;
};

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN',    label: 'Super Admin' },
  { value: 'RISK_MANAGER',   label: 'Risk Manager' },
  { value: 'SUPPORT_AGENT',  label: 'Support Agent' },
  { value: 'FINANCE_ADMIN',  label: 'Finance Admin' },
  { value: 'AUDITOR',        label: 'Auditor' },
];

const ROLE_ACCENTS: Record<string, string> = {
  SUPER_ADMIN:   'border-red-500/30 bg-red-950/15 text-red-400',
  RISK_MANAGER:  'border-amber-500/30 bg-amber-950/15 text-amber-400',
  SUPPORT_AGENT: 'border-blue-500/30 bg-blue-950/15 text-blue-400',
  FINANCE_ADMIN: 'border-emerald-500/30 bg-emerald-950/15 text-emerald-400',
  AUDITOR:       'border-slate-500/30 bg-slate-950/15 text-slate-400',
};

/* ── helpers ────────────────────────────────────────────────────────── */
function parseAdminUsersPayload(data: unknown): AdminAccountRow[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as AdminAccountRow[];
  if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>;
    for (const key of ['users', 'admins', 'items', 'data']) {
      const v = o[key];
      if (Array.isArray(v)) return v as AdminAccountRow[];
    }
  }
  return [];
}

function fmtRelative(v: string | null | undefined): string {
  if (!v) return '—';
  try {
    const d = Date.now() - new Date(v).getTime();
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
    return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  } catch { return '—'; }
}

function RolePill({ role }: { role: string }) {
  const key = role.toUpperCase().replace(/\s+/g, '_');
  const label = ROLE_OPTIONS.find((r) => r.value === key)?.label ?? role;
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold', ROLE_ACCENTS[key] ?? 'border-slate-500/30 bg-slate-950/15 text-slate-400')}>
      {label}
    </span>
  );
}

function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon: React.ElementType; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-admin-border/50 bg-admin-card p-5">
      <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-2xl',
        accent === 'indigo' ? 'bg-indigo-500' : accent === 'emerald' ? 'bg-emerald-500' : accent === 'amber' ? 'bg-amber-500' : 'bg-blue-500')} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted">{label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-admin-text">{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
          accent === 'indigo' ? 'border-indigo-500/25 bg-indigo-950/20 text-indigo-400' : accent === 'emerald' ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-400' : accent === 'amber' ? 'border-amber-500/25 bg-amber-950/20 text-amber-400' : 'border-blue-500/25 bg-blue-950/20 text-blue-400')}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

/* ── modal helper ────────────────────────────────────────────────────── */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-semibold text-admin-muted">{children}</label>;
}
function FieldInput({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className="w-full rounded-xl border border-admin-border/50 bg-white/[0.03] px-3 py-2 text-sm text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
  );
}
function FieldSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-admin-border/50 bg-white/[0.03] px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-blue-500/40">
      {children}
    </select>
  );
}

/* ── page ───────────────────────────────────────────────────────────── */
export default function AdminUsersPage() {
  const token        = useAdminAuthStore((s) => s.accessToken);
  const queryClient  = useQueryClient();

  const [search,       setSearch]       = useState('');
  const [roleFilter,   setRoleFilter]   = useState('all');
  const [addOpen,      setAddOpen]      = useState(false);
  const [editOpen,     setEditOpen]     = useState(false);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editRole,     setEditRole]     = useState('SUPPORT_AGENT');
  const [editError,    setEditError]    = useState('');
  const [formName,     setFormName]     = useState('');
  const [formEmail,    setFormEmail]    = useState('');
  const [formRole,     setFormRole]     = useState('SUPPORT_AGENT');
  const [formPassword, setFormPassword] = useState('');
  const [createError,  setCreateError]  = useState('');
  const [actionTarget, setActionTarget] = useState<{ row: AdminAccountRow; action: 'suspend' | 'activate' | 'resetpw' } | null>(null);

  /* ── queries ── */
  const listQ = useQuery({
    queryKey: ['admin', 'admins', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<unknown>('/admins', { token }),
    enabled: !!token,
    retry: false,
    refetchInterval: 60_000,
  });

  const allRows = useMemo(() => {
    if (!listQ.data?.success || !listQ.data.data) return [];
    return parseAdminUsersPayload(listQ.data.data);
  }, [listQ.data]);

  const apiUnavailable = useMemo(() => {
    if (!listQ.data) return false;
    if (!listQ.data.success) {
      const code = listQ.data.error?.code?.toUpperCase() ?? '';
      const msg  = listQ.data.error?.message ?? '';
      return code === 'NOT_FOUND' || msg.includes('404');
    }
    return false;
  }, [listQ.data]);

  const filtered = useMemo(() => {
    let rows = allRows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.email.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
    }
    if (roleFilter !== 'all') {
      rows = rows.filter((r) => r.role.toUpperCase().replace(/\s+/g, '_') === roleFilter);
    }
    return rows;
  }, [allRows, search, roleFilter]);

  const activeCount  = allRows.filter((r) => (r.status ?? 'active') === 'active').length;
  const superAdmins  = allRows.filter((r) => r.role.toUpperCase().replace(/\s+/g, '_') === 'SUPER_ADMIN').length;
  const twoFaEnabled = allRows.filter((r) => r.two_factor_enabled === true).length;

  /* ── mutations ── */
  const createMutation = useMutation({
    mutationFn: (body: { name: string; email: string; role: string; password: string }) =>
      adminFetch('/admins', { method: 'POST', body, token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      setAddOpen(false); setFormName(''); setFormEmail(''); setFormRole('SUPPORT_AGENT'); setFormPassword('');
    },
    onError: () => setCreateError('Failed to create admin. Email may already be in use.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string | boolean> }) =>
      adminFetch(`/admins/${id}`, { method: 'PATCH', body, token }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      if (res.success) { setEditOpen(false); setEditingId(null); setEditError(''); setActionTarget(null); }
      else setEditError(res.error?.message ?? 'Update failed');
    },
    onError: () => setEditError('Failed to update. Please try again.'),
  });
  const resetPwMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch(`/admins/${id}/reset-password`, { method: 'POST', token, body: { reason } }),
    onSuccess: () => setActionTarget(null),
    onError: () => setEditError('Failed to send password reset email.'),
  });

  const openEditRole = (row: AdminAccountRow) => {
    const key = row.role.toUpperCase().replace(/\s+/g, '_');
    setEditingId(row.id);
    setEditRole(ROLE_OPTIONS.find((r) => r.value === key)?.value ?? 'SUPPORT_AGENT');
    setEditError('');
    setEditOpen(true);
  };

  return (
    <AdminPageFrame
      title="Admin Users"
      description="Manage admin accounts, roles, access, and 2FA."
      error={listQ.isError ? (listQ.error instanceof Error ? listQ.error.message : 'Failed to load admin users.') : null}
      onRetry={listQ.isError ? () => { void listQ.refetch(); } : undefined}
      quickActions={
        <>
          <button type="button" onClick={() => listQ.refetch()} disabled={listQ.isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('h-3.5 w-3.5', listQ.isFetching && 'animate-spin')} />
          </button>
          <button type="button" onClick={() => { setAddOpen(true); setCreateError(''); }}
            disabled={apiUnavailable}
            className="flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-950/15 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-950/25 disabled:opacity-40 transition-colors">
            <UserPlus className="h-3.5 w-3.5" /> Add Admin
          </button>
        </>
      }
    >
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Admins"   value={allRows.length}  icon={Users}         accent="indigo" />
        <KpiCard label="Active"         value={activeCount}     icon={Activity}      accent="emerald" />
        <KpiCard label="Super Admins"   value={superAdmins}     icon={Shield}        accent="amber" />
        <KpiCard label="2FA Enabled"    value={twoFaEnabled > 0 ? twoFaEnabled : '—'} icon={KeyRound} accent="blue" />
      </div>

      {apiUnavailable && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-400">Admin User API not configured</p>
              <p className="mt-1 text-xs text-amber-400/70">The `/admin-users` endpoint is not available. Contact your system administrator to enable it.</p>
            </div>
          </div>
        </div>
      )}

      {!apiUnavailable && (
        <div className="rounded-2xl border border-admin-border/50 bg-admin-card">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-admin-border/30 px-5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
              <input type="text" placeholder="Search name or email…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-52 rounded-lg border border-admin-border/50 bg-white/[0.03] pl-8 pr-3 text-xs text-admin-text placeholder:text-admin-muted focus:outline-none focus:border-blue-500/40" />
              {search && <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-admin-muted hover:text-admin-text"><X className="h-3 w-3" /></button>}
            </div>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className="h-8 rounded-lg border border-admin-border/50 bg-admin-card px-2 text-xs text-admin-text focus:outline-none focus:border-blue-500/40">
              <option value="all">All Roles</option>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <span className="ml-auto text-xs text-admin-muted">{filtered.length} admins</span>
            {listQ.isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="border-b border-admin-border/50 bg-white/[0.015]">
                  {['Admin', 'Role', 'Status', '2FA', 'Last Login', 'Actions'].map((h, i) => (
                    <th key={h} className={cn('px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-admin-muted', i === 5 && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listQ.isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-admin-border/30">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-5 py-3"><div className="h-3 w-20 rounded bg-white/[0.05] animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-admin-muted">
                        <UserCog className="h-8 w-8 opacity-10" />
                        <p className="text-sm">No admin accounts found</p>
                        <p className="text-xs opacity-60">{search ? 'Try adjusting your search' : 'Add the first admin above'}</p>
                      </div>
                    </td>
                  </tr>
                ) : filtered.map((row) => {
                  const ll = row.lastLogin ?? row.last_login_at;
                  const normalizedStatus = row.status ?? (row.is_active === false ? 'suspended' : 'active');
                  const st = normalizedStatus.toLowerCase();
                  return (
                    <tr key={row.id} className="border-b border-admin-border/25 transition-colors hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-500/20 bg-blue-950/20 text-xs font-bold text-blue-400">
                            {((row.name ?? row.email)[0] ?? '?').toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-admin-text">{row.name ?? '—'}</p>
                            <p className="text-[10px] text-admin-muted truncate max-w-[180px]">{row.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3"><RolePill role={row.role} /></td>
                      <td className="px-5 py-3"><StatusBadge status={normalizedStatus} /></td>
                      <td className="px-5 py-3">
                        {row.two_factor_enabled === true ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400"><Check className="h-3 w-3" /> On</span>
                        ) : row.two_factor_enabled === false ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-400"><X className="h-3 w-3" /> Off</span>
                        ) : (
                          <span className="text-[10px] text-admin-muted/50">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-admin-muted whitespace-nowrap" title={ll ?? ''}>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3 opacity-50" />{fmtRelative(ll)}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => openEditRole(row)} title="Edit Role"
                            className="flex items-center gap-1 rounded-lg border border-admin-border/40 px-2.5 py-1 text-[10px] font-semibold text-admin-muted hover:text-admin-text hover:border-admin-border transition-colors">
                            <UserCog className="h-3 w-3" /> Role
                          </button>
                          {st === 'active' ? (
                            <button type="button"
                              onClick={() => setActionTarget({ row, action: 'suspend' })}
                              className="flex items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-950/10 px-2.5 py-1 text-[10px] font-semibold text-amber-400 hover:bg-amber-950/20 transition-colors">
                              <ShieldOff className="h-3 w-3" /> Suspend
                            </button>
                          ) : (
                            <button type="button"
                              onClick={() => setActionTarget({ row, action: 'activate' })}
                              className="flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-950/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-950/20 transition-colors">
                              <Check className="h-3 w-3" /> Activate
                            </button>
                          )}
                          <button type="button" onClick={() => setActionTarget({ row, action: 'resetpw' })} title="Reset Password"
                            className="p-1.5 rounded-lg text-admin-muted hover:text-amber-400 hover:bg-amber-950/15 transition-colors">
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Role Permission Reference */}
      <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Role Permission Matrix</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-[10px]">
            <thead>
              <tr className="border-b border-admin-border/40">
                <th className="pb-2 text-admin-muted font-semibold uppercase tracking-wider">Role</th>
                {['Users', 'KYC', 'Finance', 'Risk/AML', 'Settings', 'Audit'].map((p) => (
                  <th key={p} className="pb-2 px-3 text-center text-admin-muted font-semibold uppercase tracking-wider">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { role: 'Super Admin',    caps: [true,true,true,true,true,true] },
                { role: 'Risk Manager',   caps: [false,true,false,true,false,true] },
                { role: 'Finance Admin',  caps: [false,false,true,true,false,true] },
                { role: 'Support Agent',  caps: [true,false,false,false,false,false] },
                { role: 'Auditor',        caps: [false,false,false,false,false,true] },
              ].map(({ role, caps }) => (
                <tr key={role} className="border-b border-admin-border/25">
                  <td className="py-2 text-xs font-medium text-admin-text">{role}</td>
                  {caps.map((c, i) => (
                    <td key={i} className="py-2 px-3 text-center">
                      {c ? <span className="text-emerald-400 font-bold">✓</span> : <span className="text-admin-muted/30">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-admin-muted/50">Fine-grained permissions are enforced server-side. This matrix is a reference guide.</p>
      </div>

      {/* Edit Role Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-admin-text">Edit Role</h3>
              <button type="button" onClick={() => setEditOpen(false)} className="text-admin-muted hover:text-admin-text"><X className="h-4 w-4" /></button>
            </div>
            <FieldLabel>Role</FieldLabel>
            <FieldSelect value={editRole} onChange={setEditRole}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </FieldSelect>
            {editError && <p className="mt-3 rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-400">{editError}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setEditOpen(false)}
                className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
                Cancel
              </button>
              <button type="button" disabled={!editingId || updateMutation.isPending}
                onClick={() => { if (editingId) updateMutation.mutate({ id: editingId, body: { role: editRole } }); }}
                className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-all">
                {updateMutation.isPending ? 'Saving…' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ActionAuthModal
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!actionTarget) return;
          const { row, action } = actionTarget;
          if (action === 'resetpw') {
            resetPwMutation.mutate({ id: row.id, reason: payload.reason });
            return;
          }
          updateMutation.mutate({
            id: row.id,
            body: {
              is_active: action === 'activate',
              reason: payload.reason,
            },
          });
        }}
        title={
          actionTarget?.action === 'suspend'
            ? 'Suspend admin account'
            : actionTarget?.action === 'resetpw'
              ? 'Send admin password reset'
              : 'Activate admin account'
        }
        actionLabel={
          actionTarget?.action === 'suspend'
            ? `Suspend ${actionTarget.row.email}`
            : actionTarget?.action === 'resetpw'
              ? `Send password reset to ${actionTarget.row.email}`
              : `Activate ${actionTarget?.row.email ?? 'admin'}`
        }
        description="Privileged admin actions require operator reason and verification."
        requireReason
        twofaRequired
        confirmationPhrase={actionTarget?.action === 'suspend' ? 'CONFIRM SUSPEND_ADMIN' : undefined}
        externalError={editError || null}
        isPending={updateMutation.isPending || resetPwMutation.isPending}
        confirmLabel={
          updateMutation.isPending || resetPwMutation.isPending
            ? 'Processing…'
            : actionTarget?.action === 'suspend'
              ? 'Suspend admin'
              : actionTarget?.action === 'resetpw'
                ? 'Send reset'
                : 'Activate admin'
        }
        confirmVariant={actionTarget?.action === 'suspend' ? 'danger' : 'primary'}
      />

      {/* Add Admin Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setAddOpen(false); setCreateError(''); }} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-admin-border/60 bg-admin-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-950/20">
                  <UserPlus className="h-4 w-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-admin-text">Add Admin Account</h3>
              </div>
              <button type="button" onClick={() => { setAddOpen(false); setCreateError(''); }} className="text-admin-muted hover:text-admin-text"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div><FieldLabel>Full Name</FieldLabel><FieldInput value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="John Smith" /></div>
              <div>
                <FieldLabel>Email Address</FieldLabel>
                <div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
                  <FieldInput type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="admin@exchange.com" className="pl-9" /></div>
              </div>
              <div><FieldLabel>Role</FieldLabel>
                <FieldSelect value={formRole} onChange={setFormRole}>
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </FieldSelect>
              </div>
              <div>
                <FieldLabel>Temporary Password</FieldLabel>
                <div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-admin-muted" />
                  <FieldInput type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Min 8 characters" className="pl-9" /></div>
                <p className="mt-1 text-[10px] text-admin-muted">The admin must change this on first login.</p>
              </div>
            </div>
            {createError && <p className="mt-3 rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-400">{createError}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => { setAddOpen(false); setCreateError(''); }}
                className="flex-1 rounded-xl border border-admin-border/50 py-2 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
                Cancel
              </button>
              <button type="button" disabled={createMutation.isPending}
                onClick={() => {
                  setCreateError('');
                  if (!formName.trim() || !formEmail.trim() || formPassword.length < 8) {
                    setCreateError('All fields required. Password must be at least 8 characters.');
                    return;
                  }
                  createMutation.mutate({ name: formName.trim(), email: formEmail.trim().toLowerCase(), role: formRole, password: formPassword });
                }}
                className="flex-1 rounded-xl bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-all">
                {createMutation.isPending ? 'Creating…' : 'Create Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminPageFrame>
  );
}
