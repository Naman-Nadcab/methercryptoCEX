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
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { useAdminAlertStore } from '@/store/adminAlerts';
import {
  getDashboardSummary, getSystemHealth, getControlOverview,
  adminFetch, type DashboardSummary,
} from '@/lib/api';
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
  revenue: { tip: 'Open Analytics for 7-day fee revenue and charts.' },
  users: { tip: 'Total registered users on the platform.' },
  pendingWithdrawals: { tip: 'Withdrawals awaiting approval or chain confirmation.', danger: '>100 = processing bottleneck.' },
  systemHealth: { tip: 'Status of DB, Redis, WS, and settlement infra.', danger: 'Any degraded component impacts trading.' },
} as const;

function useResilientQuery<T>(options: Parameters<typeof useQuery<T>>[0]) {
  const lastGoodRef = useRef<T | undefined>(undefined);
  const result = useQuery<T>(options);
  if (result.data !== undefined) lastGoodRef.current = result.data;
  return { ...result, data: result.data ?? lastGoodRef.current, isStale: result.isError && lastGoodRef.current !== undefined };
}

function Tip({ tip, danger }: { tip: string; danger?: string }) {
  return (
    <SmartTooltip content={tip} danger={danger}>
      <Info className="h-3 w-3 text-admin-muted/60 cursor-help" />
    </SmartTooltip>
  );
}

