'use client';

import { useQuery } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import Link from 'next/link';
import { fetchP2PMerchantStats, fetchMyOrders, P2P_V2_MERCHANT_STATS_KEY, P2P_V2_ORDERS_KEY } from '@/lib/p2pApi';
import { BarChart3, CheckCircle2, Clock, DollarSign, ArrowRight, ListOrdered, Megaphone } from 'lucide-react';

export default function P2PV2MerchantDashboardPage() {
  return <RequireAuth><DashInner /></RequireAuth>;
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
  const completionRate = s.completion_rate != null ? Number(s.completion_rate) : null;
  const totalOrders = s.total_orders != null ? String(s.total_orders) : '—';
  const avgRelease = s.avg_release_time != null
    ? String(s.avg_release_time)
    : s.avg_release_time_minutes != null
      ? String(s.avg_release_time_minutes)
      : '—';

  const statCards = [
    {
      label: 'Completion Rate',
      value: completionRate != null ? `${completionRate}%` : '—',
      icon: CheckCircle2,
      iconCls: 'bg-[#0ecb81]/10 text-[#0ecb81]',
      bar: completionRate,
    },
    {
      label: 'Total Orders',
      value: totalOrders,
      icon: BarChart3,
      iconCls: 'bg-primary/10 text-primary',
      sub: 'All time',
    },
    {
      label: 'Avg Release',
      value: avgRelease,
      icon: Clock,
      iconCls: 'bg-blue-500/10 text-blue-500',
      sub: 'Minutes',
    },
    {
      label: 'Completed',
      value: String(completed),
      icon: DollarSign,
      iconCls: 'bg-amber-500/10 text-amber-500',
      sub: 'Recent orders',
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
      <div className="border-b border-border/20 py-3">
        <h1 className="text-[15px] font-bold text-foreground">Merchant Dashboard</h1>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-5">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-lg border border-border/30 bg-card p-4 transition-colors hover:border-border/50">
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.iconCls}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{card.label}</p>
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums font-mono">{card.value}</p>
              {card.bar != null && (
                <div className="mt-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
                    <div
                      className="h-full rounded-full bg-[#0ecb81] transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, card.bar))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">Target: 95%+</p>
                </div>
              )}
              {card.sub && <p className="mt-1 text-[10px] text-muted-foreground">{card.sub}</p>}
            </div>
          );
        })}
      </div>

      {/* Volume */}
      <div className="mt-4 rounded-lg border border-border/30 bg-card p-4">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Approx. Fiat Volume</p>
            <p className="text-[10px] text-muted-foreground/40">From loaded orders</p>
          </div>
        </div>
        <p className="text-2xl font-bold font-mono text-foreground tabular-nums">{volumeApprox.toFixed(2)}</p>
      </div>

      {/* Quick links */}
      <div className="grid gap-3 sm:grid-cols-2 mt-4">
        <Link
          href="/p2p/my-ads"
          className="group flex items-center justify-between rounded-lg border border-border/30 bg-card p-3.5 transition-colors hover:border-border/50"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
              <Megaphone className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Manage Ads</p>
              <p className="text-[10px] text-muted-foreground">Edit, pause, or create ads</p>
            </div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-primary" />
        </Link>
        <Link
          href="/p2p/orders"
          className="group flex items-center justify-between rounded-lg border border-border/30 bg-card p-3.5 transition-colors hover:border-border/50"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
              <ListOrdered className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-foreground">View Orders</p>
              <p className="text-[10px] text-muted-foreground">Track all transactions</p>
            </div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-primary" />
        </Link>
      </div>
    </div>
  );
}
