/**
 * PHASE-12: Exchange abuse & fraud resilience. High-severity protections only.
 * - P2P: escrow exhaustion cap (transactional with row-level lock), order velocity
 * - Trading halt check
 * - Risk evaluation hook for P2P
 */

import { Decimal } from '../lib/decimal.js';
import type { PoolClient } from 'pg';
import { db } from '../lib/database.js';
import { getTradingHalted } from '../lib/trading-halt.js';
import { evaluateAndLogRisk } from './risk-engine.service.js';
import type { RiskDecision } from './risk-engine.service.js';
import { logger } from '../lib/logger.js';
import { recordAbuseEvent } from './exchange-monitoring.service.js';

/** Max open P2P escrows (status=locked) per user. Prevents escrow exhaustion attacks. */
const P2P_MAX_OPEN_ESCROWS_PER_USER = 30;

/** Max total amount (sum of locked escrow amounts) per user. String for Decimal. */
const P2P_MAX_ESCROW_TOTAL_PER_USER = '500000';

/** P2P order creation velocity: max orders per user in last 1 hour. */
const P2P_ORDER_VELOCITY_WINDOW_MINUTES = 60;
const P2P_ORDER_VELOCITY_MAX = 20;

/**
 * Returns true if global trading halt is active. Call before spot order place and P2P order create.
 */
export async function isTradingHalted(): Promise<boolean> {
  return getTradingHalted();
}

/**
 * CONCURRENCY-SAFE: Enforce escrow cap inside the SAME transaction that will perform moveToEscrow.
 * Uses row-level locking (FOR UPDATE) on seller's locked escrows so concurrent orders for the same
 * seller serialize; cap is evaluated against transactionally visible state before any insert.
 * Call this immediately before moveToEscrow(client) in the same transaction.
 *
 * Pattern: lock escrows for seller → recompute count/sum in same tx → enforce caps → caller does insert.
 */
