/**
 * Processes hedge_jobs against DB-configured providers (e.g. Binance). Does not modify user balances.
 * Uses LIMIT + IOC with max_slippage_bps vs internal reference price; exchangeInfo for lot/tick/minNotional.
 */
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { decryptProviderSecret } from '../lib/hybrid-credentials-crypto.js';
import { binanceSignedGet, binanceSignedPost, toBinanceSymbol } from '../lib/binance-signed-http.js';
import { externalLiquidityConfigService } from './external-liquidity-config.service.js';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import {
  hedgeJobsCompletedTotal,
  hedgeJobsFailedTotal,
} from '../lib/prometheus-metrics.js';
import { sendHedgeAlert } from './hedge-alert.service.js';
import {
  assertHedgeWorkerTickAllowed,
  refreshHedgeExposureGauge,
} from './hedge-risk.service.js';
import { recordHedgeRealizedPnlUsd } from './pnl.service.js';
import {
  getBinanceSymbolFilters,
  floorQtyToStep,
  roundLimitPriceToTick,
  stripDecimalString,
} from './binance-spot-symbol-filters.service.js';

/** Max reschedule attempts before marking job failed (safety-first; low default). */
const HEDGE_MAX_RETRIES = 3;

async function hybridFallbackInternalEnabled(market: string): Promise<boolean> {
  const cfg = await externalLiquidityConfigService.getHybridConfig(market);
  return cfg?.fallback_to_internal !== false;
}

async function cancelHedgeJobFallbackInternal(jobId: string, retryCount: number, detail: string): Promise<void> {
  await db.query(
    `UPDATE hedge_jobs SET status = 'cancelled', last_error = $1, retry_count = $2, next_attempt_at = NULL WHERE id = $3::uuid`,
    [`FALLBACK_INTERNAL:${detail.slice(0, 1900)}`, retryCount, jobId]
  );
  logger.info('hedge_job_cancelled_fallback_internal', { jobId, detail: detail.slice(0, 160) });
  await refreshHedgeExposureGauge();
}

function nextBackoffIsoForRetry(stepIndexZeroBased: number): string {
  const ms = Math.min(120_000, 500 * 2 ** Math.max(0, stepIndexZeroBased));
  return new Date(Date.now() + ms).toISOString();
}

type HedgeJobRow = {
  id: string;
  market: string;
  side: string;
  qty: string;
  status: string;
  retry_count: number;
  provider_id: string | null;
  internal_avg_price: string | null;
  notional_usd: string | null;
};

let workerStarted = false;

async function currentOpenHedgeNotionalUsd(): Promise<DecimalInstance> {
  const r = await db.query<{ s: string | null }>(
    `SELECT COALESCE(SUM(notional_usd), 0)::text AS s
     FROM hedge_jobs WHERE status IN ('pending', 'processing') AND notional_usd IS NOT NULL`
  );
  const s = r.rows[0]?.s ?? '0';
  const d = new Decimal(s);
  return d.isFinite() ? d : new Decimal(0);
}

