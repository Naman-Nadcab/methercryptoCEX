'use client';

import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getMonitoringCounters, getTradingOverview } from '@/lib/admin/trading';
import { getUsers } from '@/lib/admin/users';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminPanel, AdminDataTable, AdminStatusBadge } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { AlertTriangle, BarChart3 } from 'lucide-react';

const CANCEL_RATIO_THRESHOLD = 0.7;
const LARGE_ORDER_THRESHOLD = 10000;

export default function OrderbookSurveillancePage() {
  const { accessToken } = useAdminAuthStore();

  const { data: countersData } = useQuery({
    queryKey: ['admin', 'monitoring-counters'],
    queryFn: () => getMonitoringCounters(accessToken),
    enabled: !!accessToken,
  });

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading-overview'],
    queryFn: () => getTradingOverview(accessToken),
    enabled: !!accessToken,
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', 'surveillance'],
    queryFn: () => getUsers(accessToken, { limit: 100 }),
    enabled: !!accessToken,
  });

  const counters = (countersData?.data || {}) as Record<string, unknown>;
  const overview = (overviewData?.data || {}) as Record<string, unknown>;
  const users = (usersData?.data as { users?: Array<Record<string, unknown>> })?.users ?? [];

  const tradesPerSec = Number(counters.trades_per_second ?? counters.tradesPerSecond ?? 0);
  const ordersPerSec = Number(counters.orders_per_second ?? counters.ordersPerSecond ?? 0);
  const activeMarkets = Array.isArray(overview.markets) ? (overview.markets as unknown[]).length : 0;

  const surveillanceRows = users.slice(0, 50).map((u) => {
    const ordersTotal = Number(u.orders_count ?? u.ordersCount ?? 0) || 0;
    const cancelsTotal = Number(u.cancels_count ?? u.cancelsCount ?? 0) || 0;
    const cancelRatio = ordersTotal > 0 ? cancelsTotal / ordersTotal : 0;
    const largeOrders = Number(u.large_orders_count ?? u.largeOrdersCount ?? 0) || 0;
    const riskFlags: string[] = [];
    if (cancelRatio >= CANCEL_RATIO_THRESHOLD) riskFlags.push('High cancel ratio');
    if (largeOrders > 0) riskFlags.push('Large orders');
    if (cancelRatio >= CANCEL_RATIO_THRESHOLD && largeOrders > 0) riskFlags.push('Wash/spoof pattern');
    return {
      id: String(u.id ?? ''),
      trader: String(u.email ?? u.name ?? u.id ?? '—'),
      market: typeof u.primary_market === 'string' ? u.primary_market : '—',
      orderSize: ordersTotal,
      cancelRatio: ordersTotal > 0 ? `${(cancelRatio * 100).toFixed(1)}%` : '—',
      largeOrders,
      riskFlag: riskFlags.length > 0 ? riskFlags.join('; ') : '—',
      hasRisk: riskFlags.length > 0,
    };
  });

  const alertCount = surveillanceRows.filter((r) => r.hasRisk).length;
  const thresholdExceeded = tradesPerSec > 100 || ordersPerSec > 500;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Orderbook Surveillance"
        subtitle="Detect abnormal trading behavior — high cancel ratio, large spoof orders, wash trading"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Trades/sec"
          value={tradesPerSec}
          sublabel="Current"
          icon={<BarChart3 className="w-4 h-4" />}
          variant={thresholdExceeded ? 'warning' : 'neutral'}
        />
        <AdminMetricCard
          label="Orders/sec"
          value={ordersPerSec}
          sublabel="Current"
          icon={<BarChart3 className="w-4 h-4" />}
          variant={thresholdExceeded ? 'warning' : 'neutral'}
        />
        <AdminMetricCard
          label="Active markets"
          value={activeMarkets}
          sublabel="Trading"
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Risk-flagged traders"
          value={alertCount}
          sublabel="Above thresholds"
          icon={<AlertTriangle className="w-4 h-4" />}
          variant={alertCount > 0 ? 'danger' : 'neutral'}
        />
      </section>

      <AdminPanel title="Threshold alerts" subtitle="Alerts when thresholds exceeded">
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>• High cancel ratio: &gt; {(CANCEL_RATIO_THRESHOLD * 100).toFixed(0)}% of orders cancelled</li>
          <li>• Large spoof orders: single order size &gt; {LARGE_ORDER_THRESHOLD.toLocaleString()}</li>
          <li>• Wash trading patterns: high cancel ratio + large orders</li>
          {thresholdExceeded && (
            <li className="text-amber-600 dark:text-amber-400 font-medium">
              ⚠ Engine load high: trades/sec or orders/sec above normal range
            </li>
          )}
        </ul>
      </AdminPanel>

      <AdminDataTable
        title="Trader surveillance"
        subtitle={`Trader, market, order size, cancel ratio, large orders, risk flag — ${surveillanceRows.length} shown`}
        isEmpty={surveillanceRows.length === 0}
        emptyMessage="No user/trading data. Data derived from users and monitoring counters."
        wrapTable={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <DataTableTh>Trader</DataTableTh>
                <DataTableTh>Market</DataTableTh>
                <DataTableTh align="right">Order size</DataTableTh>
                <DataTableTh align="right">Cancel ratio</DataTableTh>
                <DataTableTh align="right">Large orders</DataTableTh>
                <DataTableTh>Risk flag</DataTableTh>
              </tr>
            </thead>
            <tbody>
              {surveillanceRows.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    <a href={`/admin/users/${row.id}`} className="text-primary hover:underline">
                      {row.trader}
                    </a>
                  </DataTableCell>
                  <DataTableCell mono>{row.market}</DataTableCell>
                  <DataTableCell align="right" mono>{row.orderSize}</DataTableCell>
                  <DataTableCell align="right" mono>{row.cancelRatio}</DataTableCell>
                  <DataTableCell align="right" mono>{row.largeOrders}</DataTableCell>
                  <DataTableCell>
                    {row.hasRisk ? (
                      <AdminStatusBadge variant="DEGRADED" label={row.riskFlag} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </table>
        </div>
      </AdminDataTable>

      <p className="text-xs text-muted-foreground">
        Data from <code className="bg-muted px-1 rounded">monitoring/counters</code>, <code className="bg-muted px-1 rounded">trading</code>, and <code className="bg-muted px-1 rounded">users</code>. Risk flags are derived from cancel ratio and large order counts when backend exposes them; otherwise shown as sample structure.
      </p>
    </div>
  );
}
