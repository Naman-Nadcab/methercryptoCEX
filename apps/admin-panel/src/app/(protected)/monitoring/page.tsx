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
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { InfrastructureControlModal, type InfrastructureAction } from '@/components/monitoring/InfrastructureControlModal';
import { RpcPriorityModal } from '@/components/monitoring/RpcPriorityModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Activity, Database, Server, Radio, Boxes, Cpu, HardDrive, MemoryStick,
  PlayCircle, Cog, Pencil, RefreshCw, Timer, ChevronDown, Info,
  Shield, Zap, Gauge, Globe, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { TableSkeleton } from '@/components/ui';

type MonitoringTab = 'overview' | 'history';
type RefreshRate = 5000 | 10000 | 15000 | 30000;

const REFRESH_OPTIONS: { label: string; value: RefreshRate }[] = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '15s', value: 15000 },
  { label: '30s', value: 30000 },
];

function Tip({ content, danger }: { content: string; danger?: string }) {
  return (
    <SmartTooltip content={content} danger={danger}>
      <Info className="h-3 w-3 text-admin-muted/60 cursor-help" />
    </SmartTooltip>
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
  const queueAnomaly = useMemo(() => detectAnomaly('mon-queue', queues?.withdrawal_pending ?? 0), [detectAnomaly, queues]);

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">System Monitoring</h1>
          <p className="text-xs text-admin-muted mt-0.5">Infrastructure health, queues, resources, and operational controls</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setRefreshDropdownOpen((s) => !s)}>
              <Timer className="h-3.5 w-3.5 mr-1" />
              {REFRESH_OPTIONS.find((o) => o.value === refreshRate)?.label}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
            {refreshDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setRefreshDropdownOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 bg-admin-card border border-admin-border rounded-lg shadow-dropdown py-1 min-w-[80px]">
                  {REFRESH_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => { setRefreshRate(opt.value); setRefreshDropdownOpen(false); }}
                      className={cn('w-full text-left px-3 py-1.5 text-xs transition-colors', refreshRate === opt.value ? 'text-admin-primary bg-admin-primary/5' : 'text-admin-text hover:bg-white/[0.02]')}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={handleRefreshAll}>Refresh</Button>
          <Link href="/monitoring/alert-rules">
            <Button variant="secondary" size="sm" icon={<Cog className="h-3.5 w-3.5" />}>Alert Rules</Button>
          </Link>
        </div>
      </div>

      {/* Critical Resource Alert Banner */}
      {hasCriticalResource && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 shrink-0">
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-800">Resource Usage Critical</p>
            <p className="text-xs text-red-600">
              {cpuPct !== null && cpuPct > 90 ? `CPU at ${cpuPct}% ` : ''}
              {memPct !== null && memPct > 90 ? `Memory at ${memPct}%` : ''}
              — Immediate attention required.
            </p>
          </div>
        </div>
      )}

      {/* === Health Score + Key Metrics === */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health Score */}
        <div className={cn('rounded-xl border p-4 flex items-center gap-4 ring-1',
          healthScore >= 90 ? 'bg-emerald-50 border-emerald-200 ring-emerald-500/20' :
          healthScore >= 70 ? 'bg-amber-50 border-amber-200 ring-amber-500/20' :
          'bg-red-50 border-red-200 ring-red-500/20'
        )}>
          <div className={cn('flex h-14 w-14 items-center justify-center rounded-full border-[3px] shrink-0',
            healthScore >= 90 ? 'text-emerald-600 border-emerald-400' :
            healthScore >= 70 ? 'text-amber-600 border-amber-400' :
            'text-red-600 border-red-400'
          )}>
            <span className="text-xl font-bold tabular-nums">{healthScore}</span>
          </div>
          <div>
            <p className="text-xs font-medium text-admin-muted flex items-center gap-1">Health Score <Tip content="Composite score from all infrastructure metrics." danger="Below 70 = degraded. Below 50 = critical." /></p>
            <p className={cn('text-sm font-semibold', healthScore >= 90 ? 'text-emerald-600' : healthScore >= 70 ? 'text-amber-600' : 'text-red-600')}>
              {healthScore >= 90 ? 'Healthy' : healthScore >= 70 ? 'Degraded' : 'Critical'}
            </p>
          </div>
        </div>

        {/* Uptime */}
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <p className="text-xs font-medium text-admin-muted mb-1">Uptime</p>
          <p className="text-2xl font-bold tabular-nums text-admin-text">{formatUptime(uptimeSec)}</p>
          <p className="text-xs text-admin-muted mt-0.5">{wsConns} WebSocket connections</p>
        </div>

        {/* Resources */}
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <p className="text-xs font-medium text-admin-muted mb-2">System Resources</p>
          <div className="space-y-2">
            <ResourceBar label="CPU" value={cpuPct} />
            <ResourceBar label="Memory" value={memPct} />
            <ResourceBar label="Disk" value={diskPct} />
          </div>
        </div>

        {/* Queues Summary */}
        <div className="rounded-xl border border-admin-border bg-admin-card p-4">
          <p className="text-xs font-medium text-admin-muted mb-2">Processing Queues</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-admin-muted">Withdrawals</span>
              <span className={cn('font-semibold tabular-nums', (queues?.withdrawal_pending ?? 0) > 50 ? 'text-amber-600' : 'text-admin-text')}>{queues?.withdrawal_pending ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-admin-muted">Settlement</span>
              <span className={cn('font-semibold tabular-nums', queues?.settlement_delayed ? 'text-amber-600' : 'text-admin-text')}>{queues?.settlement_pending ?? 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-admin-muted">Matching Engine</span>
              <span className="font-semibold tabular-nums text-admin-text">{queues?.matching_engine_pending ?? 0}</span>
            </div>
          </div>
        </div>
      </section>

      {/* === Latency Metrics === */}
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-admin-muted mb-2 pl-0.5">Latency Metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <LatencyCard label="API Latency" value={apiLatency} unit="ms" threshold={[200, 500]} anomaly={apiAnomaly} />
          <LatencyCard label="Database" value={dbLatency} unit="ms" threshold={[50, 100]} anomaly={dbAnomaly} />
          <LatencyCard label="Redis" value={redisLatency} unit="ms" threshold={[20, 50]} />
          <LatencyCard label="Heap Memory" value={Math.round(memoryMb)} unit="MB" threshold={[512, 1024]} />
        </div>
      </section>

      {/* Tabs */}
      <div className="border-b border-admin-border">
        <nav className="flex gap-1">
          {(['overview', 'history'] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)}
              className={cn('border-b-2 px-4 py-2 text-xs font-medium transition-colors capitalize',
                activeTab === tab ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-text')}>
              {tab === 'overview' ? 'Overview' : 'History Charts'}
            </button>
          ))}
        </nav>
      </div>

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <HistoryChart title="API Latency (24h)" data={historyApi?.data?.points} color="#6366F1" unit="ms" />
          <HistoryChart title="Database Latency (24h)" data={historyDb?.data?.points} color="#10B981" unit="ms" />
          <HistoryChart title="Redis Latency (24h)" data={historyRedis?.data?.points} color="#F59E0B" unit="ms" />
          <HistoryChart title="Queue Size (24h)" data={historyQueue?.data?.points} color="#64748B" unit="" />
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {/* RPC + Infrastructure Control + Rate Limits */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* RPC Providers */}
            <div className="rounded-xl border border-admin-border bg-admin-card lg:col-span-1">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text flex items-center gap-2"><Globe className="h-4 w-4 text-admin-muted" /> RPC Providers</h3>
              </div>
              <div className="px-5 py-3">
                {rpcProviders.length === 0 ? (
                  <p className="py-4 text-center text-xs text-admin-muted">No RPC providers configured.</p>
                ) : (
                  <div className="space-y-2">
                    {rpcProviders.map((row) => (
                      <div key={row.id} className="flex items-center justify-between rounded-lg border border-admin-border/60 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-admin-text">{row.provider}</p>
                          <p className="text-[10px] text-admin-muted">{row.network} · {row.latency_ms != null ? `${row.latency_ms}ms` : '—'} · Err {row.error_rate ?? 0}%</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={row.status} variant={row.status === 'Healthy' ? 'success' : row.status === 'Slow' ? 'warning' : 'default'} />
                          <button onClick={() => setRpcPriorityModal(row)} className="text-admin-muted hover:text-admin-muted"><Pencil className="h-3 w-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Infrastructure Control */}
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text flex items-center gap-2"><Server className="h-4 w-4 text-admin-muted" /> Infrastructure Control</h3>
              </div>
              <div className="px-5 py-4">
                <p className="text-[10px] text-admin-muted mb-3">Each action requires confirmation before execution.</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { action: 'restart_worker', icon: PlayCircle, label: 'Restart Worker' },
                    { action: 'flush_queue', icon: Boxes, label: 'Flush Queue' },
                    { action: 'reset_circuit_breaker', icon: Shield, label: 'Reset Breaker' },
                    { action: 'restart_liquidity_bot', icon: Zap, label: 'Restart Liq Bot' },
                    { action: 'restart_settlement_worker', icon: PlayCircle, label: 'Restart Settlement' },
                    { action: 'restart_matching_engine', icon: Zap, label: 'Restart Engine' },
                    { action: 'restart_websocket_service', icon: Radio, label: 'Restart WS' },
                  ].map(({ action, icon: Icon, label }) => (
                    <button key={action} onClick={() => setControlModal(action as InfrastructureAction)}
                      className="flex items-center gap-2 rounded-lg border border-admin-border px-3 py-2 text-xs text-admin-text hover:bg-white/[0.02] hover:border-admin-border transition-colors">
                      <Icon className="h-3.5 w-3.5 text-admin-muted shrink-0" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Rate Limits (compact) */}
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text flex items-center gap-2"><Gauge className="h-4 w-4 text-admin-muted" /> Rate Limits</h3>
              </div>
              <div className="px-5 py-3">
                <div className="space-y-2">
                  {[
                    { label: 'Public API', limit: '100 req/min per IP' },
                    { label: 'Authenticated', limit: '300 req/min per user' },
                    { label: 'WebSocket', limit: '5 conn, 100 msg/sec' },
                    { label: 'Admin API', limit: '200 req/min per admin' },
                  ].map(({ label, limit }) => (
                    <div key={label} className="flex items-center justify-between py-1">
                      <span className="text-xs text-admin-muted">{label}</span>
                      <span className="text-[10px] font-mono text-admin-muted">{limit}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-admin-muted">Enforced at API gateway level.</p>
              </div>
            </div>
          </div>

          {/* Workers + Timeline + Incidents */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Workers */}
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text">Workers</h3>
              </div>
              <div className="px-5 py-3">
                {workers.length === 0 ? (
                  <p className="py-4 text-center text-xs text-admin-muted">No worker data.</p>
                ) : (
                  <div className="space-y-2">
                    {workers.map((w) => (
                      <div key={w.id} className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-admin-text truncate">{w.worker_name}</p>
                          <p className="text-[10px] text-admin-muted">{formatUptime(w.uptime_seconds)} · {w.last_restart_at ? formatTimeAgo(w.last_restart_at) : '—'}</p>
                        </div>
                        <StatusBadge status={w.status} variant={w.status === 'running' ? 'success' : 'default'} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Event Timeline */}
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text">Event Timeline</h3>
              </div>
              <div className="px-5 py-3 max-h-[280px] overflow-y-auto">
                {timelineEvents.length === 0 ? (
                  <p className="py-4 text-center text-xs text-admin-muted">No recent events.</p>
                ) : (
                  <div className="space-y-2">
                    {timelineEvents.map((ev) => (
                      <div key={ev.id} className="flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-admin-text">{ev.event_type.replace(/_/g, ' ')}</p>
                          {ev.message && <p className="text-admin-muted truncate text-[10px]">{ev.message}</p>}
                        </div>
                        <span className="text-[10px] text-admin-muted shrink-0">{ev.created_at ? formatTimeAgo(ev.created_at) : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Incidents */}
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text">Incidents</h3>
              </div>
              <div className="px-5 py-3">
                {incidents.length === 0 ? (
                  <div className="py-4 text-center">
                    <Activity className="h-6 w-6 text-emerald-400 mx-auto mb-1" />
                    <p className="text-xs text-admin-muted">No active incidents</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {incidents.slice(0, 5).map((row) => (
                      <div key={row.id} className="flex items-center justify-between rounded-lg border border-admin-border/60 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-admin-text">{row.service}</p>
                          <p className="text-[10px] text-admin-muted">{row.created_at ? formatTimeAgo(row.created_at) : '—'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={row.severity} variant={row.severity === 'High' ? 'danger' : 'warning'} />
                          <StatusBadge status={row.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Infrastructure Alerts (full width at bottom) */}
          {(alerts.length > 0 || alertsLoading) && (
            <div className="rounded-xl border border-admin-border bg-admin-card">
              <div className="px-5 py-3 border-b border-admin-border">
                <h3 className="text-sm font-semibold text-admin-text">Infrastructure Alerts</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-admin-border text-admin-muted">
                      <th className="px-5 py-2 font-medium">System</th>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Message</th>
                      <th className="px-3 py-2 font-medium">Created</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertsLoading ? (
                      <tr><td colSpan={5} className="p-0"><TableSkeleton rows={3} cols={4} /></td></tr>
                    ) : alerts.map((row) => (
                      <tr key={row.id} className="border-b border-admin-border/50 last:border-0 hover:bg-white/[0.02]/50">
                        <td className="px-5 py-2 font-medium text-admin-text">{row.system}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.severity} variant={row.severity === 'High' ? 'danger' : row.severity === 'Medium' ? 'warning' : 'default'} /></td>
                        <td className="px-3 py-2 text-admin-muted max-w-[300px] truncate" title={row.message}>{row.message}</td>
                        <td className="px-3 py-2 text-admin-muted">{row.created_at ? formatTimeAgo(row.created_at) : '—'}</td>
                        <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {alertsTotalPages > 1 && (
                <div className="px-5 py-2 border-t border-admin-border flex items-center justify-between text-xs text-admin-muted">
                  <span>Page {alertsPage} / {alertsTotalPages} ({alertsTotal} total)</span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={alertsPage <= 1} onClick={() => setAlertsPage((p) => Math.max(1, p - 1))}>Prev</Button>
                    <Button variant="secondary" size="sm" disabled={alertsPage >= alertsTotalPages} onClick={() => setAlertsPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <InfrastructureControlModal open={!!controlModal} action={controlModal} onClose={() => setControlModal(null)} onConfirm={handleConfirmAction} isLoading={actionMutation.isPending} />
      <RpcPriorityModal open={!!rpcPriorityModal} provider={rpcPriorityModal} onClose={() => setRpcPriorityModal(null)} onSave={(id, priority) => priorityMutation.mutate({ id, priority })} isLoading={priorityMutation.isPending} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function ResourceBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const isCrit = v > 90;
  const isWarn = v > 75;
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-admin-muted">{label}</span>
        <span className={cn('text-[10px] font-bold tabular-nums', isCrit ? 'text-red-600' : isWarn ? 'text-amber-600' : 'text-admin-text')}>{v != null ? `${v}%` : '—'}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', isCrit ? 'bg-red-500' : isWarn ? 'bg-amber-400' : 'bg-emerald-400')}
          style={{ width: `${Math.min(100, v)}%` }} />
      </div>
    </div>
  );
}

const LatencyCard = memo(function LatencyCard({ label, value, unit, threshold, anomaly }: {
  label: string; value: number; unit: string; threshold: [number, number];
  anomaly?: { type: string | null; deltaPercent: number };
}) {
  const [warn, crit] = threshold;
  const status = value >= crit ? 'crit' : value >= warn ? 'warn' : 'ok';
  return (
    <div className={cn('rounded-lg border bg-admin-card px-3.5 py-2.5 transition-all',
      status === 'crit' ? 'border-red-200 bg-red-50/40' : status === 'warn' ? 'border-amber-200 bg-amber-50/40' : 'border-admin-border')}>
      <p className="text-[10px] font-medium text-admin-muted uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={cn('text-lg font-bold tabular-nums', status === 'crit' ? 'text-red-600' : status === 'warn' ? 'text-amber-600' : 'text-admin-text')}>{value}</span>
        <span className="text-[10px] text-admin-muted">{unit}</span>
      </div>
      {anomaly && anomaly.deltaPercent !== 0 && (
        <p className={cn('text-[10px] font-medium mt-0.5', anomaly.type === 'spike' ? 'text-red-500' : 'text-emerald-600')}>
          {anomaly.type === 'spike' ? '↑' : '↓'} {Math.abs(anomaly.deltaPercent).toFixed(1)}%
        </p>
      )}
    </div>
  );
});

const HistoryChart = memo(function HistoryChart({ title, data, color, unit }: {
  title: string; data?: Array<{ timestamp?: string; value?: number }>; color: string; unit: string;
}) {
  const points = useMemo(() => (data ?? []).map((p) => ({
    time: p.timestamp ? new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
    value: p.value ?? 0,
  })), [data]);

  return (
    <div className="rounded-xl border border-admin-border bg-admin-card">
      <div className="px-5 py-3 border-b border-admin-border">
        <h3 className="text-sm font-semibold text-admin-text">{title}</h3>
      </div>
      <div className="p-4 h-[220px]">
        {points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-admin-muted text-xs">No data available</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94A3B8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} />
              <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E2E8F0' }} formatter={(v: number) => [`${v}${unit ? ' ' + unit : ''}`, title.split(' ')[0]]} />
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
  } catch { return iso ?? '—'; }
}
