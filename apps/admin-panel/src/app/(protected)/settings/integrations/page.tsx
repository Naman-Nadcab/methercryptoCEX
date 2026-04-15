'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getComplianceIntegrations,
  createComplianceIntegration,
  updateComplianceIntegration,
  deleteComplianceIntegration,
  type ComplianceIntegrationRow,
} from '@/lib/risk-api';
import { adminFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, Plus, Pencil, Trash2, Zap, CheckCircle2, XCircle, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

const PROVIDER_NAMES = ['Chainalysis', 'TRM Labs', 'Elliptic', 'SumSub', 'ComplyAdvantage'];

type PingState = { id: string; status: 'loading' | 'ok' | 'fail'; ms?: number };

function StatusPill({ status }: { status: string }) {
  if (status === 'active')
    return <Badge variant="success">Active</Badge>;
  return <Badge variant="default">Inactive</Badge>;
}

export default function SettingsIntegrationsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ type: 'add' | 'edit' | 'delete'; row?: ComplianceIntegrationRow | null } | null>(null);
  const [form, setForm] = useState({
    provider_name: '',
    api_url: '',
    api_key: '',
    webhook_secret: '',
    status: 'inactive' as string,
  });
  const [ping, setPing] = useState<PingState | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings', 'integrations', token],
    queryFn: () => getComplianceIntegrations(token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (body: { provider_name: string; api_url?: string; api_key?: string; webhook_secret?: string; status?: string }) =>
      createComplianceIntegration(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'integrations'] });
      setModal(null);
      setForm({ provider_name: '', api_url: '', api_key: '', webhook_secret: '', status: 'inactive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ComplianceIntegrationRow> }) =>
      updateComplianceIntegration(token, id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'integrations'] });
      setModal(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteComplianceIntegration(token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'integrations'] });
      setModal(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateComplianceIntegration(token, id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'integrations'] }),
  });

  const integrations = (data?.data ?? []) as ComplianceIntegrationRow[];

  const openAdd = () => {
    setForm({ provider_name: '', api_url: '', api_key: '', webhook_secret: '', status: 'inactive' });
    setModal({ type: 'add' });
  };
  const openEdit = (row: ComplianceIntegrationRow) => {
    setForm({
      provider_name: row.provider_name,
      api_url: row.api_url ?? '',
      api_key: '',
      webhook_secret: '',
      status: row.status ?? 'inactive',
    });
    setModal({ type: 'edit', row });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal?.type === 'add') {
      createMutation.mutate({
        provider_name: form.provider_name.trim(),
        api_url: form.api_url || undefined,
        api_key: form.api_key || undefined,
        webhook_secret: form.webhook_secret || undefined,
        status: form.status,
      });
    } else if (modal?.type === 'edit' && modal.row) {
      const body: Partial<ComplianceIntegrationRow> = {
        provider_name: form.provider_name.trim(),
        api_url: form.api_url || undefined,
        webhook_secret: form.webhook_secret || undefined,
        status: form.status,
      };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      updateMutation.mutate({ id: modal.row.id, body });
    }
  };

  const handlePing = async (row: ComplianceIntegrationRow) => {
    if (!row.api_url) return;
    setPing({ id: row.id, status: 'loading' });
    const t0 = Date.now();
    try {
      await adminFetch(`/integrations/test`, { method: 'POST', token, body: { integration: row.provider_name, url: row.api_url } });
      setPing({ id: row.id, status: 'ok', ms: Date.now() - t0 });
    } catch {
      setPing({ id: row.id, status: 'fail', ms: Date.now() - t0 });
    }
    setTimeout(() => setPing(null), 5000);
  };

  const totalActive = integrations.filter((r) => r.status === 'active').length;

  return (
    <AdminPageFrame
      title="Compliance Integrations"
      description="Configure Chainalysis, TRM Labs, Elliptic, SumSub, ComplyAdvantage. Enable/disable and update API keys without redeploy."
      quickActions={
        <>
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" />
            Add provider
          </Button>
        </>
      }
    >
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Providers', value: integrations.length, icon: <ShieldCheck className="h-4 w-4" />, color: 'text-admin-text', bg: 'bg-admin-surface' },
          { label: 'Active', value: totalActive, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-emerald-400', bg: 'bg-emerald-950/20' },
          { label: 'Inactive', value: integrations.length - totalActive, icon: <XCircle className="h-4 w-4" />, color: 'text-admin-muted', bg: 'bg-admin-surface' },
        ].map((k) => (
          <div key={k.label} className={cn('rounded-xl border border-admin-border px-4 py-3', k.bg)}>
            <p className="text-xs text-admin-muted">{k.label}</p>
            <p className={cn('mt-1 text-xl font-semibold tabular-nums', k.color)}>{isLoading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Third-Party Compliance APIs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-white/[0.02]">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Provider</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">API URL</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Ping</th>
                    <th className="px-4 py-3 font-medium text-admin-muted text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {integrations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-admin-muted">
                        No compliance integrations. Add one (e.g. Chainalysis, TRM Labs).
                      </td>
                    </tr>
                  ) : (
                    integrations.map((r) => {
                      const p = ping?.id === r.id ? ping : null;
                      return (
                        <tr key={r.id} className="border-t border-admin-border hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 font-medium text-admin-text">{r.provider_name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-admin-muted max-w-[220px] truncate" title={r.api_url ?? ''}>
                            {r.api_url || <span className="text-admin-muted/40">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill status={r.status ?? 'inactive'} />
                          </td>
                          <td className="px-4 py-3">
                            {p?.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
                            {p?.status === 'ok' && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{p.ms}ms</span>}
                            {p?.status === 'fail' && <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" />Fail</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {r.api_url && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Test connection"
                                  disabled={p?.status === 'loading'}
                                  onClick={() => handlePing(r)}
                                >
                                  <Zap className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                title={r.status === 'active' ? 'Deactivate' : 'Activate'}
                                disabled={toggleMutation.isPending}
                                onClick={() => toggleMutation.mutate({ id: r.id, status: r.status === 'active' ? 'inactive' : 'active' })}
                              >
                                {r.status === 'active'
                                  ? <XCircle className="h-3.5 w-3.5 text-admin-muted" />
                                  : <CheckCircle2 className="h-3.5 w-3.5 text-admin-muted" />}
                              </Button>
                              <Button variant="ghost" size="sm" title="Edit" onClick={() => openEdit(r)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Delete"
                                onClick={() => setModal({ type: 'delete', row: r })}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-red-400" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit modal */}
      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModal(null)}>
          <div
            className="w-full max-w-md rounded-xl border border-admin-border bg-admin-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-admin-text">
              {modal.type === 'add' ? 'Add compliance provider' : 'Edit compliance provider'}
            </h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Provider name</label>
                {modal.type === 'add' ? (
                  <select
                    value={form.provider_name}
                    onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                    required
                  >
                    <option value="">Select provider</option>
                    {PROVIDER_NAMES.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={form.provider_name}
                    onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                    required
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">API URL</label>
                <input
                  type="url"
                  value={form.api_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">API key</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Webhook secret</label>
                <input
                  type="password"
                  value={form.webhook_secret}
                  onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {modal.type === 'add' ? 'Create' : 'Update'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {modal?.type === 'delete' && modal.row && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModal(null)}>
          <div
            className="w-full max-w-sm rounded-xl border border-red-500/30 bg-admin-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <h2 className="text-base font-semibold text-admin-text">Delete provider?</h2>
            </div>
            <p className="text-sm text-admin-muted mb-4">
              Permanently remove <strong className="text-admin-text">{modal.row.provider_name}</strong>? This cannot be undone.
            </p>
            {deleteMutation.isError && (
              <p className="mb-3 text-xs text-red-400">Failed to delete. Please try again.</p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0"
                disabled={deleteMutation.isPending}
                onClick={() => modal.row && deleteMutation.mutate(modal.row.id)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminPageFrame>
  );
}
