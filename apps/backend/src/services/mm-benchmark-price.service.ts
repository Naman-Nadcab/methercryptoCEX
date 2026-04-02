/**
 * Quant benchmark for edge / MTM: trimmed (outlier-filtered) internal VWAP, optionally blended with external mid.
 */
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { getSpotTradesUseMarketSync } from '../lib/spot-schema-cache.js';
import { aggregateExternalMidPrice } from './external-price-feed.service.js';
import { getReliableMicroprice } from './mm-microprice.service.js';

export type BenchmarkSource =
  | 'filtered_vwap'
  | 'external_blended'
  | 'raw_vwap'
  | 'oracle_mid'
  | 'microprice_blended';

export type BenchmarkPriceResult = {
  price: number | null;
  source: BenchmarkSource;
  /** Internal trimmed VWAP (same window) when available. */
  filteredVwap: number | null;
  externalMid: number | null;
};

export type AlphaBenchmarkResult = BenchmarkPriceResult & {
  microprice: number | null;
  /** False when book depth/spread/jump gates reject microprice for this tick. */
  micropriceReliable: boolean;
  /** VWAP/external/oracle blend before microprice overlay. */
  preMicroBlendPrice: number | null;
};

async function trimmedVwapSql(symbol: string, windowSec: number, outlierMaxBps: number): Promise<number | null> {
  const w = Math.max(30, Math.floor(windowSec));
  const bps = Math.max(5, outlierMaxBps);
  const useMarket = getSpotTradesUseMarketSync();
  try {
    const sql = useMarket
      ? `
      WITH t AS (
        SELECT price::numeric AS p, quantity::numeric AS q
        FROM spot_trades
        WHERE market = $1
          AND created_at > NOW() - ($2::text || ' seconds')::interval
      ),
      med AS (
        SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY p) AS m FROM t
      )
      SELECT
        CASE WHEN SUM(f.q) > 0 THEN SUM(f.p * f.q) / SUM(f.q) ELSE NULL END AS vwap
      FROM t f
      CROSS JOIN med
      WHERE med.m > 0
        AND ABS(f.p - med.m) / med.m * 10000 <= $3::numeric`
      : `
      WITH t AS (
        SELECT st.price::numeric AS p, st.quantity::numeric AS q
        FROM spot_trades st
        INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
        WHERE tp.symbol = $1
          AND st.created_at > NOW() - ($2::text || ' seconds')::interval
      ),
      med AS (
        SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY p) AS m FROM t
      )
      SELECT
        CASE WHEN SUM(f.q) > 0 THEN SUM(f.p * f.q) / SUM(f.q) ELSE NULL END AS vwap
      FROM t f
      CROSS JOIN med
      WHERE med.m > 0
        AND ABS(f.p - med.m) / med.m * 10000 <= $3::numeric`;
    const r = await db.query<{ vwap: string | null }>(sql, [symbol, String(w), String(bps)]);
    const v = r.rows[0]?.vwap;
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function rawVwap(symbol: string, windowSec: number): Promise<number | null> {
  const w = Math.max(1, Math.floor(windowSec));
  const useMarket = getSpotTradesUseMarketSync();
  try {
    if (useMarket) {
      const r = await db.query<{ pq: string; q: string }>(
        `SELECT COALESCE(SUM(price::numeric * quantity::numeric), 0)::text AS pq,
                COALESCE(SUM(quantity::numeric), 0)::text AS q
         FROM spot_trades
         WHERE market = $1 AND created_at > NOW() - ($2::text || ' seconds')::interval`,
        [symbol, String(w)]
      );
      const pq = parseFloat(r.rows[0]?.pq ?? '0') || 0;
      const q = parseFloat(r.rows[0]?.q ?? '0') || 0;
      return q > 0 ? pq / q : null;
    }
    const r = await db.query<{ pq: string; q: string }>(
      `SELECT COALESCE(SUM(st.price::numeric * st.quantity::numeric), 0)::text AS pq,
              COALESCE(SUM(st.quantity::numeric), 0)::text AS q
       FROM spot_trades st
       INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
       WHERE tp.symbol = $1 AND st.created_at > NOW() - ($2::text || ' seconds')::interval`,
      [symbol, String(w)]
    );
    const pq = parseFloat(r.rows[0]?.pq ?? '0') || 0;
    const q = parseFloat(r.rows[0]?.q ?? '0') || 0;
    return q > 0 ? pq / q : null;
  } catch {
    return null;
  }
}

/**
 * Blended benchmark: β·external_mid + (1−β)·trimmed_internal_VWAP, with fallbacks.
 */
export async function getBlendedBenchmarkPrice(
  symbol: string,
  windowSec: number,
  oracleMid: number | null
): Promise<BenchmarkPriceResult> {
  const em = config.eliteMm;
  const filt = await trimmedVwapSql(symbol, windowSec, em.benchOutlierMaxBps);
  const raw = filt == null ? await rawVwap(symbol, windowSec) : null;
  const filteredVwap = filt ?? raw;

  let externalMid: number | null = null;
  if (config.externalPriceFeed.enabled && em.benchExternalBlend > 0) {
    const agg = await aggregateExternalMidPrice(symbol);
    externalMid = agg.mid;
  }

  const beta = Math.max(0, Math.min(1, em.benchExternalBlend));
  let price: number | null = null;
  let source: BenchmarkSource = 'filtered_vwap';

  if (externalMid != null && externalMid > 0 && filteredVwap != null && filteredVwap > 0) {
    price = beta * externalMid + (1 - beta) * filteredVwap;
    source = 'external_blended';
  } else if (filteredVwap != null && filteredVwap > 0) {
    price = filteredVwap;
    source = filt != null ? 'filtered_vwap' : 'raw_vwap';
  } else if (externalMid != null && externalMid > 0) {
    price = externalMid;
    source = 'external_blended';
  } else if (oracleMid != null && oracleMid > 0) {
    price = oracleMid;
    source = 'oracle_mid';
  }

  return { price, source, filteredVwap: filt ?? null, externalMid };
}

/**
 * Final alpha benchmark: ω_μ·μ + (1−ω_μ)·P_blend (trimmed VWAP / external / oracle stack).
 */
export async function getAlphaBenchmarkPrice(
  symbol: string,
  windowSec: number,
  oracleMid: number | null
): Promise<AlphaBenchmarkResult> {
  const em = config.eliteMm;
  const base = await getBlendedBenchmarkPrice(symbol, windowSec, oracleMid);
  const pre = base.price;
  const rel = await getReliableMicroprice(symbol);
  const micro = rel.reliable && rel.price != null && rel.price > 0 ? rel.price : null;
  const wm = Math.max(0, Math.min(1, em.benchMicropriceWeight));

  if (micro != null && pre != null && pre > 0 && wm > 0) {
    const price = wm * micro + (1 - wm) * pre;
    return {
      ...base,
      price,
      source: 'microprice_blended',
      microprice: micro,
      micropriceReliable: true,
      preMicroBlendPrice: pre,
    };
  }

  return {
    ...base,
    microprice: micro,
    micropriceReliable: rel.reliable,
    preMicroBlendPrice: pre,
  };
}

/**
 * Mark-to-market mid: blend microprice with oracle/benchmark (not oracle-only).
 */
export function computeBlendedMarkMid(
  oracleMid: number,
  benchmark1h: number | null,
  microprice: number | null
): number {
  const em = config.eliteMm;
  const refBench = benchmark1h != null && benchmark1h > 0 ? benchmark1h : oracleMid;
  const midCore = (oracleMid + refBench) / 2;
  if (microprice != null && microprice > 0 && em.mtmMicroInMark > 0) {
    const η = Math.max(0, Math.min(1, em.mtmMicroInMark));
    return η * microprice + (1 - η) * midCore;
  }
  return midCore;
}
