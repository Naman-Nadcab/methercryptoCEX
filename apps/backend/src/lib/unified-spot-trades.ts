/**
 * SQL abstraction: normalized spot_trades as unified_trades (user_id, market, side, qty, price, fee, created_at).
 * Use in WITH clauses so risk / manipulation queries do not branch on schema manually.
 */
import type { SpotTradesShape } from './spot-trades-shape.js';

const CTE_NAME = 'unified_trades';

function feeExprUnified(shape: SpotTradesShape): string {
  return shape.hasFee ? 'COALESCE(fee::numeric, 0)' : '0::numeric';
}

function feeExprSt(shape: SpotTradesShape): string {
  return shape.hasFee ? 'COALESCE(st.fee::numeric, 0)' : '0::numeric';
}

/**
 * Returns `unified_trades AS (...)` for use in `WITH unified_trades AS (...), ...`
 * Columns: user_id, market, side ('buy'|'sell'), qty, price, fee, created_at, trade_id
 */
export function buildUnifiedSpotTradesCte(shape: SpotTradesShape | null, cteName = CTE_NAME): string | null {
  if (!shape) return null;

  if (shape.hasUserId && shape.hasMarket) {
    const fe = feeExprUnified(shape);
    return `${cteName} AS (
      SELECT user_id,
        market::text AS market,
        lower(side::text) AS side,
        quantity::numeric AS qty,
        price::numeric AS price,
        ${fe} AS fee,
        created_at,
        id::text AS trade_id
      FROM spot_trades
    )`;
  }

  if (shape.hasMakerUserId && shape.hasTakerUserId && shape.hasTradingPairId && !shape.hasUserId) {
    const sideCol = shape.hasTakerSide ? 'st.taker_side' : 'st.side';
    const fe = feeExprSt(shape);
    return `${cteName} AS (
      SELECT st.taker_user_id AS user_id,
        tp.symbol::text AS market,
        CASE WHEN lower(${sideCol}::text) IN ('buy','b') THEN 'buy' ELSE 'sell' END AS side,
        st.quantity::numeric AS qty,
        st.price::numeric AS price,
        ${fe} AS fee,
        st.created_at,
        st.id::text AS trade_id
      FROM spot_trades st
      INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
      UNION ALL
      SELECT st.maker_user_id,
        tp.symbol::text,
        CASE WHEN lower(${sideCol}::text) IN ('buy','b') THEN 'sell' ELSE 'buy' END,
        st.quantity::numeric,
        st.price::numeric,
        0::numeric AS fee,
        st.created_at,
        st.id::text
      FROM spot_trades st
      INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
    )`;
  }

  return null;
}

/** Prefix for queries: `WITH ${cte}, ...` */
export function withUnifiedSpotTrades(shape: SpotTradesShape | null, innerSql: string, cteName = CTE_NAME): string | null {
  const cte = buildUnifiedSpotTradesCte(shape, cteName);
  if (!cte) return null;
  return `WITH ${cte}\n${innerSql}`;
}

/**
 * One row per trade for market-level volume/price stats (pump detection). Not for per-user legs.
 */
export function buildMarketTradesCte(shape: SpotTradesShape | null, cteName = 'market_trades'): string | null {
  if (!shape) return null;
  if (shape.hasMarket) {
    return `${cteName} AS (
      SELECT market::text AS market, price::numeric AS price, quantity::numeric AS qty, created_at
      FROM spot_trades
    )`;
  }
  if (shape.hasTradingPairId) {
    return `${cteName} AS (
      SELECT tp.symbol::text AS market, st.price::numeric AS price, st.quantity::numeric AS qty, st.created_at
      FROM spot_trades st
      INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
    )`;
  }
  return null;
}
