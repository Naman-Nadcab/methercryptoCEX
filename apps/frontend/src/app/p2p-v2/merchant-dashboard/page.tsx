'use client';

import { useQuery } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import Link from 'next/link';
import { fetchP2PMerchantStats, fetchMyOrders, P2P_V2_MERCHANT_STATS_KEY, P2P_V2_ORDERS_KEY } from '@/lib/p2pApi';
import { P2P_HREF } from '@/lib/routes';
import { BarChart3, CheckCircle2, Clock, DollarSign, ArrowRight, ListOrdered, Megaphone, Sparkles } from 'lucide-react';

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
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-6">
      <header className="border-b border-border/25 py-5 sm:py-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Merchant dashboard</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Snapshot of your P2P performance. Stats come from your merchant profile; volume sums completed orders loaded in this session.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-muted/25 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            P2P merchant
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-border/40 bg-card/80 p-5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-primary/20 hover:shadow-md supports-[backdrop-filter]:bg-card/70"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</p>
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-border/20 ${card.iconCls}`}>
                  <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
                </div>
              </div>
              <p className="numeric text-3xl font-bold tracking-tight text-foreground">{card.value}</p>
              {card.bar != null && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progress vs target</span>
                    <span className="font-medium text-[#0ecb81]">95%+</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full rounded-full bg-[#0ecb81] transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, card.bar))}%` }}
                    />
                  </div>
                </div>
              )}
              {card.sub && <p className="mt-2 text-sm text-muted-foreground">{card.sub}</p>}
            </div>
          );
        })}
      </div>

      {/* Volume */}
      <div className="mt-6 rounded-2xl border border-border/40 bg-gradient-to-br from-card via-card to-muted/20 p-6 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
              <DollarSign className="h-6 w-6 text-primary" strokeWidth={2} aria-hidden />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approx. fiat volume</p>
              <p className="mt-1 text-sm text-muted-foreground">Sum of fiat from completed orders in the list loaded for this page.</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium text-muted-foreground">Total (fiat)</p>
            <p className="numeric mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {volumeApprox.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link
          href={`${P2P_HREF}/my-ads`}
          className="group flex items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card p-5 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-muted/20 hover:shadow-md"
        >
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
              <Megaphone className="h-5 w-5" strokeWidth={2} aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-foreground">Manage ads</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Edit, pause, or create listings</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
        </Link>
        <Link
          href={`${P2P_HREF}/orders`}
          className="group flex items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card p-5 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-muted/20 hover:shadow-md"
        >
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-foreground ring-1 ring-border/30">
              <ListOrdered className="h-5 w-5" strokeWidth={2} aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-foreground">View orders</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Track every P2P transaction</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
