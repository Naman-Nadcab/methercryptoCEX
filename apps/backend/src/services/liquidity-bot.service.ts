/**
 * Institutional liquidity bot: ladder quotes, vol-based spread, inventory risk, quote-age refresh.
 * Base URL: LIQUIDITY_BOT_INTERNAL_API_URL or http://127.0.0.1:{PORT}/api/v1
 */
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { getSpotOrdersUseMarketSync, getSpotTradesUseMarketSync } from '../lib/spot-schema-cache.js';
import { getSpotTradesShapeSync, loadSpotTradesShape } from '../lib/spot-trades-shape.js';
import { buildUnifiedSpotTradesCte } from '../lib/unified-spot-trades.js';
import {
  liquidityBotRunsTotal,
  liquidityBotErrorsTotal,
} from '../lib/prometheus-metrics.js';
import {
  computeMmHealthSnapshot,
  recordLiquidityBotCycleOutcome,
  markMmQuotesFresh,
} from './mm-health.service.js';
import { getRealizedVolatilityBps, volatilitySpreadMultiplier } from './mm-volatility.service.js';
import { getInventoryRiskAdjust, getMmPositionGuard } from './mm-inventory-risk.service.js';
import {
  isUserMmEmergencyStopped,
  setMmEmergencyStopped,
  getMmUserDailyPnlUsd,
} from './mm-risk.service.js';
import { aggregateExternalMidPrice } from './external-price-feed.service.js';
import { getOrderFlowImbalance } from './mm-order-flow.service.js';
import { getToxicFlowMetrics } from './mm-toxic-flow.service.js';
import {
  computeEliteSpreadAdjustments,
  computeFeeAwareHalfSpreadAddBps,
  computeProfitabilitySpreadAdjustBps,
  computeAdverseSelectionSpreadAddBps,
  computeDeskLatencyArbAddBps,
  computePreTradeBookAdverseBps,
  computeMomentumHalfExtrasBps,
} from './mm-spread-elite.service.js';
import { getFastMomentumBps } from './mm-momentum-fast.service.js';
import { getTopKBookObi } from './mm-book-imbalance.service.js';
import { getMarketFeeRates } from './mm-market-fees.service.js';
import { getMmSymbolProfitMetrics } from './mm-pnl-metrics.service.js';
import { getCapitalAllocationWeights } from './mm-capital-allocation.service.js';
import {
  getGlobalMMConfig,
  getPairConfig,
  getPairCapital,
  getMmPairFillRate,
  getDailyTargetUsd,
  resolveEffectiveMaxDailyLossUsd,
  resolveEffectiveMaxPositionUsdForSymbol,
  recordPairPerformance,
  incrementLiquidityBotCycleCounter,
  setMmToxicFlow,
  setMmPairFillRate,
} from './mm-runtime-config.service.js';
import {
  applyGlobalModeToSpreadBps,
  calculateSpread,
  computeMmProfitOrientedQuote,
  computeMinProfitSpreadBps,
  getMmSpreadLearningAdjBps,
  observeMmSpreadLearning,
} from './mm-strategy.service.js';

const ROUND_DOWN = 1;

/**
 * When true and strategy returns skip_placement, do not cancel or place orders — keep the existing ladder.
 */
const skipPlacementSafeMode = true;

/** Scheduler lower bound — never schedule faster than this (reduces CPU churn). */
const MIN_REFRESH_MS = 1500;
const BASE_REFRESH_MS = 5000;
/** High-vol path: max(2000, MIN_REFRESH_MS) per spec; stays above MIN for burst control. */
const VOL_HIGH_REFRESH_MS = Math.max(2000, MIN_REFRESH_MS);

/** Max realized vol (bps) seen in the last completed cycle; compared to `schedulerVolHighBps`. */
let lastCycleMaxVolBps = 0;
/** One-shot: set when ladder fills detected; next `getLiquidityBotNextTickMs` returns `MIN_REFRESH_MS` then clears. */
let fastRefreshFlag = false;

export function getLiquidityBotNextTickMs(): number {
  const thr = config.liquidityBot.schedulerVolHighBps;
  if (fastRefreshFlag) {
    fastRefreshFlag = false;
    return MIN_REFRESH_MS;
  }
  if (lastCycleMaxVolBps >= thr) {
    return VOL_HIGH_REFRESH_MS;
  }
  return BASE_REFRESH_MS;
}

