'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getNodeProviders,
  createNodeProvider,
  updateNodeProvider,
  type NodeProviderRow,
} from '@/lib/treasury-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ArrowLeft, Plus, Pencil } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';

const NETWORKS = ['mainnet', 'testnet', 'sepolia', 'goerli'];
const STATUSES = ['active', 'inactive', 'maintenance'];

export default function SettingsNodesPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ type: 'add' | 'edit'; row?: NodeProviderRow | null } | null>(null);
  const [form, setForm] = useState({
    provider_name: '',
    rpc_url: '',
    api_key: '',
    network: 'mainnet',
    status: 'active' as string,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'settings', 'nodes', token],
    queryFn: () => getNodeProviders(token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (body: { provider_name: string; rpc_url?: string; api_key?: string; network?: string; status?: string }) =>
      createNodeProvider(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'nodes'] });
      setModal(null);
      setForm({ provider_name: '', rpc_url: '', api_key: '', network: 'mainnet', status: 'active' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<NodeProviderRow> }) =>
      updateNodeProvider(token, id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'nodes'] });
      setModal(null);
    },
  });

  const nodes = (data?.data ?? []) as NodeProviderRow[];
  const openAdd = () => {
    setForm({ provider_name: '', rpc_url: '', api_key: '', network: 'mainnet', status: 'active' });
    setModal({ type: 'add' });
  };
  const openEdit = (row: NodeProviderRow) => {
    setForm({
      provider_name: row.provider_name,
      rpc_url: row.rpc_url ?? '',
      api_key: '', // do not pre-fill; backend masks key
      network: row.network ?? 'mainnet',
      status: row.status ?? 'active',
    });
    setModal({ type: 'edit', row });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal?.type === 'add') {
      createMutation.mutate({
        provider_name: form.provider_name.trim(),
        rpc_url: form.rpc_url || undefined,
        api_key: form.api_key || undefined,
        network: form.network,
        status: form.status,
      });
    } else if (modal?.type === 'edit' && modal.row) {
      const body: Partial<NodeProviderRow> = {
        provider_name: form.provider_name.trim(),
        rpc_url: form.rpc_url || undefined,
        network: form.network,
        status: form.status,
      };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      updateMutation.mutate({ id: modal.row.id, body });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-admin-text">Node Providers</h1>
            <p className="text-xs text-admin-muted mt-0.5">Manage RPC node providers (Infura, Alchemy, QuickNode, self-hosted). Updates apply without redeploy.</p>
          </div>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-4 w-4" />
          Add provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Third-Party Node Integration</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} cols={5} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-white/[0.02]">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Provider</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">RPC URL</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">API Key</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Network</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                        No node providers. Add one to get started.
                      </td>
                    </tr>
                  ) : (
                    nodes.map((n) => (
                      <tr key={n.id} className="border-t border-admin-border hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-admin-text">{n.provider_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-admin-muted max-w-[200px] truncate" title={n.rpc_url}>
                          {n.rpc_url || '—'}
                        </td>
                        <td className="px-4 py-3 text-admin-muted">{n.api_key || '—'}</td>
                        <td className="px-4 py-3 text-admin-muted">{n.network}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={n.status} />
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(n)}>
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
            className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-admin-text">
              {modal.type === 'add' ? 'Add node provider' : 'Edit node provider'}
            </h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Provider name</label>
                <input
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                  placeholder="e.g. Infura, Alchemy"
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">RPC URL</label>
                <input
                  type="url"
                  value={form.rpc_url}
                  onChange={(e) => setForm((f) => ({ ...f, rpc_url: e.target.value }))}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">API key</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder={modal.type === 'edit' ? 'Leave blank to keep current' : 'Optional'}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Network</label>
                <select
                  value={form.network}
                  onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
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
