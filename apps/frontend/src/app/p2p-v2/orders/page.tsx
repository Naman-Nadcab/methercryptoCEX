'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { fetchMyOrders, P2P_V2_ORDERS_KEY, type P2POrderRow } from '@/lib/p2pApi';
import { useAuthStore } from '@/store/auth';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ClipboardList, ArrowRight, ShoppingBag, Clock, Paperclip, ListOrdered } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { formatFiatSymbol, formatP2pFiatPrice, formatP2pCryptoQty } from '@/lib/p2p-v2-utils';

const STATUSES = ['', 'payment_pending', 'payment_confirmed', 'completed', 'cancelled', 'expired', 'disputed'] as const;

const FILTER_LABEL: Record<string, string> = {
  '': 'All',
  payment_pending: 'Pending',
  payment_confirmed: 'Confirmed',
  completed: 'Done',
  cancelled: 'Cancelled',
  expired: 'Expired',
  disputed: 'Dispute',
};

const STATUS_LABEL: Record<string, string> = {
  payment_pending: 'Paying',
  payment_confirmed: 'Confirm',
  completed: 'Done',
  cancelled: 'Off',
  expired: 'Expired',
  disputed: 'Dispute',
};

const STATUS_CLS: Record<string, string> = {
  payment_pending: 'bg-amber-500/14 text-amber-500 ring-1 ring-amber-500/25',
  payment_confirmed: 'bg-blue-500/14 text-blue-400 ring-1 ring-blue-500/25',
  completed: 'bg-[#0ecb81]/14 text-[#0ecb81] ring-1 ring-[#0ecb81]/22',
  cancelled: 'bg-muted/90 text-muted-foreground ring-1 ring-border/35',
  expired: 'bg-muted/90 text-muted-foreground ring-1 ring-border/35',
  disputed: 'bg-[#f6465d]/14 text-[#f6465d] ring-1 ring-[#f6465d]/25',
};

const IN_PROGRESS = new Set(['payment_pending', 'payment_confirmed', 'disputed']);
const TIME_SENSITIVE = new Set(['payment_pending', 'payment_confirmed', 'disputed']);

function useListTimeTicker() {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);
}

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function orderSide(o: P2POrderRow, userId: string | undefined): 'Buy' | 'Sell' | null {
  if (!userId) return null;
  if (o.buyer_id === userId) return 'Buy';
  if (o.seller_id === userId) return 'Sell';
  return null;
}

function counterpartyLabel(o: P2POrderRow, userId: string | undefined): string {
  if (!userId) return '—';
  if (o.buyer_id === userId) {
    const u = o.seller_username?.trim();
    if (u) return truncate(u, 14);
    return truncate(o.seller_id, 10);
  }
  if (o.seller_id === userId) {
    const u = o.buyer_username?.trim();
    if (u) return truncate(u, 14);
    return truncate(o.buyer_id, 10);
  }
  return '—';
}

function pairLabel(o: P2POrderRow): string {
  const c = (o.crypto_symbol ?? '—').toUpperCase();
  const f = (o.fiat_currency ?? '—').toUpperCase();
  return `${c}/${f}`;
}

function unitPriceDisplay(o: P2POrderRow): string | null {
  const f = parseFloat(String(o.fiat_amount ?? '').replace(/,/g, ''));
  const q = parseFloat(String(o.quantity ?? '').replace(/,/g, ''));
  if (!Number.isFinite(f) || !Number.isFinite(q) || q === 0) return null;
  const p = f / q;
  if (!Number.isFinite(p)) return null;
  const fiat = o.fiat_currency ?? '';
  return `${formatFiatSymbol(fiat)}${formatP2pFiatPrice(String(p), fiat)}`;
}

function formatTimeLeft(o: P2POrderRow): string {
  if (!o.expires_at || !TIME_SENSITIVE.has(o.status)) return '—';
  const end = new Date(o.expires_at).getTime();
  if (Number.isNaN(end)) return '—';
  const ms = end - Date.now();
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 72) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function payMethod(o: P2POrderRow): string {
  const n = o.seller_payment_method_name?.trim();
  if (n) return truncate(n, 18);
  const c = o.seller_payment_method_code?.trim();
  if (c) return truncate(c.replace(/_/g, ' '), 18);
  return '—';
}

