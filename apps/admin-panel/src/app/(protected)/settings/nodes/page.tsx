'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getNodeProviders,
  createNodeProvider,
  updateNodeProvider,
  deleteNodeProvider,
  type NodeProviderRow,
} from '@/lib/treasury-api';
import { adminFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ArrowLeft, Plus, Pencil, Trash2, Zap, CheckCircle2, XCircle, Loader2, Server, AlertTriangle } from 'lucide-react';
import { TableSkeleton } from '@/components/ui';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';

// Expanded chain + network list
const NETWORKS = [
  'mainnet',
  'testnet',
  // Ethereum
  'ethereum-mainnet',
  'ethereum-sepolia',
  'ethereum-goerli',
  // BNB Chain
  'bsc-mainnet',
  'bsc-testnet',
  // Polygon
  'polygon-mainnet',
  'polygon-amoy',
  'polygon-mumbai',
  // Arbitrum
  'arbitrum-one',
  'arbitrum-sepolia',
  // Optimism
  'optimism-mainnet',
  'optimism-sepolia',
  // Base
  'base-mainnet',
  'base-sepolia',
  // Avalanche
  'avalanche-mainnet',
  'avalanche-fuji',
  // Solana
  'solana-mainnet',
  'solana-devnet',
  // Bitcoin
  'bitcoin-mainnet',
  'bitcoin-testnet',
  // Tron
  'tron-mainnet',
  'tron-nile',
  // Other
  'sepolia',
  'goerli',
];

const STATUSES = ['active', 'inactive', 'maintenance'];

type PingState = { id: string; status: 'loading' | 'ok' | 'fail'; ms?: number };

function StatusPill({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'maintenance') return <Badge variant="warning">Maintenance</Badge>;
  return <Badge variant="default">Inactive</Badge>;
}

