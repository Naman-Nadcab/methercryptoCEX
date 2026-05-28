/**
 * spot_orders fill updates + spot_trades inserts after a match is settled.
 * Supports unified schema (market, user_id, order_id) and legacy (trading_pair_id, order_status enums, maker/taker rows).
 */
import type { PoolClient } from 'pg';
import { getSpotOrdersUseMarketSync } from '../../lib/spot-schema-cache.js';
import type { SpotTradesShape } from '../../lib/spot-trades-shape.js';

export type MatchPayloadForSpotDb = {
  symbol: string;
  taker_order_id: string;
  maker_order_id: string;
  taker_user_id: string;
  maker_user_id: string;
  taker_side: 'buy' | 'sell';
};

export async function updateSpotOrdersFilledAfterMatch(
  client: PoolClient,
  fillQty: string,
  takerOrderId: string,
  makerOrderId: string
): Promise<void> {
  const useUnified = getSpotOrdersUseMarketSync();
  const sql = useUnified
    ? `UPDATE spot_orders SET filled_quantity = filled_quantity + $1::numeric, status = CASE
         WHEN (quantity::numeric - filled_quantity::numeric - $1::numeric) <= 0 THEN 'FILLED' ELSE 'PARTIALLY_FILLED' END,
         updated_at = NOW() WHERE id = $2::uuid`
    : `UPDATE spot_orders SET filled_quantity = filled_quantity + $1::numeric,
         remaining_quantity = GREATEST(0::numeric, COALESCE(remaining_quantity, quantity)::numeric - $1::numeric),
         status = CASE
           WHEN (quantity::numeric - filled_quantity::numeric - $1::numeric) <= 0 THEN 'filled'
           ELSE 'partially_filled'
         END, updated_at = NOW() WHERE id = $2::uuid`;
  const r1 = await client.query(sql, [fillQty, takerOrderId]);
  if ((r1.rowCount ?? 0) === 0) throw new Error('ORDER_INVARIANT_VIOLATION');
  const r2 = await client.query(sql, [fillQty, makerOrderId]);
  if ((r2.rowCount ?? 0) === 0) throw new Error('ORDER_INVARIANT_VIOLATION');
}

