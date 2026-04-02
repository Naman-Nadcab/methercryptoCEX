/**
 * Alpha-optimized MM metrics: microprice-blended benchmark, MTM mark-mid, signed edge, regime-aware targets, adaptive adverse horizon.
 */
import { db } from '../lib/database.js';
import { getSpotTradesUseMarketSync } from '../lib/spot-schema-cache.js';
import { redis } from '../lib/redis.js';
import { config } from '../config/index.js';
import { getAlphaBenchmarkPrice, computeBlendedMarkMid } from './mm-benchmark-price.service.js';
import { fetchBalancesForSymbol, computeMarkToMarket } from './mm-inventory-mtm.service.js';
import {
  getAdverseSelectionCostBps,
  countMarketTrades,
  computeAdverseLookaheadTrades,
} from './mm-adverse-post-trade.service.js';
import { computeDynamicProfitTargetBps } from './mm-spread-elite.service.js';
import { getRealizedVolatilityBps } from './mm-volatility.service.js';
import { detectMarketRegime } from './mm-regime.service.js';
import type { MarketRegimeLabel } from './mm-regime.service.js';

export type TradeRow = { side: 'buy' | 'sell'; p: number; q: number; fee: number; ts: Date };

export type MmWindowRollup = {
  pnlQuote: number;
  realizedEdgeBps: number;
  quoteVolume: number;
  tradeCount: number;
  benchmarkPrice: number | null;
  benchmarkSource: string;
  /** VW of edge where edge > 0 (favorable vs benchmark). */
  signedEdgePositiveBpsVw: number;
  /** VW of edge where edge < 0 (typically negative). */
  signedEdgeNegativeBpsVw: number;
  /** Share of fills with positive edge vs benchmark. */
  goodExecutionShare: number;
};

export type MmFillQuality = {
  avgSlippageBps: number;
  /** realized_edge_bps / effective_half_spread_bps */
  executionEfficiency: number;
  effectiveHalfSpreadBps: number;
  signedEdgePositiveBpsVw: number;
  signedEdgeNegativeBpsVw: number;
  goodExecutionShare: number;
};

export type MmQuantSignals = {
  dynamicProfitTargetBps1h: number;
  adverseSelectionBps1h: number;
  adverseLookaheadTrades: number;
  regime: MarketRegimeLabel;
  regimeLag1Autocorr: number;
  regimeVarianceRatio: number;
};

export type MmMarkToMarketSnapshot = {
  inventoryBase: number;
  inventoryQuote: number;
  oracleMid: number;
  blendedMarkMid: number;
  unrealizedVsBenchmarkQuote: number;
  wacUnrealizedQuote: number | null;
  wacQuotePerBase: number | null;
  wacApproximate: boolean;
  benchmarkPrice1h: number | null;
};

export type MmSymbolProfitMetrics = {
  m5: MmWindowRollup;
  h1: MmWindowRollup;
  h24: MmWindowRollup;
  fillQuality1h: MmFillQuality;
  quant: MmQuantSignals;
  markToMarket: MmMarkToMarketSnapshot | null;
};

function emptyRollup(): MmWindowRollup {
  return {
    pnlQuote: 0,
    realizedEdgeBps: 0,
    quoteVolume: 0,
    tradeCount: 0,
    benchmarkPrice: null,
    benchmarkSource: 'none',
    signedEdgePositiveBpsVw: 0,
    signedEdgeNegativeBpsVw: 0,
    goodExecutionShare: 0,
  };
}

function parseSide(raw: string): 'buy' | 'sell' | null {
  const s = raw.trim().toLowerCase();
  if (s === 'buy' || s === 'b') return 'buy';
  if (s === 'sell' || s === 's') return 'sell';
  return null;
}

export async function fetchMmTrades(
  symbol: string,
  userId: string,
  windowSec: number,
  maxRows = 20_000
): Promise<TradeRow[]> {
  const w = Math.max(1, Math.floor(windowSec));
  const lim = Math.max(10, Math.min(50_000, Math.floor(maxRows)));
  const useMarket = getSpotTradesUseMarketSync();
  try {
    if (useMarket) {
      const r = await db.query<{ side: string; price: string; qty: string; fee: string | null; created_at: Date }>(
        `SELECT side::text, price::text, quantity::text,
                COALESCE(fee::text, '0') AS fee, created_at
         FROM spot_trades
         WHERE market = $1 AND user_id = $2::uuid
           AND created_at > NOW() - ($3::text || ' seconds')::interval
         ORDER BY created_at ASC
         LIMIT $4`,
        [symbol, userId, String(w), lim]
      );
      return mapTradeRows(r.rows);
    }
    const r = await db.query<{ side: string; price: string; qty: string; fee: string | null; created_at: Date }>(
      `SELECT st.side::text, st.price::text, st.quantity::text,
              COALESCE(st.fee::text, '0') AS fee, st.created_at
       FROM spot_trades st
       INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
       WHERE tp.symbol = $1 AND st.user_id = $2::uuid
         AND st.created_at > NOW() - ($3::text || ' seconds')::interval
       ORDER BY st.created_at ASC
       LIMIT $4`,
      [symbol, userId, String(w), lim]
    );
    return mapTradeRows(r.rows);
  } catch {
    return [];
  }
}

