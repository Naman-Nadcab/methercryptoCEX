'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getInfrastructureProviders,
  createInfrastructureProvider,
  updateInfrastructureProvider,
  deleteInfrastructureProvider,
  type InfrastructureProviderRow,
} from '@/lib/monitoring-api';
import { adminFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, Plus, Pencil, Trash2, Zap, CheckCircle2, XCircle, Loader2, Cable, AlertTriangle } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

const PROVIDER_TYPES = [
  { value: 'rpc', label: 'RPC Nodes' },
  { value: 'oracle', label: 'Price Oracles' },
  { value: 'email_sms', label: 'Email / SMS Gateways' },
  { value: 'webhook', label: 'Webhook Endpoints' },
];
const STATUSES = ['active', 'inactive'];

type PingState = { id: string; status: 'loading' | 'ok' | 'fail'; ms?: number };

function StatusPill({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  return <Badge variant="default">Inactive</Badge>;
}

export default function SettingsInfrastructurePage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ type: 'add' | 'edit' | 'delete'; row?: InfrastructureProviderRow | null } | null>(null);
  const [form, setForm] = useState({
    provider_type: 'rpc',
    provider_name: '',
    endpoint_url: '',
    api_key: '',
    status: 'active' as string,
  });
  const [ping, setPing] = useState<PingState | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings', 'infrastructure', token],
    queryFn: () => getInfrastructureProviders(token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (body: { provider_type: string; provider_name: string; endpoint_url?: string; api_key?: string; status?: string }) =>
      createInfrastructureProvider(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'infrastructure'] });
      setModal(null);
      setForm({ provider_type: 'rpc', provider_name: '', endpoint_url: '', api_key: '', status: 'active' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<InfrastructureProviderRow> }) =>
      updateInfrastructureProvider(token, id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'infrastructure'] });
      setModal(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInfrastructureProvider(token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'infrastructure'] });
      setModal(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateInfrastructureProvider(token, id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'infrastructure'] }),
  });

  const providers = (data?.data?.providers ?? []) as InfrastructureProviderRow[];
  const typeLabel = (t: string) => PROVIDER_TYPES.find((p) => p.value === t)?.label ?? t;

  const openAdd = () => {
    setForm({ provider_type: 'rpc', provider_name: '', endpoint_url: '', api_key: '', status: 'active' });
    setModal({ type: 'add' });
  };
  const openEdit = (row: InfrastructureProviderRow) => {
    setForm({
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      endpoint_url: row.endpoint_url ?? '',
      api_key: '',
      status: row.status ?? 'active',
    });
    setModal({ type: 'edit', row });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal?.type === 'add') {
      createMutation.mutate({
        provider_type: form.provider_type,
        provider_name: form.provider_name.trim(),
        endpoint_url: form.endpoint_url || undefined,
        api_key: form.api_key.trim() || undefined,
        status: form.status,
      });
    } else if (modal?.type === 'edit' && modal.row) {
      const body: Partial<InfrastructureProviderRow> = {
        provider_name: form.provider_name.trim(),
        endpoint_url: form.endpoint_url || undefined,
        status: form.status,
      };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      updateMutation.mutate({ id: modal.row.id, body });
    }
  };

  const handlePing = async (row: InfrastructureProviderRow) => {
    const url = row.endpoint_url;
    if (!url) return;
    setPing({ id: row.id, status: 'loading' });
    const t0 = Date.now();
    try {
      await adminFetch(`/integrations/test`, { method: 'POST', token, body: { integration: row.provider_name, url } });
      setPing({ id: row.id, status: 'ok', ms: Date.now() - t0 });
    } catch {
      setPing({ id: row.id, status: 'fail', ms: Date.now() - t0 });
    }
    setTimeout(() => setPing(null), 5000);
  };

  const totalActive = providers.filter((p) => p.status === 'active').length;

  return (
    <AdminPageFrame
      title="Infrastructure"
      description="Configure RPC nodes, price oracles, email/SMS gateways, and webhook endpoints. Updates apply without redeploy."
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
          { label: 'Total', value: providers.length, color: 'text-admin-text' },
          { label: 'Active', value: totalActive, color: 'text-emerald-400' },
          { label: 'Inactive', value: providers.length - totalActive, color: providers.length - totalActive > 0 ? 'text-amber-400' : 'text-admin-muted' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-admin-border bg-admin-card px-4 py-3">
            <p className="text-xs text-admin-muted">{k.label}</p>
            <p className={cn('mt-1 text-xl font-semibold tabular-nums', k.color)}>{isLoading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-admin-muted" />
            <CardTitle>Third-Party Infrastructure</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Provider Name</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Type</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Endpoint URL</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Ping</th>
                  <th className="px-4 py-3 font-medium text-admin-muted text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <TableSkeleton rows={3} cols={5} />
                    </td>
                  </tr>
                ) : providers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-admin-muted">
                      No infrastructure providers. Add one to get started.
                    </td>
                  </tr>
                ) : (
                  providers.map((row) => {
                    const p = ping?.id === row.id ? ping : null;
                    return (
                      <tr key={row.id} className="border-t border-admin-border hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 font-medium text-admin-text">{row.provider_name}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-admin-surface px-2 py-0.5 text-xs text-admin-muted border border-admin-border">
                            {typeLabel(row.provider_type)}
                          </span>
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-admin-muted" title={row.endpoint_url ?? ''}>
                          {row.endpoint_url || <span className="text-admin-muted/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={row.status ?? 'inactive'} />
                        </td>
                        <td className="px-4 py-3">
                          {p?.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
                          {p?.status === 'ok' && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{p.ms}ms</span>}
                          {p?.status === 'fail' && <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" />Fail</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {row.endpoint_url && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Ping endpoint"
                                disabled={p?.status === 'loading'}
                                onClick={() => handlePing(row)}
                              >
                                <Zap className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              title={row.status === 'active' ? 'Deactivate' : 'Activate'}
                              disabled={toggleMutation.isPending}
                              onClick={() => toggleMutation.mutate({ id: row.id, status: row.status === 'active' ? 'inactive' : 'active' })}
                            >
                              {row.status === 'active'
                                ? <XCircle className="h-3.5 w-3.5 text-admin-muted" />
                                : <CheckCircle2 className="h-3.5 w-3.5 text-admin-muted" />}
                            </Button>
                            <Button variant="ghost" size="sm" title="Edit" onClick={() => openEdit(row)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Delete"
                              onClick={() => setModal({ type: 'delete', row })}
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
        </CardContent>
      </Card>

      {/* Add / Edit modal */}
      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-admin-border bg-admin-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-admin-text">
              {modal.type === 'add' ? 'Add provider' : 'Edit provider'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Type</label>
                <select
                  value={form.provider_type}
                  onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                  disabled={modal.type === 'edit'}
                >
                  {PROVIDER_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Provider Name *</label>
                <input
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                  placeholder="e.g. Infura, Twilio"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Endpoint URL</label>
                <input
                  type="url"
                  value={form.endpoint_url}
                  onChange={(e) => setForm((f) => ({ ...f, endpoint_url: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">
                  API Key {modal.type === 'edit' && '(leave blank to keep current)'}
                </label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {modal.type === 'add' ? 'Add' : 'Save'}
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
              <h3 className="text-base font-semibold text-admin-text">Delete provider?</h3>
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