function resolveLiquidityBotApiBase(): string {
  const raw = config.liquidityBot.internalApiBaseUrl?.trim();
  if (raw) {
    const u = raw.replace(/\/$/, '');
    return u.endsWith('/api/v1') ? u : `${u}/api/v1`;
  }
  const port = config.port ?? 4000;
  return `http://127.0.0.1:${port}/api/v1`;
}

type OracleMidState = {
  mid: DecimalInstance;
  lastUpdated: Date | null;
  ageSec: number;
};

async function getLastTradePrice(symbol: string): Promise<DecimalInstance | null> {
  const useMarket = getSpotTradesUseMarketSync();
  try {
    const sql = useMarket
      ? `SELECT price::text AS price FROM spot_trades WHERE market = $1 ORDER BY created_at DESC LIMIT 1`
      : `SELECT st.price::text AS price
         FROM spot_trades st
         INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
         WHERE tp.symbol = $1
         ORDER BY st.created_at DESC LIMIT 1`;
    const r = await db.query<{ price: string | null }>(sql, [symbol]);
    const p = r.rows[0]?.price;
    if (!p) return null;
    const d = new Decimal(p);
    return d.gt(0) && !d.isNaN() ? d : null;
  } catch {
    return null;
  }
}

async function getOracleMidState(symbol: string): Promise<OracleMidState | null> {
  const row = await db.query<{ price: string; last_updated: Date | null }>(
    `SELECT mp.price::text AS price, mp.last_updated
     FROM market_prices mp
     JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
     WHERE sm.symbol = $1 AND sm.status IN ('active', 'maintenance')
     LIMIT 1`,
    [symbol]
  );
  const p = row.rows[0]?.price;
  if (!p) return null;
  try {
    const mid = new Decimal(p);
    if (mid.lte(0)) return null;
    const lu = row.rows[0]?.last_updated ?? null;
    const ageSec = lu ? Math.max(0, (Date.now() - new Date(lu).getTime()) / 1000) : 0;
    return { mid, lastUpdated: lu, ageSec };
  } catch {
    return null;
  }
}

async function getPricePrecision(symbol: string): Promise<number> {
  const r = await db.query<{ price_precision: number }>(
    `SELECT COALESCE(price_precision, 8)::int AS price_precision FROM spot_markets WHERE symbol = $1`,
    [symbol]
  );
  return r.rows[0]?.price_precision ?? 8;
}

export type BotOpenLimit = {
  id: string;
  side: 'buy' | 'sell';
  price: string;
  quantity: string;
  filled_quantity: string;
  /** ms since epoch; 0 if unknown */
  quoteAtMs: number;
};

/** Count executed spot trades for MM user in the last hour (existing ledger; no new storage). */
async function countMmUserTradesLastHour(userId: string, symbol: string): Promise<number> {
  const useMarket = getSpotTradesUseMarketSync();
  try {
    if (useMarket) {
      const r = await db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM spot_trades
         WHERE market = $1 AND user_id = $2::uuid
           AND created_at > NOW() - INTERVAL '1 hour'`,
        [symbol, userId]
      );
      return Math.max(0, parseInt(r.rows[0]?.c ?? '0', 10) || 0);
    }
    const shape = getSpotTradesShapeSync();
    const userFilter = shape?.hasUserId
      ? 'st.user_id = $2::uuid'
      : shape?.hasMakerUserId
        ? '(st.maker_user_id = $2::uuid OR st.taker_user_id = $2::uuid)'
        : null;
    if (!userFilter) return 0;
    const r = await db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM spot_trades st
       INNER JOIN trading_pairs tp ON tp.id = st.trading_pair_id
       WHERE tp.symbol = $1 AND ${userFilter}
         AND st.created_at > NOW() - INTERVAL '1 hour'`,
      [symbol, userId]
    );
    return Math.max(0, parseInt(r.rows[0]?.c ?? '0', 10) || 0);
  } catch {
    return 0;
  }
}

/** MM user fills by side in the last `minutes` (unified_trades CTE; safe fallback 0). */
async function countMmUserTradesBySideRecent(
  userId: string,
  symbol: string,
  minutes: number
): Promise<{ buy: number; sell: number }> {
  if (!getSpotTradesShapeSync()) {
    await loadSpotTradesShape();
  }
  const shape = getSpotTradesShapeSync();
  const cte = buildUnifiedSpotTradesCte(shape);
  if (!cte) return { buy: 0, sell: 0 };
  const m = Math.max(1, Math.min(60, Math.round(minutes)));
  try {
    const r = await db.query<{ side: string; c: string }>(
      `WITH ${cte}
       SELECT side, COUNT(*)::text AS c FROM unified_trades
       WHERE user_id = $1::uuid AND market = $2
         AND created_at > NOW() - ($3::text || ' minutes')::interval
       GROUP BY side`,
      [userId, symbol, String(m)]
    );
    let buy = 0;
    let sell = 0;
    for (const row of r.rows) {
      const n = Math.max(0, parseInt(row.c ?? '0', 10) || 0);
      if (row.side === 'buy') buy = n;
      else if (row.side === 'sell') sell = n;
    }
    return { buy, sell };
  } catch {
    return { buy: 0, sell: 0 };
  }
}