function mapTradeRows(
  rows: Array<{ side: string; price: string; qty: string; fee: string | null; created_at: Date }>
): TradeRow[] {
  return rows
    .map((row) => {
      const side = parseSide(row.side);
      const p = parseFloat(row.price);
      const q = parseFloat(row.qty);
      const fee = parseFloat(row.fee ?? '0') || 0;
      if (!side || !Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) return null;
      return { side, p, q, fee, ts: row.created_at };
    })
    .filter((x): x is TradeRow => x != null);
}

function rollupWindow(trades: TradeRow[], bench: { price: number | null; source: string }): MmWindowRollup {
  const out = emptyRollup();
  out.benchmarkPrice = bench.price;
  out.benchmarkSource = bench.source;
  const vwap = bench.price;
  if (trades.length === 0) return out;
  let edgeNum = 0;
  let edgeDen = 0;
  let posNum = 0;
  let posDen = 0;
  let negNum = 0;
  let negDen = 0;
  let goodN = 0;
  for (const t of trades) {
    const notional = t.p * t.q;
    out.quoteVolume += notional;
    out.tradeCount += 1;
    if (t.side === 'sell') {
      out.pnlQuote += notional - t.fee;
    } else {
      out.pnlQuote -= notional + t.fee;
    }
    if (vwap != null && vwap > 0) {
      const e =
        t.side === 'sell' ? ((t.p - vwap) / vwap) * 10_000 : ((vwap - t.p) / vwap) * 10_000;
      edgeNum += e * notional;
      edgeDen += notional;
      if (e > 0) {
        posNum += e * notional;
        posDen += notional;
        goodN += 1;
      } else if (e < 0) {
        negNum += e * notional;
        negDen += notional;
      }
    }
  }
  out.realizedEdgeBps = edgeDen > 0 ? edgeNum / edgeDen : 0;
  out.signedEdgePositiveBpsVw = posDen > 0 ? posNum / posDen : 0;
  out.signedEdgeNegativeBpsVw = negDen > 0 ? negNum / negDen : 0;
  out.goodExecutionShare = trades.length > 0 ? goodN / trades.length : 0;
  return out;
}

function effectiveHalfSpreadBps(trades: TradeRow[], benchPx: number | null, configuredHalfBps: number): number {
  if (trades.length === 0 || benchPx == null || benchPx <= 0) return Math.max(1, configuredHalfBps);
  let num = 0;
  let den = 0;
  for (const t of trades) {
    const n = t.p * t.q;
    const absE =
      t.side === 'sell'
        ? (Math.abs(t.p - benchPx) / benchPx) * 10_000
        : (Math.abs(benchPx - t.p) / benchPx) * 10_000;
    num += absE * n;
    den += n;
  }
  const vwAbs = den > 0 ? num / den : configuredHalfBps;
  const estHalf = vwAbs * 0.5;
  return Math.min(200, Math.max(configuredHalfBps, estHalf));
}

function fillQualityFromTrades(
  trades: TradeRow[],
  benchPx: number | null,
  effectiveHalfBps: number,
  rollup: MmWindowRollup
): MmFillQuality {
  if (trades.length < 2) {
    return {
      avgSlippageBps: 0,
      executionEfficiency: 0,
      effectiveHalfSpreadBps: effectiveHalfBps,
      signedEdgePositiveBpsVw: rollup.signedEdgePositiveBpsVw,
      signedEdgeNegativeBpsVw: rollup.signedEdgeNegativeBpsVw,
      goodExecutionShare: rollup.goodExecutionShare,
    };
  }
  let slipSum = 0;
  let slipN = 0;
  for (let i = 1; i < trades.length; i++) {
    const p0 = trades[i - 1]!.p;
    const p1 = trades[i]!.p;
    if (p1 > 0) {
      slipSum += (Math.abs(p1 - p0) / p1) * 10_000;
      slipN++;
    }
  }
  const avgSlippageBps = slipN > 0 ? slipSum / slipN : 0;
  let edgeNum = 0;
  let edgeDen = 0;
  for (const t of trades) {
    const notional = t.p * t.q;
    if (benchPx != null && benchPx > 0) {
      const e =
        t.side === 'sell' ? ((t.p - benchPx) / benchPx) * 10_000 : ((benchPx - t.p) / benchPx) * 10_000;
      edgeNum += e * notional;
      edgeDen += notional;
    }
  }
  const edge = edgeDen > 0 ? edgeNum / edgeDen : 0;
  const ref = Math.max(1, effectiveHalfBps);
  const executionEfficiency = Math.max(0, Math.min(3, edge / ref));
  return {
    avgSlippageBps,
    executionEfficiency,
    effectiveHalfSpreadBps: effectiveHalfBps,
    signedEdgePositiveBpsVw: rollup.signedEdgePositiveBpsVw,
    signedEdgeNegativeBpsVw: rollup.signedEdgeNegativeBpsVw,
    goodExecutionShare: rollup.goodExecutionShare,
  };
}

