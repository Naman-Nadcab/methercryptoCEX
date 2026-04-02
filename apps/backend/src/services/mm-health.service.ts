/**
 * Market-maker / liquidity intelligence: oracle freshness, settlement lag, bot errors, quote age, external price check.
 * Drives automatic spread widening and optional bot pause (liquidity bot integration).
 */
import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { refreshSettlementBacklogSnapshot } from './settlement-pipeline-health.service.js';
import { aggregateExternalMidPrice, midDivergenceBps } from './external-price-feed.service.js';
import { liquidityBotQuoteAgeSeconds, mmHealthLevelGauge } from '../lib/prometheus-metrics.js';

export type MmHealthLevel = 'ok' | 'degraded' | 'critical';

export type MmHealthSnapshot = {
  level: MmHealthLevel;
  pauseBot: boolean;
  /** Applied on top of oracle stale multiplier in liquidity bot. */
  spreadMultiplier: number;
  oracleMaxAgeSec: number;
  settlementLagSec: number;
  pendingSettlementCount: number;
  botErrorRate: number;
  /** Null if bot never marked quotes fresh this process. */
  quoteAgeSec: number | null;
  externalMaxDivergenceBps: number | null;
  reasons: string[];
};

let lastQuoteFreshAt: number | null = null;
const botHadErrorsWindow: boolean[] = [];
let botCycleCount = 0;

export function markMmQuotesFresh(): void {
  lastQuoteFreshAt = Date.now();
}

export function recordLiquidityBotCycleOutcome(hadErrors: boolean): void {
  botCycleCount += 1;
  const w = config.mmHealth.botErrorWindow;
  botHadErrorsWindow.push(hadErrors);
  while (botHadErrorsWindow.length > w) botHadErrorsWindow.shift();
}

function computeBotErrorRate(): number {
  if (botHadErrorsWindow.length === 0) return 0;
  return botHadErrorsWindow.filter(Boolean).length / botHadErrorsWindow.length;
}

function levelToGauge(level: MmHealthLevel): number {
  if (level === 'ok') return 0;
  if (level === 'degraded') return 1;
  return 2;
}

