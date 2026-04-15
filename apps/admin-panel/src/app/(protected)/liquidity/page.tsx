'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  Droplets,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminFetch } from '@/lib/api';
import { getLiquidityAnalytics, getLiquidityHistory } from '@/lib/analytics-api';
import { getControlStatus } from '@/lib/control-api';
import { getTradingOrderbook, getTradingMarkets } from '@/lib/trading-api';
import { useAdminAuthStore } from '@/store/auth';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

const REFETCH_MS = 30_000;

type LiquidityBotConfig = {
  enabled: boolean;
  spreadBps: number;
  orderSize: number | string;
  symbols: string[];
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function spreadHealthColor(pct: number | null): { bg: string; text: string; label: string } {
  if (pct == null || pct < 0) return { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Inverted' };
  if (pct <= 0.3) return { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Tight' };
  if (pct <= 1.0) return { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Normal' };
  if (pct <= 5.0) return { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Wide' };
  return { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Very Wide' };
}

function depthBadge(depth: string | null): { bg: string; text: string } {
  const d = (depth ?? '').toLowerCase();
  if (d === 'high') return { bg: 'bg-emerald-500/15', text: 'text-emerald-400' };
  if (d === 'medium') return { bg: 'bg-blue-500/15', text: 'text-blue-400' };
  return { bg: 'bg-amber-500/15', text: 'text-amber-400' };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ElementType;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded-md bg-white/[0.06]" />
      ) : (
        <div className="text-2xl font-bold text-admin-text tabular-nums leading-none">{value}</div>
      )}
      {sub && <p className="text-[11px] text-admin-muted">{sub}</p>}
    </div>
  );
}

function SpreadBar({ pct }: { pct: number | null }) {
  const health = spreadHealthColor(pct);
  const width = pct == null || pct < 0 ? 100 : Math.min(100, (pct / 10) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct == null || pct < 0 ? 'bg-red-500' : pct <= 0.3 ? 'bg-emerald-500' : pct <= 1 ? 'bg-blue-500' : pct <= 5 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${health.text} min-w-[3.5rem] text-right`}>
        {pct == null ? '—' : pct < 0 ? `${pct.toFixed(2)}%` : `${pct.toFixed(3)}%`}
      </span>
    </div>
  );
}

// Custom dark chart tooltip
function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-admin-border bg-admin-card px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-admin-text mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-admin-muted">
          {p.name}: <span className="text-indigo-400 font-mono">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const BOT_SYMBOLS_FALLBACK = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'BNB_USDT'];

export default function LiquidityPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [historyMarket, setHistoryMarket] = useState('BTC_USDT');

  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (type === 'trade_executed') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'liquidity'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'liquidity', 'orderbooks'] });
      }
    },
  });

  const handleRefresh = () => {
    void controlQ.refetch();
    void liqQ.refetch();
    void historyQ.refetch();
    void botQ.refetch();
    void marketsQ.refetch();
  };

  const controlQ = useQuery({
    queryKey: ['admin', 'control', 'status', token],
    staleTime: 30_000,
    queryFn: () => getControlStatus(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const liqQ = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity', token],
    staleTime: 30_000,
    queryFn: () => getLiquidityAnalytics(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const historyQ = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity-history', token, historyMarket],
    staleTime: 30_000,
    queryFn: () => getLiquidityHistory(token, historyMarket),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const botQ = useQuery({
    queryKey: ['admin', 'liquidity-bot', 'config', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<LiquidityBotConfig>('/liquidity-bot/config', { token }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const marketsQ = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    staleTime: 30_000,
    queryFn: () => getTradingMarkets(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const bot = botQ.data?.success ? botQ.data.data : undefined;
  const botSymbols: string[] = bot?.symbols?.length ? bot.symbols : BOT_SYMBOLS_FALLBACK;

  // Fetch all orderbooks in a single query to avoid hooks-in-loop
  const orderbooksQ = useQuery({
    queryKey: ['admin', 'liquidity', 'orderbooks', botSymbols.join(','), token],
    staleTime: 15_000,
    queryFn: async () => {
      const results = await Promise.all(
        botSymbols.map((sym) => getTradingOrderbook(token, sym).then((r) => ({ sym, data: r?.data ?? null })))
      );
      return results;
    },
    enabled: !!token && botSymbols.length > 0,
    refetchInterval: 15_000,
  });

  const engine = controlQ.data?.success ? controlQ.data.data?.liquidity_engine_status : undefined;
  const analyticsData = liqQ.data?.success ? liqQ.data.data : undefined;

  const historyRows = useMemo(() => {
    const raw = historyQ.data?.data?.history ?? [];
    return (raw as Array<{ date: string; liquidity_score: number }>).map((d) => ({
      date: d.date?.slice(5, 10) ?? '',
      score: typeof d.liquidity_score === 'number' ? d.liquidity_score : 0,
    }));
  }, [historyQ.data]);

  const totalMarkets = marketsQ.data?.data?.markets?.length ?? 0;
  const runningMarkets = marketsQ.data?.data?.marketsRunning ?? 0;
  const haltedMarkets = marketsQ.data?.data?.marketsHalted ?? 0;

  // Build live orderbook rows
  const obMap = useMemo(() => {
    const map = new Map<string, { spread_pct: number | null; depth: string | null; bids: number; asks: number; top_bid: string | null; top_ask: string | null }>();
    for (const entry of orderbooksQ.data ?? []) {
      const d = entry.data;
      map.set(entry.sym, {
        spread_pct: d?.spread_pct ?? null,
        depth: d?.depth ?? null,
        bids: d?.bids?.length ?? 0,
        asks: d?.asks?.length ?? 0,
        top_bid: d?.bids?.[0]?.price ?? null,
        top_ask: d?.asks?.[0]?.price ?? null,
      });
    }
    return map;
  }, [orderbooksQ.data]);

  const liveRows = useMemo(() => {
    return botSymbols.map((sym) => ({
      symbol: sym,
      loading: orderbooksQ.isLoading,
      ...(obMap.get(sym) ?? { spread_pct: null, depth: null, bids: 0, asks: 0, top_bid: null, top_ask: null }),
    }));
  }, [botSymbols, obMap, orderbooksQ.isLoading]);

  // Aggregate spread score from live rows
  const validSpreads = liveRows.filter((r) => r.spread_pct != null && r.spread_pct >= 0);
  const avgSpread = validSpreads.length
    ? validSpreads.reduce((acc, r) => acc + (r.spread_pct ?? 0), 0) / validSpreads.length
    : null;
  const overallScore = avgSpread != null ? Math.max(0, Math.min(100, 100 - avgSpread)).toFixed(1) : null;

  const allFetching = controlQ.isFetching || liqQ.isFetching || botQ.isFetching || historyQ.isFetching || orderbooksQ.isFetching;

  const engineStatus = (engine ?? '').toLowerCase();
  const engineOk = engineStatus.includes('up') || engineStatus === 'active' || engineStatus === 'running' || engineStatus === 'healthy';

  return (
    <AdminPageFrame
      title="Liquidity"
      description="Monitor live spread health, orderbook depth, and bot configuration."
      status="active"
      quickActions={
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm font-medium text-admin-muted hover:text-admin-text transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${allFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Engine Status"
          value={
            <span className={engineOk ? 'text-emerald-400' : 'text-red-400'}>
              {engine ?? '—'}
            </span>
          }
          sub="Liquidity engine health"
          icon={engineOk ? CheckCircle2 : AlertTriangle}
          color={engineOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
          loading={controlQ.isLoading}
        />
        <KpiCard
          label="Markets Online"
          value={
            <span>
              {runningMarkets}
              <span className="text-sm font-normal text-admin-muted ml-1">/ {totalMarkets}</span>
            </span>
          }
          sub={haltedMarkets > 0 ? `${haltedMarkets} halted` : 'All markets running'}
          icon={Activity}
          color={haltedMarkets > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}
          loading={marketsQ.isLoading}
        />
        <KpiCard
          label="Spread Score"
          value={overallScore ?? '—'}
          sub={avgSpread != null ? `Avg spread ${avgSpread.toFixed(3)}% across ${validSpreads.length} markets` : 'No live data'}
          icon={TrendingUp}
          color="bg-indigo-500/10 text-indigo-400"
          loading={orderbooksQ.isLoading}
        />
        <KpiCard
          label="Bot Status"
          value={
            bot ? (
              <span className={bot.enabled ? 'text-emerald-400' : 'text-admin-muted'}>
                {bot.enabled ? 'Enabled' : 'Disabled'}
              </span>
            ) : (
              '—'
            )
          }
          sub={bot ? `${bot.symbols?.length ?? 0} symbols · ${bot.spreadBps} bps` : undefined}
          icon={Bot}
          color={bot?.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-admin-muted/10 text-admin-muted'}
          loading={botQ.isLoading}
        />
      </div>

      {/* Live Orderbook Depth Table */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-admin-text">Live Orderbook Depth</h3>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              15s refresh
            </span>
          </div>
          <span className="text-xs text-admin-muted">{botSymbols.length} monitored symbols</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-admin-muted">
              <tr>
                <th className="px-4 py-2.5">Market</th>
                <th className="px-4 py-2.5">Spread</th>
                <th className="px-4 py-2.5">Health</th>
                <th className="px-4 py-2.5">Depth</th>
                <th className="px-4 py-2.5">Bids</th>
                <th className="px-4 py-2.5">Asks</th>
                <th className="px-4 py-2.5">Top Bid</th>
                <th className="px-4 py-2.5">Top Ask</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {liveRows.map((row) => {
                const health = spreadHealthColor(row.spread_pct);
                const depth = depthBadge(row.depth);
                return (
                  <tr key={row.symbol} className="hover:bg-white/[0.03] transition-colors group">
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-admin-border bg-white/[0.04] px-2 py-0.5 text-xs font-mono font-semibold text-admin-text">
                        {row.symbol}
                      </span>
                    </td>
                    <td className="px-4 py-3 min-w-[160px]">
                      {row.loading ? (
                        <div className="h-2.5 w-24 animate-pulse rounded bg-white/[0.06]" />
                      ) : (
                        <SpreadBar pct={row.spread_pct} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.loading ? (
                        <div className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" />
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${health.bg} ${health.text}`}>
                          {health.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.loading ? (
                        <div className="h-5 w-14 animate-pulse rounded-full bg-white/[0.06]" />
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${depth.bg} ${depth.text}`}>
                          {row.depth ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-admin-text">
                      <span className="flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                        {row.bids}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-admin-text">
                      <span className="flex items-center gap-1">
                        <ArrowDownLeft className="h-3 w-3 text-red-400" />
                        {row.asks}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-400">
                      {row.top_bid != null ? Number(row.top_bid).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-red-400">
                      {row.top_ask != null ? Number(row.top_ask).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analytics Summary (Trade Count, Volume, M/T Ratio) */}
      {analyticsData && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Trade Count</p>
            <p className="text-xl font-bold text-admin-text tabular-nums">
              {(analyticsData as { tradeCount?: number }).tradeCount?.toLocaleString() ?? '—'}
            </p>
          </div>
          <div className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Total Volume</p>
            <p className="text-xl font-bold text-admin-text tabular-nums">
              {(analyticsData as { totalVolume?: number }).totalVolume
                ? `$${Number((analyticsData as { totalVolume?: number }).totalVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Maker/Taker Ratio</p>
            <p className="text-xl font-bold text-admin-text tabular-nums">
              {(analyticsData as { makerTakerRatio?: number }).makerTakerRatio != null
                ? Number((analyticsData as { makerTakerRatio?: number }).makerTakerRatio).toFixed(2)
                : '—'}
            </p>
          </div>
        </div>
      )}

      {/* 14d Liquidity Score Trend */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-admin-text">Liquidity Score Trend (14d)</h3>
            <p className="text-xs text-admin-muted mt-0.5">Historical score for selected market</p>
          </div>
          <div className="relative">
            <select
              value={historyMarket}
              onChange={(e) => setHistoryMarket(e.target.value)}
              className="appearance-none rounded-lg border border-admin-border bg-admin-surface pl-3 pr-8 py-1.5 text-xs font-medium text-admin-text focus:outline-none focus:ring-2 focus:ring-indigo-500/40 cursor-pointer"
            >
              {botSymbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-admin-muted" />
          </div>
        </div>
        <div className="p-4">
          <div className="h-[220px]">
            {historyQ.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <RefreshCw className="h-5 w-5 animate-spin text-admin-muted" />
              </div>
            ) : historyRows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-admin-muted">
                <BarChart3 className="h-8 w-8 opacity-30" />
                <p className="text-sm">No history data for {historyMarket}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyRows} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.35)' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.35)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<DarkTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    name="Score"
                    stroke="#6366F1"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#6366F1', stroke: '#fff', strokeWidth: 1.5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bot Configuration */}
      <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-admin-muted" />
            <h3 className="text-sm font-semibold text-admin-text">Liquidity Bot Configuration</h3>
          </div>
          {bot && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                bot.enabled
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-admin-muted/10 text-admin-muted'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${bot.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-admin-muted'}`} />
              {bot.enabled ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>
        <div className="p-4">
          {botQ.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-4 w-full animate-pulse rounded bg-white/[0.06]" />)}
            </div>
          ) : !bot ? (
            <p className="text-sm text-admin-muted">No configuration returned.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Spread</dt>
                  <dd className="text-lg font-bold font-mono text-admin-text">
                    {bot.spreadBps}
                    <span className="text-xs font-normal text-admin-muted ml-1">bps</span>
                  </dd>
                  <dd className="text-[10px] text-admin-muted mt-0.5">
                    ≈ {(bot.spreadBps / 100).toFixed(2)}%
                  </dd>
                </div>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Order Size</dt>
                  <dd className="text-lg font-bold font-mono text-admin-text">{bot.orderSize}</dd>
                  <dd className="text-[10px] text-admin-muted mt-0.5">Base asset per order</dd>
                </div>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">API Key</dt>
                  <dd className="text-sm font-mono text-admin-text">
                    {bot.apiKeyConfigured ? bot.apiKeyPreview ?? 'Configured' : 'Not configured'}
                  </dd>
                  <dd className="mt-0.5">
                    {bot.apiKeyConfigured ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <ShieldCheck className="h-3 w-3" /> Configured
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-400">Missing</span>
                    )}
                  </dd>
                </div>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted mb-1">Symbols</dt>
                  <dd className="text-lg font-bold text-admin-text">{bot.symbols?.length ?? 0}</dd>
                  <dd className="text-[10px] text-admin-muted mt-0.5">Active pairs</dd>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-admin-muted mb-2">Monitored Symbols</p>
                <div className="flex flex-wrap gap-2">
                  {bot.symbols?.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded-lg border border-admin-border bg-white/[0.04] px-2.5 py-1 text-xs font-mono font-medium text-admin-text"
                    >
                      <Droplets className="h-3 w-3 text-indigo-400" />
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-[11px] text-admin-muted border-t border-admin-border pt-3">
                Read-only view of server-side configuration. Bot parameters can only be changed via server environment variables.
              </p>
            </>
          )}
        </div>
      </div>
    </AdminPageFrame>
  );
}
