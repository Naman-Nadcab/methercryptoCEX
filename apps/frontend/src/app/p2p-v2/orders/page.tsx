'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { fetchMyOrders, P2P_V2_ORDERS_KEY } from '@/lib/p2pApi';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ClipboardList, ArrowRight, ShoppingBag } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';

const STATUSES = ['', 'payment_pending', 'payment_confirmed', 'completed', 'cancelled', 'expired', 'disputed'];
const STATUS_LABEL: Record<string, string> = {
  payment_pending: 'Pending',
  payment_confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  disputed: 'Disputed',
};
const STATUS_CLS: Record<string, string> = {
  payment_pending: 'bg-amber-500/10 text-amber-500',
  payment_confirmed: 'bg-blue-500/10 text-blue-500',
  completed: 'bg-[#0ecb81]/10 text-[#0ecb81]',
  cancelled: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground',
  disputed: 'bg-[#f6465d]/10 text-[#f6465d]',
};

export default function P2PV2OrdersPage() {
  return <RequireAuth><OrdersInner /></RequireAuth>;
}

function OrdersInner() {
  const [filter, setFilter] = useState('');
  const { data: orders = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: [...P2P_V2_ORDERS_KEY, filter],
    queryFn: () => fetchMyOrders(filter || undefined),
  });

  const sorted = useMemo(
    () => [...orders].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [orders],
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
      <div className="flex items-center justify-between border-b border-border/20 py-3">
        <h1 className="text-[15px] font-bold text-foreground">P2P Orders</h1>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 border-b border-border/10 py-2.5 overflow-x-auto">
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setFilter(s)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
              filter === s
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            }`}
          >
            {s ? s.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="divide-y divide-border/10">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-4 w-4" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="py-8">
          <ErrorState
            title="Could not load orders"
            message={error instanceof Error ? error.message : undefined}
            onRetry={() => void refetch()}
          />
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && sorted.length === 0 && (
        <div className="flex flex-col items-center py-20 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm font-medium text-foreground">No orders yet</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Start trading on the P2P marketplace.</p>
          <Link
            href="/p2p"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Browse P2P
          </Link>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && sorted.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/15 text-[11px] text-muted-foreground/60">
                  <th className="py-2.5 pl-1 pr-3 font-medium">Order</th>
                  <th className="px-3 py-2.5 font-medium">Crypto</th>
                  <th className="px-3 py-2.5 font-medium">Fiat</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="py-2.5 pl-3 pr-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => {
                  const sCls = STATUS_CLS[o.status] ?? 'bg-muted text-muted-foreground';
                  return (
                    <tr key={o.id} className="border-b border-border/10 transition-colors hover:bg-muted/[0.04]">
                      <td className="py-3.5 pl-1 pr-3">
                        <span className="font-mono text-[11px] text-muted-foreground">{o.id.slice(0, 10)}…</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="flex items-center gap-1.5">
                          {o.crypto_symbol && <CoinIcon symbol={o.crypto_symbol} size={16} />}
                          <span className="font-mono text-[13px] font-semibold text-foreground">{o.quantity}</span>
                          <span className="text-[11px] text-muted-foreground">{o.crypto_symbol}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-[13px] text-foreground">
                        {o.fiat_amount} <span className="text-[11px] text-muted-foreground">{o.fiat_currency}</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${sCls}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-[11px] text-muted-foreground">
                        {o.created_at
                          ? new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="py-3.5 pl-3 pr-1 text-right">
                        <Link
                          href={`/p2p/orders/${o.id}`}
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary transition-colors hover:text-primary/80"
                        >
                          View
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="divide-y divide-border/10 md:hidden">
            {sorted.map((o) => {
              const sCls = STATUS_CLS[o.status] ?? 'bg-muted text-muted-foreground';
              return (
                <Link key={o.id} href={`/p2p/orders/${o.id}`} className="flex items-center gap-3 py-3.5">
                  {o.crypto_symbol && <CoinIcon symbol={o.crypto_symbol} size={24} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground">
                      <span className="font-mono">{o.quantity}</span> {o.crypto_symbol}
                      <span className="mx-1.5 text-muted-foreground/30">·</span>
                      <span className="font-mono">{o.fiat_amount}</span> {o.fiat_currency}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {o.created_at ? new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${sCls}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
