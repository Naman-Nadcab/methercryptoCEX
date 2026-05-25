'use client';

import Link from 'next/link';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getTradingOverview,
  getTradingMarkets,
  getTradingHalt,
  getTradingCircuit,
  setTradingHalt,
  setTradingCircuit,
  getTradingOrderbook,
  getMonitoringTrading,
  postMarketHalt,
} from '@/lib/trading-api';
import { getLiquidityBotConfig } from '@/lib/admin/trading';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TradingControlModal, type ControlAction } from '@/components/trading/TradingControlModal';
import { OrderbookSnapshotPanel } from '@/components/trading/OrderbookSnapshotPanel';
import { useAdminWs } from '@/hooks/useAdminWs';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import {
  TrendingUp,
  BarChart3,
  Activity,
  Play,
  Pause,
  AlertTriangle,
  ShieldCheck,
  Store,
  Clock,
  Zap,
  ShoppingCart,
  LineChart,
} from 'lucide-react';

const DEFAULT_MARKETS = ['BTC_USDT', 'ETH_USDT', 'BTCUSDT', 'ETHUSDT'];

export default function TradingPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [controlModal, setControlModal] = useState<ControlAction | null>(null);
  const [orderbookMarket, setOrderbookMarket] = useState('BTC_USDT');
  const [marketHaltMarket, setMarketHaltMarket] = useState('BTC_USDT');
  const [marketAction, setMarketAction] = useState<{ market: string; halted: boolean } | null>(null);

  const { data: overviewData, isError: overviewIsError, error: overviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['admin', 'trading', 'overview', token],
    staleTime: 30_000,
    queryFn: () => getTradingOverview(token),
    enabled: !!token,
  });

  const { data: haltData, isError: haltIsError, error: haltError, refetch: refetchHalt } = useQuery({
    queryKey: ['admin', 'trading', 'halt', token],
    staleTime: 30_000,
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
  });

  const { data: circuitData, isError: circuitIsError, error: circuitError, refetch: refetchCircuit } = useQuery({
    queryKey: ['admin', 'trading', 'circuit', token],
    staleTime: 30_000,
    queryFn: () => getTradingCircuit(token),
    enabled: !!token,
  });

  const { data: marketsData, isError: marketsIsError, error: marketsError, refetch: refetchMarkets } = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    staleTime: 30_000,
    queryFn: () => getTradingMarkets(token),
    enabled: !!token,
  });

  const { data: orderbookData, isLoading: orderbookLoading } = useQuery({
    queryKey: ['admin', 'trading', 'orderbook', token, orderbookMarket],
    staleTime: 30_000,
    queryFn: () => getTradingOrderbook(token, orderbookMarket, 10),
    enabled: !!token && !!orderbookMarket,
    refetchInterval: 10_000,
  });

  const { data: monitoringData, isError: monitoringIsError, error: monitoringError, refetch: refetchMonitoring } = useQuery({
    queryKey: ['admin', 'monitoring', 'trading', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringTrading(token),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const { data: liquidityBotRes, isLoading: liquidityBotLoading, isError: liquidityBotIsError } = useQuery({
    queryKey: ['admin', 'liquidity-bot', 'config', token],
    staleTime: 30_000,
    queryFn: () => getLiquidityBotConfig(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (
        ['trade_executed', 'order_created', 'order_cancelled', 'market_halted'].includes(type)
      ) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
      }
    },
  });

  const haltMutation = useMutation({
    mutationFn: (args: { halted: boolean; reason?: string; admin_note?: string }) =>
      setTradingHalt(token, args.halted, { reason: args.reason, admin_note: args.admin_note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
      setControlModal(null);
    },
  });

  const circuitMutation = useMutation({
    mutationFn: (open: boolean) => setTradingCircuit(token, open),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
      setControlModal(null);
    },
  });

  const marketHaltMutation = useMutation({
    mutationFn: ({ market, halted, reason }: { market: string; halted: boolean; reason?: string }) =>
      postMarketHalt(token, market, halted, halted ? { reason } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
    },
  });

  const handleControlConfirm = useCallback(
    (payload?: { reason: string; admin_note?: string }) => {
      if (!controlModal) return;
      if (controlModal === 'pause_trading')
        haltMutation.mutate({ halted: true, reason: payload?.reason, admin_note: payload?.admin_note });
      else if (controlModal === 'resume_trading') haltMutation.mutate({ halted: false });
      else if (controlModal === 'open_circuit') circuitMutation.mutate(true);
      else if (controlModal === 'close_circuit') circuitMutation.mutate(false);
    },
    [controlModal, haltMutation, circuitMutation]
  );

  const overview = overviewData?.data;
  const orderStats = overview?.orderStats;
  const tradeStats = overview?.tradeStats;
  const marketsRunning = overview?.marketsRunning ?? marketsData?.data?.marketsRunning ?? 0;
  const marketsHalted = overview?.marketsHalted ?? marketsData?.data?.marketsHalted ?? 0;
  const halted = haltData?.data?.halted ?? false;
  const circuitOpen = circuitData?.data?.circuitOpen ?? false;

  const volume24h = tradeStats?.volume_24h ?? '0';
  const trades24h = tradeStats?.trades_24h ?? '0';
  const activeMarkets = marketsRunning + marketsHalted;
  const liquidityHealth = halted ? 'Halted' : circuitOpen ? 'Circuit Open' : 'Good';

  const liquidityBotCfg = liquidityBotRes?.success ? liquidityBotRes.data : undefined;
  const liquidityBotStatus = liquidityBotLoading
    ? '…'
    : liquidityBotIsError || liquidityBotRes?.success === false
      ? 'Unavailable'
      : liquidityBotCfg?.enabled
        ? liquidityBotCfg.apiKeyConfigured
          ? 'Active'
          : 'On (no API key)'
        : 'Off';

  const formatVolume = (v: string) => {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return '$0';
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  };

  const pageError =
    (overviewIsError && (overviewError instanceof Error ? overviewError.message : 'Failed to load trading overview.')) ||
    (haltIsError && (haltError instanceof Error ? haltError.message : 'Failed to load trading halt status.')) ||
    (circuitIsError && (circuitError instanceof Error ? circuitError.message : 'Failed to load circuit status.')) ||
    (marketsIsError && (marketsError instanceof Error ? marketsError.message : 'Failed to load markets data.')) ||
    (monitoringIsError && (monitoringError instanceof Error ? monitoringError.message : 'Failed to load monitoring data.')) ||
    null;

  const retryAll = () => {
    void refetchOverview();
    void refetchHalt();
    void refetchCircuit();
    void refetchMarkets();
    void refetchMonitoring();
  };

  return (
    <AdminPageFrame
      title="Trading"
      description="Monitor orders, trades, and control market status."
      status="active"
      error={pageError}
      onRetry={pageError ? retryAll : undefined}
    >

      {/* Dashboard cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="24h Trading Volume"
          value={formatVolume(volume24h)}
          icon={TrendingUp}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
        <StatCard
          title="Total Trades (24h)"
          value={trades24h}
          icon={BarChart3}
          iconBg="bg-admin-success/10 text-admin-success"
        />
        <StatCard
          title="Active Markets"
          value={activeMarkets}
          icon={Store}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
        <StatCard
          title="Liquidity Health"
          value={liquidityHealth}
          icon={Activity}
          iconBg={
            halted || circuitOpen
              ? 'bg-admin-danger/10 text-admin-danger'
              : 'bg-admin-success/10 text-admin-success'
          }
        />
      </div>

      {/* Operational metrics: latency */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Order Latency p99"
          value={
            monitoringData?.data?.order_latency_p99_ms != null
              ? `${monitoringData.data.order_latency_p99_ms} ms`
              : '—'
          }
          icon={Clock}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
        <StatCard
          title="Matching Engine Delay"
          value={
            monitoringData?.data?.matching_engine_delay_ms != null
              ? `${monitoringData.data.matching_engine_delay_ms} ms`
              : '—'
          }
          icon={Zap}
          iconBg="bg-admin-warning/10 text-admin-warning"
        />
      </div>

      {/* Market status panel */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-admin-text">Market Status</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Markets Running</p>
              <p className="mt-1 text-xl font-bold text-admin-success tabular-nums">{marketsRunning}</p>
            </div>
            <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Markets Halted</p>
              <p className="mt-1 text-xl font-bold text-admin-danger tabular-nums">{marketsHalted}</p>
            </div>
            <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Liquidity Bot</p>
              <p className="mt-1 text-xl font-bold text-admin-text tabular-nums">{liquidityBotStatus}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orderbook snapshot + liquidity (spread, depth in panel) */}
      <OrderbookSnapshotPanel
        data={orderbookData?.data ?? null}
        market={orderbookMarket}
        onMarketChange={setOrderbookMarket}
        marketOptions={
          marketsData?.data?.markets?.length
            ? (marketsData.data.markets as Array<{ symbol: string }>).map((m) => m.symbol)
            : DEFAULT_MARKETS
        }
        isLoading={orderbookLoading}
      />

      {/* Trading control panel */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-admin-text">Trading Control</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <ProtectedAction permission="control:trading" fallback="disabled">
              <Button
                variant="secondary"
                onClick={() => setControlModal(halted ? 'resume_trading' : 'pause_trading')}
              >
                {halted ? (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Resume Trading
                  </>
                ) : (
                  <>
                    <Pause className="mr-2 h-4 w-4" />
                    Pause Trading
                  </>
                )}
              </Button>
            </ProtectedAction>
            <ProtectedAction permission="control:trading" fallback="disabled">
              <Button
                variant="secondary"
                onClick={() => setControlModal(circuitOpen ? 'close_circuit' : 'open_circuit')}
              >
                {circuitOpen ? (
                  <>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Close Circuit Breaker
                  </>
                ) : (
                  <>
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Open Circuit Breaker
                  </>
                )}
              </Button>
            </ProtectedAction>
          </div>
        </CardContent>
      </Card>

      {/* Market specific halt */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-admin-text">Market Specific Halt</h2>
          <p className="mt-1 text-sm text-admin-muted">Pause or resume a single market.</p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="market-halt-select" className="block text-xs font-medium text-admin-muted">
                Market
              </label>
              <select
                id="market-halt-select"
                value={marketHaltMarket}
                onChange={(e) => setMarketHaltMarket(e.target.value)}
                className="mt-1 rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
              >
                {(marketsData?.data?.markets?.length
                  ? (marketsData.data.markets as Array<{ symbol: string }>).map((m) => m.symbol)
                  : DEFAULT_MARKETS
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <ProtectedAction permission="markets:manage" fallback="disabled">
              <Button
                variant="secondary"
                onClick={() => setMarketAction({ market: marketHaltMarket, halted: true })}
                disabled={marketHaltMutation.isPending}
              >
                <Pause className="mr-2 h-4 w-4" />
                Pause {marketHaltMarket}
              </Button>
            </ProtectedAction>
            <ProtectedAction permission="markets:manage" fallback="disabled">
              <Button
                variant="secondary"
                onClick={() => setMarketAction({ market: marketHaltMarket, halted: false })}
                disabled={marketHaltMutation.isPending}
              >
                <Play className="mr-2 h-4 w-4" />
                Resume {marketHaltMarket}
              </Button>
            </ProtectedAction>
          </div>
        </CardContent>
      </Card>

      {/* Orders & Trades — use dedicated pages */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/orders">
          <Card className="hover:shadow-md transition-all duration-200 cursor-pointer group">
            <CardContent className="py-4 px-4 flex items-center gap-3">
              <ShoppingCart className="h-5 w-5 text-admin-primary" />
              <div>
                <p className="text-sm font-semibold text-admin-text group-hover:text-admin-primary">Orders</p>
                <p className="text-xs text-admin-muted">View and filter all orders</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/trades">
          <Card className="hover:shadow-md transition-all duration-200 cursor-pointer group">
            <CardContent className="py-4 px-4 flex items-center gap-3">
              <LineChart className="h-5 w-5 text-admin-primary" />
              <div>
                <p className="text-sm font-semibold text-admin-text group-hover:text-admin-primary">Trade History</p>
                <p className="text-xs text-admin-muted">Browse all executed trades</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <TradingControlModal
        open={!!controlModal}
        action={controlModal ?? 'pause_trading'}
        onClose={() => setControlModal(null)}
        onConfirm={handleControlConfirm}
        isLoading={haltMutation.isPending || circuitMutation.isPending}
      />
      <ActionAuthModal
        open={marketAction !== null}
        onClose={() => setMarketAction(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!marketAction) return;
          marketHaltMutation.mutate({
            market: marketAction.market,
            halted: marketAction.halted,
            reason: payload.reason,
          });
          setMarketAction(null);
        }}
        title={marketAction?.halted ? 'Pause market trading' : 'Resume market trading'}
        actionLabel={marketAction ? `${marketAction.halted ? 'Pause' : 'Resume'} ${marketAction.market}` : 'Market action'}
        description="Per-market halt/resume is a production-sensitive trading control."
        requireReason
        twofaRequired
        confirmationPhrase={marketAction?.halted ? `HALT ${marketAction.market}` : undefined}
        externalError={marketHaltMutation.error instanceof Error ? marketHaltMutation.error.message : null}
        isPending={marketHaltMutation.isPending}
        confirmLabel={marketHaltMutation.isPending ? 'Applying…' : 'Confirm'}
        confirmVariant={marketAction?.halted ? 'danger' : 'primary'}
      />
    </AdminPageFrame>
  );
}