export default function P2PV2OrdersPage() {
  return (
    <RequireAuth>
      <OrdersInner />
    </RequireAuth>
  );
}

function OrdersInner() {
  useListTimeTicker();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;

  const [filter, setFilter] = useState('');
  const { data: orders = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: [...P2P_V2_ORDERS_KEY, filter],
    queryFn: () => fetchMyOrders(filter || undefined),
  });

  const sorted = useMemo(
    () => [...orders].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [orders],
  );

  const stats = useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    for (const o of sorted) {
      if (IN_PROGRESS.has(o.status)) inProgress += 1;
      else if (o.status === 'completed') completed += 1;
    }
    return { total: sorted.length, inProgress, completed };
  }, [sorted]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
        {/* Match P2P marketplace page header strip */}
        <header className="flex flex-col gap-3 border-b border-border/20 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">My P2P orders</h1>
              {!isLoading && !isError && sorted.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
                  <ListOrdered className="h-3.5 w-3.5 shrink-0" />
                  <span className="tabular-nums">{stats.total}</span> orders
                  {stats.inProgress > 0 && (
                    <span className="text-amber-600 dark:text-amber-500">
                      · <span className="tabular-nums">{stats.inProgress}</span> active
                    </span>
                  )}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Your buys and sells with other users. Open a row for payment time, proof, and release — escrow until the trade completes.
            </p>
          </div>
          <Link
            href="/p2p"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border/40 px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <ShoppingBag className="h-4 w-4" />
            <span>Marketplace</span>
          </Link>
        </header>

        {/* Match marketplace filter bar spacing */}
        <div className="border-b border-border/10 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
          <nav
            className="flex flex-wrap items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Filter orders by status"
          >
            {STATUSES.map((s) => {
              const active = filter === s;
              return (
                <button
                  key={s || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(s)}
                  className={`inline-flex shrink-0 items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    active
                      ? 'bg-primary/12 text-primary ring-1 ring-primary/15'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  {FILTER_LABEL[s] ?? s}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="min-w-0 pt-2">
            {/* Summary strip mobile — marketplace chip scale */}
            {!isLoading && !isError && sorted.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2 md:hidden">
                <span className="rounded-lg bg-muted/40 px-2.5 py-1 text-xs font-semibold text-foreground">
                  <span className="tabular-nums">{stats.total}</span> orders
                </span>
                {stats.inProgress > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-500">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{stats.inProgress}</span> active
                  </span>
                )}
              </div>
            )}

            {/* Loading — dense row skeleton */}
            {isLoading && (
              <div className="overflow-hidden rounded-xl border border-border/25 bg-card/50">
                <div className="divide-y divide-border/10">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
                      <Skeleton className="h-7 w-16 shrink-0 rounded" />
                      <Skeleton className="h-5 w-10 shrink-0 rounded-sm" />
                      <Skeleton className="h-5 w-14 shrink-0" />
                      <Skeleton className="h-5 w-20 shrink-0" />
                      <div className="hidden min-w-0 flex-1 sm:block">
                        <Skeleton className="ml-auto h-4 w-24" />
                      </div>
                      <Skeleton className="h-5 w-12 shrink-0 rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isError && (
              <div className="py-8">
                <ErrorState
                  title="Could not load orders"
                  message={error instanceof Error ? error.message : undefined}
                  onRetry={() => void refetch()}
                />
              </div>
            )}

            {!isLoading && !isError && sorted.length === 0 && (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl border border-dashed border-border/40 bg-muted/10">
                  <div className="border-b border-border/20 bg-muted/20 px-4 py-3 sm:px-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview — your order list</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      After you start a trade, each row shows pair, counterparty, amounts, and status here.
                    </p>
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[1000px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-border/25 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="whitespace-nowrap py-2.5 pl-4 pr-2">Order</th>
                          <th className="whitespace-nowrap px-2 py-2.5">Side</th>
                          <th className="whitespace-nowrap px-2 py-2.5">Pair</th>
                          <th className="whitespace-nowrap px-2 py-2.5">Counterparty</th>
                          <th className="whitespace-nowrap px-2 py-2.5 text-right">Qty</th>
                          <th className="whitespace-nowrap px-2 py-2.5 text-right">Total</th>
                          <th className="whitespace-nowrap px-2 py-2.5 text-right">Unit</th>
                          <th className="whitespace-nowrap px-2 py-2.5">Payment</th>
                          <th className="whitespace-nowrap px-2 py-2.5">Time left</th>
                          <th className="whitespace-nowrap px-2 py-2.5">Status</th>
                          <th className="whitespace-nowrap py-2.5 pl-2 pr-4 text-right" />
                        </tr>
                      </thead>
                      <tbody className="opacity-40">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <tr key={i} className="border-b border-border/10">
                            <td className="py-2.5 pl-3 pr-2">
                              <Skeleton className="h-3 w-20" />
                            </td>
                            <td className="px-2 py-2.5">
                              <Skeleton className="h-5 w-9 rounded-sm" />
                            </td>
                            <td className="px-2 py-2.5">
                              <Skeleton className="h-3 w-14" />
                            </td>
                            <td className="px-2 py-2.5">
                              <Skeleton className="h-3 w-24" />
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <Skeleton className="ml-auto h-3 w-16" />
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <Skeleton className="ml-auto h-3 w-14" />
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <Skeleton className="ml-auto h-3 w-12" />
                            </td>
                            <td className="px-2 py-2.5">
                              <Skeleton className="h-3 w-20" />
                            </td>
                            <td className="px-2 py-2.5">
                              <Skeleton className="h-3 w-10" />
                            </td>
                            <td className="px-2 py-2.5">
                              <Skeleton className="h-5 w-14 rounded-full" />
                            </td>
                            <td className="py-2.5 pl-2 pr-3 text-right">
                              <Skeleton className="ml-auto h-3 w-8" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="divide-y divide-border/10 p-3 md:hidden">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex gap-2 py-2.5 first:pt-0">
                        <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-3/4 max-w-[220px]" />
                          <Skeleton className="h-3 w-1/2 max-w-[140px]" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col items-center py-20 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/50 bg-muted/30 text-muted-foreground/50">
                    <ClipboardList className="h-8 w-8" strokeWidth={1.5} />
                  </div>
                  <p className="text-base font-semibold tracking-tight text-foreground">No orders yet</p>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Go to the marketplace to buy or sell. Every trade you open will show up in this list.
                  </p>
                  <Link
                    href="/p2p"
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    Go to marketplace
                  </Link>
                </div>
              </div>
            )}

            {!isLoading && !isError && sorted.length > 0 && (
              <>
                <div className="hidden md:block">
                  <div className="max-h-[min(72vh,780px)] overflow-auto rounded-xl border border-border/25">
                  <table className="relative w-full min-w-[1080px] border-collapse text-left text-sm">
                    <caption className="sr-only">Your P2P orders</caption>
                    <thead>
                      <tr className="sticky top-0 z-10 border-b border-border/25 bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="whitespace-nowrap py-3.5 pl-4 pr-2">Order</th>
                        <th className="whitespace-nowrap px-3 py-3.5">Side</th>
                        <th className="whitespace-nowrap px-3 py-3.5">Pair</th>
                        <th className="whitespace-nowrap px-3 py-3.5">Counterparty</th>
                        <th className="whitespace-nowrap px-3 py-3.5 text-right">Quantity</th>
                        <th className="whitespace-nowrap px-3 py-3.5 text-right">Total</th>
                        <th className="whitespace-nowrap px-3 py-3.5 text-right">Unit price</th>
                        <th className="whitespace-nowrap px-3 py-3.5">Payment</th>
                        <th className="whitespace-nowrap px-3 py-3.5">Time left</th>
                        <th className="whitespace-nowrap px-3 py-3.5">Status</th>
                        <th className="whitespace-nowrap py-3.5 pl-3 pr-4 text-right"> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((o) => {
                        const sCls = STATUS_CLS[o.status] ?? 'bg-muted text-muted-foreground ring-1 ring-border/35';
                        const side = orderSide(o, userId);
                        const up = unitPriceDisplay(o);
                        const fiat = o.fiat_currency ?? '';
                        return (
                          <tr
                            key={o.id}
                            className="border-b border-border/10 transition-colors duration-100 hover:bg-muted/[0.06]"
                          >
                            <td className="whitespace-nowrap py-4 pl-4 pr-2 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {o.id.slice(0, 8)}…
                                </span>
                                {o.payment_proof_url ? (
                                  <span title="Payment proof attached" className="text-primary/80">
                                    <Paperclip className="h-3 w-3" />
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 align-middle">
                              {side ? (
                                <span
                                  className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
                                    side === 'Buy'
                                      ? 'bg-[#0ecb81]/16 text-[#0ecb81]'
                                      : 'bg-[#f6465d]/14 text-[#f6465d]'
                                  }`}
                                >
                                  {side}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 align-middle">
                              <span className="font-semibold text-foreground">{pairLabel(o)}</span>
                            </td>
                            <td className="max-w-[100px] truncate px-3 py-4 align-middle text-sm text-muted-foreground" title={counterpartyLabel(o, userId)}>
                              {counterpartyLabel(o, userId)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-right align-middle">
                              <span className="inline-flex items-center justify-end gap-1">
                                {o.crypto_symbol ? <CoinIcon symbol={o.crypto_symbol} size={16} /> : null}
                                <span className="numeric font-semibold tabular-nums text-foreground">{formatP2pCryptoQty(String(o.quantity ?? ''))}</span>
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-right align-middle">
                              <span className="numeric tabular-nums font-medium text-foreground">
                                {o.fiat_amount != null && String(o.fiat_amount).trim() !== ''
                                  ? `${formatFiatSymbol(fiat)}${formatP2pFiatPrice(String(o.fiat_amount), fiat)}`
                                  : '—'}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-right align-middle">
                              {up != null ? (
                                <span className="numeric font-semibold tabular-nums text-foreground">{up}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td
                              className="max-w-[88px] truncate px-3 py-4 align-middle text-sm text-muted-foreground"
                              title={payMethod(o)}
                            >
                              {payMethod(o)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 align-middle">
                              <span
                                className={`tabular-nums ${
                                  formatTimeLeft(o) !== '—' && o.status === 'payment_pending'
                                    ? 'font-semibold text-amber-500'
                                    : 'text-muted-foreground'
                                }`}
                              >
                                {formatTimeLeft(o)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 align-middle">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${sCls}`}>
                                {STATUS_LABEL[o.status] ?? o.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap py-4 pl-3 pr-4 text-right align-middle">
                              <Link
                                href={`/p2p/orders/${o.id}`}
                                className="inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80"
                              >
                                Detail
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>

                {/* Mobile — match P2P ads card radius / padding */}
                <div className="space-y-2 md:hidden">
                  {sorted.map((o) => {
                    const sCls = STATUS_CLS[o.status] ?? 'bg-muted text-muted-foreground ring-1 ring-border/35';
                    const side = orderSide(o, userId);
                    return (
                      <Link
                        key={o.id}
                        href={`/p2p/orders/${o.id}`}
                        className="flex gap-3 rounded-xl border border-border/25 bg-card p-4 transition-colors duration-100 hover:bg-muted/[0.04] sm:p-5"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          {o.crypto_symbol ? <CoinIcon symbol={o.crypto_symbol} size={22} /> : <ClipboardList className="h-5 w-5 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{o.id.slice(0, 8)}…</span>
                            {side ? (
                              <span
                                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                                  side === 'Buy' ? 'bg-[#0ecb81]/16 text-[#0ecb81]' : 'bg-[#f6465d]/14 text-[#f6465d]'
                                }`}
                              >
                                {side}
                              </span>
                            ) : null}
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sCls}`}>
                              {STATUS_LABEL[o.status] ?? o.status}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            <span className="numeric tabular-nums">{formatP2pCryptoQty(String(o.quantity ?? ''))}</span> {o.crypto_symbol}
                            <span className="mx-1 font-normal text-muted-foreground">·</span>
                            <span className="numeric tabular-nums">
                              {o.fiat_amount != null && String(o.fiat_amount).trim() !== ''
                                ? `${formatFiatSymbol(o.fiat_currency ?? '')}${formatP2pFiatPrice(String(o.fiat_amount), o.fiat_currency ?? '')}`
                                : '—'}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {pairLabel(o)} · {counterpartyLabel(o, userId)}
                            {formatTimeLeft(o) !== '—' ? (
                              <>
                                {' · '}
                                <span className="font-semibold text-amber-600 dark:text-amber-500">{formatTimeLeft(o)}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/40" />
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
        </div>
    </div>
  );
}
