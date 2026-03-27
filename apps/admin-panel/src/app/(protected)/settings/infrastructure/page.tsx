'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getInfrastructureProviders,
  createInfrastructureProvider,
  updateInfrastructureProvider,
  type InfrastructureProviderRow,
} from '@/lib/monitoring-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ArrowLeft, Plus, Pencil } from 'lucide-react';

const PROVIDER_TYPES = [
  { value: 'rpc', label: 'RPC Nodes' },
  { value: 'oracle', label: 'Price Oracles' },
  { value: 'email_sms', label: 'Email/SMS Gateways' },
  { value: 'webhook', label: 'Webhook Endpoints' },
];
const STATUSES = ['active', 'inactive'];

export default function SettingsInfrastructurePage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ type: 'add' | 'edit'; row?: InfrastructureProviderRow | null } | null>(null);
  const [form, setForm] = useState({
    provider_type: 'rpc',
    provider_name: '',
    endpoint_url: '',
    api_key: '',
    status: 'active' as string,
  });

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

  const providers = (data?.data?.providers ?? []) as InfrastructureProviderRow[];
  const openAdd = () => {
    setForm({ provider_type: 'rpc', provider_name: '', endpoint_url: '', api_key: '', status: 'active' });
    setModal({ type: 'add' });
  };
  const openEdit = (row: InfrastructureProviderRow) => {
    setForm({
      provider_type: row.provider_type,
      provider_name: row.provider_name,
      endpoint_url: row.endpoint_url ?? '',
      api_key: '', // do not pre-fill; backend masks
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

  const typeLabel = (t: string) => PROVIDER_TYPES.find((p) => p.value === t)?.label ?? t;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Infrastructure</h1>
            <p className="mt-1 text-sm text-admin-muted">
              Configure RPC nodes, price oracles, email/SMS gateways, and webhook endpoints. Updates apply without redeploy.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Third-Party Infrastructure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Provider Name</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Type</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Endpoint URL</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">API Key</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                      Loading…
                    </td>
                  </tr>
                ) : providers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                      No infrastructure providers. Add one to get started.
                    </td>
                  </tr>
                ) : (
                  providers.map((row) => (
                    <tr key={row.id} className="border-t border-admin-border hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium">{row.provider_name}</td>
                      <td className="px-4 py-3 text-gray-700">{typeLabel(row.provider_type)}</td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-600" title={row.endpoint_url}>
                        {row.endpoint_url || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {row.api_key || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900">
              {modal.type === 'add' ? 'Add provider' : 'Edit provider'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="infra-type" className="block text-sm font-medium text-gray-700">
                  Type
                </label>
                <select
                  id="infra-type"
                  value={form.provider_type}
                  onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  disabled={modal.type === 'edit'}
                >
                  {PROVIDER_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="infra-name" className="block text-sm font-medium text-gray-700">
                  Provider Name *
                </label>
                <input
                  id="infra-name"
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder="e.g. Infura, Twilio"
                  required
                />
              </div>
              <div>
                <label htmlFor="infra-url" className="block text-sm font-medium text-gray-700">
                  Endpoint URL
                </label>
                <input
                  id="infra-url"
                  type="url"
                  value={form.endpoint_url}
                  onChange={(e) => setForm((f) => ({ ...f, endpoint_url: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label htmlFor="infra-key" className="block text-sm font-medium text-gray-700">
                  API Key {modal.type === 'edit' && '(leave blank to keep current)'}
                </label>
                <input
                  id="infra-key"
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                />
              </div>
              <div>
                <label htmlFor="infra-status" className="block text-sm font-medium text-gray-700">
                  Status
                </label>
                <select
                  id="infra-status"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {modal.type === 'add' ? 'Add' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
