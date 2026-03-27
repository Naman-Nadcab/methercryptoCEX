'use client';

import Link from 'next/link';
import { useControlOverview, useTradingHalt } from '@/hooks/admin/useAdminDashboard';
import { Activity, Server, TrendingUp, Cpu, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SystemHealthPanel() {
  const { data: controlData } = useControlOverview();
  const { data: haltData } = useTradingHalt();
  const overview = controlData?.data;
  const tradingHalted = haltData?.data?.halted ?? false;
  const markets = overview && typeof overview.markets === 'object' ? overview.markets as { total?: number; active?: number } : null;
  const spotMetrics = overview?.spotMetrics;

  const items = [
    {
      label: 'Engine status',
      value: tradingHalted ? 'Halted' : 'Live',
      status: tradingHalted ? 'danger' : 'success',
      icon: Cpu,
    },
    {
      label: 'Liquidity status',
      value: spotMetrics?.ordersLastMinute != null ? 'Active' : '—',
      status: 'neutral' as const,
      icon: TrendingUp,
    },
    {
      label: 'Markets',
      value: markets?.active != null ? `${markets.active} / ${markets.total ?? 0}` : '—',
      status: 'neutral' as const,
      icon: Activity,
    },
    {
      label: 'API latency',
      value: spotMetrics?.orderLatencyP99Ms != null ? `${spotMetrics.orderLatencyP99Ms} ms` : spotMetrics?.orderLatencyP50Ms != null ? `${spotMetrics.orderLatencyP50Ms} ms` : '—',
      status: 'neutral' as const,
      icon: Link2,
    },
  ];

  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">Exchange Health</h3>
        <Link href="/admin/trading/engine" className="text-xs font-medium text-[var(--admin-primary)] hover:underline">
          View all →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ label, value, status, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 p-3 rounded-lg bg-[var(--admin-hover-bg)] border border-[var(--admin-card-border)]"
          >
            <div className="w-9 h-9 rounded-lg bg-white border border-[var(--admin-card-border)] flex items-center justify-center text-[var(--admin-text-muted)]">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-[var(--admin-text-muted)] uppercase tracking-wide">{label}</p>
              <p
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  status === 'success' && 'text-[var(--admin-success)]',
                  status === 'danger' && 'text-[var(--admin-danger)]',
                  status === 'neutral' && 'text-[var(--admin-text)]'
                )}
              >
                {value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
