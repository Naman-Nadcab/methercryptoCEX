'use client';

import { useQuery } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import Link from 'next/link';
import { fetchP2PMerchantStats, fetchMyOrders, P2P_V2_MERCHANT_STATS_KEY, P2P_V2_ORDERS_KEY } from '@/lib/p2pApi';

export default function P2PV2MerchantDashboardPage() {
  return (
    <RequireAuth>
      <DashInner />
    </RequireAuth>
  );
}

function DashInner() {
  const { data: stats } = useQuery({
    queryKey: P2P_V2_MERCHANT_STATS_KEY,
    queryFn: fetchP2PMerchantStats,
  });

  const { data: orders = [] } = useQuery({
    queryKey: P2P_V2_ORDERS_KEY,
    queryFn: () => fetchMyOrders(),
  });

  const completed = orders.filter((o) => o.status === 'completed').length;
  const volumeApprox = orders
    .filter((o) => o.status === 'completed')
    .reduce((s, o) => s + parseFloat(o.fiat_amount ?? '0'), 0);

  const s = stats ?? {};

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Merchant dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
          <p className="text-xs text-muted-foreground">Completion rate</p>
          <p className="text-2xl font-semibold text-foreground">
            {s.completion_rate != null ? String(s.completion_rate) : '—'}%
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
          <p className="text-xs text-muted-foreground">Total orders (stats)</p>
          <p className="text-2xl font-semibold text-foreground">
            {s.total_orders != null ? String(s.total_orders) : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
          <p className="text-xs text-muted-foreground">Avg release (min)</p>
          <p className="text-2xl font-semibold text-foreground">
            {s.avg_release_time != null
              ? String(s.avg_release_time)
              : s.avg_release_time_minutes != null
                ? String(s.avg_release_time_minutes)
                : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
          <p className="text-xs text-muted-foreground">Completed (recent list)</p>
          <p className="text-2xl font-semibold text-foreground">{completed}</p>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
        <p className="text-xs text-muted-foreground">Approx. completed fiat (from loaded orders)</p>
        <p className="text-lg font-mono text-foreground">{volumeApprox.toFixed(2)}</p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/p2p/my-ads" className="text-primary hover:underline dark:text-blue-400">
          Manage ads
        </Link>
        <Link href="/p2p/orders" className="text-primary hover:underline dark:text-blue-400">
          View orders
        </Link>
      </div>
    </div>
  );
}
