'use client';

import { MetricStatPanel } from './MetricStatPanel';
import { Database, Server, Radio, Zap, ArrowRightLeft, Activity } from 'lucide-react';

interface DatabaseMetrics {
  status: string;
  latency_ms: number;
  pool_active?: number;
  pool_idle?: number;
  pool_waiting?: number;
}

interface RedisMetrics {
  status: string;
  latency_ms: number;
  memory_mb?: number;
  connected_clients?: number;
  ops_per_sec?: number;
}

interface WebSocketMetrics {
  status: string;
  connections: number;
  authenticated: number;
  orderbook_subs?: number;
  trade_subs?: number;
}

interface MatchingEngineMetrics {
  latency_ms?: number;
  orders_per_sec?: number;
  status?: string;
}

interface SettlementMetrics {
  pending: number;
  processing_time_ms?: number;
  circuit_status?: string;
}

interface ApiMetrics {
  latency_ms: number;
  request_rate?: number;
  error_rate?: number;
}

interface QueueMetrics {
  settlement_pending: number;
  withdrawal_pending: number;
  withdrawal_signing: number;
  withdrawal_broadcast: number;
  total_withdrawal_queue: number;
}

export interface SystemHealthGridData {
  database: DatabaseMetrics;
  redis: RedisMetrics;
  websocket: WebSocketMetrics;
  matchingEngine?: MatchingEngineMetrics;
  settlement?: SettlementMetrics;
  api: ApiMetrics;
  queue: QueueMetrics;
  counters?: Record<string, number>;
  resources?: {
    cpu_percent?: number;
    memory_heap_mb?: number;
    memory_rss_mb?: number;
    event_loop_lag_ms?: number;
  };
}

interface SparklineStore {
  [key: string]: number[];
}

interface SystemHealthGridProps {
  data: SystemHealthGridData | null;
  sparklines?: SparklineStore;
  className?: string;
}

