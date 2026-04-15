'use client';

import { useState, useMemo, memo, useCallback } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMonitoringHealth, getMonitoringRpcProviders, getMonitoringQueues,
  getMonitoringResources, getMonitoringAlerts, getMonitoringHistory,
  getMonitoringIncidents, getMonitoringWorkers, getMonitoringTimeline,
  triggerMonitoringAction, updateRpcProviderPriority,
  type RpcProviderRow, type InfrastructureAlertRow, type IncidentRow,
  type WorkerRow, type TimelineEventRow,
} from '@/lib/monitoring-api';
import { getSystemHealth } from '@/lib/api';
import { computeHealthScore, type ExchangeMetrics } from '@/components/admin-v2/alert-engine';
import { useAnomalyDetector } from '@/components/admin-v2/useAnomalyDetector';
import { SmartTooltip } from '@/components/admin-v2/SmartTooltip';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { InfrastructureControlModal, type InfrastructureAction } from '@/components/monitoring/InfrastructureControlModal';
import { RpcPriorityModal } from '@/components/monitoring/RpcPriorityModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Activity, Server, Radio, Boxes, Cpu,
  PlayCircle, Cog, Pencil, RefreshCw, Timer, ChevronDown, Info,
  Shield, Zap, Gauge, Globe, AlertTriangle, ArrowRight, Clock, LayoutGrid,
  Inbox, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { TableSkeleton } from '@/components/ui';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

type MonitoringTab = 'overview' | 'history';
type RefreshRate = 5000 | 10000 | 15000 | 30000;

const REFRESH_OPTIONS: { label: string; value: RefreshRate }[] = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
];

const CHART_GRID = '#1F2A37';
const CHART_TICK = '#9BA7B4';
const CHART_TOOLTIP_BG = '#141A21';
const CHART_TOOLTIP_BORDER = '#2A3441';

function Tip({ content, danger }: { content: string; danger?: string }) {
  return (
    <SmartTooltip content={content} danger={danger}>
      <Info className="h-3 w-3 text-admin-muted/60 cursor-help shrink-0" />
    </SmartTooltip>
  );
}

