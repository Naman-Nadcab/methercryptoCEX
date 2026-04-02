/**
 * Canonical settlement ledger deltas for a match event (same math as settlement-worker).
 * Used for audits and must stay in sync with processSettlementEventRow ledger lines.
 */
import { Decimal, type DecimalInstance } from '../../lib/decimal.js';
import { tradeValue, takerFee, makerFee } from './decimal-utils.js';

export interface EnginePayloadForLedger {
  price: string;
  qty: string;
  taker_user_id: string;
  maker_user_id: string;
  taker_side: 'buy' | 'sell';
}

export interface MarketPrecisionForLedger {
  base: string;
  quote: string;
  price_precision: number;
  qty_precision: number;
  quote_precision: number;
}

/**
 * Four ledger lines per fill (taker/maker × base/quote), ROUND_DOWN everywhere (worker parity).
 */
export function computeSettlementLedgerDeltasFromPayload(
  p: EnginePayloadForLedger,
  market: MarketPrecisionForLedger,
  makerRebatesEnabled: boolean
): { user_id: string; asset: string; delta: DecimalInstance }[] {
  const ROUND_DOWN = 1;
  new Decimal(p.price).toDecimalPlaces(market.price_precision, ROUND_DOWN);
  const qty = new Decimal(p.qty).toDecimalPlaces(market.qty_precision, ROUND_DOWN);
  const tradeVal = tradeValue(p.price, p.qty).toDecimalPlaces(market.quote_precision, ROUND_DOWN);
  const takerFeeAmt = takerFee(tradeVal).toDecimalPlaces(market.quote_precision, ROUND_DOWN);
  const makerFeeAmt = makerFee(tradeVal).toDecimalPlaces(market.quote_precision, ROUND_DOWN);
  const makerQuoteNetCredit = (makerRebatesEnabled
    ? tradeVal.plus(makerFeeAmt)
    : tradeVal.minus(makerFeeAmt)).toDecimalPlaces(market.quote_precision, ROUND_DOWN);
  const takerQuoteNetCredit = tradeVal.minus(takerFeeAmt).toDecimalPlaces(market.quote_precision, ROUND_DOWN);
  const { base, quote } = market;
  const takerId = p.taker_user_id;
  const makerId = p.maker_user_id;
  if (p.taker_side === 'buy') {
    return [
      { user_id: takerId, asset: base, delta: qty },
      { user_id: takerId, asset: quote, delta: tradeVal.negated().minus(takerFeeAmt) },
      { user_id: makerId, asset: base, delta: qty.negated() },
      { user_id: makerId, asset: quote, delta: makerQuoteNetCredit },
    ];
  }
  return [
    { user_id: takerId, asset: base, delta: qty.negated() },
    { user_id: takerId, asset: quote, delta: takerQuoteNetCredit },
    { user_id: makerId, asset: base, delta: qty },
    { user_id: makerId, asset: quote, delta: tradeVal.negated().minus(makerFeeAmt) },
  ];
}
