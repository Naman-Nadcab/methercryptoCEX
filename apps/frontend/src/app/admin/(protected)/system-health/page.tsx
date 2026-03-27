'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getSystemHealth, type SystemHealthData } from '@/lib/admin/systemHealth';
import {
  SectionHeader,
  MetricWidget,
  Panel,
  StatusBadge,
} from '@/components/admin/control-plane';
import { AdminChartCard } from '@/components/admin/charts';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { adminChartTheme } from '@/styles/adminChartTheme';
import {
  Activity,
  Database,
  Server,
  Radio,
  Layers,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

const POLL_INTERVAL_MS = 8000;
const HISTORY_LENGTH = 30;

type StatusVariant = 'LIVE' | 'DEGRADED' | 'HALTED' | 'NEUTRAL';

function statusFromService(status: string, latencyMs?: number): StatusVariant {
  if (status !== 'up') return 'HALTED';
  if (latencyMs != null && latencyMs > 500) return 'DEGRADED';
  return 'LIVE';
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h < 24) return `${h}h ${min}m`;
  const d = Math.floor(h / 24);
  const hours = h % 24;
  return `${d}d ${hours}h`;
}

interface HistoryPoint {
  time: string;
  api: number;
  db: number;
  redis: number;
  queue: number;
  settlement: number;
}

