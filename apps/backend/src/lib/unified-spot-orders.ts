/**
 * SQL abstraction: normalized spot_orders as unified_orders (user_id, market, status, created_at, order_id).
 */
const CTE_NAME = 'unified_orders';

export function buildUnifiedSpotOrdersCte(useMarket: boolean, cteName = CTE_NAME): string {
  if (useMarket) {
    return `${cteName} AS (
      SELECT user_id,
        market::text AS market,
        status::text AS status,
        created_at,
        id::text AS order_id
      FROM spot_orders
    )`;
  }
  return `${cteName} AS (
    SELECT o.user_id,
      tp.symbol::text AS market,
      o.status::text AS status,
      o.created_at,
      o.id::text AS order_id
    FROM spot_orders o
    JOIN trading_pairs tp ON tp.id = o.trading_pair_id
  )`;
}

const OPEN_STATUSES = `('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER','new','partially_filled','pending_trigger')`;

/** Open orders with remaining qty and quote asset for max-notional checks. */
export function buildOpenOrdersNotionalSql(useMarket: boolean): string {
  const rem = `COALESCE(o.remaining_quantity::numeric, (o.quantity::numeric - COALESCE(o.filled_quantity::numeric, 0)))::text`;
  if (useMarket) {
    return `SELECT o.price::text, ${rem} AS remaining_quantity, m.quote_asset
      FROM spot_orders o
      JOIN spot_markets m ON m.symbol = o.market
      WHERE o.user_id = $1::uuid AND o.status::text IN ${OPEN_STATUSES}`;
  }
  return `SELECT o.price::text, ${rem} AS remaining_quantity, m.quote_asset
    FROM spot_orders o
    JOIN trading_pairs tp ON tp.id = o.trading_pair_id
    JOIN spot_markets m ON m.symbol = tp.symbol
    WHERE o.user_id = $1::uuid AND o.status::text IN ${OPEN_STATUSES}`;
}
