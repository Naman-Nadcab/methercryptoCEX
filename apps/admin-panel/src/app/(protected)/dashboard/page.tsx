'use client';

import { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Users, TrendingUp, DollarSign, BarChart3, ArrowUpFromLine,
  AlertTriangle, Repeat, PauseCircle, Loader2, Play,
  Wallet, Zap, Timer, ChevronDown, RefreshCw,
  ArrowLeftRight, ArrowDownToLine, BadgeCheck, ListOrdered, Percent, Info,
  Activity, Shield, Database, Cpu, Globe, Server,
  Clock, ArrowRight, CircleDot, Flame, Radio,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { useAdminAlertStore } from '@/store/adminAlerts';
import {
  getDashboardSummary, getSystemHealth, getControlOverview,
  adminFetch,
} from '@/lib/api';
import { ExchangeHealthTier1Banner } from '@/components/admin-shell/ExchangeHealthTier1Banner';
import {
  evaluateAlerts, computeHealthScore, trendPredictionsToAlerts, type ExchangeMetrics,
} from '@/components/admin-v2/alert-engine';
import { useAnomalyDetector, type AnomalyResult } from '@/components/admin-v2/useAnomalyDetector';
import { useIncidentDetector, type IncidentSuggestion } from '@/components/admin-v2/useIncidentDetector';
import { useTrendAnalyzer, type TrendPrediction } from '@/components/admin-v2/useTrendAnalyzer';
import { useSuggestionEngine } from '@/components/admin-v2/useSuggestionEngine';
import { useAuditIntegration } from '@/components/admin-v2/useAuditIntegration';
import { HeatmapIndicator } from '@/components/admin-v2/HeatmapIndicator';
import { SmartTooltip } from '@/components/admin-v2/SmartTooltip';
import { IncidentBanner } from '@/components/admin-v2/IncidentBanner';
import { IncidentPrompt } from '@/components/admin-v2/IncidentPrompt';
import { Button, SafeActionModal } from '@/components/ui';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

/* ────────────────────── constants ────────────────────── */

type RefreshRate = 10000 | 15000 | 30000 | 60000;
const REFRESH_OPTIONS: { label: string; value: RefreshRate }[] = [
  { label: '10s', value: 10000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
];

const PANEL_TIPS = {
  healthScore: { tip: 'Composite score (0–100) from latency, errors, queue depth, and risk signals.', danger: 'Below 70 = degraded. Below 50 = critical.' },
  volume: { tip: '24h aggregate trading volume across all spot pairs.', danger: 'Sudden 2x spike may indicate wash trading.' },
  users: { tip: 'Total registered users on the platform.' },
  pendingWithdrawals: { tip: 'Withdrawals awaiting approval or chain confirmation.', danger: '>100 = processing bottleneck.' },
} as const;

const CIRCUMFERENCE = 2 * Math.PI * 40;

/* ────────────────────── hooks ────────────────────── */

function useResilientQuery<T>(options: Parameters<typeof useQuery<T>>[0]) {
  const lastGoodRef = useRef<T | undefined>(undefined);
  const result = useQuery<T>(options);
  if (result.data !== undefined) lastGoodRef.current = result.data;
  return { ...result, data: result.data ?? lastGoodRef.current, isStale: result.isError && lastGoodRef.current !== undefined };
}

function useSparklineHistory(value: number, maxLen = 20): number[] {
  const histRef = useRef<number[]>([]);
  useEffect(() => {
    if (value === 0 && histRef.current.length === 0) return;
    histRef.current = [...histRef.current.slice(-(maxLen - 1)), value];
  }, [value, maxLen]);
  return histRef.current;
}

/* ────────────────────── main page ────────────────────── */

export default function DashboardPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();
  const addAlerts = useAdminAlertStore((s) => s.addAlerts);
  const addPredictiveAlerts = useAdminAlertStore((s) => s.addPredictiveAlerts);
  const storeAlertCount = useAdminAlertStore((s) => s.unreadCount);
  const detectAnomaly = useAnomalyDetector();
  const detectIncident = useIncidentDetector();
  const trendAnalyzer = useTrendAnalyzer();
  useAuditIntegration();

  const addAlertsRef = useRef(addAlerts);
  addAlertsRef.current = addAlerts;
  const addPredictiveAlertsRef = useRef(addPredictiveAlerts);
  addPredictiveAlertsRef.current = addPredictiveAlerts;
  const detectIncidentRef = useRef(detectIncident);
  detectIncidentRef.current = detectIncident;

  const [globalRefresh, setGlobalRefresh] = useState<RefreshRate>(15000);
  const [refreshDropdownOpen, setRefreshDropdownOpen] = useState(false);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [incidentSuggestion, setIncidentSuggestion] = useState<IncidentSuggestion | null>(null);
  const [trendPredictions, setTrendPredictions] = useState<TrendPrediction[]>([]);
  useSuggestionEngine(trendPredictions);

  const refetchWhenVisible = useCallback(
    (ms: number) => () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible' ? ms : false,
    []
  );

  /**
   * NOTE: queryKeys intentionally DO NOT include `token`. The three shell-shared
   * queries (`dashboard-summary`, `system-health`, `control`) are also fetched
   * by `UnifiedTopbar` / `ExchangeHealthTier1Banner`; sharing the key lets
   * React Query dedup the request and serve the topbar's cache instantly on
   * dashboard mount (and vice versa). Token is injected via queryFn only.
   */
  const { data: summaryRes, isLoading: statsLoading } = useResilientQuery({
    queryKey: ['admin', 'dashboard-summary'],
    queryFn: ({ signal }) => getDashboardSummary(token, signal),
    enabled: !!token,
    refetchInterval: refetchWhenVisible(globalRefresh),
    staleTime: 60_000,
  });

  const { data: healthRes } = useResilientQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: ({ signal }) => getSystemHealth(token, signal),
    enabled: !!token,
    refetchInterval: refetchWhenVisible(Math.min(globalRefresh, 30_000)),
    staleTime: 60_000,
  });

  const { data: controlRes } = useResilientQuery({
    queryKey: ['admin', 'control'],
    queryFn: ({ signal }) => getControlOverview(token, signal),
    enabled: !!token,
    refetchInterval: refetchWhenVisible(Math.min(globalRefresh, 30_000)),
    staleTime: 60_000,
  });

  const { data: revenueRes } = useResilientQuery({
    queryKey: ['admin', 'analytics-revenue-7d'],
    queryFn: ({ signal }) => adminFetch<{ buckets: unknown[]; total_revenue_24h: number; trading_fee_revenue: number; withdrawal_fee_revenue: number; other_fees: number }>('/analytics/revenue?period=7d', { token, signal }),
    enabled: !!token,
    refetchInterval: refetchWhenVisible(60_000),
    staleTime: 120_000,
  });

  const summary = summaryRes?.data;
  const users = summary?.stats?.users;
  const p2p = summary?.stats?.p2p;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const health = healthRes?.data as Record<string, any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const control = controlRes?.data as Record<string, any> | undefined;
  const halted = summary?.halted ?? false;

  const totalUsers = users?.total ?? 0;
  const pendingWithdrawals = summary?.pendingWithdrawals ?? 0;
  const openDisputes = p2p?.openDisputes ?? 0;
  const activeMarkets = (control?.markets as { active?: number })?.active ?? 0;
  const volume24h = summary?.tradingVolume24h ?? 0;
  const revenue7dData = revenueRes?.data;
  const revenue7dTotal = useMemo(() => {
    if (!revenue7dData?.buckets) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (revenue7dData.buckets as any[]).reduce((sum: number, b: any) => sum + (parseFloat(b.revenue ?? '0') || 0), 0);
  }, [revenue7dData]);

  const dbLatency = health?.database?.latency_ms ?? health?.database?.latencyMs ?? 0;
  const redisLatency = health?.redis?.latency_ms ?? health?.redis?.latencyMs ?? 0;
  const wsConnections = health?.websocket?.connections ?? 0;
  const apiLatency = health?.api_latency_ms ?? 0;
  const memoryMb = health?.node?.memory_heap_mb ?? 0;
  const uptime = health?.node?.uptime_sec ?? 0;
  const settlementPending = health?.queue?.settlement_pending ?? 0;
  const withdrawalQueueTotal = health?.queue?.total_withdrawal_queue ?? pendingWithdrawals;

  const p50Latency = control?.spotMetrics?.orderLatencyP50Ms ?? 0;
  const p99Latency = control?.spotMetrics?.orderLatencyP99Ms ?? 0;
  const ordersPerSec = control?.spotMetrics?.ordersPerSecond ?? 0;

  const exchangeMetrics = useMemo<ExchangeMetrics>(() => ({
    engineLatencyMs: p50Latency, p99LatencyMs: p99Latency, apiLatencyMs: apiLatency,
    apiErrorRate: 0, withdrawalQueue: withdrawalQueueTotal, settlementPending,
    amlAlertsOpen: 0, amlHighSeverity: 0,
    failedLogins24h: 0, lockedAccounts: 0,
    tradingHalted: halted, dbLatencyMs: dbLatency, redisLatencyMs: redisLatency,
    memoryMb, wsConnections,
  }), [p50Latency, p99Latency, apiLatency, withdrawalQueueTotal, settlementPending, halted, dbLatency, redisLatency, memoryMb, wsConnections]);

  const healthScore = useMemo(() => computeHealthScore(exchangeMetrics), [exchangeMetrics]);
  const orderAnomaly = useMemo(() => detectAnomaly('orders-sec', ordersPerSec), [detectAnomaly, ordersPerSec]);
  const latencyAnomaly = useMemo(() => detectAnomaly('latency-p50', p50Latency), [detectAnomaly, p50Latency]);
  const volumeAnomaly = useMemo(() => detectAnomaly('volume-24h', volume24h), [detectAnomaly, volume24h]);

  /* sparkline histories */
  const volumeHist = useSparklineHistory(volume24h);
  const ordersHist = useSparklineHistory(ordersPerSec);
  const latencyHist = useSparklineHistory(apiLatency);

  const lastMetricsKeyRef = useRef('');

  useEffect(() => {
    if (!health && !control) return;
    const timeout = setTimeout(() => {
      const metricsKey = `${exchangeMetrics.engineLatencyMs}:${exchangeMetrics.p99LatencyMs}:${exchangeMetrics.apiErrorRate}:${exchangeMetrics.withdrawalQueue}:${exchangeMetrics.memoryMb}:${volume24h}`;
      if (metricsKey === lastMetricsKeyRef.current) return;
      lastMetricsKeyRef.current = metricsKey;

      const alerts = evaluateAlerts(exchangeMetrics);
      if (alerts.length > 0) {
        addAlertsRef.current(alerts);
        if (ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_MANAGEMENT) {
          const suggestion = detectIncidentRef.current(alerts);
          if (suggestion.shouldTriggerIncident) setIncidentSuggestion(suggestion);
        }
      }

      if (ADMIN_FEATURE_FLAGS.ADMIN_AI_OPS) {
        trendAnalyzer.record('latency', exchangeMetrics.engineLatencyMs);
        trendAnalyzer.record('volume', volume24h);
        trendAnalyzer.record('errorRate', exchangeMetrics.apiErrorRate);
        trendAnalyzer.record('withdrawalQueue', exchangeMetrics.withdrawalQueue);
        trendAnalyzer.record('memory', exchangeMetrics.memoryMb);
        const predictions = trendAnalyzer.analyze();
        setTrendPredictions(predictions);
        if (predictions.length > 0) {
          addPredictiveAlertsRef.current(trendPredictionsToAlerts(predictions));
        }
      }
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeMetrics, health, control, trendAnalyzer, volume24h]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string) === 'admin' });
  }, [queryClient]);

  const handlePauseTrading = useCallback(async () => {
    await adminFetch('/control/emergency-mode', { method: 'POST', body: { enabled: !halted }, token });
    queryClient.invalidateQueries({ predicate: (q) => {
      const key = q.queryKey as string[];
      return key[0] === 'admin' && (
        key[1] === 'trading-halt' || key[1] === 'dashboard-summary' || key[1] === 'control'
      );
    }});
  }, [halted, token, queryClient]);

  const heatmapData = useMemo(() => ({
    trades: ordersPerSec, withdrawals: withdrawalQueueTotal, alerts: storeAlertCount,
  }), [ordersPerSec, withdrawalQueueTotal, storeAlertCount]);

  const statsBootstrapping = statsLoading && !summary;

  /* health sub-scores for breakdown */
  const infraScores = useMemo(() => ({
    db: dbLatency < 100 ? 100 : dbLatency < 300 ? 70 : 40,
    redis: redisLatency === 0 && !health?.redis?.status ? 0 : redisLatency < 10 ? 100 : redisLatency < 50 ? 75 : 40,
    engine: p50Latency < 50 ? 100 : p50Latency < 150 ? 70 : 40,
    api: apiLatency < 200 ? 100 : apiLatency < 500 ? 65 : 35,
    memory: memoryMb < 400 ? 100 : memoryMb < 800 ? 70 : 40,
  }), [dbLatency, redisLatency, p50Latency, apiLatency, memoryMb, health?.redis?.status]);

  const healthLevel = healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'degraded' : 'critical';

  return (
    <AdminPageFrame title="Dashboard">
    <div className="space-y-6">
      {statsBootstrapping && (
        <div className="flex items-center gap-2 rounded-lg border border-admin-border bg-admin-card/80 px-3 py-2 text-sm text-admin-muted animate-fade-in">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-admin-primary" />
          <span>Loading live dashboard…</span>
        </div>
      )}
      <SafeActionModal
        open={pauseModalOpen} onClose={() => setPauseModalOpen(false)} onConfirm={handlePauseTrading}
        title={halted ? 'Resume Trading' : 'Pause Trading'}
        description={halted ? 'Resume all spot trading. Users can place orders again.' : 'Halt all spot trading immediately.'}
        impactWarning={halted ? undefined : 'Pausing trading affects ALL markets and ALL users. Revenue stops.'}
        severity={halted ? 'warning' : 'critical'} requiredPermission="control:trading"
        confirmLabel={halted ? 'Resume Trading' : 'Pause All Trading'}
      />

      {ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_MANAGEMENT && (
        <IncidentPrompt suggestion={incidentSuggestion} onDismiss={() => setIncidentSuggestion(null)} />
      )}

      {/* ── Trading Halted Banner ── */}
      {halted && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-gradient-to-r from-red-500/10 to-red-900/5 px-5 py-3.5 shadow-glow-danger">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/15 subtle-pulse">
              <AlertTriangle className="h-4.5 w-4.5 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-300">Trading is HALTED</p>
              <p className="text-xs text-red-400/80">All spot markets paused — no new orders can be placed.</p>
            </div>
          </div>
          <ProtectedAction permission="control:trading" fallback="disabled">
            <Button size="sm" variant="danger" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setPauseModalOpen(true)}>
              Resume Trading
            </Button>
          </ProtectedAction>
        </div>
      )}

      {/* ── Header Row ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-admin-text tracking-tight">
            Welcome back, {admin?.name ?? 'Admin'}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-admin-muted">
              {pendingWithdrawals} pending withdrawals · {openDisputes} open disputes · {activeMarkets} active markets
            </p>
            <HeatmapIndicator {...heatmapData} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!halted && (
            <ProtectedAction permission="control:trading" fallback="disabled">
              <Button variant="outline" size="sm" icon={<PauseCircle className="h-3.5 w-3.5" />} onClick={() => setPauseModalOpen(true)}>
                Pause Trading
              </Button>
            </ProtectedAction>
          )}
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setRefreshDropdownOpen((s) => !s)}>
              <Timer className="h-3.5 w-3.5 mr-1" />
              {REFRESH_OPTIONS.find((o) => o.value === globalRefresh)?.label}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
            {refreshDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setRefreshDropdownOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 bg-admin-card border border-admin-border rounded-lg shadow-dropdown py-1 min-w-[80px]">
                  {REFRESH_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => { setGlobalRefresh(opt.value); setRefreshDropdownOpen(false); }}
                      className={cn('w-full text-left px-3 py-1.5 text-xs transition-colors', globalRefresh === opt.value ? 'text-admin-primary bg-admin-primary/5' : 'text-admin-text hover:bg-white/[0.02]')}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      {ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_MANAGEMENT && <IncidentBanner />}

      {/* ── HERO ROW: Health Ring + Tier-1 Banner ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Health Score Card */}
        <div className={cn(
          'lg:col-span-4 rounded-xl border p-5 flex flex-col items-center gap-4 relative overflow-hidden transition-all duration-500',
          healthLevel === 'healthy' ? 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-admin-card to-admin-card' :
          healthLevel === 'degraded' ? 'border-amber-500/25 bg-gradient-to-br from-amber-500/8 via-admin-card to-admin-card' :
          'border-red-500/30 bg-gradient-to-br from-red-500/10 via-admin-card to-admin-card',
        )}>
          {healthLevel !== 'healthy' && (
            <div className={cn('absolute inset-0 opacity-30',
              healthLevel === 'critical' ? 'bg-gradient-to-t from-red-600/10 to-transparent' : 'bg-gradient-to-t from-amber-600/5 to-transparent'
            )} />
          )}
          <div className="relative">
            <HealthRing score={healthScore} size={100} />
          </div>
          <div className="text-center relative z-10">
            <p className={cn('text-sm font-bold',
              healthLevel === 'healthy' ? 'text-emerald-400' : healthLevel === 'degraded' ? 'text-amber-400' : 'text-red-400'
            )}>
              {healthLevel === 'healthy' ? 'All Systems Operational' : healthLevel === 'degraded' ? 'Performance Degraded' : 'Critical — Action Required'}
            </p>
            <p className="text-[10px] text-admin-muted mt-0.5">Uptime: {formatUptime(uptime)}</p>
          </div>
          {/* Component breakdown */}
          <div className="w-full space-y-2 relative z-10">
            <HealthBreakdownRow label="Database" score={infraScores.db} />
            <HealthBreakdownRow label="Redis" score={infraScores.redis} />
            <HealthBreakdownRow label="Engine" score={infraScores.engine} />
            <HealthBreakdownRow label="API" score={infraScores.api} />
            <HealthBreakdownRow label="Memory" score={infraScores.memory} />
          </div>
        </div>

        {/* Tier-1 Banner + KPI Grid */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <ExchangeHealthTier1Banner token={token} />

          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KpiCard
              href="/analytics"
              label="Trading Volume"
              sublabel="24h"
              value={volume24h > 0 ? `$${volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'}
              icon={<TrendingUp className="h-4 w-4" />}
              iconColor="text-blue-400"
              iconBg="bg-blue-500/10"
              sparkline={volumeHist}
              sparkColor="blue"
              anomaly={volumeAnomaly}
              tip={PANEL_TIPS.volume}
            />
            <KpiCard
              href="/users"
              label="Total Users"
              value={totalUsers.toLocaleString()}
              sub={`${users?.newToday ?? 0} new today`}
              icon={<Users className="h-4 w-4" />}
              iconColor="text-cyan-400"
              iconBg="bg-cyan-500/10"
              tip={PANEL_TIPS.users}
              sparkColor="green"
            />
            <KpiCard
              href="/withdrawals"
              label="Pending WDs"
              value={String(pendingWithdrawals)}
              sub="awaiting approval"
              icon={<Wallet className="h-4 w-4" />}
              iconColor={pendingWithdrawals > 10 ? 'text-amber-400' : 'text-admin-muted'}
              iconBg={pendingWithdrawals > 10 ? 'bg-amber-500/10' : 'bg-white/5'}
              warn={pendingWithdrawals > 10}
              tip={PANEL_TIPS.pendingWithdrawals}
            />
            <KpiCard
              href="/orders"
              label="Orders / sec"
              value={String(ordersPerSec)}
              icon={<Flame className="h-4 w-4" />}
              iconColor="text-orange-400"
              iconBg="bg-orange-500/10"
              sparkline={ordersHist}
              sparkColor="amber"
              anomaly={orderAnomaly}
            />
          </div>
        </div>
      </section>

      {/* ── ENGINE PERFORMANCE ── */}
      <section>
        <SectionHeader label="Engine Performance" icon={<Cpu className="h-3.5 w-3.5" />} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <EngineMetric label="Orders / sec" value={ordersPerSec} sparkline={ordersHist} sparkColor="green" anomaly={orderAnomaly} />
          <EngineMetric label="Latency P50" value={p50Latency} unit="ms" threshold={{ warn: 50, crit: 100 }} anomaly={latencyAnomaly} />
          <EngineMetric label="Latency P99" value={p99Latency || '—'} unit="ms" threshold={{ warn: 200, crit: 1000 }} />
          <EngineMetric label="API Latency" value={apiLatency} unit="ms" threshold={{ warn: 100, crit: 500 }} sparkline={latencyHist} sparkColor="amber" />
          <EngineMetric label="Heap Memory" value={Math.round(memoryMb)} unit="MB" threshold={{ warn: 512, crit: 1024 }} />
        </div>
      </section>

      {/* ── INFRASTRUCTURE + MARKETS ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Infrastructure */}
        <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-admin-border bg-white/[0.01]">
            <h3 className="text-sm font-bold text-admin-text flex items-center gap-2">
              <Server className="h-4 w-4 text-admin-primary" /> Infrastructure
            </h3>
            <Link href="/monitoring" className="text-[11px] font-medium text-admin-primary hover:text-admin-primary-hover transition-colors">
              View Details <ArrowRight className="inline h-3 w-3" />
            </Link>
          </div>
          <div className="p-5 space-y-4">
            <InfraRow icon={Database} label="Database" latency={`${dbLatency}ms`} status={health?.database?.status} maxLatency={500} currentLatency={dbLatency} />
            <InfraRow icon={Zap} label="Redis" latency={`${redisLatency}ms`} status={health?.redis?.status} maxLatency={50} currentLatency={redisLatency} />
            <InfraRow icon={Globe} label="WebSocket" latency={`${wsConnections} conn`} status={health?.websocket?.status} />
            <InfraRow icon={Clock} label="Uptime" latency={formatUptime(uptime)} status="healthy" />
            <InfraRow icon={Activity} label="Settlement" latency={`${settlementPending} pending`} status={settlementPending > 50 ? 'degraded' : 'healthy'} />
          </div>
        </div>

        {/* Markets & P2P */}
        <div className="rounded-xl border border-admin-border bg-admin-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-admin-border bg-white/[0.01]">
            <h3 className="text-sm font-bold text-admin-text flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-admin-primary" /> Markets & P2P
            </h3>
            <Link href="/trading" className="text-[11px] font-medium text-admin-primary hover:text-admin-primary-hover transition-colors">
              View Details <ArrowRight className="inline h-3 w-3" />
            </Link>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <MarketStat label="Active Markets" value={activeMarkets} icon={<BarChart3 className="h-3.5 w-3.5 text-admin-primary" />} />
              <MarketStat label="Trading" value={halted ? 'HALTED' : 'Active'} icon={<Radio className={cn('h-3.5 w-3.5', halted ? 'text-red-400' : 'text-emerald-400')} />} warn={halted} />
              <MarketStat label="P2P Ads" value={p2p?.activeAds ?? 0} icon={<CircleDot className="h-3.5 w-3.5 text-indigo-400" />} />
              <MarketStat label="P2P Orders" value={p2p?.activeOrders ?? 0} icon={<ArrowLeftRight className="h-3.5 w-3.5 text-cyan-400" />} />
              <MarketStat label="Open Disputes" value={openDisputes} icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />} warn={openDisputes > 0} />
              <Link href="/analytics" className="group">
                <MarketStat label="Revenue (7d)" value={revenue7dTotal !== null ? `$${revenue7dTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'} icon={<DollarSign className="h-3.5 w-3.5 text-emerald-400" />} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── OPERATOR SHORTCUTS ── */}
      <section>
        <SectionHeader label="Quick Actions" icon={<Zap className="h-3.5 w-3.5" />} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <QuickNav href="/withdrawals" icon={ArrowUpFromLine} label="Withdrawals" count={pendingWithdrawals} accent="amber" />
          <QuickNav href="/risk" icon={Shield} label="AML & Risk" accent="red" />
          <QuickNav href="/users" icon={Users} label="Users" count={totalUsers} accent="blue" />
          <QuickNav href="/kyc" icon={BadgeCheck} label="KYC" accent="indigo" />
          <QuickNav href="/orders" icon={ListOrdered} label="Orders" accent="sky" />
          <QuickNav href="/trades" icon={Repeat} label="Trades" accent="teal" />
          <QuickNav href="/deposits" icon={ArrowDownToLine} label="Deposits" accent="emerald" />
          <QuickNav href="/fees" icon={Percent} label="Fees" accent="violet" />
          <QuickNav href="/p2p" icon={ArrowLeftRight} label="P2P" count={(p2p?.activeOrders ?? 0) + (p2p?.activeAds ?? 0)} accent="cyan" />
          <QuickNav href="/markets" icon={BarChart3} label="Markets" count={activeMarkets} accent="purple" />
        </div>
      </section>
    </div>
    </AdminPageFrame>
  );
}

/* ────────────────────────────────────────────────────── */
/*  Sub-components                                        */
/* ────────────────────────────────────────────────────── */

/* ── Tip popover ── */
function Tip({ tip, danger }: { tip: string; danger?: string }) {
  return (
    <SmartTooltip content={tip} danger={danger}>
      <Info className="h-3 w-3 text-admin-muted/50 cursor-help hover:text-admin-muted transition-colors" />
    </SmartTooltip>
  );
}

/* ── Section header ── */
function SectionHeader({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-admin-muted/60">{icon}</span>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-admin-muted">{label}</p>
      <div className="flex-1 h-px bg-admin-border/50 ml-2" />
    </div>
  );
}

/* ── Animated SVG Health Ring ── */
const HealthRing = memo(function HealthRing({ score, size = 100 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  const color = pct >= 90 ? '#10B981' : pct >= 70 ? '#F59E0B' : '#EF4444';
  const glowClass = pct < 70 ? 'health-glow' : '';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="40" className="health-ring-track" />
        <circle
          cx="50" cy="50" r="40"
          className={cn('health-ring-value', glowClass)}
          style={{ stroke: color, strokeDasharray: CIRCUMFERENCE, strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums text-admin-text leading-none">{score}</span>
        <span className="text-[9px] font-medium text-admin-muted mt-0.5 uppercase tracking-wider">Health</span>
      </div>
    </div>
  );
});

/* ── Health breakdown bar row ── */
const HealthBreakdownRow = memo(function HealthBreakdownRow({ label, score }: { label: string; score: number }) {
  const color = score >= 90 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 90 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-admin-muted w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-admin-border/50 overflow-hidden">
        <div className={cn('h-full rounded-full metric-bar-fill', color)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn('text-[10px] font-bold tabular-nums w-8 text-right', textColor)}>{score}</span>
    </div>
  );
});

/* ── Mini Sparkline SVG ── */
const Sparkline = memo(function Sparkline({
  values, color = 'green', width = 64, height = 24,
}: {
  values: number[]; color?: 'green' | 'blue' | 'amber' | 'red'; width?: number; height?: number;
}) {
  if (values.length < 2) return <div style={{ width, height }} />;

  const pad = 2;
  const vmin = Math.min(...values);
  const vmax = Math.max(...values);
  const span = vmax - vmin || 1;
  const n = values.length;
  const step = (width - pad * 2) / (n - 1);

  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - vmin) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeMap = { green: '#10B981', blue: '#6366F1', amber: '#F59E0B', red: '#EF4444' };
  const fillMap = { green: 'rgba(16,185,129,0.1)', blue: 'rgba(99,102,241,0.1)', amber: 'rgba(245,158,11,0.1)', red: 'rgba(239,68,68,0.1)' };
  const areaPath = `M${pts[0]} ${pts.join(' L')} L${(pad + (n - 1) * step).toFixed(1)},${height} L${pad},${height} Z`;

  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
      <path d={areaPath} fill={fillMap[color]} />
      <polyline fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" stroke={strokeMap[color]} points={pts.join(' ')} />
    </svg>
  );
});

