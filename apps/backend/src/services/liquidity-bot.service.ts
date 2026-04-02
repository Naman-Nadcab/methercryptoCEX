/**
 * Institutional liquidity bot: ladder quotes, vol-based spread, inventory risk, quote-age refresh.
 * Base URL: LIQUIDITY_BOT_INTERNAL_API_URL or http://127.0.0.1:{PORT}/api/v1
 */
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { getSpotOrdersUseMarketSync } from '../lib/spot-schema-cache.js';
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
import { getInventoryRiskAdjust } from './mm-inventory-risk.service.js';
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

const ROUND_DOWN = 1;

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

async function fetchBotOpenLimitOrders(userId: string, market: string): Promise<BotOpenLimit[]> {
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
  const spreadBpsBase = config.liquidityBot.spreadBps;
  const orderSize = config.liquidityBot.orderSize;
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

  const capitalWeights = await getCapitalAllocationWeights(symbols, userId);
  const nSym = symbols.length || 1;

  for (const symbol of symbols) {
    try {
      const oracle = await getOracleMidState(symbol);
      if (!oracle) {
        errors.push(`${symbol}: no oracle mid`);
        liquidityBotErrorsTotal.inc({ reason: 'no_oracle_mid' });
        continue;
      }

      if (oracle.ageSec > staleSec) {
        if (skipIfStale) {
          errors.push(`${symbol}: oracle stale ${Math.round(oracle.ageSec)}s — skipped`);
          liquidityBotErrorsTotal.inc({ reason: 'oracle_stale_skip' });
          skipped++;
          continue;
        }
        logger.warn('Liquidity bot: stale oracle, widening spread', {
          symbol,
          ageSec: Math.round(oracle.ageSec),
          thresholdSec: staleSec,
        });
      }

      const volBps = await getRealizedVolatilityBps(symbol);
      const volMult = volatilitySpreadMultiplier(volBps);

      const staleSpreadBps =
        oracle.ageSec > staleSec ? Math.min(500, Math.round(spreadBpsBase * staleMult)) : spreadBpsBase;

      const inv = await getInventoryRiskAdjust(symbol, userId, volBps);
      const precision = await getPricePrecision(symbol);
      const midSkewFactor = new Decimal(1).plus(new Decimal(inv.midSkewBps).div(10000));
      const midAdjusted = oracle.mid.times(midSkewFactor).toDecimalPlaces(precision, ROUND_DOWN);

      const coreHalfBps = Math.round(staleSpreadBps * health.spreadMultiplier * volMult);
      let avgLatMs = 0;
      let extOracleDivBps: number | null = null;
      if (config.externalPriceFeed.enabled) {
        const agg = await aggregateExternalMidPrice(symbol);
        avgLatMs = agg.avgLatencyMs ?? 0;
        const extMid = agg.mid;
        const oMid = oracle.mid.toNumber();
        if (extMid != null && extMid > 0 && oMid > 0) {
          extOracleDivBps = (Math.abs(extMid - oMid) / oMid) * 10_000;
        }
      }
      const [toxic, flow, feeRates, profitMx, momentumBps, bookObi] = await Promise.all([
        getToxicFlowMetrics(symbol),
        getOrderFlowImbalance(symbol),
        getMarketFeeRates(symbol),
        getMmSymbolProfitMetrics(symbol, userId),
        getFastMomentumBps(symbol),
        getTopKBookObi(symbol),
      ]);
      const elite = computeEliteSpreadAdjustments({
        avgSourceLatencyMs: avgLatMs,
        toxicScore: toxic.toxicScore,
        ofi: flow.ofi,
        coreHalfSpreadBps: coreHalfBps,
      });
      const deskLatArbBps = computeDeskLatencyArbAddBps(avgLatMs, extOracleDivBps);
      const bookAdvBps = computePreTradeBookAdverseBps(bookObi, coreHalfBps);
      const momExtras = computeMomentumHalfExtrasBps(momentumBps);
      const feeAddBps = computeFeeAwareHalfSpreadAddBps(feeRates.makerFeeBps, feeRates.takerFeeBps);
      const dynTarget =
        profitMx.quant?.dynamicProfitTargetBps1h ?? config.eliteMm.profitEdgeTargetBps;
      const profitAdjBps = computeProfitabilitySpreadAdjustBps(profitMx.h1.realizedEdgeBps, dynTarget);
      const adverseAddBps = computeAdverseSelectionSpreadAddBps(profitMx.quant?.adverseSelectionBps1h ?? 0);
      const halfSpreadBpsBase = Math.min(
        500,
        coreHalfBps +
          Math.round(inv.extraSpreadBps) +
          elite.symmetricAddBps +
          feeAddBps +
          profitAdjBps +
          adverseAddBps +
          deskLatArbBps +
          bookAdvBps
      );

      const L = inst.ladderLevels;
      const stepBps = inst.ladderStepBps;
      const decay = new Decimal(inst.ladderSizeDecay);
      const maxQuoteAgeSec = inst.quoteMaxAgeSec;

      const allocW = capitalWeights[symbol] ?? 1 / nSym;
      const sizeMult = allocW * nSym;
      const sizedOrder = new Decimal(orderSize).times(sizeMult);

      const open = await fetchBotOpenLimitOrders(userId, symbol);
      const buys = open.filter((o) => o.side === 'buy').sort((a, b) => new Decimal(b.price).cmp(new Decimal(a.price)));
      const sells = open.filter((o) => o.side === 'sell').sort((a, b) => new Decimal(a.price).cmp(new Decimal(b.price)));

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

      for (let i = 0; i < L; i++) {
        const bidLevelBps = Math.min(
          750,
          halfSpreadBpsBase +
            elite.bidHalfExtraBps +
            momExtras.bidHalfExtraBps +
            i * stepBps
        );
        const askLevelBps = Math.min(
          750,
          halfSpreadBpsBase +
            elite.askHalfExtraBps +
            momExtras.askHalfExtraBps +
            i * stepBps
        );
        const bidSpreadFactor = new Decimal(bidLevelBps).div(10000);
        const askSpreadFactor = new Decimal(askLevelBps).div(10000);
        const bidPrice = midAdjusted.times(new Decimal(1).minus(bidSpreadFactor)).toDecimalPlaces(precision, ROUND_DOWN);
        const askPrice = midAdjusted.times(new Decimal(1).plus(askSpreadFactor)).toDecimalPlaces(precision, ROUND_DOWN);

        const baseQty = sizedOrder.times(decay.pow(i)).toDecimalPlaces(8, ROUND_DOWN);
        const bidQtyStr = baseQty.times(inv.bidSizeMult).toDecimalPlaces(8, ROUND_DOWN).toString();
        const askQtyStr = baseQty.times(inv.askSizeMult).toDecimalPlaces(8, ROUND_DOWN).toString();

        const primaryBid = buys[i];
        const primaryAsk = sells[i];

        const bidNeeds = needsReplace(primaryBid, bidPrice, bidQtyStr, precision, bpsTh, qtyRelTh, maxQuoteAgeSec);
        const askNeeds = needsReplace(primaryAsk, askPrice, askQtyStr, precision, bpsTh, qtyRelTh, maxQuoteAgeSec);

        if (bidNeeds || askNeeds) allLevelsFresh = false;

        if (bidNeeds && primaryBid) {
          const ok = await cancelOrderHttp(baseUrl, headers, primaryBid.id);
          if (!ok) {
            errors.push(`${symbol}: cancel bid L${i} ${primaryBid.id} failed`);
            liquidityBotErrorsTotal.inc({ reason: 'cancel_bid_failed' });
          }
        }
        if (askNeeds && primaryAsk) {
          const ok = await cancelOrderHttp(baseUrl, headers, primaryAsk.id);
          if (!ok) {
            errors.push(`${symbol}: cancel ask L${i} ${primaryAsk.id} failed`);
            liquidityBotErrorsTotal.inc({ reason: 'cancel_ask_failed' });
          }
        }

        const ts = Date.now();
        if (bidNeeds) {
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

        if (askNeeds) {
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

      if (!(oracle.ageSec > staleSec && skipIfStale)) {
        if (allLevelsFresh && !anyAction) {
          markMmQuotesFresh();
        } else if (anyAction) {
          markMmQuotesFresh();
        }
      }

      if (!anyAction && allLevelsFresh) {
        skipped++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${symbol}: ${msg}`);
      liquidityBotErrorsTotal.inc({ reason: 'cycle_exception' });
      logger.warn('Liquidity bot cycle error', { symbol, error: msg });
    }
  }

  recordLiquidityBotCycleOutcome(errors.length > 0);
  void computeMmHealthSnapshot();

  liquidityBotRunsTotal.inc({ result: errors.length > 0 && placed === 0 ? 'degraded' : 'ok' });
  if (placed > 0 || errors.length > 0) {
    logger.debug('Liquidity bot cycle', { placed, skipped, errors: errors.length, baseUrl });
  }
  return { placed, errors, skipped };
}