/** Phase C toxic flag: need enough prints and dominant side (reduces false positives). */
function detectToxicOneSidedFills(buy: number, sell: number): boolean {
  const b = Math.max(0, Number.isFinite(buy) ? Math.floor(buy) : 0);
  const s = Math.max(0, Number.isFinite(sell) ? Math.floor(sell) : 0);
  const t = b + s;
  if (t < 5) return false;
  const oneSideRatio = Math.max(b, s) / t;
  return oneSideRatio > 0.8;
}

/** Smooth de-risk as daily PnL approaches / exceeds target; missing/invalid inputs → no extra scaling. */
function profitTargetSizeMult(pnlTodayUsd: number, targetUsd: number): number {
  if (!(targetUsd > 0) || !Number.isFinite(targetUsd) || !Number.isFinite(pnlTodayUsd)) return 1;
  const progress = pnlTodayUsd / targetUsd;
  if (progress >= 1) return 0.7;
  if (progress >= 0.75) return 0.8;
  if (progress >= 0.5) return 0.9;
  return 1;
}

export async function fetchBotOpenLimitOrders(userId: string, market: string): Promise<BotOpenLimit[]> {
  const openIn =
    "('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER','new','partially_filled','pending_trigger')";
  const useMarket = getSpotOrdersUseMarketSync();
  const sql = useMarket
    ? `SELECT id::text, lower(side::text) AS side, price::text, quantity::text, filled_quantity::text,
              (EXTRACT(EPOCH FROM COALESCE(updated_at, created_at)) * 1000)::double precision AS quote_at_ms
       FROM spot_orders
       WHERE user_id = $1::uuid AND market = $2
         AND lower(type::text) = 'limit'
         AND status::text IN ${openIn}`
    : `SELECT o.id::text, lower(o.side::text) AS side, o.price::text, o.quantity::text, o.filled_quantity::text,
              (EXTRACT(EPOCH FROM COALESCE(o.updated_at, o.created_at)) * 1000)::double precision AS quote_at_ms
       FROM spot_orders o
       JOIN trading_pairs tp ON tp.id = o.trading_pair_id
       WHERE o.user_id = $1::uuid AND tp.symbol = $2
         AND lower(o.order_type::text) = 'limit'
         AND o.status::text IN ${openIn}`;
  const r = await db.query<{
    id: string;
    side: string;
    price: string;
    quantity: string;
    filled_quantity: string;
    quote_at_ms: string | number | null;
  }>(sql, [userId, market]);
  return r.rows
    .filter((row) => row.side === 'buy' || row.side === 'sell')
    .map((row) => ({
      id: row.id,
      side: row.side as 'buy' | 'sell',
      price: row.price,
      quantity: row.quantity,
      filled_quantity: row.filled_quantity,
      quoteAtMs: row.quote_at_ms != null ? Number(row.quote_at_ms) || 0 : 0,
    }));
}

function remainingQty(o: BotOpenLimit): DecimalInstance {
  return new Decimal(o.quantity).minus(new Decimal(o.filled_quantity)).toDecimalPlaces(8, ROUND_DOWN);
}

function needsReplace(
  existing: BotOpenLimit | undefined,
  targetPrice: DecimalInstance,
  targetQtyStr: string,
  precision: number,
  bpsThreshold: number,
  qtyRelThreshold: number,
  maxQuoteAgeSec: number
): boolean {
  if (!existing) return true;
  if (maxQuoteAgeSec > 0 && existing.quoteAtMs > 0) {
    const ageSec = (Date.now() - existing.quoteAtMs) / 1000;
    if (ageSec > maxQuoteAgeSec) return true;
  }
  const rem = remainingQty(existing);
  const targetQty = new Decimal(targetQtyStr).toDecimalPlaces(8, ROUND_DOWN);
  if (rem.lte(0)) return true;
  const oldPx = new Decimal(existing.price);
  if (oldPx.lte(0)) return true;
  const newPx = targetPrice.toDecimalPlaces(precision, ROUND_DOWN);
  const diffBps = oldPx.minus(newPx).abs().div(oldPx).times(10000);
  if (diffBps.gte(bpsThreshold)) return true;
  const qdiff = rem.minus(targetQty).abs().div(Decimal.max(rem, targetQty, new Decimal('1e-12')));
  if (qdiff.gt(qtyRelThreshold)) return true;
  return false;
}

