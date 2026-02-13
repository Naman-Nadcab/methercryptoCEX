/**
 * Offline-safe settlement replay integrity check.
 * Recomputes trade_value, fees, ledger deltas, and settlement hash from stored
 * settlement_events and ledger; compares to stored hash. On mismatch logs CRITICAL
 * SETTLEMENT_REPLAY_MISMATCH. Does NOT auto-repair.
 * No DB mutations during replay; read-only.
 */
import crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { Decimal, type DecimalInstance } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { tradeValue, takerFee, makerFee, toNumeric } from './decimal-utils.js';
import { SETTLEMENT_EVENT_DOMAIN } from './settlement-hash-constants.js';

interface EnginePayload {
  event_id: number;
  symbol: string;
  price: string;
  qty: string;
  taker_order_id: string;
  maker_order_id: string;
  taker_user_id: string;
  maker_user_id: string;
  taker_side: 'buy' | 'sell';
  timestamp?: number;
}

async function resolveMarketAssets(
  client: PoolClient,
  symbol: string
): Promise<{ base: string; quote: string; price_precision: number; qty_precision: number; quote_precision: number }> {
  const r = await client.query<{
    base_asset: string;
    quote_asset: string;
    price_precision: number;
    qty_precision: number;
    quote_precision: number;
  }>(`SELECT base_asset, quote_asset, price_precision, qty_precision, quote_precision FROM markets WHERE symbol = $1`, [
    symbol,
  ]);
  if (r.rows.length === 0) {
    throw new Error('MARKET_NOT_FOUND');
  }
  const row = r.rows[0]!;
  return {
    base: row.base_asset,
    quote: row.quote_asset,
    price_precision: typeof row.price_precision === 'number' ? row.price_precision : 8,
    qty_precision: typeof row.qty_precision === 'number' ? row.qty_precision : 8,
    quote_precision: typeof row.quote_precision === 'number' ? row.quote_precision : 8,
  };
}

export async function replaySettlementIntegrityCheck(): Promise<{ ok: boolean; mismatches: number }> {
  const client = await db.getSettlementClient();
  let mismatches = 0;
  try {
    const events = await client.query<{
      id: number;
      engine_event_id: number;
      payload: EnginePayload;
      hash: string | null;
    }>(
      `SELECT id, engine_event_id, payload, hash FROM settlement_events WHERE status = 'processed' AND hash IS NOT NULL ORDER BY engine_event_id ASC`
    );

    for (const row of events.rows) {
      const p = row.payload;
      const storedHash = row.hash ?? '';
      const { base, quote, quote_precision, price_precision, qty_precision } = await resolveMarketAssets(client, p.symbol);
      const ROUND_DOWN = 1;
      /* Same rounding as worker: price→price_precision, qty→qty_precision, trade_value & fees→quote_precision. */
      const price = new Decimal(p.price).toDecimalPlaces(price_precision, ROUND_DOWN);
      const qty = new Decimal(p.qty).toDecimalPlaces(qty_precision, ROUND_DOWN);
      const tradeVal = tradeValue(p.price, p.qty).toDecimalPlaces(quote_precision, ROUND_DOWN);
      const takerFeeAmt = takerFee(tradeVal).toDecimalPlaces(quote_precision, ROUND_DOWN);
      const makerFeeAmt = makerFee(tradeVal).toDecimalPlaces(quote_precision, ROUND_DOWN);
      const takerId = p.taker_user_id;
      const makerId = p.maker_user_id;
      const makerQuoteNetCredit = tradeVal.minus(makerFeeAmt).toDecimalPlaces(quote_precision, ROUND_DOWN);
      const takerQuoteNetCredit = tradeVal.minus(takerFeeAmt).toDecimalPlaces(quote_precision, ROUND_DOWN);

      const ledgerDeltas: { user_id: string; asset: string; delta: DecimalInstance }[] = [];
      if (p.taker_side === 'buy') {
        ledgerDeltas.push(
          { user_id: takerId, asset: base, delta: qty },
          { user_id: takerId, asset: quote, delta: tradeVal.negated().minus(takerFeeAmt) },
          { user_id: makerId, asset: base, delta: qty.negated() },
          { user_id: makerId, asset: quote, delta: makerQuoteNetCredit },
        );
      } else {
        ledgerDeltas.push(
          { user_id: takerId, asset: base, delta: qty.negated() },
          { user_id: takerId, asset: quote, delta: takerQuoteNetCredit },
          { user_id: makerId, asset: base, delta: qty },
          { user_id: makerId, asset: quote, delta: tradeVal.negated().minus(makerFeeAmt) },
        );
      }
      ledgerDeltas.sort((a, b) => (a.user_id === b.user_id ? a.asset.localeCompare(b.asset) : a.user_id.localeCompare(b.user_id)));
      const ledgerLines = ledgerDeltas.map((ld) => `${ld.user_id}|${ld.asset}|${toNumeric(ld.delta)}`).join('\n');

      const payloadSorted = (Object.keys(p) as (keyof EnginePayload)[]).sort();
      const payloadCanonical = JSON.stringify(
        payloadSorted.map((k) => [k, (p as unknown as Record<string, unknown>)[k]])
      );
      const hashPayload = [
        SETTLEMENT_EVENT_DOMAIN,
        payloadCanonical,
        toNumeric(tradeVal),
        toNumeric(takerFeeAmt),
        toNumeric(makerFeeAmt),
        ledgerLines,
      ].join('|');
      const computedHash = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');

      if (computedHash !== storedHash) {
        mismatches++;
        logger.error('SETTLEMENT_REPLAY_MISMATCH', {
          message: 'Settlement replay integrity check failed; recomputed hash does not match stored hash.',
          level: 'CRITICAL',
          settlement_event_id: row.id,
          engine_event_id: row.engine_event_id,
          stored_hash: storedHash,
          computed_hash: computedHash,
          diagnostic: 'Do NOT auto-repair; investigate event and ledger.',
        });
      }
    }
    return { ok: mismatches === 0, mismatches };
  } finally {
    client.release();
  }
}
