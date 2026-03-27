/**
 * Phase E: SLO (Service Level Objective) status for dashboards and alerting.
 * Aggregates settlement pending, order latency, trading halt into a single status.
 */
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { getSpotMetrics } from './spot-metrics.service.js';
import { getTradingHalted } from '../lib/trading-halt.js';
import { getSettlementCircuitOpen } from '../lib/trading-halt.js';

export interface SloStatus {
  status: 'ok' | 'degraded' | 'critical';
  timestamp: string;
  instance_id: string;
  slo: {
    settlement_pending: { value: number; limit: number; ok: boolean };
    order_latency_p99_ms: { value: number | null; limit: number; ok: boolean };
    trading_halted: { value: boolean; ok: boolean };
    settlement_circuit_open: { value: boolean; ok: boolean };
  };
  services?: {
    database: boolean;
    redis?: boolean;
  };
}

export async function getSloStatus(): Promise<SloStatus> {
  const now = new Date().toISOString();
  const instanceId = config.nodeId;

  let settlementPending = 0;
  let tradingHalted = false;
  let settlementCircuitOpen = false;
  let dbOk = false;

  try {
    const [setRes, halted, circuit] = await Promise.all([
      db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM settlement_events WHERE status = 'pending'`).catch(() => ({ rows: [{ n: '0' }] })),
      getTradingHalted().catch(() => false),
      getSettlementCircuitOpen().catch(() => false),
    ]);
    settlementPending = parseInt(setRes.rows[0]?.n ?? '0', 10) || 0;
    tradingHalted = halted;
    settlementCircuitOpen = circuit;
    dbOk = true;
  } catch {
    /* db or halt check failed */
  }

  const spot = getSpotMetrics();
  const orderLatencyP99Ms = spot.orderLatencyP99Ms ?? null;

  const settlementLimit = config.slo.settlementPendingMax;
  const latencyLimit = config.slo.orderLatencyP99MsMax;

  const settlementOk = settlementPending <= settlementLimit;
  const latencyOk = orderLatencyP99Ms === null || orderLatencyP99Ms <= latencyLimit;
  const tradingOk = !tradingHalted;
  const circuitOk = !settlementCircuitOpen;

  const slo = {
    settlement_pending: { value: settlementPending, limit: settlementLimit, ok: settlementOk },
    order_latency_p99_ms: { value: orderLatencyP99Ms, limit: latencyLimit, ok: latencyOk },
    trading_halted: { value: tradingHalted, ok: tradingOk },
    settlement_circuit_open: { value: settlementCircuitOpen, ok: circuitOk },
  };

  const allOk = settlementOk && latencyOk && tradingOk && circuitOk;
  const anyCritical = !settlementOk || !tradingOk || !circuitOk;
  const status: SloStatus['status'] = anyCritical ? 'critical' : (allOk ? 'ok' : 'degraded');

  return {
    status,
    timestamp: now,
    instance_id: instanceId,
    slo,
    services: dbOk ? { database: true } : undefined,
  };
}