export default function SystemHealthDashboard() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const fetchStart = useRef<number>(0);

  const fetchHealth = useCallback(async () => {
    if (!accessToken) return;
    fetchStart.current = Date.now();
    const res = await getSystemHealth(accessToken);
    const clientLatencyMs = Date.now() - fetchStart.current;

    if (!res.success || !res.data) {
      setError(res.error?.message ?? 'Failed to load system health');
      setData(null);
      setLoading(false);
      return;
    }
    setError(null);
    const d = res.data;
    d.api_latency_ms = clientLatencyMs;
    setData(d);

    const point: HistoryPoint = {
      time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      api: clientLatencyMs,
      db: d.database.latency_ms,
      redis: d.redis.latency_ms,
      queue: d.queue.total_withdrawal_queue,
      settlement: d.queue.settlement_pending,
    };
    setHistory((prev) => [...prev.slice(-(HISTORY_LENGTH - 1)), point]);
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const dbStatus = data ? statusFromService(data.database.status, data.database.latency_ms) : 'NEUTRAL';
  const redisStatus = data ? statusFromService(data.redis.status, data.redis.latency_ms) : 'NEUTRAL';
  const wsStatus = data?.websocket?.status === 'up' ? 'LIVE' : (data ? 'HALTED' : 'NEUTRAL');
  const nodeStatus = data?.node?.status === 'up' ? 'LIVE' : (data ? 'HALTED' : 'NEUTRAL');

  const chartData = history.length > 0 ? history : [
    { time: '—', api: 0, db: 0, redis: 0, queue: 0, settlement: 0 },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="System Health"
        subtitle="API latency, websocket, database, node status, and queue metrics"
        action={
          <button
            type="button"
            onClick={() => { setLoading(true); fetchHealth(); }}
            disabled={loading}
            className="text-sm font-medium text-[var(--admin-primary)] hover:underline disabled:opacity-50 flex items-center gap-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Refresh
          </button>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 flex items-center gap-2 text-sm text-red-800 dark:text-red-200">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Metric cards */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--admin-text-muted)] uppercase tracking-wider mb-3">
          Overview
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricWidget
            label="API latency"
            value={loading && !data ? '—' : (data ? `${data.api_latency_ms} ms` : '—')}
            sublabel="Last probe"
            variant={data && data.api_latency_ms > 500 ? 'warning' : 'neutral'}
            statusBadge={data && data.api_latency_ms > 500 ? 'DEGRADED' : undefined}
            icon={<Activity className="w-5 h-5" />}
          />
          <MetricWidget
            label="Database"
            value={loading && !data ? '—' : (data ? `${data.database.latency_ms} ms` : '—')}
            sublabel={data?.database.status ?? '—'}
            variant={data && data.database.status !== 'up' ? 'danger' : 'neutral'}
            statusBadge={data ? dbStatus : undefined}
            icon={<Database className="w-5 h-5" />}
          />
          <MetricWidget
            label="Redis"
            value={loading && !data ? '—' : (data ? `${data.redis.latency_ms} ms` : '—')}
            sublabel={data?.redis.status ?? '—'}
            variant={data && data.redis.status !== 'up' ? 'danger' : 'neutral'}
            statusBadge={data ? redisStatus : undefined}
            icon={<Server className="w-5 h-5" />}
          />
          <MetricWidget
            label="WebSocket"
            value={loading && !data ? '—' : (data ? `${data.websocket.connections} conn` : '—')}
            sublabel={data ? `${data.websocket.authenticated} auth` : '—'}
            statusBadge={data ? wsStatus : undefined}
            icon={<Radio className="w-5 h-5" />}
          />
          <MetricWidget
            label="Node"
            value={loading && !data ? '—' : (data ? formatUptime(data.node.uptime_sec) : '—')}
            sublabel={data ? `${data.node.memory_heap_mb} MB heap` : '—'}
            statusBadge={data ? nodeStatus : undefined}
            icon={<Server className="w-5 h-5" />}
          />
          <MetricWidget
            label="Withdrawal queue"
            value={loading && !data ? '—' : (data ? data.queue.total_withdrawal_queue : '—')}
            sublabel={data ? `Settlement: ${data.queue.settlement_pending}` : '—'}
            variant={data && data.queue.total_withdrawal_queue > 10 ? 'warning' : 'neutral'}
            icon={<Layers className="w-5 h-5" />}
          />
        </div>
      </section>

      {/* Status indicators */}
      <Panel title="Service status" subtitle="Database, Redis, WebSocket, Node">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--admin-hover-bg)]">
            {data?.database.status === 'up' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : data ? (
              <XCircle className="w-5 h-5 text-red-500 shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-[var(--admin-text-muted)] shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-[var(--admin-text)]">Database</p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                {data ? (data.database.status === 'up' ? `${data.database.latency_ms} ms` : 'Down') : '—'}
              </p>
            </div>
            {data && <StatusBadge variant={dbStatus} label={dbStatus} showDot />}
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--admin-hover-bg)]">
            {data?.redis.status === 'up' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : data ? (
              <XCircle className="w-5 h-5 text-red-500 shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-[var(--admin-text-muted)] shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-[var(--admin-text)]">Redis</p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                {data ? (data.redis.status === 'up' ? `${data.redis.latency_ms} ms` : 'Down') : '—'}
              </p>
            </div>
            {data && <StatusBadge variant={redisStatus} label={redisStatus} showDot />}
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--admin-hover-bg)]">
            {data?.websocket?.status === 'up' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : data ? (
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-[var(--admin-text-muted)] shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-[var(--admin-text)]">WebSocket</p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                {data ? `${data.websocket.connections} connections` : '—'}
              </p>
            </div>
            {data && <StatusBadge variant={wsStatus} label={wsStatus} showDot />}
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--admin-hover-bg)]">
            {data?.node?.status === 'up' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : data ? (
              <XCircle className="w-5 h-5 text-red-500 shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-[var(--admin-text-muted)] shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-[var(--admin-text)]">Node</p>
              <p className="text-xs text-[var(--admin-text-muted)]">
                {data ? `${data.node.memory_heap_mb} MB` : '—'}
              </p>
            </div>
            {data && <StatusBadge variant={nodeStatus} label={nodeStatus} showDot />}
          </div>
        </div>
      </Panel>

      {/* Line charts */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--admin-text-muted)] uppercase tracking-wider mb-3">
          Latency &amp; queues over time
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AdminChartCard title="API / DB / Redis latency" subtitle="Last probe (ms)">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
                <XAxis dataKey="time" stroke={adminChartTheme.axis} fontSize={10} tickLine={false} />
                <YAxis stroke={adminChartTheme.axis} fontSize={10} tickLine={false} unit=" ms" />
                <Tooltip
                  contentStyle={{
                    background: adminChartTheme.tooltipBg,
                    border: `1px solid ${adminChartTheme.tooltipBorder}`,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: adminChartTheme.axis }}
                />
                <Line type="monotone" dataKey="api" stroke={adminChartTheme.primary} strokeWidth={2} dot={false} name="API" />
                <Line type="monotone" dataKey="db" stroke={adminChartTheme.success} strokeWidth={1.5} dot={false} name="DB" />
                <Line type="monotone" dataKey="redis" stroke={adminChartTheme.accent} strokeWidth={1.5} dot={false} name="Redis" />
              </LineChart>
            </ResponsiveContainer>
          </AdminChartCard>
          <AdminChartCard title="Queue depth" subtitle="Withdrawal queue & settlement pending">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={adminChartTheme.grid} />
                <XAxis dataKey="time" stroke={adminChartTheme.axis} fontSize={10} tickLine={false} />
                <YAxis stroke={adminChartTheme.axis} fontSize={10} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: adminChartTheme.tooltipBg,
                    border: `1px solid ${adminChartTheme.tooltipBorder}`,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: adminChartTheme.axis }}
                />
                <Line type="monotone" dataKey="queue" stroke={adminChartTheme.warning} strokeWidth={2} dot={false} name="Withdrawal queue" />
                <Line type="monotone" dataKey="settlement" stroke={adminChartTheme.danger} strokeWidth={1.5} dot={false} name="Settlement pending" />
              </LineChart>
            </ResponsiveContainer>
          </AdminChartCard>
        </div>
      </section>

      {/* Queue breakdown */}
      <Panel title="Queue metrics" subtitle="Withdrawal signing queue and settlement">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricWidget
            label="Settlement pending"
            value={data?.queue.settlement_pending ?? '—'}
            variant={data && data.queue.settlement_pending > 5 ? 'warning' : 'neutral'}
          />
          <MetricWidget
            label="Withdrawal pending"
            value={data?.queue.withdrawal_pending ?? '—'}
          />
          <MetricWidget
            label="Withdrawal signing"
            value={data?.queue.withdrawal_signing ?? '—'}
          />
          <MetricWidget
            label="Withdrawal broadcast"
            value={data?.queue.withdrawal_broadcast ?? '—'}
          />
        </div>
      </Panel>
    </div>
  );
}
