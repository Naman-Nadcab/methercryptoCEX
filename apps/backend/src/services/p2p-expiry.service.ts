/**
 * PHASE-11: P2P order timeout/expiry. Safe unlock: refund escrow only; no illegal balance mutation.
 * Idempotent: expired orders are skipped if already refunded/completed.
 * Uses Redis lock to prevent duplicate execution across multiple instances.
 */

import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { refundFromEscrow } from './p2p-escrow.service.js';
import { logger } from '../lib/logger.js';

const P2P_ORDER_STATUS_PAYMENT_PENDING = 'awaiting_payment';
const P2P_EXPIRY_LOCK_KEY = 'p2p_expiry:run';
const P2P_EXPIRY_LOCK_TTL_MS = 120_000; // 2 minutes

/**
 * Process expired P2P orders: status = payment_pending and expires_at < NOW().
 * Refunds escrow to seller and marks order expired. Safe under replay (refundFromEscrow is idempotent).
 * Distributed lock prevents duplicate processing across multiple server instances.
 */
export async function processExpiredP2POrders(): Promise<{ processed: number; errors: number }> {
  const lockValue = await redis.acquireLock(P2P_EXPIRY_LOCK_KEY, P2P_EXPIRY_LOCK_TTL_MS, 1, 0);
  if (!lockValue) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;

  const expired = await db.query<{ id: string; escrow_id: string; ad_id: string; quantity: string }>(
    `SELECT id, escrow_id, ad_id, COALESCE(quantity::text, crypto_amount::text, '0') AS quantity FROM p2p_orders
     WHERE status = $1 AND expires_at < NOW() AND escrow_id IS NOT NULL
     ORDER BY expires_at ASC
     LIMIT 100`,
    [P2P_ORDER_STATUS_PAYMENT_PENDING]
  );

  for (const row of expired.rows) {
    try {
      await db.transaction(async (client) => {
        const current = await client.query<{ status: string }>(
          'SELECT status FROM p2p_orders WHERE id = $1 FOR UPDATE',
          [row.id]
        );
        if (current.rows.length === 0 || current.rows[0]?.status !== P2P_ORDER_STATUS_PAYMENT_PENDING) return;

        const refundResult = await refundFromEscrow(row.escrow_id, client);
        if (refundResult.alreadyRefunded) {
          await client.query(
            `UPDATE p2p_orders SET status = 'expired', updated_at = NOW() WHERE id = $1`,
            [row.id]
          );
          processed++;
          return;
        }

        await client.query(
          `UPDATE p2p_orders SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
        if (row.quantity && row.ad_id) {
          await client.query(
            `UPDATE p2p_ads SET available_amount = available_amount + $2, updated_at = NOW() WHERE id = $1`,
            [row.ad_id, row.quantity]
          );
        }
        processed++;
      });
    } catch (e) {
      errors++;
      logger.error('P2P expiry: failed to process order', { orderId: row.id, error: e });
    }
  }

  await redis.releaseLock(P2P_EXPIRY_LOCK_KEY, lockValue).catch(() => {});
  return { processed, errors };
}
