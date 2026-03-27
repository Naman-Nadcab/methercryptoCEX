'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getComplianceIntegrations,
  createComplianceIntegration,
  updateComplianceIntegration,
  type ComplianceIntegrationRow,
} from '@/lib/risk-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ArrowLeft, Plus, Pencil } from 'lucide-react';

const PROVIDER_NAMES = ['Chainalysis', 'TRM Labs', 'Elliptic', 'SumSub', 'ComplyAdvantage'];

export default function SettingsIntegrationsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ type: 'add' | 'edit'; row?: ComplianceIntegrationRow | null } | null>(null);
  const [form, setForm] = useState({
    provider_name: '',
    api_url: '',
    api_key: '',
    webhook_secret: '',
    status: 'inactive' as string,
  });

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
            <h1 className="text-2xl font-semibold text-gray-900">Compliance Integrations</h1>
            <p className="mt-1 text-sm text-admin-muted">
              Configure Chainalysis, TRM Labs, Elliptic, SumSub, ComplyAdvantage. Enable/disable and update API keys without redeploy.
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
          <CardTitle>Third-Party Compliance APIs</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-admin-muted">Loading…</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Provider</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">API URL</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">API Key</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Webhook Secret</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {integrations.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                        No compliance integrations. Add one (e.g. Chainalysis, TRM Labs).
                      </td>
                    </tr>
                  ) : (
                    integrations.map((r) => (
                      <tr key={r.id} className="border-t border-admin-border hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.provider_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 max-w-[200px] truncate" title={r.api_url}>
                          {r.api_url || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.api_key || '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{r.webhook_secret || '—'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900">
              {modal.type === 'add' ? 'Add compliance provider' : 'Edit compliance provider'}
            </h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Provider name</label>
                {modal.type === 'add' ? (
                  <select
                    value={form.provider_name}
                    onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">API URL</label>
                <input
                  type="url"
                  value={form.api_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">API key</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Webhook secret</label>
                <input
                  type="password"
                  value={form.webhook_secret}
                  onChange={(e) => setForm((f) => ({ ...f, webhook_secret: e.target.value }))}
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
    </div>
  );
}
