'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMonitoringHealth,
  getMonitoringRpcProviders,
  getMonitoringQueues,
  getMonitoringResources,
  getMonitoringAlerts,
  getMonitoringHistory,
  getMonitoringIncidents,
  getMonitoringWorkers,
  getMonitoringTimeline,
  triggerMonitoringAction,
  updateRpcProviderPriority,
  type RpcProviderRow,
  type InfrastructureAlertRow,
  type IncidentRow,
  type WorkerRow,
  type TimelineEventRow,
} from '@/lib/monitoring-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { InfrastructureControlModal, type InfrastructureAction } from '@/components/monitoring/InfrastructureControlModal';
import { RpcPriorityModal } from '@/components/monitoring/RpcPriorityModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Activity,
  Database,
  Server,
  Radio,
  Boxes,
  Cpu,
  HardDrive,
  MemoryStick,
  Settings,
  PlayCircle,
  Cog,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/cn';

type MonitoringTab = 'overview' | 'history';

export default function MonitoringPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MonitoringTab>('overview');
  const [controlModal, setControlModal] = useState<InfrastructureAction | null>(null);
  const [rpcPriorityModal, setRpcPriorityModal] = useState<RpcProviderRow | null>(null);
  const [alertsPage, setAlertsPage] = useState(1);

  const { data: healthData } = useQuery({
    queryKey: ['admin', 'monitoring', 'health', token],
    queryFn: () => getMonitoringHealth(token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const { data: rpcData } = useQuery({
    queryKey: ['admin', 'monitoring', 'rpc', token],
    queryFn: () => getMonitoringRpcProviders(token),
    enabled: !!token,
  });

  const { data: queuesData } = useQuery({
    queryKey: ['admin', 'monitoring', 'queues', token],
    queryFn: () => getMonitoringQueues(token),
    enabled: !!token,
    refetchInterval: 10000,
  });

  const { data: resourcesData } = useQuery({
    queryKey: ['admin', 'monitoring', 'resources', token],
    queryFn: () => getMonitoringResources(token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['admin', 'monitoring', 'alerts', token, alertsPage],
    queryFn: () =>
      getMonitoringAlerts(token, { limit: 20, offset: (alertsPage - 1) * 20 }),
    enabled: !!token,
  });

  const { data: historyApi } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'api_latency', token],
    queryFn: () => getMonitoringHistory(token, 'api_latency'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: historyDb } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'db_latency', token],
    queryFn: () => getMonitoringHistory(token, 'db_latency'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: historyRedis } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'redis_latency', token],
    queryFn: () => getMonitoringHistory(token, 'redis_latency'),
    enabled: !!token && activeTab === 'history',
  });
  const { data: historyQueue } = useQuery({
    queryKey: ['admin', 'monitoring', 'history', 'queue_size', token],
    queryFn: () => getMonitoringHistory(token, 'queue_size'),
    enabled: !!token && activeTab === 'history',
  });

  const { data: incidentsData } = useQuery({
    queryKey: ['admin', 'monitoring', 'incidents', token],
    queryFn: () => getMonitoringIncidents(token, { limit: 20 }),
    enabled: !!token,
  });
  const { data: workersData } = useQuery({
    queryKey: ['admin', 'monitoring', 'workers', token],
    queryFn: () => getMonitoringWorkers(token),
    enabled: !!token,
  });
  const { data: timelineData } = useQuery({
    queryKey: ['admin', 'monitoring', 'timeline', token],
    queryFn: () => getMonitoringTimeline(token, 15),
    enabled: !!token,
  });

  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: number }) =>
      updateRpcProviderPriority(token, id, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring', 'rpc'] });
      setRpcPriorityModal(null);
    },
  });

  useAdminWs({
    onEvent: (ev) => {
      const t = (ev?.type as string) ?? '';
      if (
        t === 'system_alert' ||
        t === 'rpc_timeout' ||
        t === 'queue_overflow' ||
        t === 'node_failure'
      ) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] });
      }
    },
  });

  const actionMutation = useMutation({
    mutationFn: (action: string) => triggerMonitoringAction(token, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] });
      setControlModal(null);
    },
  });

  const health = healthData?.data;
  const rpcProviders = (rpcData?.data?.providers ?? []) as RpcProviderRow[];
  const queues = queuesData?.data;
  const resources = resourcesData?.data;
  const alertsPayload = alertsData?.data;
  const alerts = (alertsPayload?.alerts ?? []) as InfrastructureAlertRow[];
  const alertsTotal = alertsPayload?.total ?? 0;
  const alertsTotalPages = Math.ceil(alertsTotal / 20) || 1;
  const incidents = (incidentsData?.data?.incidents ?? []) as IncidentRow[];
  const workers = (workersData?.data?.workers ?? []) as WorkerRow[];
  const timelineEvents = (timelineData?.data?.events ?? []) as TimelineEventRow[];

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };
  const formatTimeAgo = (iso: string) => {
    try {
      const d = new Date(iso);
      const diff = (Date.now() - d.getTime()) / 60000;
      if (diff < 1) return 'Just now';
      if (diff < 60) return `${Math.floor(diff)} min ago`;
      if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
      return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso ?? '—';
    }
  };

  const handleConfirmAction = () => {
    if (controlModal) actionMutation.mutate(controlModal);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">System Monitoring</h1>
          <p className="mt-1 text-sm text-admin-muted">
            Infrastructure health, RPC nodes, queues, resources, and operational controls.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/monitoring/alert-rules">
            <Button variant="secondary" size="sm">
              <Cog className="mr-1 h-4 w-4" />
              Alert rules
            </Button>
          </Link>
          <Link href="/settings/infrastructure">
            <Button variant="secondary" size="sm">
              <Settings className="mr-1 h-4 w-4" />
              Infrastructure
            </Button>
          </Link>
        </div>
      </div>

      <div className="border-b border-admin-border">
        <nav className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'overview'
                ? 'border-admin-primary text-admin-primary'
                : 'border-transparent text-admin-muted hover:text-gray-700'
            )}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'history'
                ? 'border-admin-primary text-admin-primary'
                : 'border-transparent text-admin-muted hover:text-gray-700'
            )}
          >
            History
          </button>
        </nav>
      </div>

      {activeTab === 'history' && (
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>API Latency (last 24h)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={(historyApi?.data?.points ?? []).map((p) => ({ ...p, time: new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`${v} ms`, 'Latency']} />
                    <Line type="monotone" dataKey="value" stroke="#6366F1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Database Latency (last 24h)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={(historyDb?.data?.points ?? []).map((p) => ({ ...p, time: new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`${v} ms`, 'Latency']} />
                    <Line type="monotone" dataKey="value" stroke="#10B981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Redis Latency (last 24h)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={(historyRedis?.data?.points ?? []).map((p) => ({ ...p, time: new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`${v} ms`, 'Latency']} />
                    <Line type="monotone" dataKey="value" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Queue Size (last 24h)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={(historyQueue?.data?.points ?? []).map((p) => ({ ...p, time: new Date(p.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [v, 'Size']} />
                    <Line type="monotone" dataKey="value" stroke="#64748B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'overview' && (
        <>
      {/* Infrastructure Dashboard Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="API Latency"
          value={health?.api_latency_ms != null ? `${health.api_latency_ms} ms` : '—'}
          icon={Activity}
          iconBg="bg-slate-100 text-slate-700"
        />
        <StatCard
          title="Database Health"
          value={health?.db_health ?? '—'}
          icon={Database}
          iconBg={
            health?.db_health === 'Healthy'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }
        />
        <StatCard
          title="Redis Health"
          value={health?.redis_health ?? '—'}
          icon={Server}
          iconBg={
            health?.redis_health === 'Healthy'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }
        />
        <StatCard
          title="WS Connections"
          value={health?.ws_connections ?? '—'}
          icon={Radio}
          iconBg="bg-indigo-100 text-indigo-700"
        />
      </div>

      {/* Queue Monitoring */}
      <Card>
        <CardHeader>
          <CardTitle>Queue Monitoring</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Withdrawal Queue</p>
              <p className="text-2xl font-semibold text-gray-900">
                {queues?.withdrawal_pending ?? '—'} pending
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Settlement Queue</p>
              <p className="text-2xl font-semibold text-gray-900">
                {queues?.settlement_pending ?? '—'} pending
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <p className="text-sm font-medium text-gray-700">Matching Engine Queue</p>
              <p className="text-2xl font-semibold text-gray-900">
                {queues?.matching_engine_pending ?? '—'} pending
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Resources */}
      <Card>
        <CardHeader>
          <CardTitle>System Resources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <Cpu className="h-8 w-8 text-admin-muted" />
              <div>
                <p className="text-sm font-medium text-gray-700">CPU Usage</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {resources?.cpu_percent != null ? `${resources.cpu_percent}%` : '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <MemoryStick className="h-8 w-8 text-admin-muted" />
              <div>
                <p className="text-sm font-medium text-gray-700">Memory Usage</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {resources?.memory_percent != null ? `${resources.memory_percent}%` : '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-lg border border-gray-100 bg-gray-50/50 p-4">
              <HardDrive className="h-8 w-8 text-admin-muted" />
              <div>
                <p className="text-sm font-medium text-gray-700">Disk Usage</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {resources?.disk_percent != null ? `${resources.disk_percent}%` : '—'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* RPC Providers */}
        <Card>
          <CardHeader>
            <CardTitle>RPC Providers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Provider</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Network</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">RPC URL</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Latency</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Failover Priority</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Error Rate</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Last Failure</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rpcProviders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-admin-muted">
                        No RPC providers configured.
                      </td>
                    </tr>
                  ) : (
                    rpcProviders.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-admin-border hover:bg-gray-50/50"
                      >
                        <td className="px-4 py-3 font-medium">{row.provider}</td>
                        <td className="px-4 py-3 text-gray-700">{row.network}</td>
                        <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-gray-600" title={row.rpc_url}>
                          {row.rpc_url}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {row.latency_ms != null ? `${row.latency_ms} ms` : '—'}
                        </td>
                        <td className="px-4 py-3">Priority {row.failover_priority ?? 1}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {row.error_rate != null ? `${row.error_rate}%` : '—'}
                        </td>
                        <td className="px-4 py-3 text-admin-muted text-xs">
                          {row.last_failure ? formatTimeAgo(row.last_failure) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            status={row.status}
                            variant={
                              row.status === 'Healthy'
                                ? 'success'
                                : row.status === 'Slow'
                                  ? 'warning'
                                  : 'default'
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={() => setRpcPriorityModal(row)} title="Edit failover priority">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Infrastructure Control Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Infrastructure Control</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-admin-muted">
              Trigger operational actions. Each action requires confirmation.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('restart_worker')}
              >
                <PlayCircle className="mr-1 h-4 w-4" />
                Restart Worker
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('flush_queue')}
              >
                <Boxes className="mr-1 h-4 w-4" />
                Flush Queue
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('reset_circuit_breaker')}
              >
                Restart Circuit Breaker
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('restart_liquidity_bot')}
              >
                Restart Liquidity Bot
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('restart_settlement_worker')}
              >
                Restart Settlement Worker
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('restart_matching_engine')}
              >
                Restart Matching Engine
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlModal('restart_websocket_service')}
              >
                Restart WebSocket Service
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Incident Management */}
      <Card>
        <CardHeader>
          <CardTitle>Incident Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Incident ID</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Service</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Severity</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Created</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                      No incidents.
                    </td>
                  </tr>
                ) : (
                  incidents.map((row) => (
                    <tr key={row.id} className="border-t border-admin-border hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-mono text-xs">{row.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 font-medium">{row.service}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.severity} variant={row.severity === 'High' ? 'danger' : 'warning'} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {row.created_at ? new Date(row.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {row.resolved_at ? new Date(row.resolved_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Worker Status */}
      <Card>
        <CardHeader>
          <CardTitle>Worker Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Worker Name</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Uptime</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last Restart</th>
                </tr>
              </thead>
              <tbody>
                {workers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">
                      No worker data.
                    </td>
                  </tr>
                ) : (
                  workers.map((row) => (
                    <tr key={row.id} className="border-t border-admin-border hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium">{row.worker_name}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} variant={row.status === 'running' ? 'success' : 'default'} />
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatUptime(row.uptime_seconds)}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {row.last_restart_at ? formatTimeAgo(row.last_restart_at) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Infrastructure Event Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Event Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {timelineEvents.length === 0 ? (
              <p className="py-4 text-center text-admin-muted">No recent events.</p>
            ) : (
              timelineEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border/60 px-4 py-2 text-sm"
                >
                  <span className="font-medium">{ev.event_type.replace(/_/g, ' ')}</span>
                  <span className="text-admin-muted text-xs">
                    {ev.created_at ? new Date(ev.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </span>
                  {ev.message && <span className="w-full text-xs text-gray-600">{ev.message}</span>}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Infrastructure Alerts */}
      <Card>
        <CardHeader>
          <CardTitle>Infrastructure Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border bg-white">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Alert ID</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">System</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Severity</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Message</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Created</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {alertsLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                      Loading…
                    </td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-admin-muted">
                      No infrastructure alerts.
                    </td>
                  </tr>
                ) : (
                  alerts.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-admin-border hover:bg-gray-50/50"
                    >
                      <td className="px-4 py-3 font-mono text-xs">{row.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 font-medium">{row.system}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={row.severity}
                          variant={
                            row.severity === 'High'
                              ? 'danger'
                              : row.severity === 'Medium'
                                ? 'warning'
                                : 'default'
                          }
                        />
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-3 text-gray-700" title={row.message}>
                        {row.message}
                      </td>
                      <td className="px-4 py-3 text-admin-muted">
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {alertsTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-admin-muted">
              <span>
                Page {alertsPage} of {alertsTotalPages} ({alertsTotal} alerts)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={alertsPage <= 1}
                  onClick={() => setAlertsPage((p) => Math.max(1, p - 1))}
                >
                  Previous
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
        </CardContent>
      </Card>

        </>
      )}

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
    </div>
  );
}
