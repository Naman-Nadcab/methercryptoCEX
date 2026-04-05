'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  TableSkeleton,
} from '@/components/ui';

type AdminAccountRow = {
  id: string;
  name?: string;
  email: string;
  role: string;
  status?: string;
  lastLogin?: string;
  last_login_at?: string;
};

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'RISK_MANAGER', label: 'Risk Manager' },
  { value: 'SUPPORT_AGENT', label: 'Support Agent' },
  { value: 'FINANCE_ADMIN', label: 'Finance Admin' },
  { value: 'AUDITOR', label: 'Auditor' },
];

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

function roleBadgeProps(role: string): { variant: 'danger' | 'warning' | 'info' | 'success' | 'default'; label: string } {
  const u = role.toUpperCase().replace(/\s+/g, '_');
  const label = ROLE_OPTIONS.find((r) => r.value === u)?.label ?? role;
  switch (u) {
    case 'SUPER_ADMIN':
      return { variant: 'danger', label };
    case 'RISK_MANAGER':
      return { variant: 'warning', label };
    case 'SUPPORT_AGENT':
      return { variant: 'info', label };
    case 'FINANCE_ADMIN':
      return { variant: 'success', label };
    case 'AUDITOR':
      return { variant: 'default', label };
    default:
      return { variant: 'default', label: role };
  }
}

export default function AdminUsersPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('SUPPORT_AGENT');
  const [formPassword, setFormPassword] = useState('');
  const [createError, setCreateError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('SUPPORT_AGENT');

  const listQ = useQuery({
    queryKey: ['admin', 'admin-users', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<unknown>('/admin-users', { token }),
    enabled: !!token,
    retry: false,
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; email: string; role: string; password: string }) =>
      adminFetch('/admin-users', { method: 'POST', body, token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'admin-users'] });
      setAddOpen(false);
      setFormName('');
      setFormEmail('');
      setFormRole('SUPPORT_AGENT');
      setFormPassword('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      adminFetch(`/admin-users/${id}`, { method: 'PATCH', body, token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'admin-users'] });
    },
  });

  const apiUnavailable = useMemo(() => {
    if (!listQ.data) return false;
    if (!listQ.data.success) {
      const code = listQ.data.error?.code?.toUpperCase();
      const msg = listQ.data.error?.message ?? '';
      if (code === 'NOT_FOUND' || msg.includes('404')) return true;
      return false;
    }
    return false;
  }, [listQ.data]);

  const rows = useMemo(() => {
    if (!listQ.data?.success || !listQ.data.data) return [];
    return parseAdminUsersPayload(listQ.data.data);
  }, [listQ.data]);

  const lastLogin = (row: AdminAccountRow) => row.lastLogin ?? row.last_login_at;

  const openEditRole = (row: AdminAccountRow) => {
    const u = row.role.toUpperCase().replace(/\s+/g, '_');
    const match = ROLE_OPTIONS.find((r) => r.value === u)?.value ?? 'SUPPORT_AGENT';
    setEditingId(row.id);
    setEditRole(match);
    setEditOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Admin Users</h1>
          <p className="text-xs text-admin-muted mt-0.5">Manage admin accounts, roles, and permissions.</p>
        </div>
        <Button type="button" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAddOpen(true)} disabled={apiUnavailable}>
          Add Admin
        </Button>
      </div>

      {apiUnavailable && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-admin-muted">
              Admin user management API not yet configured. Contact your system administrator.
            </p>
          </CardContent>
        </Card>
      )}

      {!apiUnavailable && (
        <Card>
          <CardHeader>
            <CardTitle>Directory</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {listQ.isLoading ? (
              <TableSkeleton rows={5} cols={6} />
            ) : rows.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-admin-muted">No admin accounts returned.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-admin-border bg-white/[0.02] text-xs font-semibold uppercase tracking-wide text-admin-muted">
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Email</th>
                      <th className="px-6 py-3">Role</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Last Login</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rb = roleBadgeProps(row.role);
                      const st = (row.status ?? 'active').toLowerCase();
                      return (
                        <tr key={row.id} className="border-b border-admin-border last:border-0 hover:bg-white/5">
                          <td className="px-6 py-3 font-medium text-admin-text">{row.name ?? '—'}</td>
                          <td className="px-6 py-3 text-admin-muted">{row.email}</td>
                          <td className="px-6 py-3">
                            <Badge variant={rb.variant} className={cn('text-[10px]')}>
                              {rb.label}
                            </Badge>
                          </td>
                          <td className="px-6 py-3">
                            <Badge
                              variant={st === 'active' ? 'success' : st === 'suspended' ? 'warning' : 'default'}
                              className={cn('text-[10px] capitalize')}
                            >
                              {row.status ?? 'active'}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-admin-muted">
                            {lastLogin(row) ? new Date(lastLogin(row)!).toLocaleString() : '—'}
                          </td>
                          <td className="px-6 py-3">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={updateMutation.isPending}
                                onClick={() => openEditRole(row)}
                              >
                                Edit Role
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={updateMutation.isPending || st === 'suspended'}
                                onClick={() => updateMutation.mutate({ id: row.id, body: { status: 'suspended' } })}
                              >
                                Suspend
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={updateMutation.isPending || st === 'active'}
                                onClick={() => updateMutation.mutate({ id: row.id, body: { status: 'active' } })}
                              >
                                Activate
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Modal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingId(null);
        }}
        title="Edit role"
        size="md"
      >
        <div className="space-y-4">
          <Select label="Role" options={ROLE_OPTIONS} value={editRole} onChange={setEditRole} />
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-admin-border pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEditOpen(false);
              setEditingId(null);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            loading={updateMutation.isPending}
            disabled={!editingId}
            onClick={() => {
              if (!editingId) return;
              updateMutation.mutate(
                { id: editingId, body: { role: editRole } },
                {
                  onSuccess: (res) => {
                    if (res.success) {
                      setEditOpen(false);
                      setEditingId(null);
                    }
                  },
                }
              );
            }}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal open={addOpen} onClose={() => { setAddOpen(false); setCreateError(''); setFormPassword(''); }} title="Add admin" size="md">
        <div className="space-y-4">
          <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Full name" />
          <Input
            label="Email"
            type="email"
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            placeholder="admin@example.com"
          />
          <Select label="Role" options={ROLE_OPTIONS} value={formRole} onChange={setFormRole} />
          <Input label="Temporary Password" type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Min 8 characters" />
        </div>
        {createError && <p className="text-xs text-red-600 mt-2">{createError}</p>}
        <div className="mt-6 flex justify-end gap-2 border-t border-admin-border pt-4">
          <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
          <Button type="button" loading={createMutation.isPending} onClick={() => {
            setCreateError('');
            if (!formName.trim() || !formEmail.trim() || formPassword.length < 8) {
              setCreateError('All fields required. Password must be at least 8 characters.');
              return;
            }
            createMutation.mutate(
              { name: formName.trim(), email: formEmail.trim().toLowerCase(), role: formRole, password: formPassword },
              { onError: () => setCreateError('Failed to create admin. Email may already exist.') }
            );
          }}>
            Create
          </Button>
        </div>
      </Modal>
    </div>
  );
}
