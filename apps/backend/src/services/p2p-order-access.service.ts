import { db } from '../lib/database.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** Buyer or seller may subscribe to WS room `p2p.order.{orderId}`. */
export async function userHasP2POrderAccess(userId: string, orderId: string): Promise<boolean> {
  if (!isUuid(orderId)) return false;
  const r = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM p2p_orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2) LIMIT 1`,
    [orderId, userId]
  );
  return r.rows.length > 0;
}