export async function assertP2PEscrowCapInTransaction(
  sellerId: string,
  additionalAmount: string,
  client: PoolClient
): Promise<void> {
  await client.query(
    `SELECT id FROM escrows WHERE user_id = $1 AND status = 'locked' FOR UPDATE`,
    [sellerId]
  );
  const countRow = await client.query<{ count: string; total: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS total
     FROM escrows WHERE user_id = $1 AND status = 'locked'`,
    [sellerId]
  );
  const count = parseInt(countRow.rows[0]?.count ?? '0', 10);
  const totalStr = countRow.rows[0]?.total ?? '0';
  const newTotal = new Decimal(totalStr).plus(additionalAmount);
  const cap = new Decimal(P2P_MAX_ESCROW_TOTAL_PER_USER);
  if (count >= P2P_MAX_OPEN_ESCROWS_PER_USER) {
    logger.warn('P2P escrow cap: max open escrows exceeded', { userId: sellerId, count });
    recordAbuseEvent({
      type: 'escrow_cap_count_exceeded',
      userId: sellerId,
      count,
      limit: P2P_MAX_OPEN_ESCROWS_PER_USER,
    });
    throw new Error('P2P_ESCROW_CAP_EXCEEDED');
  }
  if (newTotal.gt(cap)) {
    logger.warn('P2P escrow cap: max total escrow exceeded', { userId: sellerId, newTotal: newTotal.toString() });
    recordAbuseEvent({
      type: 'escrow_cap_total_exceeded',
      userId: sellerId,
      total: newTotal.toString(),
    });
    throw new Error('P2P_ESCROW_TOTAL_CAP_EXCEEDED');
  }
}

/**
 * NOT safe under concurrency. Use only for read-only / best-effort (e.g. UI). For order creation
 * enforcement, use assertP2PEscrowCapInTransaction inside the same transaction as moveToEscrow.
 */
export async function assertP2PEscrowCap(sellerId: string, additionalAmount: string): Promise<void> {
  const countRow = await db.query<{ count: string; total: string }>(
    `SELECT COUNT(*)::text AS count, COALESCE(SUM(amount), 0)::text AS total
     FROM escrows WHERE user_id = $1 AND status = 'locked'`,
    [sellerId]
  );
  const count = parseInt(countRow.rows[0]?.count ?? '0', 10);
  const totalStr = countRow.rows[0]?.total ?? '0';
  const newTotal = new Decimal(totalStr).plus(additionalAmount);
  const cap = new Decimal(P2P_MAX_ESCROW_TOTAL_PER_USER);
  if (count >= P2P_MAX_OPEN_ESCROWS_PER_USER) {
    logger.warn('P2P escrow cap: max open escrows exceeded', { userId: sellerId, count });
    recordAbuseEvent({
      type: 'escrow_cap_count_exceeded',
      userId: sellerId,
      count,
      limit: P2P_MAX_OPEN_ESCROWS_PER_USER,
    });
    throw new Error('P2P_ESCROW_CAP_EXCEEDED');
  }
  if (newTotal.gt(cap)) {
    logger.warn('P2P escrow cap: max total escrow exceeded', { userId: sellerId, newTotal: newTotal.toString() });
    recordAbuseEvent({
      type: 'escrow_cap_total_exceeded',
      userId: sellerId,
      total: newTotal.toString(),
    });
    throw new Error('P2P_ESCROW_TOTAL_CAP_EXCEEDED');
  }
}

/**
 * CONCURRENCY-SAFE: P2P order velocity inside the same transaction, after caller has locked the user row.
 * Call with the transaction client after: SELECT id FROM users WHERE id = $userId FOR UPDATE.
 * Ensures velocity limit cannot be bypassed by concurrent requests (same user serialized).
 */
export async function assertP2POrderVelocityInTransaction(userId: string, client: PoolClient): Promise<void> {
  const r = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM p2p_orders
     WHERE (buyer_id = $1 OR seller_id = $1) AND created_at > NOW() - ($2 || ' minutes')::interval`,
    [userId, P2P_ORDER_VELOCITY_WINDOW_MINUTES]
  );
  const count = parseInt(r.rows[0]?.count ?? '0', 10);
  if (count >= P2P_ORDER_VELOCITY_MAX) {
    logger.warn('P2P order velocity exceeded', { userId, count });
    recordAbuseEvent({
      type: 'velocity_exceeded',
      userId,
      count,
      limit: P2P_ORDER_VELOCITY_MAX,
    });
    throw new Error('P2P_ORDER_VELOCITY_EXCEEDED');
  }
}

/**
 * NOT safe under concurrency. Use only for read-only / best-effort. For order creation enforcement
 * use assertP2POrderVelocityInTransaction inside the same transaction after locking the user row.
 */
export async function assertP2POrderVelocity(userId: string): Promise<void> {
  const r = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM p2p_orders
     WHERE (buyer_id = $1 OR seller_id = $1) AND created_at > NOW() - ($2 || ' minutes')::interval`,
    [userId, P2P_ORDER_VELOCITY_WINDOW_MINUTES]
  );
  const count = parseInt(r.rows[0]?.count ?? '0', 10);
  if (count >= P2P_ORDER_VELOCITY_MAX) {
    logger.warn('P2P order velocity exceeded', { userId, count });
    recordAbuseEvent({
      type: 'velocity_exceeded',
      userId,
      count,
      limit: P2P_ORDER_VELOCITY_MAX,
    });
    throw new Error('P2P_ORDER_VELOCITY_EXCEEDED');
  }
}

/**
 * Evaluate risk for P2P create order. Returns decision; caller should block if decision === 'block'.
 */
export async function evaluateP2PRisk(params: {
  userId: string;
  requestId?: string | null;
  ip?: string | null;
  deviceId?: string | null;
  countryCode?: string | null;
  isVpnOrTor?: boolean;
}): Promise<RiskDecision> {
  const result = await evaluateAndLogRisk({
    scope: 'p2p',
    actorType: 'user',
    actorId: params.userId,
    context: {
      userId: params.userId,
      ip: params.ip,
      countryCode: params.countryCode,
      deviceId: params.deviceId,
      isVpnOrTor: params.isVpnOrTor,
      requestId: params.requestId,
    },
    requestId: params.requestId,
    ipAddress: params.ip,
  });
  return result.decision;
}
