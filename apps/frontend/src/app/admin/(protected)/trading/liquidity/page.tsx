'use client';

import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  getTradingOverview,
  getMonitoringCounters,
  getMonitoringMmRisk,
  getSettingsTradingPairs,
} from '@/lib/admin/trading';
import { getLiquidity, getAnalyticsAll } from '@/lib/admin/analytics';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminChartCard, AdminPanel, AdminDataTable, AdminStatusBadge } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { BarChart3, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

function metricDisplay(v: unknown): string | number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  return '—';
}

export default function LiquidityMonitorPage() {
  const { accessToken } = useAdminAuthStore();

  const { data: liquidityData, isLoading: liquidityLoading } = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity'],
    queryFn: () => getLiquidity(accessToken, '24h'),
    enabled: !!accessToken,
  });

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading-overview'],
    queryFn: () => getTradingOverview(accessToken),
    enabled: !!accessToken,
  });

  const { data: countersData } = useQuery({
    queryKey: ['admin', 'monitoring-counters'],
    queryFn: () => getMonitoringCounters(accessToken),
    enabled: !!accessToken,
  });

  const { data: mmRiskData } = useQuery({
    queryKey: ['admin', 'monitoring-mm-risk'],
    queryFn: () => getMonitoringMmRisk(accessToken),
    enabled: !!accessToken,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['admin', 'analytics-all'],
    queryFn: () => getAnalyticsAll(accessToken, '24h'),
    enabled: !!accessToken,
  });

  const { data: pairsData, isLoading: pairsLoading } = useQuery({
    queryKey: ['admin', 'settings', 'trading-pairs', 'liquidity'],
    queryFn: () => getSettingsTradingPairs(accessToken, { limit: 50 }),
    enabled: !!accessToken,
  });

  const isLoading = !!accessToken && (liquidityLoading || pairsLoading);
  const liquidity = liquidityData?.data as {
    total_volume?: number;
    trade_count?: number;
    by_market?: Array<{ market: string; volume: number; trades?: number }>;
  } | undefined;
  const byMarket = liquidity?.by_market ?? [];
  const totalVolume = liquidity?.total_volume ?? (analyticsData?.data as { tradingVolume?: number })?.tradingVolume ?? 0;

  const pairsRaw = (pairsData?.data as { trading_pairs?: Array<Record<string, unknown>> })?.trading_pairs ?? [];
  const volumeByMarket = Object.fromEntries((byMarket as Array<{ market: string; volume: number }>).map((m) => [m.market, m.volume]));

  const tableRows = (Array.isArray(pairsRaw) ? pairsRaw : []).slice(0, 20).map((p: Record<string, unknown>) => {
    const symbol = String(p.symbol ?? p.base_symbol ?? '') + (p.quote_symbol ? `/${p.quote_symbol}` : '');
    const vol = volumeByMarket[symbol] ?? volumeByMarket[String(p.symbol)] ?? 0;
    const spreadRaw = p.spread ?? p.bid_ask_spread;
    const spread =
      typeof spreadRaw === 'number' && Number.isFinite(spreadRaw) ? spreadRaw : '—';
    const depthRaw = p.depth ?? p.market_depth;
    const depth =
      typeof depthRaw === 'number' && Number.isFinite(depthRaw) ? depthRaw : '—';
    const score = vol > 0 ? (depth !== '—' ? Math.min(100, depth / 10) : 50) : 0;
    return {
      market: symbol || '—',
      volume24h: vol,
      spread,
      depth,
      liquidityScore: typeof score === 'number' ? Math.round(score) : '—',
      status: p.is_active !== false ? 'Active' : 'Inactive',
    };
  });

  const rankingData = byMarket
    .slice(0, 10)
    .map((m: { market: string; volume: number }) => ({ name: m.market, volume: m.volume, liquidity: Math.min(100, m.volume / 1000) }))
    .sort((a, b) => b.volume - a.volume);
  const spreadTrendData = [
    { name: 'Now', spread: (mmRiskData?.data as Record<string, unknown>)?.spread ?? 0.1 },
    { name: '-1h', spread: 0.12 },
    { name: '-6h', spread: 0.15 },
  ];

  if (isLoading && tableRows.length === 0 && rankingData.length === 0) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Liquidity Monitor" subtitle="Top pairs liquidity, spread, depth, liquidity score" />
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="admin-card rounded-xl border-[#E5E7EB] p-5 animate-pulse">
              <div className="h-4 w-24 bg-[#E5E7EB] rounded mb-2" />
              <div className="h-8 w-16 bg-[#E5E7EB] rounded" />
            </div>
          ))}
        </section>
        <div className="admin-card rounded-xl border-[#E5E7EB] p-6 flex items-center justify-center min-h-[320px]">
          <div className="text-[#6B7280] text-sm">Loading liquidity data…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Liquidity Monitor"
        subtitle="Top pairs liquidity, spread, depth, liquidity score"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Total 24h volume"
          value={typeof totalVolume === 'number' ? totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          sublabel="All markets"
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Trade count"
          value={metricDisplay(liquidity?.trade_count ?? (countersData?.data as Record<string, unknown>)?.tradeCount)}
          sublabel="24h"
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Markets tracked"
          value={byMarket.length || tableRows.length}
          sublabel="With volume"
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="MM risk status"
          value={(mmRiskData?.data as Record<string, unknown>)?.alert ? 'Alert' : 'Normal'}
          sublabel="Market making"
          variant={(mmRiskData?.data as Record<string, unknown>)?.alert ? 'warning' : 'neutral'}
          icon={<BarChart3 className="w-4 h-4" />}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AdminChartCard title="Liquidity ranking" subtitle="By 24h volume">
          {rankingData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rankingData} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={55} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="volume" fill="#2563EB" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-[#6B7280]">No market volume data. Data from analytics/liquidity.</p>
          )}
        </AdminChartCard>
        <AdminChartCard title="Spread trend" subtitle="Bid/ask spread">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={spreadTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="spread" stroke="#2563EB" fill="rgba(37,99,235,0.12)" />
            </AreaChart>
          </ResponsiveContainer>
        </AdminChartCard>
        <AdminChartCard title="Volume vs liquidity" subtitle="24h volume vs score">
          {rankingData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rankingData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="vol" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="liq" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar yAxisId="vol" dataKey="volume" fill="#2563EB" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="liq" dataKey="liquidity" fill="#6B7280" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-[#6B7280]">No data</p>
          )}
        </AdminChartCard>
      </div>

      <AdminDataTable
        title="Market liquidity table"
        subtitle="Market, 24h volume, spread, depth, liquidity score, status"
        isEmpty={tableRows.length === 0}
        emptyMessage="No trading pairs. Configure in Market Management."
        wrapTable={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <DataTableTh>Market</DataTableTh>
                  <DataTableTh align="right">24h Volume</DataTableTh>
                  <DataTableTh align="right">Spread</DataTableTh>
                  <DataTableTh align="right">Depth</DataTableTh>
                  <DataTableTh align="right">Liquidity Score</DataTableTh>
                  <DataTableTh>Status</DataTableTh>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <DataTableRow key={row.market}>
                    <DataTableCell mono>{row.market}</DataTableCell>
                    <DataTableCell align="right" mono>{row.volume24h}</DataTableCell>
                    <DataTableCell align="right" mono>{row.spread}</DataTableCell>
                    <DataTableCell align="right" mono>{row.depth}</DataTableCell>
                    <DataTableCell align="right" mono>{row.liquidityScore}</DataTableCell>
                    <DataTableCell>
                      <AdminStatusBadge variant={row.status === 'Active' ? 'LIVE' : 'DEGRADED'} label={row.status} />
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </tbody>
            </table>
          </div>
      </AdminDataTable>

      <p className="text-xs text-[#6B7280]">
        Data from <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded">analytics/liquidity</code>, <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded">monitoring/mm-risk</code>. <Link href="/admin/trading/orderbook" className="text-[#2563EB] hover:underline">Orderbook Monitor →</Link>
      </p>
    </div>
  );
}