export function SystemHealthGrid({ data, sparklines = {}, className = '' }: SystemHealthGridProps) {
  if (!data) {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 ${className}`}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 min-h-[140px] animate-pulse"
          >
            <div className="h-3 w-20 bg-zinc-800 rounded mb-4" />
            <div className="h-6 w-16 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Database section */}
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" /> Database
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricStatPanel
            label="Query Latency"
            value={data.database.latency_ms}
            unit="ms"
            sparklineData={sparklines['db_latency']}
            thresholds={[
              { value: 100, level: 'warning' },
              { value: 500, level: 'critical' },
            ]}
            description={data.database.status}
            icon={<Database className="w-4 h-4" />}
          />
          <MetricStatPanel
            label="Pool Active"
            value={data.database.pool_active ?? 0}
            sparklineData={sparklines['db_pool_active']}
            thresholds={[
              { value: 15, level: 'warning' },
              { value: 19, level: 'critical' },
            ]}
          />
          <MetricStatPanel
            label="Pool Idle"
            value={data.database.pool_idle ?? 0}
            sparklineData={sparklines['db_pool_idle']}
          />
          <MetricStatPanel
            label="Pool Waiting"
            value={data.database.pool_waiting ?? 0}
            sparklineData={sparklines['db_pool_waiting']}
            thresholds={[
              { value: 3, level: 'warning' },
              { value: 8, level: 'critical' },
            ]}
          />
        </div>
      </div>

      {/* Redis section */}
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5" /> Redis
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricStatPanel
            label="Latency"
            value={data.redis.latency_ms}
            unit="ms"
            sparklineData={sparklines['redis_latency']}
            thresholds={[
              { value: 50, level: 'warning' },
              { value: 200, level: 'critical' },
            ]}
            description={data.redis.status}
            icon={<Server className="w-4 h-4" />}
          />
          <MetricStatPanel
            label="Memory"
            value={data.redis.memory_mb ?? 0}
            unit="MB"
            sparklineData={sparklines['redis_memory']}
            thresholds={[
              { value: 500, level: 'warning' },
              { value: 900, level: 'critical' },
            ]}
          />
          <MetricStatPanel
            label="Clients"
            value={data.redis.connected_clients ?? 0}
            sparklineData={sparklines['redis_clients']}
          />
          <MetricStatPanel
            label="Ops/sec"
            value={data.redis.ops_per_sec ?? 0}
            sparklineData={sparklines['redis_ops']}
          />
        </div>
      </div>

      {/* WebSocket section */}
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5" /> WebSocket
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricStatPanel
            label="Connections"
            value={data.websocket.connections}
            sparklineData={sparklines['ws_connections']}
            description={data.websocket.status}
            icon={<Radio className="w-4 h-4" />}
          />
          <MetricStatPanel
            label="Authenticated"
            value={data.websocket.authenticated}
            sparklineData={sparklines['ws_authenticated']}
          />
          <MetricStatPanel
            label="Orderbook Subs"
            value={data.websocket.orderbook_subs ?? 0}
            sparklineData={sparklines['ws_orderbook']}
          />
          <MetricStatPanel
            label="Trade Subs"
            value={data.websocket.trade_subs ?? 0}
            sparklineData={sparklines['ws_trades']}
          />
        </div>
      </div>

      {/* Matching Engine & Settlement */}
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" /> Matching Engine & Settlement
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricStatPanel
            label="Engine Latency"
            value={data.matchingEngine?.latency_ms ?? 0}
            unit="ms"
            sparklineData={sparklines['engine_latency']}
            thresholds={[
              { value: 10, level: 'warning' },
              { value: 50, level: 'critical' },
            ]}
            icon={<Zap className="w-4 h-4" />}
          />
          <MetricStatPanel
            label="Orders/sec"
            value={data.matchingEngine?.orders_per_sec ?? 0}
            sparklineData={sparklines['engine_ops']}
          />
          <MetricStatPanel
            label="Settlement Pending"
            value={data.queue.settlement_pending}
            sparklineData={sparklines['settlement_pending']}
            thresholds={[
              { value: 10, level: 'warning' },
              { value: 50, level: 'critical' },
            ]}
            icon={<ArrowRightLeft className="w-4 h-4" />}
          />
          <MetricStatPanel
            label="Processing Time"
            value={data.settlement?.processing_time_ms ?? 0}
            unit="ms"
            sparklineData={sparklines['settlement_time']}
          />
          <MetricStatPanel
            label="Circuit Status"
            value={data.settlement?.circuit_status ?? 'closed'}
            description={data.settlement?.circuit_status === 'open' ? 'Halted' : 'Healthy'}
          />
          <MetricStatPanel
            label="Withdrawal Queue"
            value={data.queue.total_withdrawal_queue}
            sparklineData={sparklines['withdrawal_queue']}
            thresholds={[
              { value: 10, level: 'warning' },
              { value: 25, level: 'critical' },
            ]}
          />
        </div>
      </div>

      {/* API section */}
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> API
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricStatPanel
            label="API Latency"
            value={data.api.latency_ms}
            unit="ms"
            sparklineData={sparklines['api_latency']}
            thresholds={[
              { value: 200, level: 'warning' },
              { value: 1000, level: 'critical' },
            ]}
            icon={<Activity className="w-4 h-4" />}
          />
          <MetricStatPanel
            label="Request Rate"
            value={data.api.request_rate ?? 0}
            unit="req/s"
            sparklineData={sparklines['api_rps']}
          />
          <MetricStatPanel
            label="Error Rate"
            value={data.api.error_rate ?? 0}
            unit="%"
            sparklineData={sparklines['api_errors']}
            thresholds={[
              { value: 1, level: 'warning' },
              { value: 5, level: 'critical' },
            ]}
          />
          {data.resources && (
            <MetricStatPanel
              label="Event Loop Lag"
              value={data.resources.event_loop_lag_ms ?? 0}
              unit="ms"
              sparklineData={sparklines['event_loop_lag']}
              thresholds={[
                { value: 50, level: 'warning' },
                { value: 200, level: 'critical' },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
