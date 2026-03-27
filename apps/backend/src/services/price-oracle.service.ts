/**
 * Phase D: Price oracle.
 * Fetches spot prices from an external API (e.g. Binance) and upserts into market_prices
 * for convert, balance valuation, and liquidity bot mid price.
 */
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { getCurrencyIdBySymbol } from '../lib/currency-resolver.js';

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/price';
const FETCH_TIMEOUT_MS = 10_000;

export interface OraclePrice {
  symbol: string;
  price: string;
}

/**
 * Fetch all ticker prices from Binance. Symbols are like BTCUSDT, ETHUSDT.
 */
export async function fetchBinancePrices(): Promise<OraclePrice[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(BINANCE_TICKER_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Binance API ${res.status}`);
    const data = (await res.json()) as Array<{ symbol: string; price: string }>;
    return data.map((t) => ({ symbol: t.symbol, price: t.price }));
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Map exchange symbol (e.g. BTC_USDT) to oracle symbol (e.g. BTCUSDT).
 */
function toOracleSymbol(marketSymbol: string): string {
  return marketSymbol.replace(/_/g, '').replace(/-/g, '');
}

/**
 * Update market_prices from oracle. Uses spot_markets to get base/quote and currency IDs;
 * fetches prices from Binance and upserts. Only updates pairs that exist in spot_markets
 * and have matching currency rows.
 */
export async function runPriceOracleUpdate(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  const markets = await db.query<{ symbol: string; base_asset: string; quote_asset: string; base_currency_id: string | null; quote_currency_id: string | null }>(
    `SELECT symbol, base_asset, quote_asset, base_currency_id, quote_currency_id FROM spot_markets WHERE status IN ('active', 'maintenance')`
  );

  let prices: OraclePrice[] = [];
  try {
    prices = await fetchBinancePrices();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('Price oracle: fetch failed', { error: msg });
    return { updated: 0, errors: [msg] };
  }

  const priceBySymbol = new Map(prices.map((p) => [p.symbol.toUpperCase(), p.price]));

  for (const m of markets.rows) {
    const baseId = m.base_currency_id ?? (await getCurrencyIdBySymbol(m.base_asset)) ?? null;
    const quoteId = m.quote_currency_id ?? (await getCurrencyIdBySymbol(m.quote_asset)) ?? null;
    if (!baseId || !quoteId) {
      errors.push(`Missing currency for ${m.symbol}`);
      continue;
    }
    const oracleSym = toOracleSymbol(m.symbol);
    const priceStr = priceBySymbol.get(oracleSym);
    if (!priceStr || !Number.isFinite(parseFloat(priceStr))) {
      continue;
    }
    try {
      await db.query(
        `INSERT INTO market_prices (base_currency_id, quote_currency_id, price, last_updated)
         VALUES ($1, $2, $3::numeric, NOW())
         ON CONFLICT (base_currency_id, quote_currency_id)
         DO UPDATE SET price = $3::numeric, last_updated = NOW()`,
        [baseId, quoteId, priceStr]
      );
      updated++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${m.symbol}: ${msg}`);
    }
  }

  if (updated > 0) {
    logger.debug('Price oracle updated', { updated, pairs: updated });
  }
  return { updated, errors };
}