async function maxOracleAgeForSymbols(symbols: string[]): Promise<number> {
  if (symbols.length === 0) return 0;
  try {
    const r = await db.query<{ sec: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(mp.last_updated)))::text AS sec
       FROM market_prices mp
       JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
       WHERE sm.symbol = ANY($1::text[])`,
      [symbols]
    );
    const raw = r.rows[0]?.sec;
    if (raw == null || raw === '') return 0;
    return Math.max(0, parseFloat(raw) || 0);
  } catch {
    return 0;
  }
}

async function oracleMid(symbol: string): Promise<number | null> {
  try {
    const row = await db.query<{ price: string }>(
      `SELECT mp.price::text AS price
       FROM market_prices mp
       JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
       WHERE sm.symbol = $1 LIMIT 1`,
      [symbol]
    );
    const p = parseFloat(row.rows[0]?.price ?? '');
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

let lastSnapshot: MmHealthSnapshot | null = null;
let lastExternalEvalAt = 0;
let cachedExternalDivergenceBps: number | null = null;

export function getLastMmHealthSnapshot(): MmHealthSnapshot | null {
  return lastSnapshot;
}

/**
 * Full MM health evaluation. Refreshes settlement backlog snapshot as side effect.
 */
export async function computeMmHealthSnapshot(): Promise<MmHealthSnapshot> {
  const reasons: string[] = [];
  const mh = config.mmHealth;
  const symbols = config.liquidityBot.symbols;

  if (!mh.enabled) {
    const qAge =
      lastQuoteFreshAt != null ? Math.max(0, (Date.now() - lastQuoteFreshAt) / 1000) : 0;
    const snap: MmHealthSnapshot = {
      level: 'ok',
      pauseBot: false,
      spreadMultiplier: 1,
      oracleMaxAgeSec: 0,
      settlementLagSec: 0,
      pendingSettlementCount: 0,
      botErrorRate: 0,
      quoteAgeSec: lastQuoteFreshAt != null ? qAge : null,
      externalMaxDivergenceBps: null,
      reasons: [],
    };
    lastSnapshot = snap;
    mmHealthLevelGauge.set(0);
    liquidityBotQuoteAgeSeconds.set(qAge);
    return snap;
  }

  const [oracleMaxAgeSec, backlog] = await Promise.all([
    maxOracleAgeForSymbols(symbols),
    refreshSettlementBacklogSnapshot(),
  ]);

  const settlementLagSec = backlog.oldestPendingAgeSeconds;
  const botErrorRate = computeBotErrorRate();
  const quoteAgeSec =
    lastQuoteFreshAt != null ? Math.max(0, (Date.now() - lastQuoteFreshAt) / 1000) : null;

  let externalMaxDivergenceBps: number | null = null;
  const extIntervalMs = 60_000;
  if (config.externalPriceFeed.enabled && symbols.length > 0) {
    const now = Date.now();
    if (now - lastExternalEvalAt >= extIntervalMs) {
      lastExternalEvalAt = now;
      let maxBps: number | null = null;
      for (const sym of symbols) {
        const internal = await oracleMid(sym);
        const { mid: ext } = await aggregateExternalMidPrice(sym);
        if (internal != null && ext != null) {
          const bps = midDivergenceBps(internal, ext);
          maxBps = maxBps == null ? bps : Math.max(maxBps, bps);
        }
      }
      cachedExternalDivergenceBps = maxBps;
    }
    externalMaxDivergenceBps = cachedExternalDivergenceBps;
  }

  let level: MmHealthLevel = 'ok';
  let spreadMultiplier = 1;

  const oracleCrit = oracleMaxAgeSec >= mh.oracleCriticalSec;
  const settleCrit = settlementLagSec >= mh.settlementLagCriticalSec;
  const extCrit =
    externalMaxDivergenceBps != null && externalMaxDivergenceBps >= mh.externalDivergenceCriticalBps;
  const botCrit = botErrorRate >= mh.botErrorRateCritical;
  const quoteCrit =
    quoteAgeSec != null &&
    quoteAgeSec >= mh.quoteAgeCriticalSec &&
    botCycleCount >= mh.minCyclesBeforeQuoteCheck;

  if (oracleCrit) reasons.push('oracle_stale_critical');
  if (settleCrit) reasons.push('settlement_lag_critical');
  if (extCrit) reasons.push('external_price_divergence_critical');
  if (botCrit) reasons.push('bot_error_rate_critical');
  if (quoteCrit) reasons.push('quote_stale_critical');

  const anyCritical = oracleCrit || settleCrit || extCrit || botCrit || quoteCrit;

  const oracleDegraded =
    !oracleCrit && oracleMaxAgeSec >= config.liquidityBot.oracleStaleSec && oracleMaxAgeSec > 0;
  const settleDegraded =
    !settleCrit && settlementLagSec >= Math.max(30, Math.floor(mh.settlementLagCriticalSec / 3));
  const extDegraded =
    !extCrit &&
    externalMaxDivergenceBps != null &&
    externalMaxDivergenceBps >= mh.externalDivergenceWarnBps;
  const botDegraded = !botCrit && botErrorRate >= mh.botErrorRateWarn;
  const quoteDegraded =
    !quoteCrit &&
    quoteAgeSec != null &&
    quoteAgeSec >= Math.max(60, Math.floor(mh.quoteAgeCriticalSec / 2)) &&
    botCycleCount >= mh.minCyclesBeforeQuoteCheck;

  if (oracleDegraded) reasons.push('oracle_stale');
  if (settleDegraded) reasons.push('settlement_lag_elevated');
  if (extDegraded) reasons.push('external_price_divergence');
  if (botDegraded) reasons.push('bot_errors_elevated');
  if (quoteDegraded) reasons.push('quote_stale');

  const anyDegraded =
    oracleDegraded || settleDegraded || extDegraded || botDegraded || quoteDegraded;

  if (anyCritical) {
    level = 'critical';
    spreadMultiplier = mh.spreadMultBad;
  } else if (anyDegraded) {
    level = 'degraded';
    spreadMultiplier = mh.spreadMultDegraded;
  }

  const pauseBot = anyCritical && mh.autoPauseOnCritical;

  const snap: MmHealthSnapshot = {
    level,
    pauseBot,
    spreadMultiplier,
    oracleMaxAgeSec,
    settlementLagSec,
    pendingSettlementCount: backlog.pendingCount,
    botErrorRate,
    quoteAgeSec,
    externalMaxDivergenceBps,
    reasons: [...new Set(reasons)],
  };

  lastSnapshot = snap;
  mmHealthLevelGauge.set(levelToGauge(level));
  liquidityBotQuoteAgeSeconds.set(quoteAgeSec ?? 0);

  if (level !== 'ok') {
    logger.debug('MM health snapshot', { level, pauseBot, spreadMultiplier, reasons: snap.reasons });
  }

  return snap;
}
