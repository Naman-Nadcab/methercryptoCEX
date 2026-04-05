'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus, Power, PowerOff, Loader2, AlertTriangle } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAdminAuthStore } from '@/store/auth';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Modal, ModalFooter } from '@/components/ui';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';

type StakingProduct = {
  id: string;
  name: string;
  asset: string;
  apy_pct: number;
  lock_period_days: number;
  min_stake: number;
  total_staked: number;
  stakers: number;
  enabled: boolean;
  created_at: string;
};

const emptyForm = { name: '', asset: '', apyPct: '', lockPeriodDays: '', minStake: '' };

export default function StakingPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [toastMsg, setToastMsg] = useState<{type: 'success'|'error'; text: string} | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'staking-products', token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/staking/products', { token }),
    enabled: !!token,
    refetchInterval: 30000,
  });

  const products: StakingProduct[] = (data?.data as Record<string, unknown>)?.products as StakingProduct[] ?? [];

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch('/staking/products', { method: 'POST', body, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'staking-products'] });
      setModalOpen(false);
      setForm(emptyForm);
      setToastMsg({type: 'success', text: 'Product created.'});
    },
    onError: () => setToastMsg({type: 'error', text: 'Failed to create product.'}),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      adminFetch(`/staking/products/${id}`, { method: 'PATCH', body: { enabled }, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'staking-products'] });
    },
    onError: () => setToastMsg({type: 'error', text: 'Failed to update product status.'}),
  });

  const kpis = useMemo(() => {
    const active = products.filter((p) => p.enabled);
    const totalStakedValue = active.reduce((s, p) => s + Number(p.total_staked ?? 0), 0);
    const totalStakers = active.reduce((s, p) => s + Number(p.stakers ?? 0), 0);
    const avgApy = active.length > 0 ? active.reduce((s, p) => s + Number(p.apy_pct ?? 0), 0) / active.length : 0;
    return { totalStakedValue, activeCount: active.length, totalStakers, avgApy };
  }, [products]);

  const submitCreate = useCallback(() => {
    const apy = Number(form.apyPct);
    const lock = Number(form.lockPeriodDays);
    const min = Number(form.minStake);
    if (!form.name.trim() || !form.asset.trim() || !Number.isFinite(apy)) return;
    createMut.mutate({
      name: form.name.trim(),
      asset: form.asset.trim().toUpperCase(),
      apy_pct: apy,
      lock_period_days: Math.max(0, Math.floor(lock || 0)),
      min_stake: Math.max(0, min || 0),
    });
  }, [form, createMut]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Staking & Earn</h1>
          <p className="text-xs text-admin-muted mt-0.5">Manage staking products and earn pools.</p>
        </div>
        <ProtectedAction permission="settings:edit" fallback="disabled">
          <Button type="button" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm(emptyForm); setModalOpen(true); }}>
            Create Product
          </Button>
        </ProtectedAction>
      </div>

      {toastMsg && (
        <div className={cn('flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs', toastMsg.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="ml-auto text-admin-muted hover:text-admin-muted">✕</button>
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-semibold text-red-800">Failed to load staking products</p>
                <p className="text-xs text-admin-muted">The staking API may be unavailable. Please retry or contact engineering.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card compact><CardContent className="p-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Total Staked Value</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-admin-text">${kpis.totalStakedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </CardContent></Card>
        <Card compact><CardContent className="p-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Active Products</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-admin-text">{kpis.activeCount}</p>
        </CardContent></Card>
        <Card compact><CardContent className="p-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Total Stakers</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-admin-text">{kpis.totalStakers.toLocaleString()}</p>
        </CardContent></Card>
        <Card compact><CardContent className="p-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Avg APY</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-admin-text">{kpis.activeCount > 0 ? `${kpis.avgApy.toFixed(2)}%` : '—'}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Products</CardTitle></CardHeader>
        <CardContent className="p-0 sm:p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-admin-muted">
              <Loader2 className="h-6 w-6 shrink-0 animate-spin text-admin-primary" />
              <span>Loading products…</span>
            </div>
          ) : products.length === 0 ? (
            <div className="border-t border-admin-border px-6 py-16 text-center">
              <Coins className="mx-auto h-10 w-10 text-admin-muted/50" />
              <p className="mt-3 text-sm font-medium text-admin-text">No staking products yet</p>
              <p className="mt-1 text-sm text-admin-muted">Create a product to populate this table.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-admin-border">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-admin-border bg-white/[0.02] text-left text-admin-muted">
                    <th className="px-4 py-3 font-medium">Product Name</th>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">APY %</th>
                    <th className="px-4 py-3 font-medium">Lock Period</th>
                    <th className="px-4 py-3 font-medium">Min Stake</th>
                    <th className="px-4 py-3 font-medium">Total Staked</th>
                    <th className="px-4 py-3 font-medium">Stakers</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-admin-border/60 hover:bg-white/5">
                      <td className="px-4 py-3 font-medium text-admin-text">{p.name}</td>
                      <td className="px-4 py-3"><Badge variant="primary" size="sm">{p.asset}</Badge></td>
                      <td className="px-4 py-3 tabular-nums">{Number(p.apy_pct).toFixed(2)}%</td>
                      <td className="px-4 py-3 tabular-nums">{p.lock_period_days}d</td>
                      <td className="px-4 py-3 tabular-nums">${Number(p.min_stake).toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums">${Number(p.total_staked).toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums">{Number(p.stakers).toLocaleString()}</td>
                      <td className="px-4 py-3"><Badge variant={p.enabled ? 'success' : 'default'} size="sm">{p.enabled ? 'Active' : 'Disabled'}</Badge></td>
                      <td className="px-4 py-3">
                        <ProtectedAction permission="settings:edit" fallback="disabled">
                          <Button type="button" size="sm" variant={p.enabled ? 'outline' : 'secondary'} className="whitespace-nowrap"
                            icon={p.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                            loading={toggleMut.isPending}
                            onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}>
                            {p.enabled ? 'Disable' : 'Enable'}
                          </Button>
                        </ProtectedAction>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Create staking product" size="md">
        <div className="space-y-4">
          <Input label="Product name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Flexible USDC Earn" />
          <Input label="Asset" value={form.asset} onChange={(e) => setForm((f) => ({ ...f, asset: e.target.value }))} placeholder="e.g. USDC" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="APY (%)" type="number" step="0.01" value={form.apyPct} onChange={(e) => setForm((f) => ({ ...f, apyPct: e.target.value }))} placeholder="5.25" />
            <Input label="Lock period (days)" type="number" min={0} value={form.lockPeriodDays} onChange={(e) => setForm((f) => ({ ...f, lockPeriodDays: e.target.value }))} placeholder="30" />
            <Input label="Minimum stake ($)" type="number" min={0} value={form.minStake} onChange={(e) => setForm((f) => ({ ...f, minStake: e.target.value }))} placeholder="100" />
          </div>
        </div>
        <ModalFooter className="mt-4 border-0 px-0 pb-0 pt-4">
          <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button type="button" onClick={submitCreate} loading={createMut.isPending}>Save product</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
