'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import { fetchMyP2PAds, patchMyP2PAd, deleteMyP2PAd, P2P_V2_MY_ADS_KEY } from '@/lib/p2pApi';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';
import { PlusCircle, Pencil, Pause, Play, Trash2, Megaphone, X, Check } from 'lucide-react';

export default function P2PV2MyAdsPage() {
  return <RequireAuth><MyAdsInner /></RequireAuth>;
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
    onError: (err: Error) => alert(err.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteMyP2PAd(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_V2_MY_ADS_KEY }),
    onError: (err: Error) => alert(err.message),
  });

  const patchMut = useMutation({
    mutationFn: (payload: { id: string; body: Parameters<typeof patchMyP2PAd>[1] }) =>
      patchMyP2PAd(payload.id, payload.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: P2P_V2_MY_ADS_KEY });
      setEditing(null);
    },
    onError: (err: Error) => alert(err.message),
  });

  const inputCls = 'w-full rounded-md border border-border/40 bg-background px-3 py-1.5 text-[12px] font-mono text-foreground focus:border-primary/40 focus:outline-none';

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/20 py-3">
        <h1 className="text-[15px] font-bold text-foreground">My Ads</h1>
        <Link
          href="/p2p/create-ad"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PlusCircle className="h-3.5 w-3.5" />
          New Ad
        </Link>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="divide-y divide-border/10">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-14 rounded-md" />
              <div className="ml-auto flex gap-1.5">
                <Skeleton className="h-7 w-16 rounded-md" />
                <Skeleton className="h-7 w-16 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center">
          <Megaphone className="h-8 w-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm font-medium text-foreground">No ads yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Create your first ad to start trading.</p>
          <Link
            href="/p2p/create-ad"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Create Ad
          </Link>
        </div>
      )}

      {/* Table */}
      {!isLoading && rows.length > 0 && (
        <>
          {/* Desktop */}
          <div className="hidden md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/15 text-[11px] text-muted-foreground/60">
                  <th className="py-2.5 pl-1 pr-3 font-medium">Pair</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Price</th>
                  <th className="px-3 py-2.5 font-medium">Limits</th>
                  <th className="px-3 py-2.5 font-medium">Available</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="py-2.5 pl-3 pr-1 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const id = String(r.id);
                  const st = String(r.status ?? '');
                  const price = String((r as { current_price?: string }).current_price ?? r.price ?? '—');
                  const sym = String((r as { crypto_symbol?: string }).crypto_symbol ?? '');
                  const fiat = String(r.fiat_currency ?? '');
                  const adType = String(r.type ?? r.ad_type ?? '');
                  const isActive = st === 'active';
                  const isPaused = st === 'paused';
                  const isEditing = editing === id;

                  return (
                    <tr key={id} className="border-b border-border/10 transition-colors hover:bg-muted/[0.04]">
                      <td className="py-3 pl-1 pr-3">
                        <span className="text-[13px] font-semibold text-foreground">{sym}/{fiat}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          adType === 'sell' ? 'bg-[#f6465d]/10 text-[#f6465d]' : 'bg-[#0ecb81]/10 text-[#0ecb81]'
                        }`}>
                          {adType}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] font-semibold text-foreground">{price}</td>
                      <td className="px-3 py-3 text-[12px] text-muted-foreground">
                        {r.min_amount && <span className="font-mono text-foreground">{String(r.min_amount)}</span>}
                        {r.min_amount && r.max_amount && <span className="mx-1">–</span>}
                        {r.max_amount && <span className="font-mono text-foreground">{String(r.max_amount)}</span>}
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px] text-foreground">{r.available_amount ?? '—'}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${
                          isActive ? 'bg-[#0ecb81]/10 text-[#0ecb81]'
                          : isPaused ? 'bg-amber-500/10 text-amber-500'
                          : 'bg-muted text-muted-foreground'
                        }`}>
                          {st}
                        </span>
                      </td>
                      <td className="py-3 pl-3 pr-1">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(isEditing ? null : id);
                              if (!isEditing) {
                                setEp({
                                  price: price === '—' ? '' : price,
                                  min_amount: String(r.min_amount ?? ''),
                                  max_amount: String(r.max_amount ?? ''),
                                  remarks: String(r.remarks ?? ''),
                                });
                              }
                            }}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {isActive && (
                            <button
                              type="button"
                              onClick={() => pauseMut.mutate({ id, paused: true })}
                              className="rounded-md p-1.5 text-amber-500 transition-colors hover:bg-amber-500/10"
                              title="Pause"
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isPaused && (
                            <button
                              type="button"
                              onClick={() => pauseMut.mutate({ id, paused: false })}
                              className="rounded-md p-1.5 text-[#0ecb81] transition-colors hover:bg-[#0ecb81]/10"
                              title="Resume"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { if (confirm('Close this ad permanently?')) delMut.mutate(id); }}
                            className="rounded-md p-1.5 text-[#f6465d] transition-colors hover:bg-[#f6465d]/10"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Inline edit row */}
                        {isEditing && (
                          <div className="mt-2 flex items-end gap-2 border-t border-border/15 pt-2">
                            <input placeholder="Price" value={ep.price} onChange={(e) => setEp({ ...ep, price: e.target.value })} className={`${inputCls} w-24`} />
                            <input placeholder="Min" value={ep.min_amount} onChange={(e) => setEp({ ...ep, min_amount: e.target.value })} className={`${inputCls} w-20`} />
                            <input placeholder="Max" value={ep.max_amount} onChange={(e) => setEp({ ...ep, max_amount: e.target.value })} className={`${inputCls} w-20`} />
                            <input placeholder="Remarks" value={ep.remarks} onChange={(e) => setEp({ ...ep, remarks: e.target.value })} className={`${inputCls} w-28`} />
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
                              className="rounded-md bg-primary p-1.5 text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-border/10 md:hidden">
            {rows.map((r) => {
              const id = String(r.id);
              const st = String(r.status ?? '');
              const price = String((r as { current_price?: string }).current_price ?? r.price ?? '—');
              const sym = String((r as { crypto_symbol?: string }).crypto_symbol ?? '');
              const fiat = String(r.fiat_currency ?? '');
              const adType = String(r.type ?? r.ad_type ?? '');
              const isActive = st === 'active';
              const isPaused = st === 'paused';

              return (
                <div key={id} className="py-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground">{sym}/{fiat}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        adType === 'sell' ? 'bg-[#f6465d]/10 text-[#f6465d]' : 'bg-[#0ecb81]/10 text-[#0ecb81]'
                      }`}>{adType}</span>
                    </div>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${
                      isActive ? 'bg-[#0ecb81]/10 text-[#0ecb81]'
                      : isPaused ? 'bg-amber-500/10 text-amber-500'
                      : 'bg-muted text-muted-foreground'
                    }`}>{st}</span>
                  </div>
                  <p className="font-mono text-lg font-bold text-foreground mb-2">{price}</p>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2.5">
                    {r.min_amount && <span>Min: <span className="font-mono text-foreground">{String(r.min_amount)}</span></span>}
                    {r.max_amount && <span>Max: <span className="font-mono text-foreground">{String(r.max_amount)}</span></span>}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => {
                      setEditing(editing === id ? null : id);
                      setEp({ price: price === '—' ? '' : price, min_amount: String(r.min_amount ?? ''), max_amount: String(r.max_amount ?? ''), remarks: String(r.remarks ?? '') });
                    }} className="rounded-md border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <Pencil className="inline h-3 w-3 mr-1" />Edit
                    </button>
                    {isActive && (
                      <button type="button" onClick={() => pauseMut.mutate({ id, paused: true })} className="rounded-md border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-500">
                        <Pause className="inline h-3 w-3 mr-1" />Pause
                      </button>
                    )}
                    {isPaused && (
                      <button type="button" onClick={() => pauseMut.mutate({ id, paused: false })} className="rounded-md border border-[#0ecb81]/30 px-2.5 py-1 text-[11px] text-[#0ecb81]">
                        <Play className="inline h-3 w-3 mr-1" />Resume
                      </button>
                    )}
                    <button type="button" onClick={() => { if (confirm('Close this ad permanently?')) delMut.mutate(id); }} className="rounded-md border border-[#f6465d]/30 px-2.5 py-1 text-[11px] text-[#f6465d]">
                      <Trash2 className="inline h-3 w-3 mr-1" />Delete
                    </button>
                  </div>
                  {editing === id && (
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/15 pt-3">
                      <input placeholder="Price" value={ep.price} onChange={(e) => setEp({ ...ep, price: e.target.value })} className={inputCls} />
                      <input placeholder="Min" value={ep.min_amount} onChange={(e) => setEp({ ...ep, min_amount: e.target.value })} className={inputCls} />
                      <input placeholder="Max" value={ep.max_amount} onChange={(e) => setEp({ ...ep, max_amount: e.target.value })} className={inputCls} />
                      <div className="col-span-3 flex gap-2">
                        <button type="button" disabled={patchMut.isPending} onClick={() => {
                          const body: Parameters<typeof patchMyP2PAd>[1] = {};
                          if (ep.price.trim()) body.price = ep.price.trim();
                          if (ep.min_amount.trim()) body.min_amount = ep.min_amount.trim();
                          if (ep.max_amount.trim()) body.max_amount = ep.max_amount.trim();
                          if (ep.remarks.trim()) body.remarks = ep.remarks.trim();
                          if (Object.keys(body).length) patchMut.mutate({ id, body });
                        }} className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground">Save</button>
                        <button type="button" onClick={() => setEditing(null)} className="rounded-md px-3 py-1.5 text-[11px] text-muted-foreground">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
