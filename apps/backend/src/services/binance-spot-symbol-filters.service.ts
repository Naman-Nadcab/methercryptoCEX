/**
 * Public Binance Spot exchangeInfo + Redis cache (stepSize, tickSize, minQty, minNotional).
 * No API keys; base_url comes from the liquidity provider row.
 */
import crypto from 'node:crypto';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';

const CACHE_PREFIX = 'hybrid:binance:sym:';
const CACHE_TTL_SEC = 3600;

export type BinanceSymbolFilters = {
  stepSize: DecimalInstance;
  tickSize: DecimalInstance;
  minQty: DecimalInstance;
  minNotional: DecimalInstance;
};

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function cacheKey(baseUrl: string, binanceSymbol: string): string {
  const h = crypto.createHash('sha256').update(trimBaseUrl(baseUrl)).digest('hex').slice(0, 16);
  return `${CACHE_PREFIX}${h}:${binanceSymbol.toUpperCase()}`;
}

/** Clear cached exchangeInfo for all providers (call after provider base_url change). */
export async function invalidateBinanceSymbolFiltersCache(): Promise<void> {
  try {
    const client = redis.getClient();
    let cursor = '0';
    const keys: string[] = [];
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', `${CACHE_PREFIX}*`, 'COUNT', 128);
      cursor = next;
      if (batch.length) keys.push(...batch);
    } while (cursor !== '0');
    if (keys.length) await client.del(...keys);
  } catch (e) {
    logger.warn('binance_symbol_cache_invalidate_failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function parseFilters(symbolPayload: Record<string, unknown>): BinanceSymbolFilters | null {
  const filters = symbolPayload.filters as Array<Record<string, string>> | undefined;
  if (!Array.isArray(filters)) return null;
  let stepSize = '0';
  let tickSize = '0';
  let minQty = '0';
  let minNotional = '0';
  for (const f of filters) {
    const t = f.filterType;
    if (t === 'LOT_SIZE') {
      stepSize = f.stepSize ?? stepSize;
      minQty = f.minQty ?? minQty;
    } else if (t === 'PRICE_FILTER') {
      tickSize = f.tickSize ?? tickSize;
    } else if (t === 'MIN_NOTIONAL' || t === 'NOTIONAL') {
      const mn = f.minNotional ?? f.notional;
      if (mn != null) minNotional = String(mn);
    }
  }
  const step = new Decimal(stepSize);
  const tick = new Decimal(tickSize);
  const minQ = new Decimal(minQty);
  const minN = new Decimal(minNotional);
  if (!step.isFinite() || step.lte(0) || !tick.isFinite() || tick.lte(0)) return null;
  return {
    stepSize: step,
    tickSize: tick,
    minQty: minQ.isFinite() && minQ.gt(0) ? minQ : new Decimal('0'),
    minNotional: minN.isFinite() && minN.gt(0) ? minN : new Decimal('0'),
  };
}

export async function getBinanceSymbolFilters(baseUrl: string, binanceSymbol: string): Promise<BinanceSymbolFilters | null> {
  const sym = binanceSymbol.toUpperCase();
  const key = cacheKey(baseUrl, sym);
  try {
    const hit = await redis.getJson<{
      stepSize: string;
      tickSize: string;
      minQty: string;
      minNotional: string;
    }>(key);
    if (hit) {
      return {
        stepSize: new Decimal(hit.stepSize),
        tickSize: new Decimal(hit.tickSize),
        minQty: new Decimal(hit.minQty),
        minNotional: new Decimal(hit.minNotional),
      };
    }
  } catch {
    /* miss */
  }

  const url = `${trimBaseUrl(baseUrl)}/api/v3/exchangeInfo?symbol=${encodeURIComponent(sym)}`;
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let data: { symbols?: Array<Record<string, unknown>> } = {};
  try {
    data = JSON.parse(text) as { symbols?: Array<Record<string, unknown>> };
  } catch {
    logger.warn('binance_exchangeInfo_parse_failed', { symbol: sym, snippet: text.slice(0, 200) });
    return null;
  }
  const row = data.symbols?.[0];
  if (!row) return null;
  const parsed = parseFilters(row);
  if (!parsed) return null;
  try {
    await redis.setJson(
      key,
      {
        stepSize: parsed.stepSize.toString(),
        tickSize: parsed.tickSize.toString(),
        minQty: parsed.minQty.toString(),
        minNotional: parsed.minNotional.toString(),
      },
      CACHE_TTL_SEC
    );
  } catch {
    /* best-effort */
  }
  return parsed;
}

/** Floor quantity to LOT_SIZE step (never increase qty). */
export function floorQtyToStep(qty: DecimalInstance, step: DecimalInstance): DecimalInstance {
  if (!step.isFinite() || step.lte(0)) return qty;
  return qty.dividedToIntegerBy(step).times(step);
}

/** Limit price: BUY → round up to tick (max willing to pay); SELL → round down to tick. */
export function roundLimitPriceToTick(
  price: DecimalInstance,
  tick: DecimalInstance,
  side: 'BUY' | 'SELL'
): DecimalInstance {
  if (!tick.isFinite() || tick.lte(0)) return price;
  if (side === 'BUY') {
    return price.div(tick).ceil().times(tick);
  }
  return price.div(tick).floor().times(tick);
}

export function stripDecimalString(d: DecimalInstance): string {
  const s = d.toString();
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}
