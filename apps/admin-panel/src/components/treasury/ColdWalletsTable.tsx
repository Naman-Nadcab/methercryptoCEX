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
import type { ColdWalletRow } from '@/lib/treasury-api';
import { patchHotWallet } from '@/lib/treasury-api';
import { Button } from '@/components/ui/Button';
import { Pencil, Check, X } from 'lucide-react';

function truncateAddress(addr: string | null, head = 8, tail = 6): string {
  if (!addr) return '—';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export interface ColdWalletsTableProps {
  rows: ColdWalletRow[];
}

export function ColdWalletsTable({ rows }: ColdWalletsTableProps) {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [editingChain, setEditingChain] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const patchMut = useMutation({
    mutationFn: ({ chainId, addr }: { chainId: string; addr: string | null }) =>
      patchHotWallet(token, chainId, { coldWalletAddress: addr }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
      setEditingChain(null);
      showToast('success', 'Cold wallet address updated');
    },
    onError: () => showToast('error', 'Failed to update cold address'),
  });

  const columns: ColumnDef<ColdWalletRow>[] = [
    { id: 'chain_name', header: 'Chain', cell: ({ row }) => <span className="font-medium">{row.original.chain_name || row.original.chain_id || '—'}</span> },
    {
      id: 'address', header: 'Wallet Address',
      cell: ({ row }) => {
        const r = row.original;
        const isEditing = editingChain === r.chain_id;
        if (isEditing) {
          return (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="0x… cold wallet address"
                className="w-60 rounded border border-admin-border px-2 py-1 font-mono text-xs"
                autoFocus
              />
              <Button variant="ghost" size="sm" onClick={() => patchMut.mutate({ chainId: r.chain_id, addr: editValue.trim() || null })} disabled={patchMut.isPending}>
                <Check className="h-3.5 w-3.5 text-green-600" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingChain(null)}>
                <X className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs" title={r.address ?? ''}>{truncateAddress(r.address)}</span>
            <Button variant="ghost" size="sm" title="Edit cold address" onClick={() => { setEditValue(r.address ?? ''); setEditingChain(r.chain_id); }}>
              <Pencil className="h-3 w-3 text-admin-muted" />
            </Button>
          </div>
        );
      },
    },
    { id: 'balance', header: 'Balance', cell: () => <span className="text-admin-muted">—</span> },
    {
      id: 'reserve_percentage', header: 'Reserve %',
      cell: ({ row }) => <span className="tabular-nums">{row.original.reserve_percentage}%</span>,
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
        {rows.length === 0 && <div className="py-8 text-center text-admin-muted">No cold wallets.</div>}
      </div>
    </>
  );
}
