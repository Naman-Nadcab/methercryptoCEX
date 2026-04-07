'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import { fetchMyP2PAds, patchMyP2PAd, deleteMyP2PAd, P2P_V2_MY_ADS_KEY } from '@/lib/p2pApi';
import {
  formatFiatSymbol,
  formatP2pFiatPrice,
  formatP2pCryptoQty,
  p2pPaymentMethodChipCls,
} from '@/lib/p2p-v2-utils';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/Skeleton';
import { PlusCircle, Pencil, Pause, Play, Trash2, Megaphone, X, Check } from 'lucide-react';

function paymentLabels(ad: Record<string, unknown>): string[] {
  const m = ad.accepted_payment_methods;
  if (m == null) return [];
  if (Array.isArray(m)) {
    return m
      .map((x) =>
        typeof x === 'string'
          ? x
          : typeof x === 'object' && x && 'name' in x
            ? String((x as { name?: string }).name)
            : String(x),
      )
      .filter(Boolean)
      .slice(0, 6);
  }
  return [String(m)];
}

function formatUpdatedAt(ad: Record<string, unknown>): string | null {
  const t = (ad as { updated_at?: string; created_at?: string }).updated_at
    ?? (ad as { created_at?: string }).created_at;
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

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

  const inputCls =
    'w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm font-mono text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10';

  const iconBtn =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground';

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-border/20 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My ads</h1>
        <Link
          href="/p2p/create-ad"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PlusCircle className="h-4 w-4" />
          New ad
        </Link>
      </header>

      {isLoading && (
        <div className="mt-2 divide-y divide-border/10 rounded-xl border border-border/25">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center gap-4 px-3 py-4 sm:px-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-6 w-16 rounded-lg" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-36" />
              <Skeleton className="ml-auto h-9 w-28 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/50 bg-muted/30 text-muted-foreground/50">
            <Megaphone className="h-8 w-8" />
          </div>
          <p className="text-base font-semibold tracking-tight text-foreground">No ads yet</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Create your first ad to start trading on the marketplace.</p>
          <Link
            href="/p2p/create-ad"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PlusCircle className="h-4 w-4" />
            Create ad
          </Link>
        </div>
      )}

      {/* Table */}
      {!isLoading && rows.length > 0 && (
        <>
          <div className="mt-2 hidden md:block">
            <div className="overflow-x-auto rounded-xl border border-border/25">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/25 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="whitespace-nowrap py-3.5 pl-4 pr-3">Pair</th>
                  <th className="whitespace-nowrap px-3 py-3.5">Type</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-right">Price</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-right">Limits (crypto)</th>
                  <th className="whitespace-nowrap px-3 py-3.5 text-right">Available</th>
                  <th className="whitespace-nowrap px-3 py-3.5">Payments</th>
                  <th className="whitespace-nowrap px-3 py-3.5">Status</th>
                  <th className="whitespace-nowrap px-3 py-3.5">Updated</th>
                  <th className="whitespace-nowrap py-3.5 pl-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const id = String(r.id);
                  const st = String((r as { status?: string }).status ?? '');
                  const rawPrice = String((r as { current_price?: string }).current_price ?? r.price ?? '');
                  const price = rawPrice || '—';
                  const sym = String(r.crypto_symbol ?? '');
                  const fiat = String(r.fiat_currency ?? '');
                  const adType = String(r.type ?? r.ad_type ?? '');
                  const isActive = st === 'active';
                  const isPaused = st === 'paused';
                  const isEditing = editing === id;
                  const pms = paymentLabels(r);
                  const updated = formatUpdatedAt(r);
                  const minS = r.min_amount != null && r.min_amount !== '' ? formatP2pCryptoQty(String(r.min_amount)) : null;
                  const maxS = r.max_amount != null && r.max_amount !== '' ? formatP2pCryptoQty(String(r.max_amount)) : null;
                  const limitsDisplay =
                    minS && maxS ? `${minS} – ${maxS}` : minS ?? maxS ?? '—';

                  return (
                    <tr key={id} className="border-b border-border/10 transition-colors duration-100 hover:bg-muted/[0.06]">
                      <td className="py-4 pl-4 pr-3 align-middle">
                        <span className="text-sm font-semibold text-foreground">{sym}/{fiat}</span>
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <span className={`rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                          adType === 'sell' ? 'bg-[#f6465d]/12 text-[#f6465d] ring-1 ring-[#f6465d]/20' : 'bg-[#0ecb81]/12 text-[#0ecb81] ring-1 ring-[#0ecb81]/20'
                        }`}>
                          {adType}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right align-middle">
                        <span className="numeric text-base font-semibold tabular-nums text-foreground">
                          {price === '—' ? '—' : (
                            <>
                              {formatFiatSymbol(fiat)}
                              {formatP2pFiatPrice(price, fiat)}
                            </>
                          )}
                          {price !== '—' && sym ? (
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">per {sym}</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="numeric px-3 py-4 text-right align-middle text-sm tabular-nums text-foreground">
                        {limitsDisplay}
                      </td>
                      <td className="numeric px-3 py-4 text-right align-middle text-sm font-medium tabular-nums text-foreground">
                        {formatP2pCryptoQty(String(r.available_amount ?? ''))}
                        {sym ? <span className="ml-1 text-xs font-normal text-muted-foreground">{sym}</span> : null}
                      </td>
                      <td className="max-w-[200px] px-3 py-4 align-middle">
                        {pms.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {pms.slice(0, 2).map((p) => (
                              <span
                                key={p}
                                className={`max-w-[88px] truncate rounded-md border px-2 py-0.5 text-xs font-medium ${p2pPaymentMethodChipCls(p)}`}
                                title={p}
                              >
                                {p}
                              </span>
                            ))}
                            {pms.length > 2 && (
                              <span className="rounded-md border border-border/30 bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                +{pms.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-4 align-middle">
                        <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${
                          isActive ? 'bg-[#0ecb81]/12 text-[#0ecb81] ring-1 ring-[#0ecb81]/18'
                          : isPaused ? 'bg-amber-500/12 text-amber-500 ring-1 ring-amber-500/20'
                          : 'bg-muted/80 text-muted-foreground ring-1 ring-border/30'
                        }`}>
                          {st || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-4 align-middle text-sm text-muted-foreground">
                        {updated ?? '—'}
                      </td>
                      <td className="py-4 pl-3 pr-4 align-middle">
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(isEditing ? null : id);
                                if (!isEditing) {
                                  setEp({
                                    price: price === '—' ? '' : rawPrice,
                                    min_amount: String(r.min_amount ?? ''),
                                    max_amount: String(r.max_amount ?? ''),
                                    remarks: String((r as { remarks?: string }).remarks ?? ''),
                                  });
                                }
                              }}
                              className={iconBtn}
                              title="Edit"
                              aria-label="Edit ad"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {isActive && (
                              <button
                                type="button"
                                onClick={() => pauseMut.mutate({ id, paused: true })}
                                className={`${iconBtn} text-amber-600 hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-500`}
                                title="Pause"
                                aria-label="Pause ad"
                              >
                                <Pause className="h-4 w-4" />
                              </button>
                            )}
                            {isPaused && (
                              <button
                                type="button"
                                onClick={() => pauseMut.mutate({ id, paused: false })}
                                className={`${iconBtn} text-[#0ecb81] hover:border-[#0ecb81]/30 hover:bg-[#0ecb81]/10`}
                                title="Resume"
                                aria-label="Resume ad"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { if (confirm('Close this ad permanently?')) delMut.mutate(id); }}
                              className={`${iconBtn} text-[#f6465d] hover:border-[#f6465d]/30 hover:bg-[#f6465d]/10`}
                              title="Delete"
                              aria-label="Delete ad"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          {isEditing && (
                            <div className="mt-1 flex w-full max-w-md flex-wrap items-end justify-end gap-2 border-t border-border/20 pt-3">
                              <input placeholder="Price" value={ep.price} onChange={(e) => setEp({ ...ep, price: e.target.value })} className={`${inputCls} w-28`} />
                              <input placeholder="Min" value={ep.min_amount} onChange={(e) => setEp({ ...ep, min_amount: e.target.value })} className={`${inputCls} w-24`} />
                              <input placeholder="Max" value={ep.max_amount} onChange={(e) => setEp({ ...ep, max_amount: e.target.value })} className={`${inputCls} w-24`} />
                              <input placeholder="Remarks" value={ep.remarks} onChange={(e) => setEp({ ...ep, remarks: e.target.value })} className={`${inputCls} min-w-[7rem] flex-1`} />
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
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                                aria-label="Save"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditing(null)}
                                className={iconBtn}
                                aria-label="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="mt-2 space-y-3 md:hidden">
            {rows.map((r) => {
              const id = String(r.id);
              const st = String((r as { status?: string }).status ?? '');
              const rawPrice = String((r as { current_price?: string }).current_price ?? r.price ?? '');
              const price = rawPrice || '—';
              const sym = String(r.crypto_symbol ?? '');
              const fiat = String(r.fiat_currency ?? '');
              const adType = String(r.type ?? r.ad_type ?? '');
              const isActive = st === 'active';
              const isPaused = st === 'paused';
              const pms = paymentLabels(r);
              const updated = formatUpdatedAt(r);

              return (
                <div key={id} className="rounded-xl border border-border/25 bg-card p-4 sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-foreground">{sym}/{fiat}</span>
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                        adType === 'sell' ? 'bg-[#f6465d]/12 text-[#f6465d] ring-1 ring-[#f6465d]/20' : 'bg-[#0ecb81]/12 text-[#0ecb81] ring-1 ring-[#0ecb81]/20'
                      }`}>{adType}</span>
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${
                      isActive ? 'bg-[#0ecb81]/12 text-[#0ecb81] ring-1 ring-[#0ecb81]/18'
                      : isPaused ? 'bg-amber-500/12 text-amber-500 ring-1 ring-amber-500/20'
                      : 'bg-muted/80 text-muted-foreground ring-1 ring-border/30'
                    }`}>{st || '—'}</span>
                  </div>
                  <p className="numeric text-xl font-bold tabular-nums text-foreground">
                    {price === '—' ? '—' : (
                      <>
                        {formatFiatSymbol(fiat)}{formatP2pFiatPrice(price, fiat)}
                        <span className="ml-1 text-sm font-semibold text-muted-foreground">/ {sym}</span>
                      </>
                    )}
                  </p>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <p>
                      Limits:{' '}
                      <span className="numeric font-medium tabular-nums text-foreground">
                        {r.min_amount != null && r.min_amount !== '' ? formatP2pCryptoQty(String(r.min_amount)) : '—'}
                        {' – '}
                        {r.max_amount != null && r.max_amount !== '' ? formatP2pCryptoQty(String(r.max_amount)) : '—'}
                      </span>{' '}
                      {sym}
                    </p>
                    <p>
                      Available:{' '}
                      <span className="numeric font-semibold tabular-nums text-foreground">{formatP2pCryptoQty(String(r.available_amount ?? ''))}</span>{' '}
                      {sym}
                    </p>
                    {pms.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {pms.slice(0, 3).map((p) => (
                          <span key={p} className={`rounded-md border px-2 py-0.5 text-xs font-medium ${p2pPaymentMethodChipCls(p)}`}>{p}</span>
                        ))}
                        {pms.length > 3 && (
                          <span className="rounded-md border border-border/30 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">+{pms.length - 3}</span>
                        )}
                      </div>
                    )}
                    {updated && <p className="text-xs">Updated {updated}</p>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(editing === id ? null : id);
                        setEp({
                          price: price === '—' ? '' : rawPrice,
                          min_amount: String(r.min_amount ?? ''),
                          max_amount: String(r.max_amount ?? ''),
                          remarks: String((r as { remarks?: string }).remarks ?? ''),
                        });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => pauseMut.mutate({ id, paused: true })}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/35 px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-500"
                      >
                        <Pause className="h-4 w-4" />
                        Pause
                      </button>
                    )}
                    {isPaused && (
                      <button
                        type="button"
                        onClick={() => pauseMut.mutate({ id, paused: false })}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#0ecb81]/35 px-3 py-2 text-sm font-medium text-[#0ecb81]"
                      >
                        <Play className="h-4 w-4" />
                        Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { if (confirm('Close this ad permanently?')) delMut.mutate(id); }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#f6465d]/35 px-3 py-2 text-sm font-medium text-[#f6465d]"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                  {editing === id && (
                    <div className="mt-4 space-y-2 border-t border-border/20 pt-4">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input placeholder="Price" value={ep.price} onChange={(e) => setEp({ ...ep, price: e.target.value })} className={inputCls} />
                        <input placeholder="Min" value={ep.min_amount} onChange={(e) => setEp({ ...ep, min_amount: e.target.value })} className={inputCls} />
                        <input placeholder="Max" value={ep.max_amount} onChange={(e) => setEp({ ...ep, max_amount: e.target.value })} className={inputCls} />
                      </div>
                      <input placeholder="Remarks" value={ep.remarks} onChange={(e) => setEp({ ...ep, remarks: e.target.value })} className={inputCls} />
                      <div className="flex flex-wrap gap-2">
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
                          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className="rounded-xl border border-border/40 px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/40">
                          Cancel
                        </button>
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
