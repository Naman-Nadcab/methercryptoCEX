/**
 * Legacy in-process SQL matcher (price-time). Kept for reference and ad-hoc tooling;
 * production place-order and stop-trigger paths use the Rust HTTP engine only.
 */
import { Decimal } from '../lib/decimal.js';
import {
  debitLockedTradingBalance,
  creditTradingBalance,
} from './spot-balance.service.js';
import * as spotMetrics from './spot-metrics.service.js';
import {
  debitAmountQuote,
  debitAmountBase,
  toDecimalPlaces,
  ROUND_DOWN,
} from './spot-decimal.js';
import { getFeeRatesForUser } from './volume-fee-tier.service.js';
import type { PoolClient } from 'pg';

export type MarketRow = {
  base_asset: string;
  quote_asset: string;
  maker_fee: string | null;
  taker_fee: string | null;
};

export type OrderRow = {
  id: string;
  user_id: string;
  market: string;
  side: string;
  type: string;
  price: string | null;
  quantity: string;
  filled_quantity: string;
  status: string;
};

export type TimeInForce = 'gtc' | 'ioc' | 'fok';

/** Executed trade info for AML recording (recordAndEvaluate). One record per fill. */
export type ExecutedTrade = {
  buyerId: string;
  sellerId: string;
  baseAsset: string;
  quoteAsset: string;
  quantity: string;
  price: string;
  quoteValue: string;
};

export type MatchingOutcome = {
  executedTrades: ExecutedTrade[];
  /** Remaining taker quantity resting on the book (limit / GTC). */
  resting?: { side: 'buy' | 'sell'; price: string; quantity: string };
};

/** Returns total fillable quantity for an incoming limit order (read-only, for FOK pre-check). */
export async function getFillableQuantity(
  client: PoolClient,
  market: string,
  side: string,
  price: string,
  excludeUserId: string
): Promise<string> {
  const isBuy = side === 'buy';
  const oppositeSide = isBuy ? 'sell' : 'buy';
  const priceCond = isBuy ? 'AND o.price <= $4' : 'AND o.price >= $4';
  const params: unknown[] = [market, oppositeSide, excludeUserId, price];
  const r = await client.query<{ sum: string }>(
    `SELECT COALESCE(SUM((o.quantity::numeric - o.filled_quantity::numeric)), 0)::text as sum
     FROM spot_orders o
     WHERE o.market = $1 AND o.side = $2 AND o.status IN ('OPEN', 'PARTIALLY_FILLED') AND o.user_id != $3
       AND (o.quantity - o.filled_quantity) > 0 ${priceCond}`,
    params
  );
  return r.rows[0]?.sum ?? '0';
}

