'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { fetchMyOrders, P2P_V2_ORDERS_KEY } from '@/lib/p2pApi';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ClipboardList } from 'lucide-react';

const STATUSES = [
  '',
  'payment_pending',
  'payment_confirmed',
  'completed',
  'cancelled',
  'expired',
  'disputed',
];

export default function P2PV2OrdersPage() {
  return (
    <RequireAuth>
      <OrdersInner />
    </RequireAuth>
  );
}

function OrdersInner() {
  const [filter, setFilter] = useState('');
  const { data: orders = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: [...P2P_V2_ORDERS_KEY, filter],
    queryFn: () => fetchMyOrders(filter || undefined),
  });

  const sorted = useMemo(
    () => [...orders].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))),
    [orders]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">P2P orders</h1>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-3 py-2 text-sm dark:border-border dark:bg-card dark:text-foreground"
      >
        {STATUSES.map((s) => (
          <option key={s || 'all'} value={s}>
            {s ? s.replace(/_/g, ' ') : 'All statuses'}
          </option>
        ))}
      </select>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card"
            >
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-4 w-full max-w-xs" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load orders"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card dark:border-border dark:bg-card">
          <EmptyState
            icon={ClipboardList}
            title="No orders yet"
            description="When you buy or sell on P2P, your orders will appear here."
            action={{ label: 'Browse P2P', href: '/p2p' }}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        {!isLoading && !isError && sorted.map((o) => (
          <Link
            key={o.id}
            href={`/p2p/orders/${o.id}`}
            className="block rounded-xl border border-border bg-card p-4 transition hover:border-blue-500/40 dark:border-border dark:bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted-foreground">{o.id.slice(0, 8)}…</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs dark:bg-accent">{o.status}</span>
            </div>
            <p className="mt-1 text-sm text-foreground">
              {o.quantity} {o.crypto_symbol} · {o.fiat_amount} {o.fiat_currency}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