async function claimNextHedgeJob(): Promise<HedgeJobRow | null> {
  return db.transaction(async (client) => {
    const pick = await client.query<{ id: string }>(
      `SELECT id FROM hedge_jobs
       WHERE status = 'pending'
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    const id = pick.rows[0]?.id;
    if (!id) return null;
    const upd = await client.query<HedgeJobRow>(
      `UPDATE hedge_jobs SET status = 'processing'
       WHERE id = $1
       RETURNING id::text, market, side, qty::text, status, retry_count, provider_id::text,
         internal_avg_price::text, notional_usd::text`,
      [id]
    );
    return upd.rows[0] ?? null;
  });
}

async function resolveInternalRefPrice(job: HedgeJobRow): Promise<DecimalInstance | null> {
  if (job.internal_avg_price) {
    const d = new Decimal(job.internal_avg_price);
    if (d.isFinite() && d.gt(0)) return d;
  }
  if (job.notional_usd && job.qty) {
    const q = new Decimal(job.qty);
    if (q.gt(0)) {
      const n = new Decimal(job.notional_usd);
      const p = n.div(q);
      if (p.isFinite() && p.gt(0)) return p;
    }
  }
  const r = await db.query<{ p: string | null }>(
    `SELECT st.price::text AS p
     FROM spot_trades st
     LEFT JOIN trading_pairs tp ON tp.id = st.trading_pair_id
     WHERE COALESCE(st.market, tp.symbol) = $1
     ORDER BY st.created_at DESC NULLS LAST
     LIMIT 1`,
    [job.market]
  );
  const p = r.rows[0]?.p;
  if (!p) return null;
  const d = new Decimal(p);
  return d.isFinite() && d.gt(0) ? d : null;
}

async function processOneJob(job: HedgeJobRow): Promise<void> {
  let providerId = job.provider_id;
  const providers = await externalLiquidityConfigService.getActiveProviders();
  if (!providerId || !providers.some((p) => p.id === providerId)) {
    const p0 = providers[0];
    if (!p0) {
      await failJob(job.id, 'NO_ACTIVE_EXTERNAL_PROVIDER', job.retry_count, job.market);
      return;
    }
    providerId = p0.id;
    await db.query(`UPDATE hedge_jobs SET provider_id = $1::uuid WHERE id = $2::uuid`, [providerId, job.id]);
  }

  const provRow = providers.find((p) => p.id === providerId) ?? providers[0];
  if (!provRow) {
    await failJob(job.id, 'NO_ACTIVE_EXTERNAL_PROVIDER', job.retry_count, job.market);
    return;
  }

  const hybridCfg = await externalLiquidityConfigService.getHybridConfig(job.market);
  const slipBps = Math.min(5000, Math.max(0, hybridCfg?.max_slippage_bps ?? 50));
  const slip = new Decimal(slipBps).div(10000);

  const internalRef = await resolveInternalRefPrice(job);
  if (!internalRef) {
    await failJob(job.id, 'MISSING_INTERNAL_REFERENCE_PRICE', job.retry_count, job.market);
    return;
  }

  const symbol = toBinanceSymbol(job.market);
  const sideBinance = job.side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL';

  const filters = await getBinanceSymbolFilters(provRow.base_url, symbol);
  if (!filters) {
    await failJob(job.id, 'BINANCE_EXCHANGEINFO_UNAVAILABLE', job.retry_count, job.market);
    return;
  }

  const qtyRaw = new Decimal(job.qty);
  const qtyAdj = floorQtyToStep(qtyRaw, filters.stepSize);
  if (!qtyAdj.isFinite() || qtyAdj.lte(0)) {
    await failJob(job.id, 'HEDGE_QTY_ZERO_AFTER_STEP', job.retry_count, job.market);
    return;
  }
  if (filters.minQty.gt(0) && qtyAdj.lt(filters.minQty)) {
    await failJob(job.id, `HEDGE_QTY_BELOW_MIN_QTY:${filters.minQty.toString()}`, job.retry_count, job.market);
    return;
  }

  let limitPx =
    sideBinance === 'BUY'
      ? internalRef.times(new Decimal(1).plus(slip))
      : internalRef.times(new Decimal(1).minus(slip));
  if (!limitPx.isFinite() || limitPx.lte(0)) {
    await failJob(job.id, 'LIMIT_PRICE_NON_POSITIVE', job.retry_count, job.market);
    return;
  }
  limitPx = roundLimitPriceToTick(limitPx, filters.tickSize, sideBinance);

  const notionalEst = limitPx.times(qtyAdj);
  if (filters.minNotional.gt(0) && notionalEst.lt(filters.minNotional)) {
    await failJob(
      job.id,
      `HEDGE_BELOW_MIN_NOTIONAL:${filters.minNotional.toString()}:${notionalEst.toString()}`,
      job.retry_count,
      job.market
    );
    return;
  }

  let apiKey: string;
  let apiSecret: string;
  try {
    apiKey = decryptProviderSecret(provRow.api_key_ciphertext);
    apiSecret = decryptProviderSecret(provRow.api_secret_ciphertext);
  } catch (e) {
    await failJob(job.id, `DECRYPT_PROVIDER_FAILED:${e instanceof Error ? e.message : String(e)}`, job.retry_count, job.market);
    return;
  }

  const clientOid = `hx${job.id.replace(/-/g, '').slice(0, 24)}`;
  const qtyStr = stripDecimalString(qtyAdj);
  const priceStr = stripDecimalString(limitPx);

  const extIns = await db.query<{ id: string }>(
    `INSERT INTO external_orders (provider_id, hedge_job_id, external_order_id, status, filled_qty, avg_price, raw_response)
     VALUES ($1::uuid, $2::uuid, NULL, 'pending', 0, NULL, NULL)
     RETURNING id::text`,
    [provRow.id, job.id]
  );
  const extRowId = extIns.rows[0]?.id;

  let recv: { ok: boolean; status: number; body: unknown };

  if (config.hybrid.hedgeDryRun) {
    const simQty = qtyStr;
    const simQuote = stripDecimalString(limitPx.times(qtyAdj));
    recv = {
      ok: true,
      status: 200,
      body: {
        dry_run: true,
        orderId: `dry_${Date.now()}`,
        symbol,
        status: 'FILLED',
        type: 'LIMIT',
        side: sideBinance,
        price: priceStr,
        origQty: simQty,
        executedQty: simQty,
        cummulativeQuoteQty: simQuote,
        timeInForce: 'IOC',
        max_slippage_bps_used: slipBps,
        internal_ref_price: internalRef.toString(),
      },
    };
    logger.info('hedge_dry_run_simulated', { hedgeJobId: job.id, symbol, side: sideBinance, qty: qtyStr, price: priceStr });
  } else {
    recv = await binanceSignedPost(provRow.base_url, '/api/v3/order', apiKey, apiSecret, {
      symbol,
      side: sideBinance,
      type: 'LIMIT',
      timeInForce: 'IOC',
      quantity: qtyStr,
      price: priceStr,
      newClientOrderId: clientOid,
      timestamp: Date.now(),
      recvWindow: 60_000,
    });

    // Network ambiguity guard: if place call failed/timeout, reconcile by clientOrderId once
    // to avoid duplicate hedge or false fail on an actually accepted order.
    if (!recv.ok) {
      const probe = await binanceSignedGet(provRow.base_url, '/api/v3/order', apiKey, apiSecret, {
        symbol,
        origClientOrderId: clientOid,
        timestamp: Date.now(),
        recvWindow: 60_000,
      });
      const body = probe.body as Record<string, unknown>;
      const hasOrder = probe.ok && (typeof body.orderId === 'number' || typeof body.orderId === 'string');
      if (hasOrder) {
        recv = probe;
        logger.warn('hedge_place_reconciled_via_query_order', {
          hedgeJobId: job.id,
          symbol,
          providerId: provRow.id,
        });
      }
    }
  }

  const raw = recv.body as Record<string, unknown>;
  const extOid =
    typeof raw.orderId === 'number'
      ? String(raw.orderId)
      : raw.orderId != null
        ? String(raw.orderId)
        : null;
  const exQty = new Decimal(String(raw.executedQty ?? '0'));
  const filledOk = exQty.gt(0);
  const st = String(raw.status ?? '').toUpperCase();
  const filledStr = exQty.toString();
  let avgPx: string | null = null;
  if (filledOk && raw.cummulativeQuoteQty != null && exQty.gt(0)) {
    avgPx = new Decimal(String(raw.cummulativeQuoteQty)).div(exQty).toString();
  }

  let extStatus: 'filled' | 'partially_filled' | 'failed' = 'failed';
  if (filledOk) {
    const orig = new Decimal(String(raw.origQty ?? qtyStr));
    extStatus = exQty.gte(orig) || st === 'FILLED' ? 'filled' : 'partially_filled';
  } else if (recv.ok && !config.hybrid.hedgeDryRun) {
    extStatus = 'failed';
  }

  if (extRowId) {
    await db.query(
      `UPDATE external_orders SET external_order_id = $1, status = $2, filled_qty = $3::numeric, avg_price = $4::numeric, raw_response = $5::jsonb
       WHERE id = $6::uuid`,
      [extOid, extStatus, filledStr, avgPx, JSON.stringify(raw), extRowId]
    );
  }

  if (filledOk) {
    await db.query(
      `UPDATE hedge_jobs SET status = 'completed', last_error = NULL, next_attempt_at = NULL WHERE id = $1::uuid`,
      [job.id]
    );
    await externalLiquidityConfigService.markProviderHealthOk(provRow.id);
    hedgeJobsCompletedTotal.inc();
    if (avgPx) {
      try {
        const avg = new Decimal(avgPx);
        const exQ = new Decimal(exQty);
        /** Desk PnL vs internal reference (+ = favorable). */
        const signedUsd =
          sideBinance === 'BUY'
            ? internalRef.minus(avg).mul(exQ)
            : avg.minus(internalRef).mul(exQ);
        await recordHedgeRealizedPnlUsd({
          market: job.market,
          signedPnlUsd: signedUsd.toString(),
        });
      } catch (e) {
        logger.warn('hedge_pnl_record_failed', { jobId: job.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await refreshHedgeExposureGauge();
    logger.info('hedge_placed', { hedgeJobId: job.id, symbol, providerId: provRow.id, side: sideBinance, qty: filledStr });
    return;
  }

  logger.warn('hedge_failed_or_unfilled', { hedgeJobId: job.id, symbol, providerId: provRow.id, httpOk: recv.ok, dryRun: config.hybrid.hedgeDryRun });

  const msg = config.hybrid.hedgeDryRun
    ? 'DRY_RUN_UNEXPECTED'
    : recv.ok
      ? `IOC_NO_FILL:${st}`
      : typeof raw.msg === 'string'
        ? raw.msg
        : typeof raw.message === 'string'
          ? raw.message
          : `HTTP_${recv.status}`;
  const nextRetry = job.retry_count + 1;
  const rf = await externalLiquidityConfigService.recordHedgeProviderFailure(provRow.id);
  if (rf.circuitTrippedAtThree) {
    logger.error('hedge_provider_circuit_disabled', {
      providerId: provRow.id,
      streak: rf.consecutive,
    });
    void sendHedgeAlert('hedge_failure_streak_provider_disabled', {
      providerId: provRow.id,
      consecutiveFailures: String(rf.consecutive),
    });
  }
  if (nextRetry >= HEDGE_MAX_RETRIES) {
    if (await hybridFallbackInternalEnabled(job.market)) {
      await cancelHedgeJobFallbackInternal(job.id, nextRetry, msg);
    } else {
      await db.query(
        `UPDATE hedge_jobs SET status = 'failed', last_error = $1, retry_count = $2, next_attempt_at = NULL WHERE id = $3::uuid`,
        [msg.slice(0, 2000), nextRetry, job.id]
      );
      hedgeJobsFailedTotal.inc();
    }
  } else {
    const backoffIso = nextBackoffIsoForRetry(nextRetry - 1);
    let rotateProvId = providerId;
    if (providers.length > 1) {
      const idx = providers.findIndex((p) => p.id === providerId);
      const nextIdx = idx >= 0 ? (idx + 1) % providers.length : 0;
      rotateProvId = providers[nextIdx]!.id;
    }
    await db.query(
      `UPDATE hedge_jobs SET status = 'pending', last_error = $1, retry_count = $2, next_attempt_at = $3::timestamptz, provider_id = $4::uuid WHERE id = $5::uuid`,
      [msg.slice(0, 2000), nextRetry, backoffIso, rotateProvId, job.id]
    );
  }
  await refreshHedgeExposureGauge();
}

async function failJob(id: string, err: string, retryCount: number, market?: string): Promise<void> {
  const next = retryCount + 1;

  if (market && err === 'NO_ACTIVE_EXTERNAL_PROVIDER' && (await hybridFallbackInternalEnabled(market))) {
    await cancelHedgeJobFallbackInternal(id, next, err);
    return;
  }

  if (next >= HEDGE_MAX_RETRIES) {
    if (market && (await hybridFallbackInternalEnabled(market))) {
      await cancelHedgeJobFallbackInternal(id, next, err);
      return;
    }
    await db.query(
      `UPDATE hedge_jobs SET status = 'failed', last_error = $1, retry_count = $2, next_attempt_at = NULL WHERE id = $3::uuid`,
      [err.slice(0, 2000), next, id]
    );
    hedgeJobsFailedTotal.inc();
    logger.warn('hedge_job_terminal_fail', { id, err: err.slice(0, 200) });
  } else {
    const backoffIso = nextBackoffIsoForRetry(next - 1);
    await db.query(
      `UPDATE hedge_jobs SET status = 'pending', last_error = $1, retry_count = $2, next_attempt_at = $3::timestamptz WHERE id = $4::uuid`,
      [err.slice(0, 2000), next, backoffIso, id]
    );
  }
  await refreshHedgeExposureGauge();
}

/** GET /api/v3/account — validates signing only; does not place orders. */
export async function testBinanceProviderCredentials(
  baseUrl: string,
  apiKey: string,
  apiSecret: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  return binanceSignedGet(baseUrl, '/api/v3/account', apiKey, apiSecret, {
    timestamp: Date.now(),
    recvWindow: 60_000,
  });
}

export function startHedgeEngineWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const tick = async () => {
    if (!config.hybrid.hedgeEnabled) return;
    try {
      const gate = await assertHedgeWorkerTickAllowed();
      if (!gate.ok) {
        logger.debug('hedge_worker_skipped', { reason: gate.message });
        return;
      }
      await refreshHedgeExposureGauge();
      const globalCfg = await externalLiquidityConfigService.getGlobalHybridConfig();
      const maxNet = globalCfg ? new Decimal(globalCfg.max_net_hedge_exposure_usd) : new Decimal(0);
      if (maxNet.gt(0)) {
        const open = await currentOpenHedgeNotionalUsd();
        if (open.gt(maxNet)) return;
      }
      const job = await claimNextHedgeJob();
      if (!job) return;
      await processOneJob(job);
    } catch (e) {
      logger.warn('hedge_engine_tick_failed', { error: e instanceof Error ? e.message : String(e) });
    }
  };
  setInterval(() => {
    void tick();
  }, config.hybrid.hedgeWorkerIntervalMs);
  logger.info('Hedge engine worker scheduled', {
    intervalMs: config.hybrid.hedgeWorkerIntervalMs,
    dryRun: config.hybrid.hedgeDryRun,
  });
}