export async function insertSpotTradesAfterMatch(
  client: PoolClient,
  shape: SpotTradesShape,
  p: MatchPayloadForSpotDb,
  args: {
    fillQty: string;
    price: string;
    buyerId: string;
    sellerId: string;
    buyerOrderId: string;
    sellerOrderId: string;
    buyerFee: string;
    sellerFee: string;
    takerFee: string;
    makerFee: string;
    quoteAsset: string;
    /** Notional quote amount (for legacy full-schema `quote_amount`). */
    quoteAmount: string;
    quoteCurrencyId: string;
  }
): Promise<void> {
  const {
    fillQty,
    price,
    buyerId,
    sellerId,
    buyerOrderId,
    sellerOrderId,
    buyerFee,
    sellerFee,
    takerFee,
    makerFee,
    quoteAsset,
    quoteAmount,
    quoteCurrencyId,
  } = args;

  if (shape.hasMarket && shape.hasUserId && shape.hasOrderId) {
    if (shape.hasFee && shape.hasFeeAsset) {
      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1::uuid, $2::uuid, $3, 'buy', $4::numeric, $5::numeric, $6::numeric, $7)`,
        [buyerOrderId, buyerId, p.symbol, price, fillQty, buyerFee, quoteAsset]
      );
      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1::uuid, $2::uuid, $3, 'sell', $4::numeric, $5::numeric, $6::numeric, $7)`,
        [sellerOrderId, sellerId, p.symbol, price, fillQty, sellerFee, quoteAsset]
      );
    } else {
      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity) VALUES ($1::uuid, $2::uuid, $3, 'buy', $4::numeric, $5::numeric)`,
        [buyerOrderId, buyerId, p.symbol, price, fillQty]
      );
      await client.query(
        `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity) VALUES ($1::uuid, $2::uuid, $3, 'sell', $4::numeric, $5::numeric)`,
        [sellerOrderId, sellerId, p.symbol, price, fillQty]
      );
    }
    return;
  }

  const tp = await client.query<{ id: string }>(
    `SELECT id::text FROM trading_pairs WHERE symbol = $1 AND (trading_enabled IS NULL OR trading_enabled = TRUE) LIMIT 1`,
    [p.symbol]
  );
  const tradingPairId = tp.rows[0]?.id;
  if (!tradingPairId) {
    throw new Error('TRADING_PAIR_NOT_FOUND_FOR_SYMBOL');
  }

  /* full-schema.sql style: one row, quote_amount + fee currency UUIDs */
  if (
    shape.columns.has('quote_amount') &&
    shape.hasTradingPairId &&
    shape.hasMakerUserId &&
    shape.hasTakerUserId &&
    shape.hasMakerOrderId &&
    shape.hasTakerOrderId &&
    !shape.hasUserId &&
    shape.columns.has('maker_fee_currency_id') &&
    shape.columns.has('taker_fee_currency_id')
  ) {
    const rowVals = [
      tradingPairId,
      p.maker_order_id,
      p.taker_order_id,
      p.maker_user_id,
      p.taker_user_id,
      price,
      fillQty,
      quoteAmount,
      p.taker_side,
      makerFee,
      quoteCurrencyId,
      takerFee,
      quoteCurrencyId,
    ] as const;
    if (shape.columns.has('side')) {
      await client.query(
        `INSERT INTO spot_trades (
          trading_pair_id, maker_order_id, taker_order_id, maker_user_id, taker_user_id,
          price, quantity, quote_amount, side,
          maker_fee, maker_fee_currency_id, taker_fee, taker_fee_currency_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          $6::numeric, $7::numeric, $8::numeric, $9::order_side,
          $10::numeric, $11::uuid, $12::numeric, $13::uuid
        )`,
        [...rowVals]
      );
    } else if (shape.hasTakerSide) {
      await client.query(
        `INSERT INTO spot_trades (
          trading_pair_id, maker_order_id, taker_order_id, maker_user_id, taker_user_id,
          price, quantity, quote_amount, taker_side,
          maker_fee, maker_fee_currency_id, taker_fee, taker_fee_currency_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          $6::numeric, $7::numeric, $8::numeric, $9::order_side,
          $10::numeric, $11::uuid, $12::numeric, $13::uuid
        )`,
        [...rowVals]
      );
    } else {
      throw new Error('SPOT_TRADES_SCHEMA_UNSUPPORTED: quote_amount row requires side or taker_side column');
    }
    return;
  }

  /* One row per match (maker/taker columns, no user_id) — slim variant without quote_amount */
  if (shape.hasMakerUserId && shape.hasTakerUserId && !shape.hasUserId) {
    const cols = ['trading_pair_id', 'maker_user_id', 'taker_user_id', 'maker_order_id', 'taker_order_id', 'price', 'quantity'];
    const vals: unknown[] = [
      tradingPairId,
      p.maker_user_id,
      p.taker_user_id,
      p.maker_order_id,
      p.taker_order_id,
      price,
      fillQty,
    ];
    if (shape.hasTakerSide) {
      cols.push('taker_side');
      vals.push(p.taker_side);
    }
    if (shape.columns.has('taker_fee')) {
      cols.push('taker_fee');
      vals.push(takerFee);
    }
    if (shape.columns.has('maker_fee')) {
      cols.push('maker_fee');
      vals.push(makerFee);
    }
    const placeholders = cols
      .map((col, i) => {
        const n = i + 1;
        if (
          col === 'trading_pair_id' ||
          col === 'maker_user_id' ||
          col === 'taker_user_id' ||
          col === 'maker_order_id' ||
          col === 'taker_order_id'
        ) {
          return `$${n}::uuid`;
        }
        if (col === 'price' || col === 'quantity' || col === 'taker_fee' || col === 'maker_fee') {
          return `$${n}::numeric`;
        }
        return `$${n}`;
      })
      .join(', ');
    await client.query(`INSERT INTO spot_trades (${cols.join(', ')}) VALUES (${placeholders})`, vals);
    return;
  }

  /* Per-user legs: trading_pair_id + user_id, no order_id */
  if (shape.hasUserId && shape.hasTradingPairId && !shape.hasOrderId) {
    if (shape.hasFee && shape.hasFeeAsset) {
      await client.query(
        `INSERT INTO spot_trades (user_id, trading_pair_id, side, price, quantity, fee, fee_asset)
         VALUES ($1::uuid, $2::uuid, 'buy', $3::numeric, $4::numeric, $5::numeric, $6)`,
        [buyerId, tradingPairId, price, fillQty, buyerFee, quoteAsset]
      );
      await client.query(
        `INSERT INTO spot_trades (user_id, trading_pair_id, side, price, quantity, fee, fee_asset)
         VALUES ($1::uuid, $2::uuid, 'sell', $3::numeric, $4::numeric, $5::numeric, $6)`,
        [sellerId, tradingPairId, price, fillQty, sellerFee, quoteAsset]
      );
    } else if (shape.hasFee) {
      await client.query(
        `INSERT INTO spot_trades (user_id, trading_pair_id, side, price, quantity, fee)
         VALUES ($1::uuid, $2::uuid, 'buy', $3::numeric, $4::numeric, $5::numeric)`,
        [buyerId, tradingPairId, price, fillQty, buyerFee]
      );
      await client.query(
        `INSERT INTO spot_trades (user_id, trading_pair_id, side, price, quantity, fee)
         VALUES ($1::uuid, $2::uuid, 'sell', $3::numeric, $4::numeric, $5::numeric)`,
        [sellerId, tradingPairId, price, fillQty, sellerFee]
      );
    } else {
      await client.query(
        `INSERT INTO spot_trades (user_id, trading_pair_id, side, price, quantity)
         VALUES ($1::uuid, $2::uuid, 'buy', $3::numeric, $4::numeric)`,
        [buyerId, tradingPairId, price, fillQty]
      );
      await client.query(
        `INSERT INTO spot_trades (user_id, trading_pair_id, side, price, quantity)
         VALUES ($1::uuid, $2::uuid, 'sell', $3::numeric, $4::numeric)`,
        [sellerId, tradingPairId, price, fillQty]
      );
    }
    return;
  }

  throw new Error(
    `SPOT_TRADES_SCHEMA_UNSUPPORTED: cannot insert trades; columns=${[...shape.columns].sort().join(',')}`
  );
}