export default function SettingsNodesPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ type: 'add' | 'edit' | 'delete'; row?: NodeProviderRow | null } | null>(null);
  const [form, setForm] = useState({
    provider_name: '',
    rpc_url: '',
    api_key: '',
    network: 'mainnet',
    status: 'active' as string,
  });
  const [ping, setPing] = useState<PingState | null>(null);
  const [nodeAuthTarget, setNodeAuthTarget] = useState<
    | { kind: 'add'; body: { provider_name: string; rpc_url?: string; api_key?: string; network?: string; status?: string } }
    | { kind: 'edit'; id: string; body: Partial<NodeProviderRow> }
    | { kind: 'toggle'; id: string; status: string }
    | { kind: 'delete'; id: string; providerName: string }
    | null
  >(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNodeProvider(token, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'nodes'] });
      setModal(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateNodeProvider(token, id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'nodes'] }),
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
      api_key: '',
      network: row.network ?? 'mainnet',
      status: row.status ?? 'active',
    });
    setModal({ type: 'edit', row });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modal?.type === 'add') {
      setNodeAuthTarget({ kind: 'add', body: {
        provider_name: form.provider_name.trim(),
        rpc_url: form.rpc_url || undefined,
        api_key: form.api_key || undefined,
        network: form.network,
        status: form.status,
      }});
    } else if (modal?.type === 'edit' && modal.row) {
      const body: Partial<NodeProviderRow> = {
        provider_name: form.provider_name.trim(),
        rpc_url: form.rpc_url || undefined,
        network: form.network,
        status: form.status,
      };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      setNodeAuthTarget({ kind: 'edit', id: modal.row.id, body });
    }
  };

  const handlePing = async (row: NodeProviderRow) => {
    const url = row.rpc_url;
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

  const totalActive = nodes.filter((n) => n.status === 'active').length;
  const totalMaintenance = nodes.filter((n) => n.status === 'maintenance').length;

  return (
    <AdminPageFrame
      title="Node Providers"
      description="Manage RPC node providers (Infura, Alchemy, QuickNode, self-hosted). Updates apply without redeploy."
      error={isError ? (error instanceof Error ? error.message : 'Failed to load node providers.') : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
      quickActions={
        <>
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <ProtectedAction permission="settings:edit" fallback="disabled">
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-1 h-4 w-4" />
              Add provider
            </Button>
          </ProtectedAction>
        </>
      }
    >
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Nodes', value: nodes.length, color: 'text-admin-text' },
          { label: 'Active', value: totalActive, color: 'text-emerald-400' },
          { label: 'Maintenance', value: totalMaintenance, color: totalMaintenance > 0 ? 'text-amber-400' : 'text-admin-muted' },
          { label: 'Inactive', value: nodes.length - totalActive - totalMaintenance, color: 'text-admin-muted' },
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
            <Server className="h-4 w-4 text-admin-muted" />
            <CardTitle>Blockchain Node Providers</CardTitle>
          </div>
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
                    <th className="px-4 py-3 font-medium text-admin-muted">RPC URL</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Network</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Ping</th>
                    <th className="px-4 py-3 font-medium text-admin-muted text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-admin-muted">
                        No node providers. Add one to get started (Infura, Alchemy, QuickNode…).
                      </td>
                    </tr>
                  ) : (
                    nodes.map((n) => {
                      const p = ping?.id === n.id ? ping : null;
                      return (
                        <tr key={n.id} className="border-t border-admin-border hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 font-medium text-admin-text">{n.provider_name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-admin-muted max-w-[200px] truncate" title={n.rpc_url ?? ''}>
                            {n.rpc_url || <span className="text-admin-muted/40">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-admin-surface px-2 py-0.5 text-xs text-admin-muted border border-admin-border">
                              {n.network ?? 'mainnet'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill status={n.status ?? 'active'} />
                          </td>
                          <td className="px-4 py-3 w-20">
                            {p?.status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-admin-muted" />}
                            {p?.status === 'ok' && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{p.ms}ms</span>}
                            {p?.status === 'fail' && <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="h-3 w-3" />Fail</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              {n.rpc_url && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Ping RPC node"
                                  disabled={p?.status === 'loading'}
                                  onClick={() => handlePing(n)}
                                >
                                  <Zap className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <ProtectedAction permission="settings:edit" fallback="disabled">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={n.status === 'active' ? 'Deactivate' : 'Activate'}
                                  disabled={toggleMutation.isPending}
                                  onClick={() => setNodeAuthTarget({ kind: 'toggle', id: n.id, status: n.status === 'active' ? 'inactive' : 'active' })}
                                >
                                  {n.status === 'active'
                                    ? <XCircle className="h-3.5 w-3.5 text-admin-muted" />
                                    : <CheckCircle2 className="h-3.5 w-3.5 text-admin-muted" />}
                                </Button>
                                <Button variant="ghost" size="sm" title="Edit" onClick={() => openEdit(n)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Delete"
                                  onClick={() => setModal({ type: 'delete', row: n })}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                                </Button>
                              </ProtectedAction>
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
              {modal.type === 'add' ? 'Add node provider' : 'Edit node provider'}
            </h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Provider name *</label>
                <input
                  type="text"
                  value={form.provider_name}
                  onChange={(e) => setForm((f) => ({ ...f, provider_name: e.target.value }))}
                  placeholder="e.g. Infura, Alchemy, QuickNode"
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">RPC URL</label>
                <input
                  type="url"
                  value={form.rpc_url}
                  onChange={(e) => setForm((f) => ({ ...f, rpc_url: e.target.value }))}
                  placeholder="https://mainnet.infura.io/v3/..."
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
                <label className="block text-xs font-medium text-admin-muted mb-1">Network / Chain</label>
                <select
                  value={form.network}
                  onChange={(e) => setForm((f) => ({ ...f, network: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-admin-accent/50"
                >
                  {NETWORKS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
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
              <h2 className="text-base font-semibold text-admin-text">Delete node provider?</h2>
            </div>
            <p className="text-sm text-admin-muted mb-4">
              Permanently remove <strong className="text-admin-text">{modal.row.provider_name}</strong>{' '}
              ({modal.row.network ?? 'mainnet'})? This cannot be undone.
            </p>
            {deleteMutation.isError && (
              <p className="mb-3 text-xs text-red-400">Failed to delete. Please try again.</p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setModal(null)}>Cancel</Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0"
                disabled={deleteMutation.isPending}
                onClick={() => modal.row && setNodeAuthTarget({ kind: 'delete', id: modal.row.id, providerName: modal.row.provider_name })}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ActionAuthModal
        open={nodeAuthTarget !== null}
        onClose={() => setNodeAuthTarget(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!nodeAuthTarget) return;
          if (nodeAuthTarget.kind === 'add') {
            createMutation.mutate(nodeAuthTarget.body);
          } else if (nodeAuthTarget.kind === 'edit') {
            updateMutation.mutate({ id: nodeAuthTarget.id, body: nodeAuthTarget.body });
          } else if (nodeAuthTarget.kind === 'toggle') {
            toggleMutation.mutate({ id: nodeAuthTarget.id, status: nodeAuthTarget.status });
          } else if (nodeAuthTarget.kind === 'delete') {
            deleteMutation.mutate(nodeAuthTarget.id);
          }
          void payload;
          setNodeAuthTarget(null);
        }}
        title="Authorize node provider change"
        actionLabel={
          nodeAuthTarget?.kind === 'add'
            ? `Add node provider ${nodeAuthTarget.body.provider_name}`
            : nodeAuthTarget?.kind === 'edit'
              ? 'Update node provider configuration'
              : nodeAuthTarget?.kind === 'toggle'
                ? `${nodeAuthTarget.status === 'active' ? 'Activate' : 'Deactivate'} node provider`
                : nodeAuthTarget?.kind === 'delete'
                  ? `Delete node provider ${nodeAuthTarget.providerName}`
                  : 'Node provider action'
        }
        description="Node provider settings directly affect blockchain connectivity and transaction reliability."
        requireReason
        twofaRequired
        confirmationPhrase={nodeAuthTarget?.kind === 'delete' ? 'CONFIRM NODE_DELETE' : 'CONFIRM NODE_CHANGE'}
        externalError={
          createMutation.error instanceof Error
            ? createMutation.error.message
            : updateMutation.error instanceof Error
              ? updateMutation.error.message
              : deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : toggleMutation.error instanceof Error
                  ? toggleMutation.error.message
                  : null
        }
        isPending={createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || toggleMutation.isPending}
        confirmLabel={(createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || toggleMutation.isPending) ? 'Applying…' : 'Apply change'}
        confirmVariant={nodeAuthTarget?.kind === 'delete' ? 'danger' : 'primary'}
      />
    </AdminPageFrame>
  );
}