/* ── KPI Card ── */
const KpiCard = memo(function KpiCard({
  href, label, sublabel, value, sub, icon, iconColor, iconBg, sparkline, sparkColor, anomaly, warn, tip,
}: {
  href: string;
  label: string;
  sublabel?: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  sparkline?: number[];
  sparkColor?: 'green' | 'blue' | 'amber' | 'red';
  anomaly?: AnomalyResult;
  warn?: boolean;
  tip?: { tip: string; danger?: string };
}) {
  return (
    <Link href={href} className="group">
      <div className={cn(
        'rounded-xl border bg-admin-card p-4 transition-all duration-200 h-full',
        'hover:border-admin-primary/30 hover:shadow-lg hover:shadow-admin-primary/5',
        warn ? 'border-amber-500/25' : 'border-admin-border',
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">
              {label}{sublabel && <span className="text-admin-muted/50 ml-1">{sublabel}</span>}
            </p>
            {tip && <Tip tip={tip.tip} danger={tip.danger} />}
          </div>
          <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg transition-colors', iconBg)}>
            <span className={iconColor}>{icon}</span>
          </div>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('text-2xl font-black tabular-nums leading-none',
              warn ? 'text-amber-400' : 'text-admin-text'
            )}>{value}</p>
            {sub && <p className="text-[10px] text-admin-muted mt-1.5">{sub}</p>}
            {anomaly && anomaly.deltaPercent !== 0 && (
              <p className={cn('text-[10px] font-semibold mt-1',
                anomaly.type === 'spike' ? 'text-emerald-400' : 'text-red-400'
              )}>
                {anomaly.type === 'spike' ? '↑' : '↓'} {Math.abs(anomaly.deltaPercent).toFixed(1)}% vs prev
              </p>
            )}
          </div>
          {sparkline && sparkline.length > 1 && (
            <Sparkline values={sparkline} color={sparkColor} width={56} height={22} />
          )}
        </div>
      </div>
    </Link>
  );
});

/* ── Engine Metric Card ── */
function anomalyDirection(a: AnomalyResult): 'up' | 'down' | 'stable' {
  if (a.type === 'spike') return 'up';
  if (a.type === 'drop') return 'down';
  return 'stable';
}

const EngineMetric = memo(function EngineMetric({ label, value, unit, threshold, anomaly, sparkline, sparkColor }: {
  label: string; value: string | number; unit?: string;
  threshold?: { warn: number; crit: number };
  anomaly?: AnomalyResult;
  sparkline?: number[];
  sparkColor?: 'green' | 'blue' | 'amber' | 'red';
}) {
  const numVal = typeof value === 'number' ? value : 0;
  const status = threshold
    ? numVal >= threshold.crit ? 'critical' : numVal >= threshold.warn ? 'warning' : 'normal'
    : 'normal';
  const dir = anomaly ? anomalyDirection(anomaly) : 'stable';

  return (
    <div className={cn(
      'rounded-xl border bg-admin-card px-4 py-3 transition-all group hover:shadow-md',
      status === 'critical' ? 'border-red-500/25 hover:shadow-red-500/5' :
      status === 'warning' ? 'border-amber-500/20 hover:shadow-amber-500/5' :
      'border-admin-border hover:border-admin-primary/20 hover:shadow-admin-primary/5',
    )}>
      <p className="text-[9px] font-bold text-admin-muted uppercase tracking-[0.1em] mb-2">{label}</p>
      <div className="flex items-end justify-between gap-1">
        <div>
          <div className="flex items-baseline gap-1">
            <span className={cn('text-lg font-black tabular-nums leading-none',
              status === 'critical' ? 'text-red-400' : status === 'warning' ? 'text-amber-400' : 'text-admin-text'
            )}>{value}</span>
            {unit && <span className="text-[9px] text-admin-muted font-medium">{unit}</span>}
          </div>
          {anomaly && anomaly.deltaPercent !== 0 && (
            <p className={cn('text-[9px] font-semibold mt-1',
              dir === 'up' ? 'text-emerald-400' : dir === 'down' ? 'text-red-400' : 'text-admin-muted'
            )}>
              {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} {Math.abs(anomaly.deltaPercent).toFixed(1)}%
            </p>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline values={sparkline} color={sparkColor ?? (status === 'critical' ? 'red' : status === 'warning' ? 'amber' : 'green')} width={48} height={18} />
        )}
      </div>
      {threshold && typeof value === 'number' && (
        <div className="mt-2.5 h-1 rounded-full bg-admin-border/40 overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700 metric-bar-fill',
              status === 'critical' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
            )}
            style={{ width: `${Math.min(100, (numVal / threshold.crit) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
});

/* ── Infrastructure Row ── */
const InfraRow = memo(function InfraRow({ icon: Icon, label, latency, status, maxLatency, currentLatency }: {
  icon: React.ElementType; label: string; latency: string; status?: string;
  maxLatency?: number; currentLatency?: number;
}) {
  const s = status?.toLowerCase();
  const isOk = s === 'healthy' || s === 'ok' || s === 'up' || s === 'connected';
  const isWarn = s === 'degraded' || s === 'slow';
  const isDown = s === 'down' || s === 'error';

  const dotColor = isOk ? 'bg-emerald-400' : isWarn ? 'bg-amber-400' : isDown ? 'bg-red-400' : 'bg-zinc-500';
  const dotGlow = isOk ? 'shadow-emerald-400/40' : isWarn ? 'shadow-amber-400/40' : isDown ? 'shadow-red-400/40' : '';
  const pct = maxLatency && currentLatency != null ? Math.min(100, (currentLatency / maxLatency) * 100) : null;
  const barColor = isOk ? 'bg-emerald-500' : isWarn ? 'bg-amber-500' : isDown ? 'bg-red-500' : 'bg-zinc-600';

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] shrink-0">
        <Icon className="h-4 w-4 text-admin-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-admin-text">{label}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-admin-muted tabular-nums">{latency}</span>
            <span className={cn('h-2 w-2 rounded-full shrink-0 shadow-sm', dotColor, dotGlow)} />
          </div>
        </div>
        {pct !== null && (
          <div className="h-1 rounded-full bg-admin-border/40 overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-500 metric-bar-fill', barColor)} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
});

/* ── Market Stat Row ── */
function MarketStat({ label, value, icon, warn }: { label: string; value: string | number; icon: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0 flex items-center justify-between">
        <span className="text-xs text-admin-muted">{label}</span>
        <span className={cn('text-xs font-bold tabular-nums', warn ? 'text-red-400' : 'text-admin-text')}>{value}</span>
      </div>
    </div>
  );
}

/* ── Quick Nav Card ── */
const ACCENT_MAP: Record<string, { bg: string; text: string; border: string }> = {
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'hover:border-amber-500/25' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'hover:border-red-500/25' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'hover:border-blue-500/25' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'hover:border-indigo-500/25' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'hover:border-sky-500/25' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'hover:border-teal-500/25' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'hover:border-emerald-500/25' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'hover:border-violet-500/25' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'hover:border-cyan-500/25' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'hover:border-purple-500/25' },
};

const QuickNav = memo(function QuickNav({ href, icon: Icon, label, count, accent }: {
  href: string; icon: React.ElementType; label: string; count?: number | string; accent: string;
}) {
  const c = ACCENT_MAP[accent] ?? ACCENT_MAP.blue!;
  return (
    <Link href={href} className="group">
      <div className={cn(
        'rounded-xl border border-admin-border bg-admin-card px-3.5 py-3 flex items-center gap-3',
        'transition-all duration-200 hover:shadow-md hover:bg-admin-card-hover',
        c.border,
      )}>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition-colors', c.bg)}>
          <Icon className={cn('h-4 w-4', c.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-admin-muted uppercase font-medium tracking-wide truncate">{label}</p>
          {count !== undefined && <p className="text-sm font-bold text-admin-text tabular-nums">{count}</p>}
        </div>
      </div>
    </Link>
  );
});

/* ── Helpers ── */
function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
