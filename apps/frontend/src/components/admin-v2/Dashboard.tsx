'use client';

import { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
  RefreshCw, TrendingUp, Users, DollarSign, Activity, Shield,
  Wallet, ArrowLeftRight, Zap, Timer, ChevronDown,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import {
  getDashboardStats,
  getAnalyticsAll,
  getRevenue,
  getTradingVolume,
  getLiquidity,
  getSystemHealth,
  getControlOverview,
  getApiMetrics,
  getWithdrawals,
} from '@/lib/admin';
import { getAmlDashboard, getSecurityDashboard } from '@/lib/admin/risk';
import {
  evaluateAlerts, computeHealthScore, trendPredictionsToAlerts,
  type ExchangeMetrics,
} from './alert-engine';

import { ControlBar } from './ControlBar';
import { Panel, type PanelStatus } from './Panel';
import { StatPanel } from './StatPanel';
import { TimeSeriesPanel } from './TimeSeriesPanel';
import { ActivityFeed } from './ActivityFeed';
import { AlertDrawer } from './AlertDrawer';
import { CommandPalette } from './CommandPalette';
import { HeatmapIndicator } from './HeatmapIndicator';
import { IncidentPrompt } from './IncidentPrompt';
import { IncidentBanner } from './IncidentBanner';
import { ActiveAdminsIndicator } from './ActiveAdminsIndicator';
import { SystemForecastPanel } from './SystemForecastPanel';
import { ReliabilityScore } from './ReliabilityScore';
import { TimelineView } from './TimelineView';
import { SessionActivity } from './SessionActivity';
import { useAnomalyDetector, type AnomalyResult } from './useAnomalyDetector';
import { useIncidentDetector, type IncidentSuggestion } from './useIncidentDetector';
import { useTrendAnalyzer, type TrendPrediction } from './useTrendAnalyzer';
import { useSuggestionEngine } from './useSuggestionEngine';
import { usePredictiveIncidentLinker } from './usePredictiveIncidentLinker';
import { useAuditIntegration } from './useAuditIntegration';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import {
  ControlBarSkeleton,
  PanelSkeleton,
  ChartSkeleton,
  ActivitySkeleton,
} from './LoadingSkeleton';

type RefreshRate = 5000 | 15000 | 30000 | 60000;
const REFRESH_OPTIONS: { label: string; value: RefreshRate }[] = [
  { label: '5s', value: 5000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
  { label: '1m', value: 60000 },
];

// --- Tooltip definitions for each panel (STEP 3) ---
const PANEL_TOOLTIPS = {
  healthScore: {
    tip: 'Composite health score (0-100) calculated from latency, queue depth, errors, and risk signals.',
    danger: 'Below 70 means degraded; below 50 is critical — investigate immediately.',
  },
  ordersPerSec: {
    tip: 'Current throughput of incoming spot orders per second from the matching engine.',
    danger: 'A sudden drop >40% may indicate engine stall or network issues.',
  },
  latencyP50: {
    tip: 'Median (P50) order execution latency. This is what half of all orders experience.',
    danger: '>100ms may cause slippage; users will notice delays.',
  },
  latencyP99: {
    tip: '99th percentile latency — worst-case execution time for 1 in 100 orders.',
    danger: '>1000ms can trigger timeouts and failed fills.',
  },
  apiLatency: {
    tip: 'Average response time of HTTP API endpoints.',
    danger: '>500ms degrades UX severely. Check DB pool saturation or slow queries.',
  },
  wsConns: {
    tip: 'Total active WebSocket connections streaming live data to users.',
    danger: 'Zero connections may indicate WS server crash.',
  },
  memory: {
    tip: 'Heap memory used by the Node.js backend process.',
    danger: '>1GB risks OOM kills. >768MB triggers GC pressure warnings.',
  },
  volume24h: {
    tip: 'Aggregate trading volume across all spot pairs in the last 24 hours.',
    danger: 'Sudden 2x spike may indicate wash trading or unusual market activity.',
  },
  totalUsers: {
    tip: 'Total registered users on the platform.',
  },
  revenue7d: {
    tip: 'Total fee revenue collected in the last 7 days across all trading pairs.',
  },
  pendingWithdrawals: {
    tip: 'Withdrawals awaiting admin approval or blockchain confirmation.',
    danger: '>100 pending may indicate processing bottleneck or chain congestion.',
  },
  systemHealth: {
    tip: 'Real-time status of core infrastructure — database, Redis, WebSocket, and settlement.',
    danger: 'Any component in degraded/down state directly impacts trading.',
  },
  riskSecurity: {
    tip: 'AML compliance alerts, security incidents, and account lockouts.',
    danger: 'Any open AML alert requires immediate review per regulatory compliance.',
  },
  p2pMarkets: {
    tip: 'P2P trading activity, dispute status, and market pair configuration.',
  },
  apiPerformance: {
    tip: 'Overview of API throughput, error rates, and infrastructure latency.',
    danger: 'Error rate >5% signals systemic issues needing urgent investigation.',
  },
} as const;

function useToken() {
  return useAdminAuthStore((s) => s.accessToken);
}

function resolveStatus(value: number | undefined, warnAt: number, critAt: number): PanelStatus {
  if (value === undefined) return 'normal';
  if (value >= critAt) return 'critical';
  if (value >= warnAt) return 'warning';
  return 'normal';
}

function resolveServiceStatus(s?: string): 'healthy' | 'degraded' | 'down' | 'unknown' {
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if (lower === 'healthy' || lower === 'ok' || lower === 'connected') return 'healthy';
  if (lower === 'degraded' || lower === 'slow') return 'degraded';
  if (lower === 'down' || lower === 'error' || lower === 'disconnected') return 'down';
  return 'unknown';
}

function healthScoreStatus(score: number): PanelStatus {
  if (score >= 90) return 'normal';
  if (score >= 70) return 'warning';
  return 'critical';
}

// --- STEP 9: Keep last known data on API failure ---
function useResilientQuery<T>(options: Parameters<typeof useQuery<T>>[0]) {
  const lastGoodRef = useRef<T | undefined>(undefined);
  const result = useQuery<T>(options);

  if (result.data !== undefined) {
    lastGoodRef.current = result.data;
  }

  return {
    ...result,
    data: result.data ?? lastGoodRef.current,
    isStale: result.isError && lastGoodRef.current !== undefined,
  };
}

// --- STEP 5: Panel priority scoring ---
interface PriorityPanel {
  id: string;
  status: PanelStatus;
  score: number;
}

function computePriority(status: PanelStatus, alertCount: number): number {
  let base = status === 'critical' ? 100 : status === 'warning' ? 50 : 0;
  base += alertCount * 10;
  return base;
}

function DashboardV2Inner() {
  const token = useToken();
  const queryClient = useQueryClient();
  const addAlerts = useAdminAlertStore((s) => s.addAlerts);
  const storeAlertCount = useAdminAlertStore((s) => s.unreadCount);
  const storeAlerts = useAdminAlertStore((s) => s.alerts);
  const detectAnomaly = useAnomalyDetector();
  const detectIncident = useIncidentDetector();
  const trendAnalyzer = useTrendAnalyzer();
  const predictiveLinker = usePredictiveIncidentLinker();
  useAuditIntegration();

  const [globalRefresh, setGlobalRefresh] = useState<RefreshRate>(15000);
  const [incidentSuggestion, setIncidentSuggestion] = useState<IncidentSuggestion | null>(null);
  const [refreshDropdownOpen, setRefreshDropdownOpen] = useState(false);
  const [trendPredictions, setTrendPredictions] = useState<TrendPrediction[]>([]);
  const aiSuggestions = useSuggestionEngine(trendPredictions);

  // --- STEP 6: Highlighted panel from alert ---
  const [highlightedPanelId, setHighlightedPanelId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightPanel = useCallback((panelId: string) => {
    setHighlightedPanelId(panelId);
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedPanelId(null), 4000);
    const el = document.getElementById(panelId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    if (storeAlerts.length === 0) return;
    const latest = storeAlerts[0];
    if (!latest) return;
    const target = latest.navTarget ?? '';
    if (target.includes('system-health')) highlightPanel('panel-system-health');
    else if (target.includes('compliance') || target.includes('aml')) highlightPanel('panel-risk');
    else if (target.includes('api-monitoring')) highlightPanel('panel-api');
    else if (target.includes('withdrawal')) highlightPanel('panel-withdrawals');
  }, [storeAlerts, highlightPanel]);

  // --- Resilient queries (STEP 9) ---
  const { data: statsRes, isLoading: statsLoading, isError: statsError, isStale: statsStale } = useResilientQuery({
    queryKey: ['admin', 'v2-dashboard-stats', token],
    queryFn: () => getDashboardStats(token),
    enabled: !!token,
    refetchInterval: globalRefresh,
    staleTime: 5000,
  });

  const { data: analyticsRes, isError: analyticsError, isStale: analyticsStale } = useResilientQuery({
    queryKey: ['admin', 'v2-analytics-all', '24h', token],
    queryFn: () => getAnalyticsAll(token, '24h'),
    enabled: !!token,
    refetchInterval: globalRefresh,
    staleTime: 5000,
  });

  const { data: revenueRes } = useResilientQuery({
    queryKey: ['admin', 'v2-revenue', '7d', token],
    queryFn: () => getRevenue(token, '7d'),
    enabled: !!token,
    refetchInterval: Math.max(globalRefresh, 30000),
    staleTime: 10000,
  });

  const { data: volumeRes } = useResilientQuery({
    queryKey: ['admin', 'v2-trading-volume', '7d', token],
    queryFn: () => getTradingVolume(token, '7d'),
    enabled: !!token,
    refetchInterval: globalRefresh,
    staleTime: 5000,
  });

  const { data: liquidityRes } = useResilientQuery({
    queryKey: ['admin', 'v2-liquidity', '24h', token],
    queryFn: () => getLiquidity(token, '24h'),
    enabled: !!token,
    refetchInterval: Math.max(globalRefresh, 30000),
    staleTime: 10000,
  });

  const { data: healthRes, isError: healthError, isStale: healthStale } = useResilientQuery({
    queryKey: ['admin', 'v2-system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token,
    refetchInterval: Math.min(globalRefresh, 10000),
    staleTime: 3000,
  });

  const { data: controlRes, isError: controlError, isStale: controlStale } = useResilientQuery({
    queryKey: ['admin', 'v2-control-overview', token],
    queryFn: () => getControlOverview(token),
    enabled: !!token,
    refetchInterval: Math.min(globalRefresh, 10000),
    staleTime: 3000,
  });

  const { data: apiMetricsRes, isError: apiError, isStale: apiStale } = useResilientQuery({
    queryKey: ['admin', 'v2-api-metrics', token],
    queryFn: () => getApiMetrics(token),
    enabled: !!token,
    refetchInterval: globalRefresh,
    staleTime: 5000,
  });

  const { data: withdrawRes } = useResilientQuery({
    queryKey: ['admin', 'v2-withdrawals', token],
    queryFn: () => getWithdrawals(token, { limit: 1 }),
    enabled: !!token,
    refetchInterval: Math.max(globalRefresh, 30000),
    staleTime: 10000,
  });

  const { data: amlRes, isError: amlError, isStale: amlStale } = useResilientQuery({
    queryKey: ['admin', 'v2-aml', token],
    queryFn: () => getAmlDashboard(token),
    enabled: !!token,
    refetchInterval: Math.max(globalRefresh, 30000),
    staleTime: 15000,
  });

  const { data: securityRes, isError: securityError } = useResilientQuery({
    queryKey: ['admin', 'v2-security', token],
    queryFn: () => getSecurityDashboard(token),
    enabled: !!token,
    refetchInterval: Math.max(globalRefresh, 30000),
    staleTime: 15000,
  });

  // Derived data
  const stats = statsRes?.data;
  const analytics = analyticsRes?.data;
  const health = healthRes?.data;
  const control = controlRes?.data;
  const apiMetrics = apiMetricsRes?.data;
  const aml = amlRes?.data;
  const security = securityRes?.data;

  const volume24h = Number(analytics?.tradingVolume ?? 0);
  const totalUsers = stats?.users?.total ?? 0;
  const revenueBuckets = useMemo(
    () => (revenueRes?.data?.buckets ?? []) as Array<{ bucket?: string; revenue?: number }>,
    [revenueRes]
  );
  const revenue7d = useMemo(
    () => revenueBuckets.reduce((a, b) => a + Number(b.revenue ?? 0), 0),
    [revenueBuckets]
  );
  const volumeBuckets = useMemo(
    () => (volumeRes?.data?.buckets ?? []) as Array<{ date?: string; volume?: number }>,
    [volumeRes]
  );
  const pendingWithdrawals = (withdrawRes?.data?.stats as { pending_approval?: number })?.pending_approval ?? 0;

  const ordersPerSec = control?.spotMetrics?.ordersPerSecond ?? 0;
  const p50Latency = control?.spotMetrics?.orderLatencyP50Ms ?? 0;
  const p99Latency = control?.spotMetrics?.orderLatencyP99Ms ?? 0;

  const dbLatency = health?.database?.latency_ms ?? 0;
  const redisLatency = health?.redis?.latency_ms ?? 0;
  const apiLatency = health?.api_latency_ms ?? 0;
  const wsConnections = health?.websocket?.connections ?? 0;
  const memoryMb = health?.node?.memory_heap_mb ?? 0;
  const uptime = health?.node?.uptime_sec ?? 0;
  const settlementPending = health?.queue?.settlement_pending ?? control?.settlementPending ?? 0;
  const withdrawalQueueTotal = health?.queue?.total_withdrawal_queue ?? pendingWithdrawals;

  const apiErrorRate = useMemo(() => {
    const metrics = apiMetricsRes?.data?.metrics as Array<{ name?: string; value?: number }> | undefined;
    if (!metrics) return 0;
    const errorMetric = metrics.find((m) => m.name === 'http_errors_total' || m.name === 'api_error_rate');
    return Number(errorMetric?.value ?? 0);
  }, [apiMetricsRes]);

  const exchangeMetrics = useMemo<ExchangeMetrics>(() => ({
    engineLatencyMs: p50Latency,
    p99LatencyMs: p99Latency ?? 0,
    apiLatencyMs: apiLatency,
    apiErrorRate,
    withdrawalQueue: withdrawalQueueTotal,
    settlementPending,
    amlAlertsOpen: aml?.alertsOpen ?? 0,
    amlHighSeverity: aml?.alertsOpenHighSeverity ?? 0,
    failedLogins24h: security?.accounts?.loginFailedLast24h ?? 0,
    lockedAccounts: security?.accounts?.usersCurrentlyLocked ?? 0,
    tradingHalted: control?.tradingHalted ?? false,
    dbLatencyMs: dbLatency,
    redisLatencyMs: redisLatency,
    memoryMb,
    wsConnections,
  }), [p50Latency, p99Latency, apiLatency, apiErrorRate, withdrawalQueueTotal, settlementPending,
    aml, security, control, dbLatency, redisLatency, memoryMb, wsConnections]);

  // --- STEP 1: Anomaly detection using delta from useRef ---
  const orderAnomaly = useMemo(() => detectAnomaly('orders-sec', ordersPerSec), [detectAnomaly, ordersPerSec]);
  const latencyAnomaly = useMemo(() => detectAnomaly('latency-p50', p50Latency), [detectAnomaly, p50Latency]);
  const volumeAnomaly = useMemo(() => detectAnomaly('volume-24h', volume24h), [detectAnomaly, volume24h]);
  const apiLatencyAnomaly = useMemo(() => detectAnomaly('api-latency', apiLatency), [detectAnomaly, apiLatency]);

  const addPredictiveAlerts = useAdminAlertStore((s) => s.addPredictiveAlerts);
  const activeIncidentId = useAdminIncidentStore((s) => s.activeIncident?.id ?? null);

  // Run alert engine + incident detector + predictive ops
  useEffect(() => {
    if (!health && !control) return;
    const alerts = evaluateAlerts(exchangeMetrics);
    if (alerts.length > 0) {
      addAlerts(alerts);

      if (ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_MANAGEMENT) {
        const suggestion = detectIncident(alerts);
        if (suggestion.shouldTriggerIncident) {
          setIncidentSuggestion(suggestion);
        }
      }
    }

    // Predictive Ops Layer (gated behind ADMIN_AI_OPS)
    if (ADMIN_FEATURE_FLAGS.ADMIN_AI_OPS) {
      trendAnalyzer.record('latency', exchangeMetrics.engineLatencyMs);
      trendAnalyzer.record('volume', volume24h);
      trendAnalyzer.record('errorRate', exchangeMetrics.apiErrorRate);
      trendAnalyzer.record('withdrawalQueue', exchangeMetrics.withdrawalQueue);
      trendAnalyzer.record('memory', exchangeMetrics.memoryMb);

      const predictions = trendAnalyzer.analyze();
      setTrendPredictions(predictions);

      if (predictions.length > 0) {
        const predictiveAlertsList = trendPredictionsToAlerts(predictions);
        addPredictiveAlerts(predictiveAlertsList);
        predictiveLinker.trackPredictions(predictions);
      }

      if (alerts.length > 0) {
        predictiveLinker.checkRealAlerts(alerts, activeIncidentId);
      }
    }
  }, [exchangeMetrics, health, control, addAlerts, detectIncident,
    trendAnalyzer, addPredictiveAlerts, predictiveLinker, activeIncidentId, volume24h]);

  const healthScore = useMemo(() => computeHealthScore(exchangeMetrics), [exchangeMetrics]);

  const systemStatus = useMemo(() => ({
    engine: resolveServiceStatus(
      health?.database?.status === 'healthy' && health?.redis?.status === 'healthy' ? 'healthy' : 'degraded'
    ),
    trading: control?.tradingHalted ? 'down' as const : 'healthy' as const,
    settlement: settlementPending > 100 ? 'degraded' as const : 'healthy' as const,
  }), [health, control, settlementPending]);

  const volumeTimeSeries = useMemo(() =>
    volumeBuckets.map((b) => ({
      time: (b.date ?? '').slice(5, 10) || '—',
      value: Number(b.volume ?? 0),
    })),
    [volumeBuckets]
  );

  const revenueTimeSeries = useMemo(() =>
    revenueBuckets.map((b) => ({
      time: (b.bucket ?? '').slice(5, 10) || '—',
      value: Number(b.revenue ?? 0),
    })),
    [revenueBuckets]
  );

  const volumeSparkline = useMemo(() => volumeBuckets.map((b) => Number(b.volume ?? 0)), [volumeBuckets]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[1] as string)?.startsWith?.('v2-') ?? false });
  }, [queryClient]);

  // --- STEP 5: Priority-based ordering for Row 3 panels ---
  const row3Panels = useMemo<PriorityPanel[]>(() => {
    const healthStatus = resolveStatus(dbLatency, 100, 500);
    const riskStatus: PanelStatus = (aml?.alertsOpen ?? 0) > 0 ? 'warning' : 'normal';
    const p2pStatus: PanelStatus = (stats?.p2p?.openDisputes ?? 0) > 0 ? 'warning' : 'normal';

    return [
      { id: 'system-health', status: healthStatus, score: computePriority(healthStatus, 0) },
      { id: 'risk', status: riskStatus, score: computePriority(riskStatus, aml?.alertsOpen ?? 0) },
      { id: 'p2p', status: p2pStatus, score: computePriority(p2pStatus, stats?.p2p?.openDisputes ?? 0) },
    ].sort((a, b) => b.score - a.score);
  }, [dbLatency, aml, stats]);

  // --- STEP 7: Heatmap data ---
  const heatmapData = useMemo(() => ({
    trades: ordersPerSec,
    withdrawals: withdrawalQueueTotal,
    alerts: storeAlertCount,
  }), [ordersPerSec, withdrawalQueueTotal, storeAlertCount]);

  const initialLoad = statsLoading && !stats;

  // --- Row 3 panel renderer (sorted by priority) ---
  const renderRow3Panel = useCallback((panelDef: PriorityPanel) => {
    switch (panelDef.id) {
      case 'system-health':
        return (
          <Panel key="system-health" title="System Health"
            panelId="panel-system-health"
            status={resolveStatus(dbLatency, 100, 500)}
            headerRight={<Activity className="w-4 h-4 text-blue-400" />}
            href="/admin/system-health"
            error={healthError && !healthStale}
            staleWarning={healthStale}
            highlighted={highlightedPanelId === 'panel-system-health'}
            tooltip={PANEL_TOOLTIPS.systemHealth.tip}
            tooltipDanger={PANEL_TOOLTIPS.systemHealth.danger}
          >
            <div className="space-y-2.5 mt-2">
              <HealthRow label="Database" latency={dbLatency} status={health?.database?.status} />
              <HealthRow label="Redis" latency={redisLatency} status={health?.redis?.status} />
              <HealthRow label="WebSocket" extra={`${wsConnections} conns`} status={health?.websocket?.status} />
              <HealthRow label="Uptime" extra={formatUptime(uptime)} status="healthy" />
              <HealthRow label="Settlement" extra={`${settlementPending} pending`} status={settlementPending > 50 ? 'degraded' : 'healthy'} />
            </div>
          </Panel>
        );
      case 'risk':
        return (
          <Panel key="risk" title="Risk & Security"
            panelId="panel-risk"
            status={(aml?.alertsOpen ?? 0) > 5 ? 'warning' : (aml?.alertsOpen ?? 0) > 0 ? 'warning' : 'normal'}
            headerRight={<Shield className="w-4 h-4 text-red-400" />}
            href="/admin/compliance/alerts"
            error={(amlError || securityError) && !amlStale}
            staleWarning={amlStale}
            highlighted={highlightedPanelId === 'panel-risk'}
            tooltip={PANEL_TOOLTIPS.riskSecurity.tip}
            tooltipDanger={PANEL_TOOLTIPS.riskSecurity.danger}
          >
            <div className="space-y-2.5 mt-2">
              <MetricRow label="Open AML Alerts" value={aml?.alertsOpen ?? 0} warn={(aml?.alertsOpen ?? 0) > 0} />
              <MetricRow label="High Severity" value={aml?.alertsOpenHighSeverity ?? 0} warn={(aml?.alertsOpenHighSeverity ?? 0) > 0} />
              <MetricRow label="Security Blocks (24h)" value={security?.risk?.blocksLast24h ?? 0} />
              <MetricRow label="Failed Logins (24h)" value={security?.accounts?.loginFailedLast24h ?? 0} warn={(security?.accounts?.loginFailedLast24h ?? 0) > 50} />
              <MetricRow label="Locked Accounts" value={security?.accounts?.usersCurrentlyLocked ?? 0} />
            </div>
          </Panel>
        );
      case 'p2p':
        return (
          <Panel key="p2p" title="P2P & Markets"
            panelId="panel-p2p"
            headerRight={<ArrowLeftRight className="w-4 h-4 text-violet-400" />}
            href="/admin/p2p"
            error={controlError && !controlStale}
            staleWarning={controlStale}
            highlighted={highlightedPanelId === 'panel-p2p'}
            tooltip={PANEL_TOOLTIPS.p2pMarkets.tip}
          >
            <div className="space-y-2.5 mt-2">
              <MetricRow label="Active P2P Ads" value={stats?.p2p?.activeAds ?? 0} />
              <MetricRow label="Active P2P Orders" value={stats?.p2p?.activeOrders ?? 0} />
              <MetricRow label="Open Disputes" value={stats?.p2p?.openDisputes ?? 0} warn={(stats?.p2p?.openDisputes ?? 0) > 0} />
              <MetricRow label="Active Markets" value={control?.markets?.active ?? 0} />
              <MetricRow label="Trading Halted" value={control?.tradingHalted ? 'YES' : 'No'} warn={control?.tradingHalted} />
            </div>
          </Panel>
        );
      default:
        return null;
    }
  }, [dbLatency, redisLatency, wsConnections, uptime, settlementPending, health, healthError, healthStale,
    aml, security, amlError, securityError, amlStale, stats, control, controlError, controlStale,
    highlightedPanelId]);

  return (
    <div className="min-h-screen bg-[#0F1117] text-[#E5E7EB]">
      {/* STEP 4: Command Palette (press "/" to open) */}
      <CommandPalette />

      <div className="flex">
        {/* Main content */}
        <div className="flex-1 min-w-0 p-6 space-y-5">
          {/* Header with auto-refresh control + heatmap */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-400" />
                Intelligent Control Center
              </h1>
              <div className="flex items-center gap-4 mt-1">
                <p className="text-sm text-zinc-500">Real-time exchange monitoring &amp; operations</p>
                <HeatmapIndicator {...heatmapData} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM && <ActiveAdminsIndicator />}
              {/* "/" hotkey hint */}
              <div className="hidden md:flex items-center gap-1.5 text-[10px] text-zinc-600 border border-[#1F2937] rounded-md px-2 py-1">
                <kbd className="bg-[#0F1117] border border-[#1F2937] rounded px-1 text-zinc-500">/</kbd>
                <span>Command</span>
              </div>
              {/* Auto-refresh dropdown */}
              <div className="relative">
                <button onClick={() => setRefreshDropdownOpen((s) => !s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 border border-[#1F2937] rounded-lg hover:bg-white/5 transition-colors">
                  <Timer className="w-3.5 h-3.5" />
                  {REFRESH_OPTIONS.find((o) => o.value === globalRefresh)?.label}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {refreshDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setRefreshDropdownOpen(false)} />
                    <div className="absolute right-0 mt-1 z-20 bg-[#151922] border border-[#1F2937] rounded-lg shadow-xl py-1 min-w-[80px]">
                      {REFRESH_OPTIONS.map((opt) => (
                        <button key={opt.value} onClick={() => { setGlobalRefresh(opt.value); setRefreshDropdownOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                            globalRefresh === opt.value ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-400 hover:bg-white/5'
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button onClick={handleRefresh}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-400 border border-[#1F2937] rounded-lg hover:bg-white/5 hover:text-zinc-300 transition-colors active:scale-95">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
          </div>

          {/* Incident Banner — shows when an active incident exists */}
          {ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_MANAGEMENT && <IncidentBanner />}

          {/* Control Bar */}
          {initialLoad ? <ControlBarSkeleton /> : (
            <ControlBar systemStatus={systemStatus} alertCount={storeAlertCount} />
          )}

          {/* Row 0 — Health Score + Engine Stats (with anomaly + tooltips + trends) */}
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
            {initialLoad ? Array.from({ length: 7 }).map((_, i) => <PanelSkeleton key={i} />) : (
              <>
                <StatPanel
                  title="System Health"
                  value={healthScore}
                  unit="/100"
                  status={healthScoreStatus(healthScore)}
                  sparkline={[healthScore * 0.95, healthScore * 0.98, healthScore, healthScore * 1.01, healthScore]}
                  trend={{
                    direction: healthScore >= 90 ? 'up' : healthScore >= 70 ? 'flat' : 'down',
                    label: healthScore >= 90 ? 'Healthy' : healthScore >= 70 ? 'Degraded' : 'Critical',
                  }}
                  tooltip={PANEL_TOOLTIPS.healthScore.tip}
                  tooltipDanger={PANEL_TOOLTIPS.healthScore.danger}
                />
                <StatPanel title="Orders/sec" value={ordersPerSec}
                  status={resolveStatus(ordersPerSec, 0, 0)}
                  anomaly={orderAnomaly}
                  percentChange={orderAnomaly.deltaPercent}
                  tooltip={PANEL_TOOLTIPS.ordersPerSec.tip}
                  tooltipDanger={PANEL_TOOLTIPS.ordersPerSec.danger}
                />
                <StatPanel title="Latency P50" value={p50Latency} unit="ms"
                  status={resolveStatus(p50Latency, 50, 100)}
                  sparkline={[p50Latency * 0.85, p50Latency * 0.9, p50Latency, p50Latency * 1.05, p50Latency * 0.95]}
                  anomaly={latencyAnomaly}
                  percentChange={latencyAnomaly.deltaPercent}
                  tooltip={PANEL_TOOLTIPS.latencyP50.tip}
                  tooltipDanger={PANEL_TOOLTIPS.latencyP50.danger}
                />
                <StatPanel title="Latency P99" value={p99Latency ?? '—'} unit="ms"
                  status={resolveStatus(p99Latency ?? 0, 200, 1000)}
                  tooltip={PANEL_TOOLTIPS.latencyP99.tip}
                  tooltipDanger={PANEL_TOOLTIPS.latencyP99.danger}
                />
                <StatPanel title="API Latency" value={apiLatency} unit="ms"
                  status={resolveStatus(apiLatency, 100, 500)}
                  anomaly={apiLatencyAnomaly}
                  percentChange={apiLatencyAnomaly.deltaPercent}
                  staleWarning={apiStale}
                  tooltip={PANEL_TOOLTIPS.apiLatency.tip}
                  tooltipDanger={PANEL_TOOLTIPS.apiLatency.danger}
                />
                <StatPanel title="WS Conns" value={wsConnections} status="normal"
                  tooltip={PANEL_TOOLTIPS.wsConns.tip}
                  tooltipDanger={PANEL_TOOLTIPS.wsConns.danger}
                />
                <StatPanel title="Memory" value={memoryMb.toFixed(0)} unit="MB"
                  status={resolveStatus(memoryMb, 512, 1024)}
                  tooltip={PANEL_TOOLTIPS.memory.tip}
                  tooltipDanger={PANEL_TOOLTIPS.memory.danger}
                />
              </>
            )}
          </section>

          {/* Row 1 — KPI Panels with tooltips + anomaly detection */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {initialLoad ? Array.from({ length: 4 }).map((_, i) => <PanelSkeleton key={i} />) : (
              <>
                <Panel title="Trading Volume (24h)"
                  panelId="panel-volume"
                  value={volume24h > 0 ? `$${volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                  trend={volumeSparkline.length > 1 ? { direction: volumeSparkline[volumeSparkline.length - 1]! >= volumeSparkline[0]! ? 'up' : 'down', label: '7d' } : undefined}
                  headerRight={<TrendingUp className="w-4 h-4 text-blue-400" />}
                  href="/admin/reports"
                  error={analyticsError && !analyticsStale}
                  staleWarning={analyticsStale}
                  empty={!analyticsError && volume24h === 0 && !analyticsRes}
                  tooltip={PANEL_TOOLTIPS.volume24h.tip}
                  tooltipDanger={PANEL_TOOLTIPS.volume24h.danger}
                  highlighted={highlightedPanelId === 'panel-volume'}
                />
                <Panel title="Total Users" value={totalUsers.toLocaleString()}
                  panelId="panel-users"
                  trend={{ direction: 'up', label: `${stats?.users?.newToday ?? 0} today` }}
                  headerRight={<Users className="w-4 h-4 text-cyan-400" />}
                  href="/admin/users"
                  error={statsError && !statsStale}
                  staleWarning={statsStale}
                  tooltip={PANEL_TOOLTIPS.totalUsers.tip}
                />
                <Panel title="Revenue (7d)"
                  panelId="panel-revenue"
                  value={revenue7d > 0 ? `$${revenue7d.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                  headerRight={<DollarSign className="w-4 h-4 text-emerald-400" />}
                  href="/admin/reports/financial"
                  empty={revenue7d === 0 && !revenueRes}
                  tooltip={PANEL_TOOLTIPS.revenue7d.tip}
                />
                <Panel title="Pending Withdrawals" value={pendingWithdrawals}
                  panelId="panel-withdrawals"
                  status={pendingWithdrawals > 10 ? 'warning' : 'normal'}
                  headerRight={<Wallet className="w-4 h-4 text-amber-400" />}
                  href="/admin/withdrawals?status=pending_approval"
                  tooltip={PANEL_TOOLTIPS.pendingWithdrawals.tip}
                  tooltipDanger={PANEL_TOOLTIPS.pendingWithdrawals.danger}
                  highlighted={highlightedPanelId === 'panel-withdrawals'}
                />
              </>
            )}
          </section>

          {/* Row 2 — Time Series Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {initialLoad ? (<><ChartSkeleton /><ChartSkeleton /></>) : (
              <>
                <TimeSeriesPanel
                  title="Trading Volume"
                  data={volumeTimeSeries}
                  color="#3b82f6"
                  unit=" USD"
                  onTimeRangeChange={() => {}}
                  onRefresh={() => queryClient.invalidateQueries({ queryKey: ['admin', 'v2-trading-volume'] })}
                />
                <TimeSeriesPanel
                  title="Revenue"
                  data={revenueTimeSeries}
                  color="#10b981"
                  unit=" USD"
                  onRefresh={() => queryClient.invalidateQueries({ queryKey: ['admin', 'v2-revenue'] })}
                />
              </>
            )}
          </section>

          {/* Predictive Ops — System Forecast Panel */}
          {ADMIN_FEATURE_FLAGS.ADMIN_AI_OPS && (
            <section>
              <SystemForecastPanel predictions={trendPredictions} suggestions={aiSuggestions} />
            </section>
          )}

          {/* Row 3 — System Health + Risk + P2P (STEP 5: priority sorted) */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialLoad
              ? Array.from({ length: 3 }).map((_, i) => <PanelSkeleton key={i} />)
              : row3Panels.map(renderRow3Panel)
            }
          </section>

          {/* Row 4 — API Performance (with drill-down + tooltip) */}
          <section>
            <Panel title="API Performance"
              panelId="panel-api"
              headerRight={<Zap className="w-4 h-4 text-yellow-400" />}
              href="/admin/api-monitoring"
              error={apiError && !apiStale}
              staleWarning={apiStale}
              tooltip={PANEL_TOOLTIPS.apiPerformance.tip}
              tooltipDanger={PANEL_TOOLTIPS.apiPerformance.danger}
              highlighted={highlightedPanelId === 'panel-api'}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                <MiniStat label="Spot Orders Total" value={apiMetrics?.spotOrdersTotal ?? '—'} />
                <MiniStat label="Spot Trades Total" value={apiMetrics?.spotTradesTotal ?? '—'} />
                <MiniStat label="DB Latency" value={`${dbLatency}ms`} />
                <MiniStat label="Redis Latency" value={`${redisLatency}ms`} />
              </div>
            </Panel>
          </section>

          {/* Row 5 — Production Hardening (Reliability + Timeline + Session) */}
          {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ReliabilityScore errorRate={apiErrorRate} />
              <div className="lg:col-span-2">
                <TimelineView maxEvents={20} />
              </div>
            </section>
          )}

          {ADMIN_FEATURE_FLAGS.ADMIN_PRODUCTION_HARDENING && (
            <section>
              <SessionActivity />
            </section>
          )}
        </div>

        {/* Right sidebar — Activity Feed */}
        <div className="hidden xl:block w-80 border-l border-[#1F2937] bg-[#0F1117]">
          <div className="sticky top-0 h-screen overflow-hidden">
            {initialLoad ? <ActivitySkeleton /> : <ActivityFeed />}
          </div>
        </div>
      </div>

      {/* Alert Drawer */}
      <AlertDrawer />

      {/* Incident Prompt — modal suggestion when critical alert burst detected */}
      {ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_MANAGEMENT && (
        <IncidentPrompt
          suggestion={incidentSuggestion}
          onDismiss={() => setIncidentSuggestion(null)}
        />
      )}
    </div>
  );
}

export const DashboardV2 = memo(DashboardV2Inner);

// --- Sub-components (memoized) ---

const HealthRow = memo(function HealthRow({ label, latency, extra, status }: {
  label: string; latency?: number; extra?: string; status?: string;
}) {
  const s = status?.toLowerCase();
  const isOk = s === 'healthy' || s === 'ok' || s === 'connected';
  const isWarn = s === 'degraded' || s === 'slow';
  const dotClass = isOk ? 'bg-emerald-400' : isWarn ? 'bg-amber-400'
    : s === 'down' || s === 'error' ? 'bg-red-400' : 'bg-zinc-600';

  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="text-zinc-400">{label}</span>
      </div>
      <span className="text-zinc-300 tabular-nums">
        {latency !== undefined ? `${latency}ms` : extra ?? '—'}
      </span>
    </div>
  );
});

const MetricRow = memo(function MetricRow({ label, value, warn }: {
  label: string; value: string | number; warn?: boolean | number;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className={`tabular-nums font-medium ${warn ? 'text-amber-400' : 'text-zinc-300'}`}>{value}</span>
    </div>
  );
});

const MiniStat = memo(function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="group transition-transform duration-150 hover:scale-105">
      <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">{label}</p>
      <p className="text-lg font-semibold text-[#E5E7EB] tabular-nums">{value}</p>
    </div>
  );
});

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
