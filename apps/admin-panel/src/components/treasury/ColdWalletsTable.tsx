'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getColdWallets, createColdWallet, patchColdWallet, deleteColdWallet,
  type ColdWalletFull,
} from '@/lib/treasury-api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Plus, Star, Trash2, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';

function truncateAddress(addr: string | null, head = 10, tail = 6): string {
  if (!addr) return '—';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

const CHAINS = ['ethereum', 'bitcoin', 'bsc', 'polygon', 'arbitrum', 'solana', 'tron', 'base', 'optimism'];

export function ColdWalletsTable() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'add' | { edit: ColdWalletFull } | { del: ColdWalletFull }>(null);
  const [form, setForm] = useState({ chain: '', address: '', label: '', is_primary: false });
  const [toast, setToast] = useState<{ t: 'success' | 'error'; m: string } | null>(null);

  const show = (t: 'success' | 'error', m: string) => { setToast({ t, m }); setTimeout(() => setToast(null), 3000); };
  const inv = () => qc.invalidateQueries({ queryKey: ['admin', 'cold-wallets'] });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'cold-wallets', token],
    queryFn: () => getColdWallets(token),
    enabled: !!token,
  });
  const wallets = (data?.data ?? []) as ColdWalletFull[];

  const createMut = useMutation({
    mutationFn: () => createColdWallet(token, form),
    onSuccess: () => { inv(); setModal(null); show('success', 'Cold wallet added'); },
    onError: () => show('error', 'Failed to add wallet'),
  });
  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patchColdWallet(token, id, body),
    onSuccess: () => { inv(); setModal(null); show('success', 'Updated'); },
    onError: () => show('error', 'Failed to update'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteColdWallet(token, id),
    onSuccess: () => { inv(); setModal(null); show('success', 'Deleted'); },
    onError: () => show('error', 'Failed to delete'),
  });

  return (
    <>
      {toast && <div className={`mb-3 rounded-lg px-4 py-2 text-sm ${toast.t === 'success' ? 'bg-admin-success/15 text-admin-success' : 'bg-admin-danger/15 text-admin-danger'}`}>{toast.m}</div>}

      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => { setForm({ chain: '', address: '', label: '', is_primary: false }); setModal('add'); }}>
          <Plus className="mr-1 h-4 w-4" /> Add Cold Wallet
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-admin-border bg-white/[0.02]">
              <th className="px-4 py-3 font-medium text-admin-muted">Chain</th>
              <th className="px-4 py-3 font-medium text-admin-muted">Address</th>
              <th className="px-4 py-3 font-medium text-admin-muted">Label</th>
              <th className="px-4 py-3 font-medium text-admin-muted">Balance</th>
              <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
              <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-admin-border/30">
                  <td colSpan={6} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-white/5" /></td>
                </tr>
              ))
            ) : wallets.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-admin-muted">No cold wallets configured. Add one to start.</td></tr>
            ) : wallets.map((w) => (
              <tr key={w.id} className="border-b border-admin-border/30 hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-3 font-medium text-admin-text capitalize">
                  {w.chain}
                  {w.is_primary && <Badge variant="warning" className="ml-2">Primary</Badge>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-admin-muted" title={w.address}>{truncateAddress(w.address)}</td>
                <td className="px-4 py-3 text-admin-text">{w.label || '—'}</td>
                <td className="px-4 py-3 tabular-nums text-admin-text">{parseFloat(w.balance || '0').toFixed(6)}</td>
                <td className="px-4 py-3">
                  <Badge variant={w.is_active ? 'success' : 'danger'}>{w.is_active ? 'Active' : 'Inactive'}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" title={w.is_primary ? 'Primary' : 'Set as primary'}
                      onClick={() => patchMut.mutate({ id: w.id, body: { is_primary: true } })}
                      disabled={w.is_primary || patchMut.isPending}>
                      <Star className={`h-3.5 w-3.5 ${w.is_primary ? 'text-admin-warning fill-admin-warning' : 'text-admin-muted'}`} />
                    </Button>
                    <Button variant="ghost" size="sm" title={w.is_active ? 'Deactivate' : 'Activate'}
                      onClick={() => patchMut.mutate({ id: w.id, body: { is_active: !w.is_active } })}
                      disabled={patchMut.isPending}>
                      {w.is_active ? <ToggleRight className="h-3.5 w-3.5 text-admin-success" /> : <ToggleLeft className="h-3.5 w-3.5 text-admin-muted" />}
                    </Button>
                    <Button variant="ghost" size="sm" title="Edit"
                      onClick={() => { setForm({ chain: w.chain, address: w.address, label: w.label || '', is_primary: w.is_primary }); setModal({ edit: w }); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" title="Delete" onClick={() => setModal({ del: w })}>
                      <Trash2 className="h-3.5 w-3.5 text-admin-danger" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {(modal === 'add' || (modal && 'edit' in modal)) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card border border-admin-border p-6 shadow-modal" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">{modal === 'add' ? 'Add Cold Wallet' : 'Edit Cold Wallet'}</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Chain</label>
                <select value={form.chain} onChange={e => setForm(f => ({ ...f, chain: e.target.value }))}
                  className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text">
                  <option value="">Select chain...</option>
                  {CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Address</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="0x... or bc1..." className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 font-mono text-sm text-admin-text" />
              </div>
              <div>
                <label className="block text-xs font-medium text-admin-muted mb-1">Label (optional)</label>
                <input type="text" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Main cold storage" className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text" />
              </div>
              <label className="flex items-center gap-2 text-sm text-admin-text">
                <input type="checkbox" checked={form.is_primary} onChange={e => setForm(f => ({ ...f, is_primary: e.target.checked }))} />
                Set as primary cold wallet
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button disabled={!form.chain || !form.address || createMut.isPending || patchMut.isPending}
                onClick={() => {
                  if (modal === 'add') createMut.mutate();
                  else if ('edit' in modal) patchMut.mutate({ id: modal.edit.id, body: { label: form.label || null, is_primary: form.is_primary } as any });
                }}>
                {createMut.isPending || patchMut.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {modal && typeof modal === 'object' && 'del' in modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card border border-admin-border p-6 shadow-modal" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-danger">Delete Cold Wallet</h3>
            <p className="mt-2 text-sm text-admin-muted">Remove <strong>{modal.del.chain}</strong> wallet <code className="text-xs">{truncateAddress(modal.del.address)}</code>?</p>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => deleteMut.mutate(modal.del.id)} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
