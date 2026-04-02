/**
 * Spot market maker/taker fee rates for MM spread and PnL math.
 */
import { db } from '../lib/database.js';

export type MarketFeeRates = {
  makerFeeRate: number;
  takerFeeRate: number;
  makerFeeBps: number;
  takerFeeBps: number;
};

export async function getMarketFeeRates(symbol: string): Promise<MarketFeeRates> {
  const defaults = { makerFeeRate: 0.001, takerFeeRate: 0.001, makerFeeBps: 10, takerFeeBps: 10 };
  try {
    const r = await db.query<{ mf: string; tf: string }>(
      `SELECT COALESCE(maker_fee, 0.001)::text AS mf, COALESCE(taker_fee, 0.001)::text AS tf
       FROM spot_markets WHERE symbol = $1 LIMIT 1`,
      [symbol]
    );
    const row = r.rows[0];
    if (!row) return defaults;
    const makerFeeRate = parseFloat(row.mf) || 0.001;
    const takerFeeRate = parseFloat(row.tf) || 0.001;
    return {
      makerFeeRate,
      takerFeeRate,
      makerFeeBps: makerFeeRate * 10_000,
      takerFeeBps: takerFeeRate * 10_000,
    };
  } catch {
    return defaults;
  }
}
