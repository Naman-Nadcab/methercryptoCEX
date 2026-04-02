/**
 * Backend P2P reference price: internal spot last trade with Redis cache.
 * Price is quote (fiat/stable) per 1 unit of base asset (e.g. INR per USDT).
 */

import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const CACHE_PREFIX = 'p2p:ref:';

function cacheKey(asset: string, fiat: string): string {
  return `${CACHE_PREFIX}${asset.toUpperCase()}:${fiat.toUpperCase()}`;
}

/** Candidate spot `market` strings (spot_trades.market) for base/fiat pair. */
export function spotMarketCandidates(baseSymbol: string, fiat: string): string[] {
  const b = baseSymbol.toUpperCase().trim();
  const f = fiat.toUpperCase().trim();
  const out: string[] = [];
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  push(`${b}_${f}`);
  push(`${b}${f}`);
  push(`${b}-${f}`);
  if (f === 'USD' || f === 'USDT') {
    push(`${b}_USDT`);
    push(`${b}_USD`);
    push(`${b}USDT`);
  }
  if (b === 'USDT' && (f === 'USD' || f === 'USDT')) {
    push('USDT_USDT');
    push('USDT_USD');
  }
  return out;
}

async function lastTradePrice(market: string): Promise<string | null> {
  try {
    const r = await db.query<{ p: string | null }>(
      `SELECT price::text AS p FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1`,
      [market]
    );
    return r.rows[0]?.p ?? null;
  } catch {
    return null;
  }
}

export type P2PReferencePriceResult = {
  asset: string;
  fiat: string;
  reference_price: string;
  market: string | null;
  source: 'spot_trade' | 'stablecoin_parity' | 'cache';
  updated_at: string;
};

/**
 * Resolve reference price (fiat per 1 crypto) from spot trades; cache in Redis.
 */
export async function getP2PReferencePrice(asset: string, fiat: string): Promise<P2PReferencePriceResult> {
  const a = asset.toUpperCase().trim();
  const f = fiat.toUpperCase().trim();
  const ttl = config.p2p.referencePriceTtlSec;
  const ck = cacheKey(a, f);

  if (ttl > 0) {
    const cached = await redis.getJson<P2PReferencePriceResult>(ck);
    if (cached?.reference_price) {
      return { ...cached, source: 'cache' };
    }
  }

  if (a === 'USDT' && (f === 'USD' || f === 'USDT')) {
    const res: P2PReferencePriceResult = {
      asset: a,
      fiat: f,
      reference_price: '1',
      market: null,
      source: 'stablecoin_parity',
      updated_at: new Date().toISOString(),
    };
    if (ttl > 0) await redis.setJson(ck, res, ttl);
    return res;
  }

  const candidates = spotMarketCandidates(a, f);
  let usedMarket: string | null = null;
  let priceStr: string | null = null;
  for (const m of candidates) {
    const p = await lastTradePrice(m);
    if (p && new Decimal(p).greaterThan(0)) {
      usedMarket = m;
      priceStr = p;
      break;
    }
  }

  if (!priceStr) {
    logger.warn('P2P reference price: no spot market', { asset: a, fiat: f, candidates });
    throw new Error(`No internal reference price for ${a}/${f}. Ensure a spot market exists and has trades.`);
  }

  const res: P2PReferencePriceResult = {
    asset: a,
    fiat: f,
    reference_price: new Decimal(priceStr).toDecimalPlaces(18, Decimal.ROUND_DOWN).toString(),
    market: usedMarket,
    source: 'spot_trade',
    updated_at: new Date().toISOString(),
  };
  if (ttl > 0) await redis.setJson(ck, res, ttl);
  return res;
}

/** Decimal reference for order/ad math (throws if unavailable). */
export async function getP2PReferencePriceDecimal(asset: string, fiat: string): Promise<DecimalInstance> {
  const r = await getP2PReferencePrice(asset, fiat);
  const d = new Decimal(r.reference_price);
  if (!d.isFinite() || d.lessThanOrEqualTo(0)) {
    throw new Error('Invalid reference price');
  }
  return d;
}

/**
 * Ad/order price from reference and margin percent (margin is percent points, e.g. 2 => +2%).
 */
export function applyFloatingMargin(reference: DecimalInstance, marginPercent: string | number): string {
  const m = new Decimal(marginPercent);
  const mult = new Decimal(1).plus(m.div(100));
  return reference.times(mult).toDecimalPlaces(18, Decimal.ROUND_DOWN).toString();
}