function resolveStatus(value: number | undefined, warnAt: number, critAt: number): 'normal' | 'warning' | 'critical' {
  if (value === undefined) return 'normal';
  if (value >= critAt) return 'critical';
  if (value >= warnAt) return 'warning';
  return 'normal';
}

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

  const { data: summaryRes, isLoading: statsLoading } = useResilientQuery({
    queryKey: ['admin', 'dashboard-summary', token],
    queryFn: () => getDashboardSummary(token),
    enabled: !!token, refetchInterval: globalRefresh, staleTime: 60_000,
  });

  const { data: healthRes } = useResilientQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token, refetchInterval: Math.min(globalRefresh, 15000), staleTime: 60_000,
  });

  const { data: controlRes } = useResilientQuery({
    queryKey: ['admin', 'control', token],
    queryFn: () => getControlOverview(token),
    enabled: !!token, refetchInterval: Math.min(globalRefresh, 15000), staleTime: 60_000,
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
    queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
  }, [halted, token, queryClient]);

  const heatmapData = useMemo(() => ({
    trades: ordersPerSec, withdrawals: withdrawalQueueTotal, alerts: storeAlertCount,
  }), [ordersPerSec, withdrawalQueueTotal, storeAlertCount]);

  const initialLoad = statsLoading && !summary;

  if (initialLoad) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-admin-primary" />
      </div>
    );
  }

  const healthColor = healthScore >= 90 ? 'text-emerald-600' : healthScore >= 70 ? 'text-amber-600' : 'text-red-600';
  const healthBg = healthScore >= 90 ? 'bg-emerald-50 border-emerald-200' : healthScore >= 70 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
  const healthRing = healthScore >= 90 ? 'ring-emerald-500/20' : healthScore >= 70 ? 'ring-amber-500/20' : 'ring-red-500/20';

  return (
    <div className="space-y-5">
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

      {/* Trading Halted Banner */}
      {halted && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-800">Trading is HALTED</p>
              <p className="text-xs text-red-600">All spot markets are paused. No new orders can be placed.</p>
            </div>
          </div>
          <ProtectedAction permission="control:trading" fallback="disabled">
            <Button size="sm" variant="danger" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setPauseModalOpen(true)}>
              Resume Trading
            </Button>
          </ProtectedAction>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">
            Welcome back, {admin?.name ?? 'Admin'}
          </h1>
          <div className="flex items-center gap-3 mt-0.5">
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

      {/* === PRIMARY METRICS ROW === */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health Score — Prominent */}
        <div className={cn('rounded-xl border p-4 flex items-center gap-4 ring-1', healthBg, healthRing)}>
          <div className={cn('flex h-14 w-14 items-center justify-center rounded-full border-[3px] shrink-0', healthColor, healthScore >= 90 ? 'border-emerald-400' : healthScore >= 70 ? 'border-amber-400' : 'border-red-400')}>
            <span className={cn('text-xl font-bold tabular-nums', healthColor)}>{healthScore}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-admin-muted flex items-center gap-1">System Health <Tip tip={PANEL_TIPS.healthScore.tip} danger={PANEL_TIPS.healthScore.danger} /></p>
            <p className={cn('text-sm font-semibold', healthColor)}>{healthScore >= 90 ? 'Healthy' : healthScore >= 70 ? 'Degraded' : 'Critical'}</p>
          </div>
        </div>

        {/* Trading Volume */}
        <Link href="/analytics" className="group">
          <div className="rounded-xl border border-admin-border bg-admin-card p-4 hover:shadow-md transition-all h-full">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-admin-muted flex items-center gap-1">Trading Volume (24h) <Tip tip={PANEL_TIPS.volume.tip} danger={PANEL_TIPS.volume.danger} /></p>
              <div className="rounded-lg bg-blue-50 p-1.5 group-hover:bg-blue-100 transition-colors"><TrendingUp className="h-3.5 w-3.5 text-blue-600" /></div>
            </div>
            <p className="text-2xl font-bold tabular-nums text-admin-text">{volume24h > 0 ? `$${volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0'}</p>
            {volumeAnomaly && volumeAnomaly.deltaPercent !== 0 && (
              <p className={cn('text-xs mt-1 font-medium', volumeAnomaly.type === 'spike' ? 'text-emerald-600' : 'text-red-500')}>
                {volumeAnomaly.type === 'spike' ? '↑' : '↓'} {Math.abs(volumeAnomaly.deltaPercent).toFixed(1)}% vs prev
              </p>
            )}
          </div>
        </Link>

        {/* Total Users */}
        <Link href="/users" className="group">
          <div className="rounded-xl border border-admin-border bg-admin-card p-4 hover:shadow-md transition-all h-full">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-admin-muted">Total Users</p>
              <div className="rounded-lg bg-cyan-50 p-1.5 group-hover:bg-cyan-100 transition-colors"><Users className="h-3.5 w-3.5 text-cyan-600" /></div>
            </div>
            <p className="text-2xl font-bold tabular-nums text-admin-text">{totalUsers.toLocaleString()}</p>
            <p className="text-xs text-admin-muted mt-1">{users?.newToday ?? 0} new today</p>
          </div>
        </Link>

        {/* Pending Withdrawals */}
        <Link href="/withdrawals" className="group">
          <div className={cn('rounded-xl border bg-admin-card p-4 hover:shadow-md transition-all h-full', pendingWithdrawals > 10 ? 'border-amber-200' : 'border-admin-border')}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-admin-muted flex items-center gap-1">Pending Withdrawals <Tip tip={PANEL_TIPS.pendingWithdrawals.tip} danger={PANEL_TIPS.pendingWithdrawals.danger} /></p>
              <div className={cn('rounded-lg p-1.5 transition-colors', pendingWithdrawals > 10 ? 'bg-amber-50 group-hover:bg-amber-100' : 'bg-white/[0.02] group-hover:bg-white/5')}>
                <Wallet className={cn('h-3.5 w-3.5', pendingWithdrawals > 10 ? 'text-amber-600' : 'text-admin-muted')} />
              </div>
            </div>
            <p className={cn('text-2xl font-bold tabular-nums', pendingWithdrawals > 10 ? 'text-amber-600' : 'text-admin-text')}>{pendingWithdrawals}</p>
            <p className="text-xs text-admin-muted mt-1">awaiting approval</p>
          </div>
        </Link>
      </section>

      {/* === ENGINE METRICS === */}
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-2 pl-0.5">Engine Performance</p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <EngineMetric label="Orders / sec" value={ordersPerSec} anomaly={orderAnomaly} />
          <EngineMetric label="Latency P50" value={p50Latency} unit="ms" status={resolveStatus(p50Latency, 50, 100)} anomaly={latencyAnomaly} />
          <EngineMetric label="Latency P99" value={p99Latency || '—'} unit="ms" status={resolveStatus(p99Latency, 200, 1000)} />
          <EngineMetric label="API Latency" value={apiLatency} unit="ms" status={resolveStatus(apiLatency, 100, 500)} />
          <EngineMetric label="Heap Memory" value={Math.round(memoryMb)} unit="MB" status={resolveStatus(memoryMb, 512, 1024)} />
        </div>
      </section>

      {/* === INFRASTRUCTURE + MARKET OVERVIEW === */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* System Health */}
        <div className="rounded-xl border border-admin-border bg-admin-card">
          <div className="flex items-center justify-between px-5 py-3 border-b border-admin-border">
            <h3 className="text-sm font-semibold text-admin-text flex items-center gap-2">
              <Server className="h-4 w-4 text-admin-muted" /> Infrastructure
            </h3>
            <Link href="/monitoring" className="text-[11px] font-medium text-admin-primary hover:underline">View Details</Link>
          </div>
          <div className="px-5 py-4 space-y-3">
            <InfraRow icon={Database} label="Database" value={`${dbLatency}ms`} status={health?.database?.status} />
            <InfraRow icon={Zap} label="Redis" value={`${redisLatency}ms`} status={health?.redis?.status} />
            <InfraRow icon={Globe} label="WebSocket" value={`${wsConnections} connections`} status={health?.websocket?.status} />
            <InfraRow icon={Cpu} label="Uptime" value={formatUptime(uptime)} status="healthy" />
            <InfraRow icon={Activity} label="Settlement Queue" value={`${settlementPending} pending`} status={settlementPending > 50 ? 'degraded' : 'healthy'} />
          </div>
        </div>

        {/* Markets & P2P */}
        <div className="rounded-xl border border-admin-border bg-admin-card">
          <div className="flex items-center justify-between px-5 py-3 border-b border-admin-border">
            <h3 className="text-sm font-semibold text-admin-text flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-admin-muted" /> Markets & P2P
            </h3>
            <Link href="/trading" className="text-[11px] font-medium text-admin-primary hover:underline">View Details</Link>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <SummaryRow label="Active Markets" value={activeMarkets} />
              <SummaryRow label="Trading" value={halted ? 'HALTED' : 'Active'} warn={halted} />
              <SummaryRow label="P2P Ads" value={p2p?.activeAds ?? 0} />
              <SummaryRow label="P2P Orders" value={p2p?.activeOrders ?? 0} />
              <SummaryRow label="Open Disputes" value={openDisputes} warn={openDisputes > 0} />
              <SummaryRow label="Revenue (7d)" value="—" href="/analytics" />
            </div>
          </div>
        </div>
      </section>

      {/* === QUICK NAVIGATION === */}
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-2 pl-0.5">Quick Access</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function anomalyDirection(a: AnomalyResult): 'up' | 'down' | 'stable' {
  if (a.type === 'spike') return 'up';
  if (a.type === 'drop') return 'down';
  return 'stable';
}

const EngineMetric = memo(function EngineMetric({ label, value, unit, status, anomaly }: {
  label: string; value: string | number; unit?: string;
  status?: 'normal' | 'warning' | 'critical';
  anomaly?: AnomalyResult;
}) {
  const s = status ?? 'normal';
  const dir = anomaly ? anomalyDirection(anomaly) : 'stable';
  return (
    <div className={cn(
      'rounded-lg border bg-admin-card px-3.5 py-2.5 transition-all',
      s === 'critical' ? 'border-red-200 bg-red-50/30' : s === 'warning' ? 'border-amber-200 bg-amber-50/30' : 'border-admin-border',
    )}>
      <p className="text-[10px] font-medium text-admin-muted uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={cn('text-base font-bold tabular-nums',
          s === 'critical' ? 'text-red-600' : s === 'warning' ? 'text-amber-600' : 'text-admin-text'
        )}>{value}</span>
        {unit && <span className="text-[10px] text-admin-muted">{unit}</span>}
      </div>
      {anomaly && anomaly.deltaPercent !== 0 && (
        <p className={cn('text-[10px] font-medium mt-0.5',
          dir === 'up' ? 'text-emerald-600' : dir === 'down' ? 'text-red-500' : 'text-admin-muted'
        )}>
          {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} {Math.abs(anomaly.deltaPercent).toFixed(1)}%
        </p>
      )}
    </div>
  );
});

const InfraRow = memo(function InfraRow({ icon: Icon, label, value, status }: {
  icon: React.ElementType; label: string; value: string; status?: string;
}) {
  const s = status?.toLowerCase();
  const isOk = s === 'healthy' || s === 'ok' || s === 'connected';
  const isWarn = s === 'degraded' || s === 'slow';
  const isDown = s === 'down' || s === 'error';
  const dotClass = isOk ? 'bg-emerald-400' : isWarn ? 'bg-amber-400' : isDown ? 'bg-red-400' : 'bg-zinc-300';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Icon className="h-3.5 w-3.5 text-admin-muted" />
        <span className="text-xs text-admin-muted">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-admin-text tabular-nums">{value}</span>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotClass)} />
      </div>
    </div>
  );
});

function SummaryRow({ label, value, warn, href }: { label: string; value: string | number; warn?: boolean; href?: string }) {
  const content = (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-admin-muted">{label}</span>
      <span className={cn('text-xs font-semibold tabular-nums', warn ? 'text-red-600' : 'text-admin-text')}>{value}</span>
    </div>
  );
  if (href) return <Link href={href} className="hover:bg-white/[0.02] -mx-1 px-1 rounded transition-colors">{content}</Link>;
  return content;
}

const ACCENT_MAP: Record<string, { bg: string; text: string; hover: string }> = {
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', hover: 'group-hover:bg-amber-100' },
  red: { bg: 'bg-red-50', text: 'text-red-600', hover: 'group-hover:bg-red-100' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', hover: 'group-hover:bg-blue-100' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', hover: 'group-hover:bg-indigo-100' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600', hover: 'group-hover:bg-sky-100' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', hover: 'group-hover:bg-teal-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', hover: 'group-hover:bg-emerald-100' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', hover: 'group-hover:bg-violet-100' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600', hover: 'group-hover:bg-cyan-100' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', hover: 'group-hover:bg-purple-100' },
};

const QuickNav = memo(function QuickNav({ href, icon: Icon, label, count, accent }: {
  href: string; icon: React.ElementType; label: string; count?: number | string; accent: string;
}) {
  const c = ACCENT_MAP[accent] ?? ACCENT_MAP.blue!;
  return (
    <Link href={href} className="group">
      <div className="rounded-lg border border-admin-border bg-admin-card px-3.5 py-3 flex items-center gap-3 hover:shadow-sm transition-all">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition-colors', c.bg, c.hover)}>
          <Icon className={cn('h-4 w-4', c.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-admin-muted truncate">{label}</p>
          {count !== undefined && <p className="text-sm font-bold text-admin-text tabular-nums">{count}</p>}
        </div>
      </div>
    </Link>
  );
});

function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