async function buildMetrics(symbol: string, userId: string): Promise<MmSymbolProfitMetrics> {
  const cfgHalf = config.liquidityBot.spreadBps / 2;

  const bal = await fetchBalancesForSymbol(symbol, userId);
  const oracleMid = bal?.mid ?? null;

  const [
    volBps,
    regimeDet,
    mktCount1h,
    bench5,
    bench60,
    bench86400,
    t5,
    t60,
    t86400,
    tMtm,
  ] = await Promise.all([
    getRealizedVolatilityBps(symbol),
    detectMarketRegime(symbol),
    countMarketTrades(symbol, 3600),
    getAlphaBenchmarkPrice(symbol, 300, oracleMid),
    getAlphaBenchmarkPrice(symbol, 3600, oracleMid),
    getAlphaBenchmarkPrice(symbol, 86_400, oracleMid),
    fetchMmTrades(symbol, userId, 300),
    fetchMmTrades(symbol, userId, 3600),
    fetchMmTrades(symbol, userId, 86_400),
    fetchMmTrades(symbol, userId, 2_592_000, 8000),
  ]);

  const lookahead = computeAdverseLookaheadTrades(volBps, mktCount1h, 3600);
  const adverseBps = await getAdverseSelectionCostBps(symbol, userId, 3600, lookahead);

  const m5 = rollupWindow(t5, { price: bench5.price, source: bench5.source });
  const h1 = rollupWindow(t60, { price: bench60.price, source: bench60.source });
  const h24 = rollupWindow(t86400, { price: bench86400.price, source: bench86400.source });

  const effHalf = effectiveHalfSpreadBps(t60, bench60.price, cfgHalf);
  const fillQuality1h = fillQualityFromTrades(t60, bench60.price, effHalf, h1);

  const dynamicProfitTargetBps1h = computeDynamicProfitTargetBps(
    volBps,
    h1.quoteVolume,
    regimeDet.label
  );

  let markToMarket: MmMarkToMarketSnapshot | null = null;
  if (bal != null) {
    const markMid = computeBlendedMarkMid(bal.mid, bench60.price, bench60.microprice);
    const mtm = computeMarkToMarket(bal, bench60.price, markMid, tMtm);
    markToMarket = {
      inventoryBase: mtm.inventoryBase,
      inventoryQuote: mtm.inventoryQuote,
      oracleMid: mtm.oracleMid,
      blendedMarkMid: markMid,
      unrealizedVsBenchmarkQuote: mtm.unrealizedVsBenchmarkQuote,
      wacUnrealizedQuote: mtm.wacUnrealizedQuote,
      wacQuotePerBase: mtm.wacQuotePerBase,
      wacApproximate: mtm.wacApproximate,
      benchmarkPrice1h: bench60.price,
    };
  }

  return {
    m5,
    h1,
    h24,
    fillQuality1h,
    quant: {
      dynamicProfitTargetBps1h,
      adverseSelectionBps1h: adverseBps,
      adverseLookaheadTrades: lookahead,
      regime: regimeDet.label,
      regimeLag1Autocorr: regimeDet.lag1Autocorr,
      regimeVarianceRatio: regimeDet.varianceRatio,
    },
    markToMarket,
  };
}

const CACHE_PREFIX = 'mm:prof:v3:';
const CACHE_TTL_SEC = 30;

export async function getMmSymbolProfitMetrics(
  symbol: string,
  userId: string,
  opts?: { skipCache?: boolean }
): Promise<MmSymbolProfitMetrics> {
  if (opts?.skipCache || !config.eliteMm.profitMetricsCacheEnabled) {
    return buildMetrics(symbol, userId);
  }
  const key = `${CACHE_PREFIX}${userId}:${symbol}`;
  try {
    const hit = await redis.getJson<MmSymbolProfitMetrics>(key);
    if (hit) return hit;
    const m = await buildMetrics(symbol, userId);
    await redis.setJson(key, m, CACHE_TTL_SEC);
    return m;
  } catch {
    return buildMetrics(symbol, userId);
  }
}

export async function getMmRealizedEdgeBps(symbol: string, userId: string, windowSec: number): Promise<number> {
  const bal = await fetchBalancesForSymbol(symbol, userId);
  const bench = await getAlphaBenchmarkPrice(symbol, windowSec, bal?.mid ?? null);
  const t = await fetchMmTrades(symbol, userId, windowSec);
  return rollupWindow(t, { price: bench.price, source: bench.source }).realizedEdgeBps;
}
