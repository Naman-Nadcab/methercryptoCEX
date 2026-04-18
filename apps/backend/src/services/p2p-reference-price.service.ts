/**
 * Backend P2P reference price: internal spot last trade with Redis cache.
 * Price is quote (fiat/stable) per 1 unit of base asset (e.g. INR per USDT).
 *
 * Resolution order:
 *   1. Redis cache (short TTL)
 *   2. Stablecoin parity (USDT/USD, USDT/USDT → 1)
 *   3. Last price from internal spot_trades
 *   4. Configured fallback rates (P2P_REFERENCE_FALLBACK_* env or p2p_reference_rates table).
 *      Production should wire a real oracle here; dev uses the fallback map.
 */

import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

const CACHE_PREFIX = 'p2p:ref:';

/**
 * Dev-mode fallback map for pairs where no internal market exists yet.
 * Read from env `P2P_REFERENCE_FALLBACK_<ASSET>_<FIAT>` or falls back to this baseline.
 * NOTE: In production replace with a real price oracle (Binance ticker, Coingecko, etc.).
 */
const FALLBACK_RATES: Record<string, string> = {
  USDT_INR: '83',
  USDC_INR: '83',
  BTC_INR: '5500000',
  ETH_INR: '280000',
};

function fallbackRate(asset: string, fiat: string): string | null {
  const k = `${asset.toUpperCase()}_${fiat.toUpperCase()}`;
  const envKey = `P2P_REFERENCE_FALLBACK_${k}`;
  return process.env[envKey] || FALLBACK_RATES[k] || null;
}

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
    // spot_trades uses trading_pair_id; resolve via trading_pairs.symbol.
    const r = await db.query<{ p: string | null }>(
      `SELECT st.price::text AS p
       FROM spot_trades st
       INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
       WHERE tp.symbol = $1
       ORDER BY st.created_at DESC
       LIMIT 1`,
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
  source: 'spot_trade' | 'stablecoin_parity' | 'cache' | 'fallback';
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
    const fb = fallbackRate(a, f);
    if (fb) {
      logger.info('P2P reference price: using configured fallback rate (no internal market)', {
        asset: a,
        fiat: f,
        rate: fb,
      });
      const fbRes: P2PReferencePriceResult = {
        asset: a,
        fiat: f,
        reference_price: new Decimal(fb).toDecimalPlaces(18, Decimal.ROUND_DOWN).toString(),
        market: null,
        source: 'fallback',
        updated_at: new Date().toISOString(),
      };
      if (ttl > 0) await redis.setJson(ck, fbRes, ttl);
      return fbRes;
    }
    logger.warn('P2P reference price: no spot market and no fallback', { asset: a, fiat: f, candidates });
    throw new Error(`No reference price for ${a}/${f}. Seed a spot market, wire an oracle, or set P2P_REFERENCE_FALLBACK_${a}_${f}.`);
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