async function cancelOrderHttp(
  baseUrl: string,
  headers: Record<string, string>,
  orderId: string
): Promise<boolean> {
  const res = await fetch(`${baseUrl}/spot/order/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers,
  });
  return res.ok;
}

async function placeLimit(
  baseUrl: string,
  headers: Record<string, string>,
  symbol: string,
  side: 'buy' | 'sell',
  price: string,
  quantity: string,
  clientOrderId: string
): Promise<boolean> {
  const res = await fetch(`${baseUrl}/spot/order`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      market: symbol,
      side,
      type: 'limit',
      price,
      quantity,
      client_order_id: clientOrderId.slice(0, 64),
    }),
  });
  return res.ok;
}

/**
 * Run one cycle: ladder levels, vol spread, inventory taper, forced refresh on stale quotes.
 */
export async function runLiquidityBotCycle(): Promise<{ placed: number; errors: string[]; skipped: number }> {
  const errors: string[] = [];
  let placed = 0;
  let skipped = 0;

  if (!config.liquidityBot.enabled || !config.liquidityBot.apiKey) {
    return { placed: 0, errors: [], skipped: 0 };
  }

  const apiKey = config.liquidityBot.apiKey;
  const baseUrl = resolveLiquidityBotApiBase();
  const symbols = config.liquidityBot.symbols;
  const staleSec = config.liquidityBot.oracleStaleSec;
  const staleMult = config.liquidityBot.staleSpreadMultiplier;
  const skipIfStale = config.liquidityBot.skipIfOracleStale;
  const bpsTh = config.liquidityBot.repriceBpsThreshold;
  const qtyRelTh = config.liquidityBot.repriceQtyRelThreshold;
  const inst = config.institutionalMm;

  if (symbols.length === 0) {
    return { placed: 0, errors: [], skipped: 0 };
  }

  const mmGlobal = getGlobalMMConfig();
  if (!mmGlobal.enabled) {
    recordLiquidityBotCycleOutcome(false);
    liquidityBotRunsTotal.inc({ result: 'skipped' });
    logger.info('Liquidity bot skipped: MM runtime global disabled');
    return { placed: 0, errors: ['mm_runtime_global_disabled'], skipped: symbols.length };
  }

  const health = await computeMmHealthSnapshot();
  if (health.pauseBot) {
    recordLiquidityBotCycleOutcome(false);
    liquidityBotRunsTotal.inc({ result: 'skipped' });
    logger.warn('Liquidity bot paused (MM health critical)', { reasons: health.reasons });
    return { placed: 0, errors: ['mm_health_pause:' + health.reasons.join(',')], skipped: symbols.length };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  };

  const keyRow = await db.query<{ user_id: string }>(
    `SELECT user_id::text FROM user_api_keys WHERE api_key = $1 AND deleted_at IS NULL LIMIT 1`,
    [apiKey]
  );
  const userId = keyRow.rows[0]?.user_id;
  if (!userId) {
    liquidityBotErrorsTotal.inc({ reason: 'no_user_for_api_key' });
    liquidityBotRunsTotal.inc({ result: 'error' });
    recordLiquidityBotCycleOutcome(true);
    return { placed: 0, errors: ['liquidity bot: API key has no user_id'], skipped: 0 };
  }

  if (await isUserMmEmergencyStopped(userId)) {
    recordLiquidityBotCycleOutcome(false);
    liquidityBotRunsTotal.inc({ result: 'skipped' });
    logger.warn('Liquidity bot: MM emergency stop active for bot user');
    return { placed: 0, errors: ['mm_emergency_stopped'], skipped: symbols.length };
  }

  const maxDailyLoss = resolveEffectiveMaxDailyLossUsd(symbols);
  if (maxDailyLoss > 0) {
    const pnl = await getMmUserDailyPnlUsd(userId);
    if (pnl < -maxDailyLoss) {
      try {
        await setMmEmergencyStopped(userId, true);
      } catch (e) {
        logger.error('MM daily loss halt: failed to persist emergency stop', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      recordLiquidityBotCycleOutcome(false);
      liquidityBotRunsTotal.inc({ result: 'skipped' });
      logger.error('Liquidity bot halted: daily loss exceeded', { pnl, maxDailyLoss });
      return { placed: 0, errors: [`mm_daily_loss_halt: pnl=${pnl}`], skipped: symbols.length };
    }
  }

  const capitalWeights = await getCapitalAllocationWeights(symbols, userId);
  const nSym = symbols.length || 1;
  let cycleMaxVol = 0;

  const pnlTodayUsd = await getMmUserDailyPnlUsd(userId);
  const dailyTargetUsd = getDailyTargetUsd();
  const profitTargetMultGlobal = profitTargetSizeMult(pnlTodayUsd, dailyTargetUsd);

  for (const symbol of symbols) {
    try {
      const pairRt = getPairConfig(symbol);
      if (pairRt?.enabled === false) {
        skipped++;
        continue;
      }

      const oracle = await getOracleMidState(symbol);
      const oracleFresh = Boolean(oracle && oracle.mid.gt(0) && oracle.ageSec <= staleSec);
      let mid: DecimalInstance | null = null;
      if (oracleFresh && oracle) {
        mid = oracle.mid;
      } else {
        const lt = await getLastTradePrice(symbol);
        if (lt?.gt(0)) mid = lt;
      }

      if (!mid) {
        if (skipIfStale && oracle && oracle.mid.gt(0) && oracle.ageSec > staleSec) {
          errors.push(`${symbol}: oracle stale, no last trade — skipped`);
          liquidityBotErrorsTotal.inc({ reason: 'oracle_stale_skip' });
        } else {
          errors.push(`${symbol}: no quote mid (oracle unavailable/stale and no last trade)`);
          liquidityBotErrorsTotal.inc({ reason: 'no_quote_mid' });
        }
        skipped++;
        continue;
      }

      const treatAsStale = !oracle || !oracle.mid.gt(0) || oracle.ageSec > staleSec;
      if (treatAsStale) {
        logger.warn('Liquidity bot: using last trade or stale oracle path (widen spread)', {
          symbol,
          oracleAgeSec: oracle ? Math.round(oracle.ageSec) : null,
        });
      }

      const volBps = await getRealizedVolatilityBps(symbol);
      cycleMaxVol = Math.max(cycleMaxVol, volBps);
      const volMult = volatilitySpreadMultiplier(volBps);

      const inv = await getInventoryRiskAdjust(symbol, userId, volBps);

      const envSpread = config.liquidityBot.spreadBps;
      let spreadBpsBase = applyGlobalModeToSpreadBps(envSpread, mmGlobal.mode);
      let orderSize = config.liquidityBot.orderSize;
      let L = inst.ladderLevels;
      if (pairRt) {
        spreadBpsBase = calculateSpread(
          symbol,
          pairRt,
          volBps,
          /* inventory widening already applied later via inv.extraSpreadBps in half-spread stack */
          {},
          envSpread,
          mmGlobal.mode
        );
        if (pairRt.order_size > 0) orderSize = String(pairRt.order_size);
        if (pairRt.ladder_levels > 0) {
          L = Math.min(inst.ladderMax, Math.max(1, Math.round(pairRt.ladder_levels)));
        }
      }

      const [profitMx, feeRates, sideRecent, fills1h] = await Promise.all([
        getMmSymbolProfitMetrics(symbol, userId),
        getMarketFeeRates(symbol),
        countMmUserTradesBySideRecent(userId, symbol, 5),
        countMmUserTradesLastHour(userId, symbol),
      ]);
      const learnAdj = getMmSpreadLearningAdjBps(symbol, { fills1h });
      const feeOk =
        Number.isFinite(feeRates.makerFeeBps) && Number.isFinite(feeRates.takerFeeBps);
      const priorFillRate = getMmPairFillRate(symbol);
      const profitQuote = computeMmProfitOrientedQuote({
        baseSpreadBps: spreadBpsBase,
        volatilityBps: volBps,
        inventoryRatio: inv.baseRatio,
        recentPnlUsd: profitMx.h1.pnlQuote,
        symbol,
        learningAdjBps: learnAdj,
        fillRate: priorFillRate,
        fills1hForFillRate: fills1h,
        spreadMode: pairRt?.spread_mode ?? 'auto',
        ...(feeOk ? { makerFeeBps: feeRates.makerFeeBps, takerFeeBps: feeRates.takerFeeBps } : {}),
      });

      if (process.env.MM_FINAL_DEBUG === 'true') {
        logger.debug('MM_FINAL_DEBUG', {
          symbol,
          capital_per_pair: getPairCapital(symbol),
          fill_rate: priorFillRate,
          skip_placement: Boolean(profitQuote.skip_placement),
          spread_bps: profitQuote.spread_bps,
        });
      }

      const toxicOneSided = detectToxicOneSidedFills(sideRecent.buy, sideRecent.sell);
      setMmToxicFlow(symbol, toxicOneSided);

      const freezeLadderQuotes = Boolean(profitQuote.skip_placement) && skipPlacementSafeMode;
      if (freezeLadderQuotes) {
        skipped++;
      } else {
      const staleFull = treatAsStale
        ? Math.min(50, Math.round(profitQuote.spread_bps * staleMult))
        : profitQuote.spread_bps;
      const staleScale = profitQuote.spread_bps > 0 ? staleFull / profitQuote.spread_bps : 1;
      const bid0 = profitQuote.bid_spread_bps * staleScale;
      const ask0 = profitQuote.ask_spread_bps * staleScale;
      const bidCore = Math.round(bid0 * health.spreadMultiplier * volMult);
      const askCore = Math.round(ask0 * health.spreadMultiplier * volMult);
      const coreHalfBpsForElite = Math.max(1, Math.round((bidCore + askCore) / 2));

      const precision = await getPricePrecision(symbol);
      const maxPosUsd = resolveEffectiveMaxPositionUsdForSymbol(symbol);
      const posGuard = await getMmPositionGuard(symbol, userId, mid, maxPosUsd);
      const pairCapUsd = getPairCapital(symbol);
      const posUsdNum = Number.parseFloat(posGuard.positionUsd || '0');
      let capitalSkipBid = false;
      let capitalSkipAsk = false;
      /** At pair cap in neutral / unknown inventory: keep both sides but shrink quotes. */
      let neutralCapSizeMult = 1;
      const NEUTRAL_CAP_SIZE_MULT = 0.5;
      if (pairCapUsd > 0 && Number.isFinite(posUsdNum) && posUsdNum >= pairCapUsd) {
        const br = inv.baseRatio;
        if (br != null && Number.isFinite(br)) {
          if (br > 0.55) capitalSkipBid = true;
          else if (br < 0.45) capitalSkipAsk = true;
          else neutralCapSizeMult = NEUTRAL_CAP_SIZE_MULT;
        } else {
          neutralCapSizeMult = NEUTRAL_CAP_SIZE_MULT;
        }
      }
      const midSkewFactor = new Decimal(1).plus(new Decimal(inv.midSkewBps).div(10000));
      const midAdjusted = mid.times(midSkewFactor).toDecimalPlaces(precision, ROUND_DOWN);

      let avgLatMs = 0;
      let extOracleDivBps: number | null = null;
      if (config.externalPriceFeed.enabled) {
        const agg = await aggregateExternalMidPrice(symbol);
        avgLatMs = agg.avgLatencyMs ?? 0;
        const extMid = agg.mid;
        const oMid = mid.toNumber();
        if (extMid != null && extMid > 0 && oMid > 0) {
          extOracleDivBps = (Math.abs(extMid - oMid) / oMid) * 10_000;
        }
      }
      const [toxic, flow, momentumBps, bookObi] = await Promise.all([
        getToxicFlowMetrics(symbol),
        getOrderFlowImbalance(symbol),
        getFastMomentumBps(symbol),
        getTopKBookObi(symbol),
      ]);
      const elite = computeEliteSpreadAdjustments({
        avgSourceLatencyMs: avgLatMs,
        toxicScore: toxic.toxicScore,
        ofi: flow.ofi,
        coreHalfSpreadBps: coreHalfBpsForElite,
      });
      const deskLatArbBps = computeDeskLatencyArbAddBps(avgLatMs, extOracleDivBps);
      const bookAdvBps = computePreTradeBookAdverseBps(bookObi, coreHalfBpsForElite);
      const momExtras = computeMomentumHalfExtrasBps(momentumBps);
      const feeAddBps = computeFeeAwareHalfSpreadAddBps(feeRates.makerFeeBps, feeRates.takerFeeBps);
      const dynTarget =
        profitMx.quant?.dynamicProfitTargetBps1h ?? config.eliteMm.profitEdgeTargetBps;
      const profitAdjBps = computeProfitabilitySpreadAdjustBps(profitMx.h1.realizedEdgeBps, dynTarget);
      const adverseAddBps = computeAdverseSelectionSpreadAddBps(profitMx.quant?.adverseSelectionBps1h ?? 0);
      const toxicSimpleAddonBps = toxicOneSided ? 6 : 0;
      const symAddon =
        Math.round(inv.extraSpreadBps) +
        elite.symmetricAddBps +
        feeAddBps +
        profitAdjBps +
        adverseAddBps +
        deskLatArbBps +
        bookAdvBps +
        toxicSimpleAddonBps;
      const bidHalfSpreadBpsBase = Math.min(500, bidCore + symAddon);
      const askHalfSpreadBpsBase = Math.min(500, askCore + symAddon);

      const stepBps = inst.ladderStepBps;
      const decay = new Decimal(inst.ladderSizeDecay);
      const maxQuoteAgeSec = inst.quoteMaxAgeSec;

      const allocW = capitalWeights[symbol] ?? 1 / nSym;
      const sizeMult = allocW * nSym;
      const toxicSizeMult = toxicOneSided ? 0.65 : 1;
      const sizedOrder = new Decimal(orderSize)
        .times(sizeMult)
        .times(profitQuote.size_multiplier)
        .times(neutralCapSizeMult)
        .times(profitTargetMultGlobal)
        .times(toxicSizeMult);

      const open = await fetchBotOpenLimitOrders(userId, symbol);
      const buys = open.filter((o) => o.side === 'buy').sort((a, b) => new Decimal(b.price).cmp(new Decimal(a.price)));
      const sells = open.filter((o) => o.side === 'sell').sort((a, b) => new Decimal(a.price).cmp(new Decimal(b.price)));

      const hadFillOnLadder =
        buys.slice(0, L).some((o) => new Decimal(o.filled_quantity).gt(0)) ||
        sells.slice(0, L).some((o) => new Decimal(o.filled_quantity).gt(0));
      if (hadFillOnLadder) {
        fastRefreshFlag = true;
      }

      for (let k = L; k < buys.length; k++) {
        const ok = await cancelOrderHttp(baseUrl, headers, buys[k]!.id);
        if (!ok) errors.push(`${symbol}: cancel extra bid ${buys[k]!.id}`);
      }
      for (let k = L; k < sells.length; k++) {
        const ok = await cancelOrderHttp(baseUrl, headers, sells[k]!.id);
        if (!ok) errors.push(`${symbol}: cancel extra ask ${sells[k]!.id}`);
      }

      let anyAction = false;
      let allLevelsFresh = true;

      const depthSpreadOffsetBps = (level: number, totalLevels: number, step: number): number => {
        if (totalLevels <= 1) return 0;
        if (level === 0) return -Math.min(5, Math.max(1, Math.round(step * 0.4)));
        if (level === totalLevels - 1) return Math.min(10, Math.round(step * 0.55));
        return 0;
      };
      const depthSizeLevelMult = (level: number, totalLevels: number): number => {
        if (totalLevels <= 1) return 1;
        if (level === 0) return 0.62;
        if (level === totalLevels - 1) return 1.28;
        return 1;
      };

      for (let i = 0; i < L; i++) {
        const depthOff = depthSpreadOffsetBps(i, L, stepBps);
        const bidLevelBps = Math.min(
          750,
          bidHalfSpreadBpsBase +
            elite.bidHalfExtraBps +
            momExtras.bidHalfExtraBps +
            i * stepBps +
            depthOff
        );
        const askLevelBps = Math.min(
          750,
          askHalfSpreadBpsBase +
            elite.askHalfExtraBps +
            momExtras.askHalfExtraBps +
            i * stepBps +
            depthOff
        );
        const bidSpreadFactor = new Decimal(bidLevelBps).div(10000);
        const askSpreadFactor = new Decimal(askLevelBps).div(10000);
        const bidPrice = midAdjusted.times(new Decimal(1).minus(bidSpreadFactor)).toDecimalPlaces(precision, ROUND_DOWN);
        const askPrice = midAdjusted.times(new Decimal(1).plus(askSpreadFactor)).toDecimalPlaces(precision, ROUND_DOWN);

        const baseQty = sizedOrder
          .times(decay.pow(i))
          .times(depthSizeLevelMult(i, L))
          .toDecimalPlaces(8, ROUND_DOWN);
        const bidQtyStr = baseQty.times(inv.bidSizeMult).toDecimalPlaces(8, ROUND_DOWN).toString();
        const askQtyStr = baseQty.times(inv.askSizeMult).toDecimalPlaces(8, ROUND_DOWN).toString();

        const primaryBid = buys[i];
        const primaryAsk = sells[i];

        const bidNeeds = needsReplace(primaryBid, bidPrice, bidQtyStr, precision, bpsTh, qtyRelTh, maxQuoteAgeSec);
        const askNeeds = needsReplace(primaryAsk, askPrice, askQtyStr, precision, bpsTh, qtyRelTh, maxQuoteAgeSec);

        if (bidNeeds || askNeeds) allLevelsFresh = false;

        let bidAllowPlace = bidNeeds && !capitalSkipBid;
        if (bidNeeds && primaryBid && bidAllowPlace) {
          const ok = await cancelOrderHttp(baseUrl, headers, primaryBid.id);
          if (!ok) {
            errors.push(`${symbol}: cancel bid L${i} ${primaryBid.id} failed — skip replace`);
            liquidityBotErrorsTotal.inc({ reason: 'cancel_bid_failed' });
            logger.error('Liquidity bot: cancel bid failed, not placing replacement', {
              symbol,
              level: i,
              orderId: primaryBid.id,
            });
            bidAllowPlace = false;
          }
        }
        let askAllowPlace = askNeeds && !capitalSkipAsk;
        if (askNeeds && primaryAsk && askAllowPlace) {
          const ok = await cancelOrderHttp(baseUrl, headers, primaryAsk.id);
          if (!ok) {
            errors.push(`${symbol}: cancel ask L${i} ${primaryAsk.id} failed — skip replace`);
            liquidityBotErrorsTotal.inc({ reason: 'cancel_ask_failed' });
            logger.error('Liquidity bot: cancel ask failed, not placing replacement', {
              symbol,
              level: i,
              orderId: primaryAsk.id,
            });
            askAllowPlace = false;
          }
        }

        const ts = Date.now();
        if (bidAllowPlace && bidNeeds && !posGuard.skipBidPlacement) {
          const cid = `mm:${symbol}:buy:l${i}:${ts}`;
          const ok = await placeLimit(baseUrl, headers, symbol, 'buy', bidPrice.toString(), bidQtyStr, cid);
          if (!ok) {
            errors.push(`${symbol}: place bid L${i} failed`);
            liquidityBotErrorsTotal.inc({ reason: 'place_bid_failed' });
          } else {
            placed++;
            anyAction = true;
          }
        }

        if (askAllowPlace && askNeeds && !posGuard.skipAskPlacement) {
          const cid = `mm:${symbol}:sell:l${i}:${ts}`;
          const ok = await placeLimit(baseUrl, headers, symbol, 'sell', askPrice.toString(), askQtyStr, cid);
          if (!ok) {
            errors.push(`${symbol}: place ask L${i} failed`);
            liquidityBotErrorsTotal.inc({ reason: 'place_ask_failed' });
          } else {
            placed++;
            anyAction = true;
          }
        }
      }

      if (allLevelsFresh && !anyAction) {
        markMmQuotesFresh();
      } else if (anyAction) {
        markMmQuotesFresh();
      }

      if (!anyAction && allLevelsFresh) {
        skipped++;
      }

      }

      const fillRate = Math.min(1, fills1h / 18);
      setMmPairFillRate(symbol, fillRate);
      const minProfForLearn = feeOk
        ? computeMinProfitSpreadBps(feeRates.makerFeeBps, feeRates.takerFeeBps)
        : Number.NaN;
      observeMmSpreadLearning(symbol, {
        spread_bps: profitQuote.spread_bps,
        fill_rate: fillRate,
        pnl_usd: profitMx.h1?.pnlQuote ?? Number.NaN,
        min_profit_spread_bps: minProfForLearn,
      });
      recordPairPerformance(symbol, profitMx.h1.pnlQuote, fills1h);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${symbol}: ${msg}`);
      liquidityBotErrorsTotal.inc({ reason: 'cycle_exception' });
      logger.warn('Liquidity bot cycle error', { symbol, error: msg });
    }
  }

  lastCycleMaxVolBps = cycleMaxVol;

  incrementLiquidityBotCycleCounter();

  recordLiquidityBotCycleOutcome(errors.length > 0);
  void computeMmHealthSnapshot();

  liquidityBotRunsTotal.inc({ result: errors.length > 0 && placed === 0 ? 'degraded' : 'ok' });
  if (placed > 0 || errors.length > 0) {
    logger.debug('Liquidity bot cycle', { placed, skipped, errors: errors.length, baseUrl });
  }
  return { placed, errors, skipped };
}
