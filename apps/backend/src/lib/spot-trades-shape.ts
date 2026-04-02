/**
 * Cached spot_trades column layout for dynamic SQL (unified vs legacy maker/taker / trading_pair_id).
 */
import { db } from './database.js';

export type SpotTradesShape = {
  columns: Set<string>;
  hasMarket: boolean;
  hasTradingPairId: boolean;
  hasUserId: boolean;
  hasOrderId: boolean;
  hasMakerUserId: boolean;
  hasTakerUserId: boolean;
  hasMakerOrderId: boolean;
  hasTakerOrderId: boolean;
  hasTakerSide: boolean;
  hasFeeAsset: boolean;
  hasFee: boolean;
};

let cached: SpotTradesShape | null = null;

export async function loadSpotTradesShape(): Promise<SpotTradesShape> {
  if (cached) return cached;
  const r = await db.query<{ c: string }>(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'spot_trades'`
  );
  const columns = new Set(r.rows.map((x) => x.c));
  cached = {
    columns,
    hasMarket: columns.has('market'),
    hasTradingPairId: columns.has('trading_pair_id'),
    hasUserId: columns.has('user_id'),
    hasOrderId: columns.has('order_id'),
    hasMakerUserId: columns.has('maker_user_id'),
    hasTakerUserId: columns.has('taker_user_id'),
    hasMakerOrderId: columns.has('maker_order_id'),
    hasTakerOrderId: columns.has('taker_order_id'),
    hasTakerSide: columns.has('taker_side'),
    hasFeeAsset: columns.has('fee_asset'),
    hasFee: columns.has('fee'),
  };
  return cached;
}

export function getSpotTradesShapeSync(): SpotTradesShape | null {
  return cached;
}

/** For tests / hot reload */
export function resetSpotTradesShapeCache(): void {
  cached = null;
}
