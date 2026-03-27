'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Key,
  AlertTriangle,
  TrendingUp,
  Clock,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  MMPerformanceCard,
  LiquidityDepthChart,
  SpreadMonitorChart,
} from '@/components/admin/v2/dashboard';
import { TradingVolumeChart } from '@/components/admin/charts';
import {
  useMmRisk,
  useLiquidityBotConfig,
  useLiquidity,
  useTradingVolume,
  useAnalyticsAll,
} from '@/hooks/admin/useAdminDashboard';
import { Loader2 } from 'lucide-react';

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

export default function MarketMakingPage() {
  const queryClient = useQueryClient();
  const { data: mmRiskData, isLoading: mmRiskLoading } = useMmRisk();
  const { data: lbConfigData, isLoading: lbLoading } = useLiquidityBotConfig();
  const { data: liquidityData } = useLiquidity('24h');
  const { data: volumeData } = useTradingVolume('7d');
  const { data: analyticsData } = useAnalyticsAll('24h');

  const mmRisk = mmRiskData?.data as {
    apiKeysCount?: number;
    topTraders?: { userId: string; volume24h: string }[];
    emergencyStoppedUsers?: string[];
  } | undefined;
  const lbConfig = lbConfigData?.data as {
    enabled?: boolean;
    spreadBps?: number;
    orderSize?: string;
    symbols?: string[];
  } | undefined;
  const byMarket = (liquidityData?.data?.by_market ?? []) as Array<{ market: string; volume: number }>;
  const analytics = analyticsData?.data as { tradingVolume?: number } | undefined;
  const totalVolume = Number(analytics?.tradingVolume ?? 0);
  const volumeBuckets = (volumeData?.data?.buckets ?? []) as Array<{ date?: string; volume?: number }>;

  const topTradersVolume = (mmRisk?.topTraders ?? []).reduce(
    (sum, t) => sum + parseFloat(t.volume24h || '0'),
    0
  );
  const volumeContributionPct =
    totalVolume > 0 ? ((topTradersVolume / totalVolume) * 100).toFixed(1) : '0';

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring-mm-risk'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'liquidity-bot-config'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'liquidity'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'trading-volume'] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'analytics-all'] });
  };

  const loading = mmRiskLoading && lbLoading;

  if (loading && !mmRisk && !lbConfig) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-[var(--admin-primary)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--admin-text)]">Market Making</h1>
          <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">
            MM performance KPIs, liquidity depth, spread monitoring, and volume contribution
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="rounded-[var(--admin-radius)]"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button asChild size="sm" className="rounded-[var(--admin-radius)]">
            <Link href="/admin/monitoring/mm-risk">
              MM Risk Monitor
              <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Row 1 – MM Performance KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <MMPerformanceCard
          title="Liquidity Bot"
          value={lbConfig?.enabled ? 'Active' : 'Inactive'}
          subtitle={lbConfig?.enabled ? `Spread ${lbConfig?.spreadBps ?? '—'} bps` : 'Not running'}
          icon={<Bot className="w-5 h-5" />}
          accent={lbConfig?.enabled ? 'success' : 'neutral'}
        />
        <MMPerformanceCard
          title="Active API Keys"
          value={mmRisk?.apiKeysCount ?? 0}
          subtitle="Users with API keys (potential bots)"
          icon={<Key className="w-5 h-5" />}
          accent="primary"
        />
        <MMPerformanceCard
          title="Liquidity Depth"
          value={
            liquidityData?.data?.total_volume != null
              ? formatVolume(Number(liquidityData.data.total_volume))
              : '—'
          }
          subtitle="24h volume"
          icon={<TrendingUp className="w-5 h-5" />}
          accent="primary"
        />
        <MMPerformanceCard
          title="Volume Contribution"
          value={`${volumeContributionPct}%`}
          subtitle="Top traders vs total 24h volume"
          icon={<TrendingUp className="w-5 h-5" />}
          accent="neutral"
        />
        <MMPerformanceCard
          title="Market Maker Uptime"
          value={lbConfig?.enabled ? 'Live' : '—'}
          subtitle={lbConfig?.enabled ? 'Liquidity bot active' : 'No bot'}
          icon={<Clock className="w-5 h-5" />}
          accent={lbConfig?.enabled ? 'success' : 'neutral'}
        />
      </section>

      {/* Emergency stopped – compact alert */}
      {(mmRisk?.emergencyStoppedUsers?.length ?? 0) > 0 && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--admin-danger)] shrink-0" />
          <p className="text-sm text-[var(--admin-text)]">
            <strong>{mmRisk?.emergencyStoppedUsers?.length ?? 0}</strong> user(s) emergency stopped.
            <Link href="/admin/monitoring/mm-risk" className="ml-2 text-[var(--admin-primary)] hover:underline">
              MM Risk Monitor →
            </Link>
          </p>
        </div>
      )}

      {/* Row 2 – Liquidity Depth & Spread Monitoring */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
          <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Liquidity Depth</h3>
          <p className="text-xs text-[var(--admin-text-muted)] mb-2">Volume by market (24h)</p>
          <LiquidityDepthChart data={byMarket} height={260} />
        </div>
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
          <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Spread Monitoring</h3>
          <p className="text-xs text-[var(--admin-text-muted)] mb-2">
            Current spread: <strong>{lbConfig?.spreadBps ?? '—'} bps</strong>
            {lbConfig?.orderSize != null && ` · Order size: ${lbConfig.orderSize}`}
          </p>
          <SpreadMonitorChart spreadBps={lbConfig?.spreadBps ?? 0} height={260} />
        </div>
      </section>

      {/* Row 3 – Volume contribution (existing chart component) */}
      <section className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
        <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Trading Volume (7d)</h3>
        <p className="text-xs text-[var(--admin-text-muted)] mb-2">Daily volume — MM and all participants</p>
        <div className="h-[240px]">
          {volumeBuckets.length > 0 ? (
            <TradingVolumeChart
              data={volumeBuckets.map((b) => ({
                time: (b.date ?? '').slice(5, 10) || '—',
                volume: Number(b.volume ?? 0),
              }))}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--admin-text-muted)]">
              No volume data
            </div>
          )}
        </div>
      </section>

      {/* Config note */}
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
        <p className="text-sm text-[var(--admin-text-muted)]">
          Liquidity bot configuration (spread, order size, symbols) is read from environment variables.
          Update <code className="bg-[var(--admin-input-bg)] px-1.5 py-0.5 rounded text-xs">LIQUIDITY_BOT_*</code> and
          restart the backend to apply changes. For emergency stop per user, use{' '}
          <Link href="/admin/monitoring/mm-risk" className="text-[var(--admin-primary)] hover:underline">
            MM Risk Monitor
          </Link>.
        </p>
      </div>
    </div>
  );
}
