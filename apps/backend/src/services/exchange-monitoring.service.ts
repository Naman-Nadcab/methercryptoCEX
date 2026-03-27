/**
 * PHASE-13: Exchange monitoring, detection & forensics.
 * Observability only: no trading or balance logic. Records signals for alerts and dashboards.
 * CRITICAL: Counters are Redis-backed (atomic INCR) for restart-safe, cluster-consistent metrics.
 * Redis failure must NOT break financial logic: fail-safe fallback to in-memory + log.
 */

import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { sendAlertWebhook } from '../lib/alert-webhook.js';

const LOG_CATEGORY = 'EXCHANGE_MONITOR';
const REDIS_PREFIX = 'monitoring:';

/** Fallback when Redis unavailable; never used for safety logic. */
const counters: Map<string, number> = new Map();

function increment(key: string, delta = 1): void {
  const redisKey = REDIS_PREFIX + key;
  redis.incr(redisKey).catch((err) => {
    counters.set(key, (counters.get(key) ?? 0) + delta);
    logger.warn('Monitoring counter fallback to in-memory (Redis unavailable)', { key, error: err instanceof Error ? err.message : String(err) });
  });
}

function emit(event: string, payload: Record<string, unknown>): void {
  logger.info(LOG_CATEGORY, { event, ...payload });
}

// ---------------------------------------------------------------------------
// PART 1 — Balance & invariant monitoring
// ---------------------------------------------------------------------------

export function recordInvariantViolation(params: {
  label: string;
  reason: string;
  debit?: string;
  available?: string;
  locked?: string;
}): void {
  const key = `invariant_violation.${params.reason}`;
  increment(key);
  emit('invariant_violation', {
    label: params.label,
    reason: params.reason,
    debit: params.debit,
    available: params.available,
    locked: params.locked,
  });
}

// ---------------------------------------------------------------------------
// PART 2 — Escrow & P2P monitoring
// ---------------------------------------------------------------------------

export type EscrowEventType =
  | 'release'
  | 'refund'
  | 'release_idempotent'
  | 'refund_idempotent'
  | 'move_to_escrow'
  | 'near_cap_attempt'
  | 'cap_exceeded_count'
  | 'cap_exceeded_total';

export function recordEscrowEvent(params: {
  type: EscrowEventType;
  userId?: string;
  sellerId?: string;
  escrowId?: string;
  amount?: string;
  count?: number;
  total?: string;
}): void {
  const key = `escrow.${params.type}`;
  increment(key);
  emit('escrow_event', params);
}

// ---------------------------------------------------------------------------
// PART 3 — Settlement & ledger monitoring
// ---------------------------------------------------------------------------

export type SettlementEventType =
  | 'replay_detected'
  | 'failure_fatal'
  | 'failure_retry'
  | 'failure_max_retries'
  | 'circuit_triggered'
  | 'balance_ledger_divergence'
  | 'processed';

export function recordSettlementEvent(params: {
  type: SettlementEventType;
  settlementEventId?: number;
  engineEventId?: number;
  error?: string;
  retryCount?: number;
  userId?: string;
  asset?: string;
  balancesTotal?: string;
  ledgerSum?: string;
}): void {
  const key = `settlement.${params.type}`;
  increment(key);
  emit('settlement_event', params);
}

// ---------------------------------------------------------------------------
// PART 4 — Risk engine observability
// ---------------------------------------------------------------------------

export function recordRiskDecision(params: {
  scope: string;
  decision: 'allow' | 'challenge' | 'block';
  score: number;
  actorId?: string | null;
  requestId?: string | null;
}): void {
  const key = `risk.${params.scope}.${params.decision}`;
  increment(key);
  emit('risk_decision', params);
}

// ---------------------------------------------------------------------------
// PART 5 — Abuse & velocity visibility
// ---------------------------------------------------------------------------

export type AbuseEventType =
  | 'velocity_exceeded'
  | 'escrow_cap_count_exceeded'
  | 'escrow_cap_total_exceeded'
  | 'near_velocity_threshold'
  | 'near_escrow_cap';

export function recordAbuseEvent(params: {
  type: AbuseEventType;
  userId?: string;
  count?: number;
  total?: string;
  limit?: number;
}): void {
  const key = `abuse.${params.type}`;
  increment(key);
  emit('abuse_event', params);
}

// ---------------------------------------------------------------------------
// PART 6 — Operational safety signals
// ---------------------------------------------------------------------------

export type OperationalEventType =
  | 'halt_toggle'
  | 'halt_redis_error'
  | 'settlement_worker_error'
  | 'settlement_worker_start'
  | 'settlement_worker_stop'
  | 'circuit_open'
  | 'wallet_cache_divergence';

export function recordOperationalEvent(params: {
  type: OperationalEventType;
  halted?: boolean;
  error?: string;
  violation?: string;
  chainId?: string;
  asset?: string;
  cacheBalance?: string;
  liveBalance?: string;
}): void {
  const key = `operational.${params.type}`;
  increment(key);
  emit('operational_event', params);

  if (params.type === 'circuit_open') {
    void sendAlertWebhook({
      type: 'circuit_open',
      violation: params.violation,
      message: 'Settlement circuit breaker opened. No further settlements until investigation.',
    });
  }
}

/** PHASE-16: Emit when RPC live balance differs from balance_cache. No financial mutation; alert only. */
export function recordWalletCacheDivergence(params: {
  chainId: string;
  asset: string;
  cacheBalance: string;
  liveBalance: string;
}): void {
  recordOperationalEvent({
    type: 'wallet_cache_divergence',
    chainId: params.chainId,
    asset: params.asset,
    cacheBalance: params.cacheBalance,
    liveBalance: params.liveBalance,
  });
}

// ---------------------------------------------------------------------------
// Metrics surface (for /metrics or dashboard)
// ---------------------------------------------------------------------------

/** Returns Redis-backed counters; on Redis failure returns in-memory fallback. Never throws. */
export async function getMonitoringCounters(): Promise<Record<string, number>> {
  try {
    const client = redis.getClient();
    const keys = await client.keys(REDIS_PREFIX + '*');
    const out: Record<string, number> = {};
    for (const fullKey of keys) {
      const shortKey = fullKey.startsWith(REDIS_PREFIX) ? fullKey.slice(REDIS_PREFIX.length) : fullKey;
      const v = await redis.get(fullKey);
      out[shortKey] = parseInt(v ?? '0', 10) || 0;
    }
    if (keys.length > 0) return out;
  } catch (err) {
    logger.warn('getMonitoringCounters: Redis unavailable, using in-memory fallback', { error: err instanceof Error ? err.message : String(err) });
  }
  const out: Record<string, number> = {};
  for (const [k, v] of counters.entries()) {
    out[k] = v;
  }
  return out;
}

/** Reset in-memory fallback only (e.g. for tests). Redis keys are not cleared. */
export function resetMonitoringCounters(): void {
  counters.clear();
}
