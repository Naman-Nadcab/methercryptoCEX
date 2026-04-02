'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import { fetchMyP2PAds, patchMyP2PAd, deleteMyP2PAd, P2P_V2_MY_ADS_KEY } from '@/lib/p2pApi';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';

export default function P2PV2MyAdsPage() {
  return (
    <RequireAuth>
      <MyAdsInner />
    </RequireAuth>
  );
}

function MyAdsInner() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [ep, setEp] = useState({ price: '', min_amount: '', max_amount: '', remarks: '' });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: P2P_V2_MY_ADS_KEY,
    queryFn: fetchMyP2PAds,
  });

  const pauseMut = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      patchMyP2PAd(id, { status: paused ? 'paused' : 'active' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_V2_MY_ADS_KEY }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteMyP2PAd(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_V2_MY_ADS_KEY }),
  });

  const patchMut = useMutation({
    mutationFn: (payload: { id: string; body: Parameters<typeof patchMyP2PAd>[1] }) =>
      patchMyP2PAd(payload.id, payload.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: P2P_V2_MY_ADS_KEY });
      setEditing(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">My ads</h1>
        <Link href="/p2p/create-ad" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">
          New ad
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#1e2329]"
            >
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-full max-w-md" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20 rounded-lg" />
                <Skeleton className="h-9 w-20 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="space-y-3">
        {rows.map((r) => {
          const id = String(r.id);
          const st = String(r.status ?? '');
          const price = String((r as { current_price?: string }).current_price ?? r.price ?? '—');
          const sym = String((r as { crypto_symbol?: string }).crypto_symbol ?? '');
          const fiat = String(r.fiat_currency ?? '');
          return (
            <div
              key={id}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#1e2329]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-sm text-gray-900 dark:text-white">
                    {sym} / {fiat} · {price}
                  </p>
                  <p className="text-xs text-gray-500">
                    {String(r.type ?? r.ad_type ?? '')} · {st}
                  </p>
                </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(id);
                    setEp({
                      price: price === '—' ? '' : price,
                      min_amount: String(r.min_amount ?? ''),
                      max_amount: String(r.max_amount ?? ''),
                      remarks: String(r.remarks ?? ''),
                    });
                  }}
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
                >
                  Edit
                </button>
                {st === 'active' && (
                  <button
                    type="button"
                    onClick={() => pauseMut.mutate({ id, paused: true })}
                    className="rounded border border-amber-600 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
                  >
                    Pause
                  </button>
                )}
                {st === 'paused' && (
                  <button
                    type="button"
                    onClick={() => pauseMut.mutate({ id, paused: false })}
                    className="rounded border border-emerald-600 px-3 py-1.5 text-xs text-emerald-700"
                  >
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Close this ad permanently?')) delMut.mutate(id);
                  }}
                  className="rounded border border-red-500 px-3 py-1.5 text-xs text-red-600"
                >
                  Delete
                </button>
              </div>
              </div>
              {editing === id && (
                <div className="grid gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <input
                    placeholder="Price"
                    value={ep.price}
                    onChange={(e) => setEp({ ...ep, price: e.target.value })}
                    className="rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]"
                  />
                  <div className="flex gap-2">
                    <input
                      placeholder="Min"
                      value={ep.min_amount}
                      onChange={(e) => setEp({ ...ep, min_amount: e.target.value })}
                      className="flex-1 rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]"
                    />
                    <input
                      placeholder="Max"
                      value={ep.max_amount}
                      onChange={(e) => setEp({ ...ep, max_amount: e.target.value })}
                      className="flex-1 rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]"
                    />
                  </div>
                  <input
                    placeholder="Remarks"
                    value={ep.remarks}
                    onChange={(e) => setEp({ ...ep, remarks: e.target.value })}
                    className="rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={patchMut.isPending}
                      onClick={() => {
                        const body: Parameters<typeof patchMyP2PAd>[1] = {};
                        if (ep.price.trim()) body.price = ep.price.trim();
                        if (ep.min_amount.trim()) body.min_amount = ep.min_amount.trim();
                        if (ep.max_amount.trim()) body.max_amount = ep.max_amount.trim();
                        if (ep.remarks.trim()) body.remarks = ep.remarks.trim();
                        if (Object.keys(body).length) patchMut.mutate({ id, body });
                      }}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white"
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {!isLoading && rows.length === 0 && (
        <p className="text-sm text-gray-500">No ads yet. Create one to start trading.</p>
      )}
    </div>
  );
}
