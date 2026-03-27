'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getTradingOverview,
  getTradingOrders,
  getTradingTrades,
  getTradingMarkets,
  getTradingHalt,
  getTradingCircuit,
  setTradingHalt,
  setTradingCircuit,
  getTradingOrderbook,
  getMonitoringTrading,
  postMarketHalt,
} from '@/lib/trading-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { OrdersTable } from '@/components/trading/OrdersTable';
import { TradesTable } from '@/components/trading/TradesTable';
import { TradingControlModal, type ControlAction } from '@/components/trading/TradingControlModal';
import { OrderbookSnapshotPanel } from '@/components/trading/OrderbookSnapshotPanel';
import { useAdminWs } from '@/hooks/useAdminWs';
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
} from 'lucide-react';

const DEFAULT_MARKETS = ['BTC_USDT', 'ETH_USDT', 'BTCUSDT', 'ETHUSDT'];

export default function TradingPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [ordersPage, setOrdersPage] = useState(1);
  const [tradesPage, setTradesPage] = useState(1);
  const [ordersStatus, setOrdersStatus] = useState<string>('all');
  const [controlModal, setControlModal] = useState<ControlAction | null>(null);
  const [activeTable, setActiveTable] = useState<'orders' | 'trades'>('orders');
  const [orderbookMarket, setOrderbookMarket] = useState('BTC_USDT');
  const [marketHaltMarket, setMarketHaltMarket] = useState('BTC_USDT');

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading', 'overview', token],
    queryFn: () => getTradingOverview(token),
    enabled: !!token,
  });

  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading', 'halt', token],
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
  });

  const { data: circuitData } = useQuery({
    queryKey: ['admin', 'trading', 'circuit', token],
    queryFn: () => getTradingCircuit(token),
    enabled: !!token,
  });

  const { data: marketsData } = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    queryFn: () => getTradingMarkets(token),
    enabled: !!token,
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['admin', 'trading', 'orders', token, ordersPage, ordersStatus],
    queryFn: () =>
      getTradingOrders(token, {
        page: ordersPage,
        limit: 20,
        status: ordersStatus === 'all' ? undefined : ordersStatus,
      }),
    enabled: !!token,
  });

  const { data: tradesData, isLoading: tradesLoading } = useQuery({
    queryKey: ['admin', 'trading', 'trades', token, tradesPage],
    queryFn: () => getTradingTrades(token, { page: tradesPage, limit: 20 }),
    enabled: !!token,
  });

  const { data: orderbookData, isLoading: orderbookLoading } = useQuery({
    queryKey: ['admin', 'trading', 'orderbook', token, orderbookMarket],
    queryFn: () => getTradingOrderbook(token, orderbookMarket, 10),
    enabled: !!token && !!orderbookMarket,
  });

  const { data: monitoringData } = useQuery({
    queryKey: ['admin', 'monitoring', 'trading', token],
    queryFn: () => getMonitoringTrading(token),
    enabled: !!token,
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
    mutationFn: ({ market, halted }: { market: string; halted: boolean }) =>
      postMarketHalt(token, market, halted),
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

  const formatVolume = (v: string) => {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return '$0';
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return new Intl.NumberFormat('en-US', { style: 'currency', maximumFractionDigits: 0 }).format(n);
  };

  const orders = (ordersData?.data?.orders ?? []) as import('@/lib/trading-api').OrderRow[];
  const trades = (tradesData?.data?.trades ?? []) as import('@/lib/trading-api').TradeRow[];
  const ordersPagination = ordersData?.data?.pagination;
  const tradesPagination = tradesData?.data?.pagination;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Trading Operations</h1>
        <p className="mt-1 text-sm text-admin-muted">
          Monitor orders, trades, and control market status.
        </p>
      </div>

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
          <h2 className="text-lg font-semibold text-gray-900">Market Status</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-admin-border bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-admin-muted">Markets Running</p>
              <p className="mt-1 text-2xl font-semibold text-admin-success">{marketsRunning}</p>
            </div>
            <div className="rounded-lg border border-admin-border bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-admin-muted">Markets Halted</p>
              <p className="mt-1 text-2xl font-semibold text-admin-danger">{marketsHalted}</p>
            </div>
            <div className="rounded-lg border border-admin-border bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-admin-muted">Liquidity Bot Status</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">—</p>
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
          <h2 className="text-lg font-semibold text-gray-900">Trading Control</h2>
          <div className="mt-4 flex flex-wrap gap-2">
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
          </div>
        </CardContent>
      </Card>

      {/* Market specific halt */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-gray-900">Market Specific Halt</h2>
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
                className="mt-1 rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900"
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
            <Button
              variant="secondary"
              onClick={() =>
                marketHaltMutation.mutate({ market: marketHaltMarket, halted: true })
              }
              disabled={marketHaltMutation.isPending}
            >
              <Pause className="mr-2 h-4 w-4" />
              Pause {marketHaltMarket}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                marketHaltMutation.mutate({ market: marketHaltMarket, halted: false })
              }
              disabled={marketHaltMutation.isPending}
            >
              <Play className="mr-2 h-4 w-4" />
              Resume {marketHaltMarket}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders & Trades tables with tabs */}
      <Card>
        <CardContent className="p-6">
          <nav className="flex gap-1 border-b border-admin-border">
            <button
              type="button"
              onClick={() => setActiveTable('orders')}
              className={`border-b-2 px-4 py-2 text-sm font-medium ${
                activeTable === 'orders'
                  ? 'border-admin-primary text-admin-primary'
                  : 'border-transparent text-admin-muted hover:text-gray-900'
              }`}
            >
              Orders
            </button>
            <button
              type="button"
              onClick={() => setActiveTable('trades')}
              className={`border-b-2 px-4 py-2 text-sm font-medium ${
                activeTable === 'trades'
                  ? 'border-admin-primary text-admin-primary'
                  : 'border-transparent text-admin-muted hover:text-gray-900'
              }`}
            >
              Trades
            </button>
          </nav>

          {activeTable === 'orders' && (
            <div className="mt-4">
              <div className="mb-4 flex items-center justify-between">
                <select
                  value={ordersStatus}
                  onChange={(e) => setOrdersStatus(e.target.value)}
                  className="rounded-lg border border-admin-border bg-white px-3 py-2 text-sm text-gray-900"
                >
                  <option value="all">All statuses</option>
                  <option value="OPEN">OPEN</option>
                  <option value="PARTIALLY_FILLED">PARTIALLY_FILLED</option>
                  <option value="FILLED">FILLED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
              {ordersLoading ? (
                <div className="py-12 text-center text-admin-muted">Loading orders…</div>
              ) : (
                <>
                  <OrdersTable rows={orders} />
                  {ordersPagination && ordersPagination.totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between border-t border-admin-border pt-4">
                      <p className="text-sm text-admin-muted">
                        Page {ordersPagination.page} of {ordersPagination.totalPages} ·{' '}
                        {ordersPagination.total} total
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                          disabled={ordersPage <= 1}
                          className="rounded-lg border border-admin-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setOrdersPage((p) =>
                              Math.min(ordersPagination.totalPages, p + 1)
                            )
                          }
                          disabled={ordersPage >= ordersPagination.totalPages}
                          className="rounded-lg border border-admin-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTable === 'trades' && (
            <div className="mt-4">
              {tradesLoading ? (
                <div className="py-12 text-center text-admin-muted">Loading trades…</div>
              ) : (
                <>
                  <TradesTable rows={trades} />
                  {tradesPagination && tradesPagination.totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between border-t border-admin-border pt-4">
                      <p className="text-sm text-admin-muted">
                        Page {tradesPagination.page} of {tradesPagination.totalPages} ·{' '}
                        {tradesPagination.total} total
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setTradesPage((p) => Math.max(1, p - 1))}
                          disabled={tradesPage <= 1}
                          className="rounded-lg border border-admin-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setTradesPage((p) =>
                              Math.min(tradesPagination.totalPages, p + 1)
                            )
                          }
                          disabled={tradesPage >= tradesPagination.totalPages}
                          className="rounded-lg border border-admin-border bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <TradingControlModal
        open={!!controlModal}
        action={controlModal ?? 'pause_trading'}
        onClose={() => setControlModal(null)}
        onConfirm={handleControlConfirm}
        isLoading={haltMutation.isPending || circuitMutation.isPending}
      />
    </div>
  );
}