export async function runMatching(
  client: PoolClient,
  incomingOrder: OrderRow,
  m: MarketRow,
  baseCurrencyId: string,
  quoteCurrencyId: string,
  pricePrecision: number,
  qtyPrecision: number,
  timeInForce: TimeInForce = 'gtc'
): Promise<MatchingOutcome> {
  const executedTrades: ExecutedTrade[] = [];
  const incomingQty = new Decimal(incomingOrder.quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
  const incomingFilled = new Decimal(incomingOrder.filled_quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
  const remaining = incomingQty.minus(incomingFilled).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
  if (remaining.lte(0)) return { executedTrades, resting: undefined };

  const isBuy = incomingOrder.side === 'buy';
  const oppositeSide = isBuy ? 'sell' : 'buy';
  const orderBy = isBuy ? 'ORDER BY price ASC, created_at ASC' : 'ORDER BY price DESC, created_at ASC';
  const params: unknown[] = [incomingOrder.market, oppositeSide, incomingOrder.user_id];
  const priceCond = incomingOrder.price ? (isBuy ? 'AND o.price <= $4' : 'AND o.price >= $4') : '';
  if (incomingOrder.price) params.push(incomingOrder.price);

  const candidates = await client.query(
    `SELECT id, user_id, price::text as price, quantity::text, filled_quantity::text
     FROM spot_orders o
     WHERE o.market = $1 AND o.side = $2 AND o.status IN ('OPEN', 'PARTIALLY_FILLED') AND o.user_id != $3
       AND (o.quantity - o.filled_quantity) > 0 ${priceCond}
     ${orderBy}`,
    params
  ) as { rows: Array<{ id: string; user_id: string; price: string; quantity: string; filled_quantity: string }> };

  const feeCache = new Map<string, { maker: string; taker: string }>();
  const getSellerFeeRate = async (sellerId: string, asMaker: boolean): Promise<string> => {
    let rates = feeCache.get(sellerId);
    if (!rates) {
      rates = await getFeeRatesForUser(sellerId);
      feeCache.set(sellerId, rates);
    }
    return asMaker ? rates.maker : rates.taker;
  };

  let filledIncoming = incomingFilled;
  for (const other of candidates.rows) {
    if (filledIncoming.gte(incomingQty)) break;
    const otherQty = new Decimal(other.quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const otherFilled = new Decimal(other.filled_quantity).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const otherRemaining = otherQty.minus(otherFilled).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const remainingIncoming = incomingQty.minus(filledIncoming).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const matchQtyDec = (remainingIncoming.lte(otherRemaining) ? remainingIncoming : otherRemaining).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    if (matchQtyDec.lte(0)) continue;

    const tradePriceDec = new Decimal(other.price).toDecimalPlaces(pricePrecision, ROUND_DOWN);
    const quoteAmountDec = tradePriceDec.times(matchQtyDec).toDecimalPlaces(pricePrecision, ROUND_DOWN);
    const sellerFeeRate = await getSellerFeeRate(other.user_id, isBuy);
    const sellerFeeRateDec = new Decimal(sellerFeeRate).toDecimalPlaces(pricePrecision, ROUND_DOWN);
    const feeAmountDec = quoteAmountDec.times(sellerFeeRateDec).toDecimalPlaces(pricePrecision, ROUND_DOWN);
    const buyerReceivesQtyStr = toDecimalPlaces(matchQtyDec, qtyPrecision);
    const sellerReceivesQuoteStr = quoteAmountDec.minus(feeAmountDec).toDecimalPlaces(pricePrecision, ROUND_DOWN).toString();
    const debitQuoteStr = debitAmountQuote(tradePriceDec.toString(), matchQtyDec.toString(), pricePrecision);
    const debitBaseStr = debitAmountBase(matchQtyDec.toString(), qtyPrecision);

    const buyerId = isBuy ? incomingOrder.user_id : other.user_id;
    const sellerId = isBuy ? other.user_id : incomingOrder.user_id;

    await client.query(
      `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1, $2, $3, 'buy', $4, $5, 0, $6)`,
      [isBuy ? incomingOrder.id : other.id, buyerId, incomingOrder.market, tradePriceDec.toString(), matchQtyDec.toString(), m.quote_asset]
    );
    await client.query(
      `INSERT INTO spot_trades (order_id, user_id, market, side, price, quantity, fee, fee_asset) VALUES ($1, $2, $3, 'sell', $4, $5, $6, $7)`,
      [isBuy ? other.id : incomingOrder.id, sellerId, incomingOrder.market, tradePriceDec.toString(), matchQtyDec.toString(), feeAmountDec.toString(), m.quote_asset]
    );
    executedTrades.push({
      buyerId,
      sellerId,
      baseAsset: m.base_asset,
      quoteAsset: m.quote_asset,
      quantity: matchQtyDec.toString(),
      price: tradePriceDec.toString(),
      quoteValue: quoteAmountDec.toString(),
    });
    spotMetrics.recordTrade();

    if (isBuy) {
      const buyerQuoteDebited = await debitLockedTradingBalance(buyerId, quoteCurrencyId, debitQuoteStr, client);
      if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      await creditTradingBalance(buyerId, baseCurrencyId, buyerReceivesQtyStr, client);
      const sellerBaseDebited = await debitLockedTradingBalance(sellerId, baseCurrencyId, debitBaseStr, client);
      if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      await creditTradingBalance(sellerId, quoteCurrencyId, sellerReceivesQuoteStr, client);
    } else {
      const sellerBaseDebited = await debitLockedTradingBalance(sellerId, baseCurrencyId, debitBaseStr, client);
      if (!sellerBaseDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      await creditTradingBalance(sellerId, quoteCurrencyId, sellerReceivesQuoteStr, client);
      const buyerQuoteDebited = await debitLockedTradingBalance(buyerId, quoteCurrencyId, debitQuoteStr, client);
      if (!buyerQuoteDebited) throw new Error('INSUFFICIENT_LOCKED_FUNDS');
      await creditTradingBalance(buyerId, baseCurrencyId, buyerReceivesQtyStr, client);
    }

    const newOtherFilled = otherFilled.plus(matchQtyDec).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
    const otherStatus = newOtherFilled.gte(otherQty) ? 'FILLED' : 'PARTIALLY_FILLED';
    await client.query(
      `UPDATE spot_orders SET filled_quantity = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [other.id, newOtherFilled.toString(), otherStatus]
    );
    filledIncoming = filledIncoming.plus(matchQtyDec).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
  }

  // IOC/FOK: cancel unfilled portion
  let incomingStatus: string;
  if (timeInForce === 'ioc' || timeInForce === 'fok') {
    if (filledIncoming.gte(incomingQty)) {
      incomingStatus = 'FILLED';
    } else {
      // FOK with partial fill: treat as cancelled (FOK means fill 100% or kill - we got partial so "kill")
      // IOC with partial: cancel unfilled
      incomingStatus = 'CANCELLED';
    }
  } else {
    incomingStatus = filledIncoming.gte(incomingQty) ? 'FILLED' : (filledIncoming.gt(0) ? 'PARTIALLY_FILLED' : 'OPEN');
  }

  const newIncomingFilledStr = filledIncoming.toString();
  await client.query(
    `UPDATE spot_orders SET filled_quantity = $2, status = $3, updated_at = NOW() WHERE id = $1`,
    [incomingOrder.id, newIncomingFilledStr, incomingStatus]
  );

  const remainingOnBook = incomingQty.minus(filledIncoming).toDecimalPlaces(qtyPrecision, ROUND_DOWN);
  let resting: MatchingOutcome['resting'];
  if (
    (incomingStatus === 'OPEN' || incomingStatus === 'PARTIALLY_FILLED') &&
    incomingOrder.price &&
    remainingOnBook.gt(0)
  ) {
    resting = {
      side: isBuy ? 'buy' : 'sell',
      price: incomingOrder.price,
      quantity: remainingOnBook.toString(),
    };
  }
  return { executedTrades, resting };
}