/** Unified panel chrome — Tier-1 consistent cards */
function MonitorPanel({
  icon: Icon,
  title,
  description,
  iconTint,
  action,
  children,
  className,
  bodyClassName,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  iconTint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn('flex h-full min-h-[200px] flex-col rounded-xl border border-admin-border bg-admin-card overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-2 border-b border-admin-border bg-white/[0.02] px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconTint)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-admin-text leading-tight">{title}</h3>
            {description ? <p className="mt-0.5 text-[11px] text-admin-muted leading-snug">{description}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className={cn('flex flex-1 flex-col p-4', bodyClassName)}>{children}</div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
  href,
  hrefLabel,
}: {
  icon: React.ElementType;
  title: string;
  hint: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.03] border border-admin-border">
        <Icon className="h-5 w-5 text-admin-muted/50" />
      </div>
      <p className="text-xs font-semibold text-admin-text">{title}</p>
      <p className="max-w-[220px] text-[11px] leading-relaxed text-admin-muted">{hint}</p>
      {href && hrefLabel ? (
        <Link
          href={href}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-admin-primary hover:text-admin-primary-hover"
        >
          {hrefLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

export default function MonitoringPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MonitoringTab>('overview');
  const [controlModal, setControlModal] = useState<InfrastructureAction | null>(null);
  const [rpcPriorityModal, setRpcPriorityModal] = useState<RpcProviderRow | null>(null);
  const [alertsPage, setAlertsPage] = useState(1);
  const [refreshRate, setRefreshRate] = useState<RefreshRate>(10000);
  const [refreshDropdownOpen, setRefreshDropdownOpen] = useState(false);
  const detectAnomaly = useAnomalyDetector();

  const { data: healthData } = useQuery({
    queryKey: ['admin', 'monitoring', 'health', token],
    queryFn: () => getMonitoringHealth(token),
    enabled: !!token, refetchInterval: refreshRate, staleTime: 30_000,
  });
  const { data: systemHealthData } = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token, refetchInterval: refreshRate, staleTime: 30_000,
  });
  const { data: rpcData } = useQuery({
    queryKey: ['admin', 'monitoring', 'rpc', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringRpcProviders(token),
    enabled: !!token, refetchInterval: Math.max(refreshRate, 15000),
  });
  const { data: queuesData } = useQuery({
    queryKey: ['admin', 'monitoring', 'queues', token],
    queryFn: () => getMonitoringQueues(token),
    enabled: !!token, refetchInterval: refreshRate, staleTime: 30_000,
  });
  const { data: resourcesData } = useQuery({
    queryKey: ['admin', 'monitoring', 'resources', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringResources(token),
    enabled: !!token, refetchInterval: refreshRate,
  });
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['admin', 'monitoring', 'alerts', token, alertsPage],
    staleTime: 30_000,
    queryFn: () => getMonitoringAlerts(token, { limit: 20, offset: (alertsPage - 1) * 20 }),
    enabled: !!token,
  });
  const { data: historyApi } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'api_latency', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringHistory(token, 'api_latency'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: historyDb } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'db_latency', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringHistory(token, 'db_latency'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: historyRedis } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'redis_latency', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringHistory(token, 'redis_latency'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: historyQueue } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'queue_size', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringHistory(token, 'queue_size'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: incidentsData } = useQuery({
    queryKey: ['admin', 'monitoring', 'incidents', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringIncidents(token, { limit: 20 }),
    enabled: !!token,
  });
  const { data: workersData } = useQuery({
    queryKey: ['admin', 'monitoring', 'workers', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringWorkers(token),
    enabled: !!token,
  });
  const { data: timelineData } = useQuery({
    queryKey: ['admin', 'monitoring', 'timeline', token],
    staleTime: 30_000,
    queryFn: () => getMonitoringTimeline(token, 15),
    enabled: !!token,
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: number }) =>
      updateRpcProviderPriority(token, id, priority),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring', 'rpc'] }); setRpcPriorityModal(null); },
  });

  useAdminWs({
    onEvent: (ev) => {
      const t = (ev?.type as string) ?? '';
      if (['system_alert', 'rpc_timeout', 'queue_overflow', 'node_failure'].includes(t)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] });
      }
    },
  });

  const actionMutation = useMutation({
    mutationFn: (action: string) => triggerMonitoringAction(token, action),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] }); setControlModal(null); },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sys = systemHealthData?.data as Record<string, any> | undefined;
  const health = healthData?.data;
  const rpcProviders = (rpcData?.data?.providers ?? []) as RpcProviderRow[];
  const queues = queuesData?.data;
  const resources = resourcesData?.data;
  const alerts = ((alertsData?.data?.alerts ?? []) as InfrastructureAlertRow[]);
  const alertsTotal = alertsData?.data?.total ?? 0;
  const alertsTotalPages = Math.ceil(alertsTotal / 20) || 1;
  const incidents = (incidentsData?.data?.incidents ?? []) as IncidentRow[];
  const workers = (workersData?.data?.workers ?? []) as WorkerRow[];
  const timelineEvents = (timelineData?.data?.events ?? []) as TimelineEventRow[];

  const apiLatency = health?.api_latency_ms ?? 0;
  const dbLatency = sys?.database?.latency_ms ?? sys?.database?.latencyMs ?? 0;
  const redisLatency = sys?.redis?.latency_ms ?? sys?.redis?.latencyMs ?? 0;
  const wsConns = sys?.websocket?.connections ?? health?.ws_connections ?? 0;
  const memoryMb = sys?.node?.memory_heap_mb ?? 0;
  const uptimeSec = sys?.node?.uptime_sec ?? 0;

  const cpuPct = resources?.cpu_percent ?? null;
  const memPct = resources?.memory_percent ?? null;
  const diskPct = resources?.disk_percent ?? null;

  const apiAnomaly = useMemo(() => detectAnomaly('mon-api-lat', apiLatency), [detectAnomaly, apiLatency]);
  const dbAnomaly = useMemo(() => detectAnomaly('mon-db-lat', dbLatency), [detectAnomaly, dbLatency]);

  const healthScore = useMemo<number>(() => {
    const metrics: ExchangeMetrics = {
      engineLatencyMs: 0, p99LatencyMs: 0, apiLatencyMs: apiLatency,
      apiErrorRate: 0, withdrawalQueue: queues?.withdrawal_pending ?? 0,
      settlementPending: queues?.settlement_pending ?? 0,
      amlAlertsOpen: 0, amlHighSeverity: 0, failedLogins24h: 0, lockedAccounts: 0,
      tradingHalted: false, dbLatencyMs: dbLatency, redisLatencyMs: redisLatency,
      memoryMb, wsConnections: wsConns,
    };
    return computeHealthScore(metrics);
  }, [apiLatency, dbLatency, redisLatency, queues, memoryMb, wsConns]);

  const handleRefreshAll = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => ((q.queryKey[0] as string) === 'admin') });
  }, [queryClient]);

  const handleConfirmAction = () => { if (controlModal) actionMutation.mutate(controlModal); };

  const hasCriticalResource = (cpuPct !== null && cpuPct > 90) || (memPct !== null && memPct > 90);
  const healthLevel = healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'degraded' : 'critical';

  return (
    <AdminPageFrame
      title="System Monitoring"
      description="Live telemetry, SLOs, queues, and safe infrastructure actions."
      quickActions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setRefreshDropdownOpen((s) => !s)}>
              <Timer className="mr-1 h-3.5 w-3.5" />
              {REFRESH_OPTIONS.find((o) => o.value === refreshRate)?.label}
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
            {refreshDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setRefreshDropdownOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 min-w-[88px] rounded-lg border border-admin-border bg-admin-card py-1 shadow-dropdown">
                  {REFRESH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setRefreshRate(opt.value); setRefreshDropdownOpen(false); }}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-xs transition-colors',
                        refreshRate === opt.value ? 'bg-admin-primary/10 text-admin-primary' : 'text-admin-text hover:bg-white/[0.02]',
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRefreshAll}>
            Refresh
          </Button>
          <Link href="/monitoring/alert-rules">
            <Button variant="secondary" size="sm" icon={<Cog className="h-3.5 w-3.5" />}>
              Alert rules
            </Button>
          </Link>
        </div>
      }
    >
      <div className="mx-auto max-w-[1440px] space-y-6">
        {/* Compact severity strip — dark-theme aligned (no light red box) */}
        {hasCriticalResource && (
          <div
            className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent px-4 py-3"
            role="alert"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-300">High resource usage</p>
              <p className="mt-0.5 text-[11px] text-admin-muted">
                {cpuPct !== null && cpuPct > 90 ? <span className="text-red-400/90">CPU {cpuPct}%</span> : null}
                {cpuPct !== null && cpuPct > 90 && memPct !== null && memPct > 90 ? ' · ' : ''}
                {memPct !== null && memPct > 90 ? <span className="text-red-400/90">Memory {memPct}%</span> : null}
                <span className="text-admin-muted"> — scale or investigate workers.</span>
              </p>
            </div>
            <Link href="/operations" className="shrink-0 text-[11px] font-semibold text-admin-primary hover:text-admin-primary-hover">
              Ops triage <ArrowRight className="inline h-3 w-3" />
            </Link>
          </div>
        )}

        {/* Snapshot row — unified dark cards */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-stretch">
          <div
            className={cn(
              'flex min-h-[140px] items-center gap-4 rounded-xl border p-4 ring-1',
              healthLevel === 'healthy' && 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-admin-card ring-emerald-500/10',
              healthLevel === 'degraded' && 'border-amber-500/25 bg-gradient-to-br from-amber-500/8 to-admin-card ring-amber-500/10',
              healthLevel === 'critical' && 'border-red-500/25 bg-gradient-to-br from-red-500/10 to-admin-card ring-red-500/15',
            )}
          >
            <div
              className={cn(
                'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px]',
                healthLevel === 'healthy' && 'border-emerald-500/50 text-emerald-400',
                healthLevel === 'degraded' && 'border-amber-500/50 text-amber-400',
                healthLevel === 'critical' && 'border-red-500/50 text-red-400',
              )}
            >
              <span className="text-xl font-black tabular-nums">{healthScore}</span>
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-admin-muted">
                Health score
                <Tip content="Composite score from infrastructure metrics." danger="Below 70 = degraded. Below 50 = critical." />
              </p>
              <p
                className={cn(
                  'mt-1 text-sm font-bold',
                  healthLevel === 'healthy' && 'text-emerald-400',
                  healthLevel === 'degraded' && 'text-amber-400',
                  healthLevel === 'critical' && 'text-red-400',
                )}
              >
                {healthLevel === 'healthy' ? 'Healthy' : healthLevel === 'degraded' ? 'Degraded' : 'Critical'}
              </p>
            </div>
          </div>

          <div className="flex min-h-[140px] flex-col justify-center rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-admin-muted">Uptime</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-admin-text">{formatUptime(uptimeSec)}</p>
            <p className="mt-1 text-[11px] text-admin-muted">
              <Radio className="mr-1 inline h-3 w-3 align-middle text-admin-primary/80" />
              {wsConns} WebSocket connections
            </p>
          </div>

          <div className="flex min-h-[140px] flex-col justify-center rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-admin-muted">Resources</p>
            <div className="mt-2 space-y-2">
              <ResourceBar label="CPU" value={cpuPct} />
              <ResourceBar label="Memory" value={memPct} />
              <ResourceBar label="Disk" value={diskPct} />
            </div>
          </div>

          <div className="flex min-h-[140px] flex-col justify-center rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-admin-muted">Queues</p>
            <div className="mt-2 space-y-2">
              <QueueRow label="Withdrawals" value={queues?.withdrawal_pending ?? 0} warnAt={50} />
              <QueueRow
                label="Settlement"
                value={queues?.settlement_pending ?? 0}
                warnAt={100}
                highlight={queues?.settlement_delayed}
              />
              <QueueRow label="Matching" value={queues?.matching_engine_pending ?? 0} warnAt={500} />
            </div>
          </div>
        </section>

        {/* SLO / latency strip */}
        <section>
          <div className="mb-2 flex items-center gap-2 pl-0.5">
            <LayoutGrid className="h-3.5 w-3.5 text-admin-muted" />
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-admin-muted">Latency & memory (SLO view)</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <LatencyCard label="API" value={apiLatency} unit="ms" threshold={[200, 500]} anomaly={apiAnomaly} />
            <LatencyCard label="Database" value={dbLatency} unit="ms" threshold={[50, 100]} anomaly={dbAnomaly} />
            <LatencyCard label="Redis" value={redisLatency} unit="ms" threshold={[20, 50]} />
            <LatencyCard label="Heap" value={Math.round(memoryMb)} unit="MB" threshold={[512, 1024]} />
          </div>
        </section>

        {/* Tabs — pill style */}
        <div className="flex flex-wrap items-center gap-2 border-b border-admin-border pb-3">
          {(['overview', 'history'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'rounded-lg px-4 py-2 text-xs font-semibold transition-all',
                activeTab === tab
                  ? 'bg-admin-primary/15 text-admin-primary ring-1 ring-admin-primary/30'
                  : 'text-admin-muted hover:bg-white/[0.03] hover:text-admin-text',
              )}
            >
              {tab === 'overview' ? 'Overview' : 'History charts'}
            </button>
          ))}
        </div>

        {activeTab === 'history' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <HistoryChart title="API latency (24h)" data={historyApi?.data?.points} color="#818CF8" unit="ms" />
            <HistoryChart title="Database latency (24h)" data={historyDb?.data?.points} color="#34D399" unit="ms" />
            <HistoryChart title="Redis latency (24h)" data={historyRedis?.data?.points} color="#FBBF24" unit="ms" />
            <HistoryChart title="Queue size (24h)" data={historyQueue?.data?.points} color="#94A3B8" unit="" />
          </div>
        )}

        {activeTab === 'overview' && (
          <>
            <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
              <MonitorPanel
                icon={Globe}
                title="RPC providers"
                description="Chain RPC health & priority"
                iconTint="bg-sky-500/10 text-sky-400"
                className="min-h-[320px]"
                bodyClassName="!p-0"
              >
                {rpcProviders.length === 0 ? (
                  <EmptyState
                    icon={Globe}
                    title="No RPC providers"
                    hint="Add and prioritize RPC endpoints for reliable chain reads."
                    href="/settings/infrastructure"
                    hrefLabel="Open infrastructure"
                  />
                ) : (
                  <div className="max-h-[280px] flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
                    {rpcProviders.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-admin-border/80 bg-white/[0.02] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-admin-text">{row.provider}</p>
                          <p className="text-[10px] text-admin-muted">
                            {row.network} · {row.latency_ms != null ? `${row.latency_ms} ms` : '—'} · err {row.error_rate ?? 0}%
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge
                            status={row.status}
                            variant={row.status === 'Healthy' ? 'success' : row.status === 'Slow' ? 'warning' : 'default'}
                          />
                          <button
                            type="button"
                            onClick={() => setRpcPriorityModal(row)}
                            className="rounded-md p-1 text-admin-muted hover:bg-white/[0.05] hover:text-admin-text"
                            aria-label="Edit priority"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </MonitorPanel>

              <MonitorPanel
                icon={Server}
                title="Infrastructure control"
                description="Destructive — each action confirms before run"
                iconTint="bg-violet-500/10 text-violet-400"
                className="min-h-[320px]"
              >
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { action: 'restart_worker', icon: PlayCircle, label: 'Restart worker' },
                    { action: 'flush_queue', icon: Boxes, label: 'Flush queue' },
                    { action: 'reset_circuit_breaker', icon: Shield, label: 'Reset breaker' },
                    { action: 'restart_liquidity_bot', icon: Zap, label: 'Liquidity bot' },
                    { action: 'restart_settlement_worker', icon: PlayCircle, label: 'Settlement' },
                    { action: 'restart_matching_engine', icon: Zap, label: 'Matching engine' },
                    { action: 'restart_websocket_service', icon: Radio, label: 'WebSocket' },
                  ].map(({ action, icon: Icon, label }) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => setControlModal(action as InfrastructureAction)}
                      className="flex items-center gap-2 rounded-lg border border-admin-border bg-white/[0.02] px-2.5 py-2 text-left text-[11px] font-medium text-admin-text transition-colors hover:border-admin-primary/30 hover:bg-admin-primary/5"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-admin-muted" />
                      <span className="leading-tight">{label}</span>
                    </button>
                  ))}
                </div>
              </MonitorPanel>

              <MonitorPanel
                icon={Gauge}
                title="Rate limits"
                description="Gateway enforcement (reference)"
                iconTint="bg-amber-500/10 text-amber-400"
                className="min-h-[320px]"
              >
                <div className="space-y-2">
                  {[
                    { label: 'Public API', limit: '100 / min · IP' },
                    { label: 'Authenticated', limit: '300 / min · user' },
                    { label: 'WebSocket', limit: '5 conn · 100 msg/s' },
                    { label: 'Admin API', limit: '200 / min · admin' },
                  ].map(({ label, limit }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-2 rounded-lg border border-admin-border/60 bg-white/[0.02] px-3 py-2"
                    >
                      <span className="text-xs text-admin-text">{label}</span>
                      <span className="text-[10px] font-mono text-admin-muted">{limit}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-auto pt-3 text-[10px] text-admin-muted/70">Tuned in API gateway / edge config.</p>
              </MonitorPanel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
              <MonitorPanel
                icon={Cpu}
                title="Workers"
                description="Background processors"
                iconTint="bg-emerald-500/10 text-emerald-400"
                className="min-h-[280px]"
                bodyClassName="!p-0"
              >
                {workers.length === 0 ? (
                  <EmptyState
                    icon={Cpu}
                    title="No worker telemetry"
                    hint="Worker status appears when the orchestrator reports heartbeats."
                    href="/operations"
                    hrefLabel="Operations"
                  />
                ) : (
                  <div className="max-h-[240px] flex-1 divide-y divide-admin-border/50 overflow-y-auto overscroll-contain">
                    {workers.map((w) => (
                      <div key={w.id} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-white/[0.02]">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-admin-text">{w.worker_name}</p>
                          <p className="text-[10px] text-admin-muted">
                            {formatUptime(w.uptime_seconds)} · {w.last_restart_at ? formatTimeAgo(w.last_restart_at) : '—'}
                          </p>
                        </div>
                        <StatusBadge status={w.status} variant={w.status === 'running' ? 'success' : 'default'} />
                      </div>
                    ))}
                  </div>
                )}
              </MonitorPanel>

              <MonitorPanel
                icon={Clock}
                title="Event timeline"
                description="Recent infra events"
                iconTint="bg-indigo-500/10 text-indigo-400"
                className="min-h-[280px]"
                bodyClassName="!p-0"
              >
                {timelineEvents.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="No recent events"
                    hint="Alerts, deploys, and control actions will show here as they occur."
                    href="/operations"
                    hrefLabel="View operations"
                  />
                ) : (
                  <div className="max-h-[240px] flex-1 space-y-0 overflow-y-auto overscroll-contain px-4 py-2">
                    {timelineEvents.map((ev, i) => (
                      <div key={ev.id} className="relative flex gap-3 pb-3 pl-1 last:pb-0">
                        {i < timelineEvents.length - 1 ? (
                          <span className="absolute left-[5px] top-2 bottom-0 w-px bg-admin-border" aria-hidden />
                        ) : null}
                        <span className="relative z-[1] mt-1 h-2 w-2 shrink-0 rounded-full bg-admin-primary/80" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium capitalize text-admin-text">
                            {ev.event_type.replace(/_/g, ' ')}
                          </p>
                          {ev.message ? (
                            <p className="line-clamp-2 text-[10px] text-admin-muted">{ev.message}</p>
                          ) : null}
                          <p className="mt-0.5 text-[10px] text-admin-muted/70">
                            {ev.created_at ? formatTimeAgo(ev.created_at) : '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </MonitorPanel>

              <MonitorPanel
                icon={Activity}
                title="Incidents"
                description="Active & recent"
                iconTint="bg-red-500/10 text-red-400"
                className="min-h-[280px]"
                bodyClassName="!p-0"
              >
                {incidents.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                      <Sparkles className="h-5 w-5 text-emerald-400" />
                    </div>
                    <p className="text-xs font-semibold text-emerald-400/90">All clear</p>
                    <p className="max-w-[200px] text-center text-[11px] text-admin-muted">No open incidents right now.</p>
                    <Link
                      href="/incidents"
                      className="text-[11px] font-semibold text-admin-primary hover:text-admin-primary-hover"
                    >
                      Incident history <ArrowRight className="inline h-3 w-3" />
                    </Link>
                  </div>
                ) : (
                  <div className="max-h-[240px] flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
                    {incidents.slice(0, 6).map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-admin-border/80 bg-white/[0.02] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-admin-text">{row.service}</p>
                          <p className="text-[10px] text-admin-muted">{row.created_at ? formatTimeAgo(row.created_at) : '—'}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge status={row.severity} variant={row.severity === 'High' ? 'danger' : 'warning'} />
                          <StatusBadge status={row.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </MonitorPanel>
            </div>

            {(alerts.length > 0 || alertsLoading) && (
              <MonitorPanel
                icon={AlertTriangle}
                title="Infrastructure alerts"
                description={`${alertsTotal} total · paginated`}
                iconTint="bg-orange-500/10 text-orange-400"
                bodyClassName="!p-0"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-admin-border bg-white/[0.02] text-[10px] font-bold uppercase tracking-wider text-admin-muted">
                        <th className="px-4 py-2.5">System</th>
                        <th className="px-3 py-2.5">Severity</th>
                        <th className="px-3 py-2.5">Message</th>
                        <th className="px-3 py-2.5">Created</th>
                        <th className="px-3 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alertsLoading ? (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <TableSkeleton rows={3} cols={4} />
                          </td>
                        </tr>
                      ) : (
                        alerts.map((row) => (
                          <tr
                            key={row.id}
                            className="border-b border-admin-border/40 transition-colors last:border-0 hover:bg-white/[0.02]"
                          >
                            <td className="px-4 py-2.5 font-semibold text-admin-text">{row.system}</td>
                            <td className="px-3 py-2.5">
                              <StatusBadge
                                status={row.severity}
                                variant={row.severity === 'High' ? 'danger' : row.severity === 'Medium' ? 'warning' : 'default'}
                              />
                            </td>
                            <td className="max-w-[280px] truncate px-3 py-2.5 text-admin-muted" title={row.message}>
                              {row.message}
                            </td>
                            <td className="px-3 py-2.5 text-admin-muted">{row.created_at ? formatTimeAgo(row.created_at) : '—'}</td>
                            <td className="px-3 py-2.5">
                              <StatusBadge status={row.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {alertsTotalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-admin-border px-4 py-2.5 text-[11px] text-admin-muted">
                    <span>
                      Page {alertsPage} / {alertsTotalPages} ({alertsTotal} total)
                    </span>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" disabled={alertsPage <= 1} onClick={() => setAlertsPage((p) => Math.max(1, p - 1))}>
                        Prev
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={alertsPage >= alertsTotalPages}
                        onClick={() => setAlertsPage((p) => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </MonitorPanel>
            )}
          </>
        )}
      </div>

      <InfrastructureControlModal
        open={!!controlModal}
        action={controlModal}
        onClose={() => setControlModal(null)}
        onConfirm={handleConfirmAction}
        isLoading={actionMutation.isPending}
      />
      <RpcPriorityModal
        open={!!rpcPriorityModal}
        provider={rpcPriorityModal}
        onClose={() => setRpcPriorityModal(null)}
        onSave={(id, priority) => priorityMutation.mutate({ id, priority })}
        isLoading={priorityMutation.isPending}
      />
    </AdminPageFrame>
  );
}

function QueueRow({ label, value, warnAt, highlight }: { label: string; value: number; warnAt: number; highlight?: boolean }) {
  const warn = value > warnAt || highlight;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-admin-muted">{label}</span>
      <span className={cn('font-bold tabular-nums', warn ? 'text-amber-400' : 'text-admin-text')}>{value}</span>
    </div>
  );
}

function ResourceBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const isCrit = v > 90;
  const isWarn = v > 75;
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] text-admin-muted">{label}</span>
        <span
          className={cn(
            'text-[10px] font-bold tabular-nums',
            isCrit ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-admin-text',
          )}
        >
          {value != null ? `${v}%` : '—'}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-admin-border/50">
        <div
          className={cn('h-full rounded-full transition-all', isCrit ? 'bg-red-500' : isWarn ? 'bg-amber-500' : 'bg-emerald-500')}
          style={{ width: `${Math.min(100, v)}%` }}
        />
      </div>
    </div>
  );
}

const LatencyCard = memo(function LatencyCard({
  label,
  value,
  unit,
  threshold,
  anomaly,
}: {
  label: string;
  value: number;
  unit: string;
  threshold: [number, number];
  anomaly?: { type: string | null; deltaPercent: number };
}) {
  const [warn, crit] = threshold;
  const status = value >= crit ? 'crit' : value >= warn ? 'warn' : 'ok';
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-3 transition-all',
        status === 'crit' && 'border-red-500/25 bg-red-500/5',
        status === 'warn' && 'border-amber-500/20 bg-amber-500/5',
        status === 'ok' && 'border-admin-border bg-admin-card',
      )}
    >
      <p className="text-[9px] font-bold uppercase tracking-wider text-admin-muted">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            'text-lg font-black tabular-nums',
            status === 'crit' ? 'text-red-400' : status === 'warn' ? 'text-amber-400' : 'text-admin-text',
          )}
        >
          {value}
        </span>
        <span className="text-[10px] text-admin-muted">{unit}</span>
      </div>
      {anomaly && anomaly.deltaPercent !== 0 && (
        <p className={cn('mt-0.5 text-[10px] font-semibold', anomaly.type === 'spike' ? 'text-red-400' : 'text-emerald-400')}>
          {anomaly.type === 'spike' ? '↑' : '↓'} {Math.abs(anomaly.deltaPercent).toFixed(1)}%
        </p>
      )}
    </div>
  );
});

const HistoryChart = memo(function HistoryChart({
  title,
  data,
  color,
  unit,
}: {
  title: string;
  data?: Array<{ timestamp?: string; value?: number }>;
  color: string;
  unit: string;
}) {
  const points = useMemo(
    () =>
      (data ?? []).map((p) => ({
        time: p.timestamp ? new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
        value: p.value ?? 0,
      })),
    [data],
  );

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card">
      <div className="border-b border-admin-border bg-white/[0.02] px-4 py-3">
        <h3 className="text-sm font-bold text-admin-text">{title}</h3>
      </div>
      <div className="h-[220px] p-3">
        {points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-admin-muted">No series data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: CHART_TICK }} stroke={CHART_GRID} />
              <YAxis tick={{ fontSize: 10, fill: CHART_TICK }} stroke={CHART_GRID} />
              <RechartsTooltip
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: `1px solid ${CHART_TOOLTIP_BORDER}`,
                  background: CHART_TOOLTIP_BG,
                  color: '#E6EDF3',
                }}
                formatter={(v: number) => [`${v}${unit ? ' ' + unit : ''}`, title.split(' ')[0]]}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
});

function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatTimeAgo(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 60000;
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${Math.floor(diff)}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso ?? '—';
  }
}
