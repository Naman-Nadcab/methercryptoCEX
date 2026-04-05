'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { adminFetch } from '@/lib/admin/apiClient';
import {
  TimeSeriesPanel,
  MetricStatPanel,
  SystemHealthGrid,
  type SystemHealthGridData,
} from '@/components/admin/monitoring';
import {
  Activity,
  RefreshCw,
  Pause,
  Play,
  Wifi,
  WifiOff,
  Clock,
  Shield,
} from 'lucide-react';

const HISTORY_MAX = 60;

type RefreshInterval = 5 | 15 | 30 | 60 | 0;
type TimeRange = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';

interface HistoryPoint {
  time: string;
  api: number;
  db: number;
  redis: number;
  queue: number;
  settlement: number;
  ws_connections: number;
  heap_mb: number;
}

interface SparklineStore {
  [key: string]: number[];
}

function nowTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function pushSparkline(store: SparklineStore, key: string, value: number, max = 30): SparklineStore {
  const next = { ...store };
  const arr = [...(next[key] ?? []), value];
  next[key] = arr.length > max ? arr.slice(-max) : arr;
  return next;
}

export default function SystemHealthDashboard() {
  const { accessToken } = useAdminAuthStore();

  const [gridData, setGridData] = useState<SystemHealthGridData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [sparklines, setSparklines] = useState<SparklineStore>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(15);
  const [timeRange, setTimeRange] = useState<TimeRange>('15m');
  const [isPaused, setIsPaused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchStart = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    if (!accessToken) return;
    fetchStart.current = Date.now();

    try {
      const [healthRes, monitoringRes, countersRes, queuesRes, resourcesRes, scoreRes] =
        await Promise.allSettled([
          adminFetch<{
            timestamp: string;
            api_latency_ms: number;
            database: { status: string; latency_ms: number; pool_active?: number; pool_idle?: number; pool_waiting?: number };
            redis: { status: string; latency_ms: number; memory_mb?: number; connected_clients?: number; ops_per_sec?: number };
            websocket: { connections: number; authenticated: number; status: string; orderbook_subs?: number; trade_subs?: number };
            node: { uptime_sec: number; memory_heap_mb: number; status: string };
            queue: { settlement_pending: number; withdrawal_pending: number; withdrawal_signing: number; withdrawal_broadcast: number; total_withdrawal_queue: number };
          }>('/system-health', { token: accessToken }),
          adminFetch<Record<string, unknown>>('/monitoring/health', { token: accessToken }),
          adminFetch<Record<string, number>>('/monitoring/counters', { token: accessToken }),
          adminFetch<Record<string, unknown>>('/monitoring/queues', { token: accessToken }),
          adminFetch<{
            cpu_percent?: number;
            memory_heap_mb?: number;
            memory_rss_mb?: number;
            event_loop_lag_ms?: number;
          }>('/monitoring/resources', { token: accessToken }),
          adminFetch<{ score: number }>('/control/health-score', { token: accessToken }),
        ]);

      const clientLatencyMs = Date.now() - fetchStart.current;

      const h = healthRes.status === 'fulfilled' && healthRes.value.success ? healthRes.value.data : null;
      const counters = countersRes.status === 'fulfilled' && countersRes.value.success ? countersRes.value.data : null;
      const resources = resourcesRes.status === 'fulfilled' && resourcesRes.value.success ? resourcesRes.value.data : null;
      const score = scoreRes.status === 'fulfilled' && scoreRes.value.success ? scoreRes.value.data : null;

      if (!h) {
        setError('Failed to fetch system health data');
        setLoading(false);
        return;
      }

      setError(null);

      const gd: SystemHealthGridData = {
        database: {
          status: h.database.status,
          latency_ms: h.database.latency_ms,
          pool_active: h.database.pool_active,
          pool_idle: h.database.pool_idle,
          pool_waiting: h.database.pool_waiting,
        },
        redis: {
          status: h.redis.status,
          latency_ms: h.redis.latency_ms,
          memory_mb: h.redis.memory_mb,
          connected_clients: h.redis.connected_clients,
          ops_per_sec: h.redis.ops_per_sec,
        },
        websocket: {
          status: h.websocket.status,
          connections: h.websocket.connections,
          authenticated: h.websocket.authenticated,
          orderbook_subs: h.websocket.orderbook_subs,
          trade_subs: h.websocket.trade_subs,
        },
        api: {
          latency_ms: clientLatencyMs,
          request_rate: counters?.requests_per_sec,
          error_rate: counters?.error_rate_percent,
        },
        queue: h.queue,
        matchingEngine: {
          latency_ms: counters?.engine_latency_ms,
          orders_per_sec: counters?.orders_per_sec,
        },
        settlement: {
          pending: h.queue.settlement_pending,
          processing_time_ms: counters?.settlement_processing_ms,
          circuit_status: counters?.circuit_breaker_status != null
            ? (counters.circuit_breaker_status === 0 ? 'closed' : 'open')
            : undefined,
        },
        counters: counters ?? undefined,
        resources: resources ?? undefined,
      };

      setGridData(gd);
      if (score) setHealthScore(score.score);

      const ts = nowTimestamp();
      setLastUpdated(ts);

      const point: HistoryPoint = {
        time: ts,
        api: clientLatencyMs,
        db: h.database.latency_ms,
        redis: h.redis.latency_ms,
        queue: h.queue.total_withdrawal_queue,
        settlement: h.queue.settlement_pending,
        ws_connections: h.websocket.connections,
        heap_mb: h.node.memory_heap_mb,
      };
      setHistory((prev) => [...prev.slice(-(HISTORY_MAX - 1)), point]);

      setSparklines((prev) => {
        let next = { ...prev };
        next = pushSparkline(next, 'db_latency', h.database.latency_ms);
        next = pushSparkline(next, 'redis_latency', h.redis.latency_ms);
        next = pushSparkline(next, 'api_latency', clientLatencyMs);
        next = pushSparkline(next, 'ws_connections', h.websocket.connections);
        next = pushSparkline(next, 'ws_authenticated', h.websocket.authenticated);
        next = pushSparkline(next, 'settlement_pending', h.queue.settlement_pending);
        next = pushSparkline(next, 'withdrawal_queue', h.queue.total_withdrawal_queue);
        if (h.database.pool_active != null) next = pushSparkline(next, 'db_pool_active', h.database.pool_active);
        if (h.database.pool_idle != null) next = pushSparkline(next, 'db_pool_idle', h.database.pool_idle);
        if (h.database.pool_waiting != null) next = pushSparkline(next, 'db_pool_waiting', h.database.pool_waiting);
        if (h.redis.memory_mb != null) next = pushSparkline(next, 'redis_memory', h.redis.memory_mb);
        if (h.redis.connected_clients != null) next = pushSparkline(next, 'redis_clients', h.redis.connected_clients);
        if (h.redis.ops_per_sec != null) next = pushSparkline(next, 'redis_ops', h.redis.ops_per_sec);
        if (resources?.event_loop_lag_ms != null) next = pushSparkline(next, 'event_loop_lag', resources.event_loop_lag_ms);
        return next;
      });

      setLoading(false);
    } catch {
      setError('Network error fetching health data');
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0 && !isPaused) {
      intervalRef.current = setInterval(fetchAll, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll, refreshInterval, isPaused]);

  const scoreColor =
    healthScore == null
      ? 'text-zinc-500'
      : healthScore >= 80
        ? 'text-emerald-400'
        : healthScore >= 50
          ? 'text-amber-400'
          : 'text-red-400';

  const scoreRing =
    healthScore == null
      ? 'border-zinc-700'
      : healthScore >= 80
        ? 'border-emerald-500/40'
        : healthScore >= 50
          ? 'border-amber-500/40'
          : 'border-red-500/40';

  const chartPlaceholder = history.length > 0 ? history : [{ time: '—', api: 0, db: 0, redis: 0, queue: 0, settlement: 0, ws_connections: 0, heap_mb: 0 }];

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            System Monitoring
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Real-time infrastructure health &amp; performance metrics
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[11px] text-zinc-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {lastUpdated}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className={`p-2 rounded-lg border transition-colors ${
              isPaused
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchAll(); }}
            disabled={loading}
            className="p-2 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 flex items-center gap-2 text-sm text-red-300">
          <WifiOff className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Top stat row — health score + key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div
          className={`rounded-xl border-2 ${scoreRing} bg-zinc-900 p-4 flex flex-col items-center justify-center min-h-[140px] col-span-1`}
        >
          <Shield className={`w-5 h-5 mb-2 ${scoreColor}`} />
          <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>
            {healthScore ?? '—'}
          </span>
          <span className="text-[11px] text-zinc-500 mt-1 uppercase tracking-wider">
            Health Score
          </span>
        </div>

        <MetricStatPanel
          label="API Latency"
          value={gridData?.api.latency_ms ?? '—'}
          unit="ms"
          sparklineData={sparklines['api_latency']}
          thresholds={[
            { value: 200, level: 'warning' },
            { value: 1000, level: 'critical' },
          ]}
          icon={<Activity className="w-4 h-4" />}
        />
        <MetricStatPanel
          label="DB Latency"
          value={gridData?.database.latency_ms ?? '—'}
          unit="ms"
          sparklineData={sparklines['db_latency']}
          thresholds={[
            { value: 100, level: 'warning' },
            { value: 500, level: 'critical' },
          ]}
        />
        <MetricStatPanel
          label="Redis Latency"
          value={gridData?.redis.latency_ms ?? '—'}
          unit="ms"
          sparklineData={sparklines['redis_latency']}
          thresholds={[
            { value: 50, level: 'warning' },
            { value: 200, level: 'critical' },
          ]}
        />
        <MetricStatPanel
          label="WS Connections"
          value={gridData?.websocket.connections ?? '—'}
          sparklineData={sparklines['ws_connections']}
          icon={gridData?.websocket.status === 'up' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
        />
        <MetricStatPanel
          label="Queue Depth"
          value={gridData?.queue.total_withdrawal_queue ?? '—'}
          sparklineData={sparklines['withdrawal_queue']}
          thresholds={[
            { value: 10, level: 'warning' },
            { value: 25, level: 'critical' },
          ]}
        />
      </div>

      {/* Time series charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeSeriesPanel
          title="Service Latency"
          data={chartPlaceholder}
          lines={[
            { dataKey: 'api', color: '#3b82f6', name: 'API' },
            { dataKey: 'db', color: '#10b981', name: 'Database' },
            { dataKey: 'redis', color: '#f59e0b', name: 'Redis' },
          ]}
          unit="ms"
          currentValue={gridData?.api.latency_ms}
          thresholds={[
            { value: 200, level: 'warning', label: 'Warn 200ms' },
            { value: 1000, level: 'critical', label: 'Crit 1s' },
          ]}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={setRefreshInterval}
        />
        <TimeSeriesPanel
          title="Queue Depth"
          data={chartPlaceholder}
          lines={[
            { dataKey: 'queue', color: '#f59e0b', name: 'Withdrawal Queue' },
            { dataKey: 'settlement', color: '#ef4444', name: 'Settlement Pending' },
          ]}
          currentValue={gridData?.queue.total_withdrawal_queue}
          thresholds={[
            { value: 10, level: 'warning', label: 'Warn' },
            { value: 25, level: 'critical', label: 'Critical' },
          ]}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={setRefreshInterval}
        />
        <TimeSeriesPanel
          title="WebSocket Connections"
          data={chartPlaceholder}
          dataKey="ws_connections"
          lineColor="#8b5cf6"
          currentValue={gridData?.websocket.connections}
          unit="conn"
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={setRefreshInterval}
        />
        <TimeSeriesPanel
          title="Memory (Heap)"
          data={chartPlaceholder}
          dataKey="heap_mb"
          lineColor="#06b6d4"
          currentValue={gridData?.resources?.memory_heap_mb ?? (history.length > 0 ? history[history.length - 1].heap_mb : undefined)}
          unit="MB"
          thresholds={[
            { value: 512, level: 'warning', label: 'Warn 512MB' },
            { value: 1024, level: 'critical', label: 'Crit 1GB' },
          ]}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          refreshInterval={refreshInterval}
          onRefreshIntervalChange={setRefreshInterval}
        />
      </div>

      {/* Full system health grid */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
          Component Breakdown
        </h2>
        <SystemHealthGrid data={gridData} sparklines={sparklines} />
      </div>
    </div>
  );
}
