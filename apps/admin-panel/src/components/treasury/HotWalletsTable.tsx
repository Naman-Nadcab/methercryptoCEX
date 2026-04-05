'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { HotWalletRow } from '@/lib/treasury-api';
import {
  createHotWallet,
  deleteHotWallet,
  replaceHotWallet,
  refreshHotWalletBalance,
  patchHotWallet,
} from '@/lib/treasury-api';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RefreshCw, Trash2, RotateCcw, Plus, Shield, Pencil } from 'lucide-react';

function truncateAddress(addr: string, head = 8, tail = 6): string {
  if (!addr) return '—';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function formatLastSweep(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 60000;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.floor(diff)}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

type ModalState =
  | null
  | { type: 'create' }
  | { type: 'delete'; chainId: string; chainName: string }
  | { type: 'rotate'; chainId: string; chainName: string }
  | { type: 'edit'; chainId: string; chainName: string; coldWalletAddress: string; maxSingleTx: string; maxDailyOutflow: string };

export interface HotWalletsTableProps {
  rows: HotWalletRow[];
  availableFamilies?: Array<{ type: string; label: string; creationSupported: boolean }>;
}

export function HotWalletsTable({ rows, availableFamilies }: HotWalletsTableProps) {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedFamily, setSelectedFamily] = useState('');
  const [editForm, setEditForm] = useState({ coldWalletAddress: '', maxSingleTx: '', maxDailyOutflow: '' });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });

  const createMut = useMutation({
    mutationFn: () => createHotWallet(token, { chainFamily: selectedFamily }),
    onSuccess: (res) => {
      invalidate();
      setModal(null);
      showToast(res?.success !== false ? 'success' : 'error', res?.success !== false ? 'Hot wallet created' : (res as any)?.error?.message ?? 'Failed');
    },
    onError: () => showToast('error', 'Failed to create wallet'),
  });

  const deleteMut = useMutation({
    mutationFn: (chainId: string) => deleteHotWallet(token, chainId),
    onSuccess: () => { invalidate(); setModal(null); showToast('success', 'Hot wallet deleted'); },
    onError: () => showToast('error', 'Failed to delete wallet'),
  });

  const rotateMut = useMutation({
    mutationFn: (chainId: string) => replaceHotWallet(token, chainId),
    onSuccess: () => { invalidate(); setModal(null); showToast('success', 'Wallet rotated — new keypair generated'); },
    onError: () => showToast('error', 'Failed to rotate wallet'),
  });

  const refreshMut = useMutation({
    mutationFn: (chainId: string) => refreshHotWalletBalance(token, chainId),
    onSuccess: () => { invalidate(); showToast('success', 'Balance refreshed from RPC'); },
    onError: () => showToast('error', 'RPC balance refresh failed'),
  });

  const patchMut = useMutation({
    mutationFn: ({ chainId, body }: { chainId: string; body: Record<string, string | null> }) =>
      patchHotWallet(token, chainId, body),
    onSuccess: () => { invalidate(); setModal(null); showToast('success', 'Wallet settings updated'); },
    onError: () => showToast('error', 'Failed to update wallet'),
  });

  const columns: ColumnDef<HotWalletRow>[] = [
    { id: 'chain_name', header: 'Chain', cell: ({ row }) => <span className="font-medium">{row.original.chain_name || row.original.chain_id || '—'}</span> },
    {
      id: 'address', header: 'Address',
      cell: ({ row }) => <span className="font-mono text-xs" title={row.original.address}>{truncateAddress(row.original.address)}</span>,
    },
    { id: 'balance', header: 'Balance', cell: ({ row }) => <span className="tabular-nums">{row.original.balance || '0'}</span> },
    { id: 'last_sweep_at', header: 'Last Sweep', cell: ({ row }) => <span className="text-admin-muted text-xs">{formatLastSweep(row.original.last_sweep_at)}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status === 'active' ? 'Active' : 'Inactive'} /> },
    {
      id: 'actions', header: 'Actions',
      cell: ({ row }) => {
        const r = row.original;
        const chainId = r.chain_id;
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" title="Refresh balance" onClick={() => refreshMut.mutate(chainId)} disabled={refreshMut.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshMut.isPending ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" title="Edit settings" onClick={() => {
              setEditForm({ coldWalletAddress: '', maxSingleTx: '', maxDailyOutflow: '' });
              setModal({ type: 'edit', chainId, chainName: r.chain_name, coldWalletAddress: '', maxSingleTx: '', maxDailyOutflow: '' });
            }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" title="Rotate keypair" onClick={() => setModal({ type: 'rotate', chainId, chainName: r.chain_name })}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" title="Delete wallet" onClick={() => setModal({ type: 'delete', chainId, chainName: r.chain_name })}>
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <>
      {toast && (
        <div className={`mb-3 rounded-lg px-4 py-2 text-sm ${toast.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {toast.message}
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => { setSelectedFamily(''); setModal({ type: 'create' }); }}>
          <Plus className="mr-1 h-4 w-4" /> Create Hot Wallet
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-admin-border bg-admin-card">
        <table className="w-full text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-admin-border bg-white/[0.02]">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 font-medium text-admin-muted">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-admin-border last:border-0 hover:bg-white/[0.03]">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-admin-text">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-8 text-center text-admin-muted">No hot wallets.</div>}
      </div>

      {/* Create Modal */}
      {modal?.type === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Create Hot Wallet</h3>
            <p className="mt-1 text-sm text-admin-muted">Select the chain family to generate a new hot wallet keypair.</p>
            <div className="mt-4">
              <label className="block text-sm font-medium text-admin-text">Chain Family</label>
              <select
                value={selectedFamily}
                onChange={(e) => setSelectedFamily(e.target.value)}
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              >
                <option value="">Select chain family…</option>
                {(availableFamilies ?? []).filter(f => f.creationSupported).map((f) => (
                  <option key={f.type} value={f.type}>{f.label}</option>
                ))}
                {(!availableFamilies || availableFamilies.length === 0) && (
                  <>
                    <option value="evm">EVM (Ethereum, BSC, Polygon, etc.)</option>
                    <option value="solana">Solana</option>
                    <option value="tron">Tron</option>
                    <option value="bitcoin">Bitcoin</option>
                  </>
                )}
              </select>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={() => createMut.mutate()} disabled={!selectedFamily || createMut.isPending}>
                {createMut.isPending ? 'Creating…' : 'Create Wallet'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {modal?.type === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-red-700">Delete Hot Wallet</h3>
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-800 font-medium">WARNING: This is a destructive action.</p>
              <p className="mt-1 text-xs text-red-700">Deleting the hot wallet for <strong>{modal.chainName}</strong> will remove the encrypted keypair. Ensure all funds have been transferred out first.</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button variant="primary" className="bg-red-600 hover:bg-red-700" onClick={() => deleteMut.mutate(modal.chainId)} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? 'Deleting…' : 'Confirm Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rotate Confirmation */}
      {modal?.type === 'rotate' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-admin-text">
              <Shield className="h-5 w-5 text-amber-500" /> Rotate Wallet Keypair
            </h3>
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800 font-medium">This will generate a new private key for {modal.chainName}.</p>
              <p className="mt-1 text-xs text-amber-700">The old address will be decommissioned. Make sure funds from the old address have been swept before rotation.</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={() => rotateMut.mutate(modal.chainId)} disabled={rotateMut.isPending}>
                {rotateMut.isPending ? 'Rotating…' : 'Confirm Rotation'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Settings Modal */}
      {modal?.type === 'edit' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModal(null)}>
          <div className="w-full max-w-lg rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Edit Wallet Settings — {modal.chainName}</h3>
            <p className="mt-1 text-sm text-admin-muted">Update cold wallet address and outflow limits for this chain.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Cold Wallet Address</label>
                <input
                  type="text"
                  placeholder="0x… or leave empty to clear"
                  value={editForm.coldWalletAddress}
                  onChange={(e) => setEditForm((f) => ({ ...f, coldWalletAddress: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-admin-text">Max Single Tx (wei)</label>
                  <input
                    type="text"
                    placeholder="e.g. 5000000000000000000"
                    value={editForm.maxSingleTx}
                    onChange={(e) => setEditForm((f) => ({ ...f, maxSingleTx: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-admin-text">Max Daily Outflow (wei)</label>
                  <input
                    type="text"
                    placeholder="e.g. 50000000000000000000"
                    value={editForm.maxDailyOutflow}
                    onChange={(e) => setEditForm((f) => ({ ...f, maxDailyOutflow: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  const body: Record<string, string | null> = {};
                  if (editForm.coldWalletAddress !== '') body.coldWalletAddress = editForm.coldWalletAddress || null;
                  if (editForm.maxSingleTx) body.maxSingleTx = editForm.maxSingleTx;
                  if (editForm.maxDailyOutflow) body.maxDailyOutflow = editForm.maxDailyOutflow;
                  if (Object.keys(body).length === 0) { setModal(null); return; }
                  patchMut.mutate({ chainId: modal.chainId, body });
                }}
                disabled={patchMut.isPending}
              >
                {patchMut.isPending ? 'Saving…' : 'Save Settings'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
