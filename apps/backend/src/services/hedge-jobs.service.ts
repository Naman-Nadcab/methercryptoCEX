/**
 * Post-internal-match hedge job queue. Does not touch user balances or settlement.
 */
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { assertHedgeEnqueueAllowed, refreshHedgeExposureGauge } from './hedge-risk.service.js';

export async function enqueueHedgeJobAfterInternalFill(params: {
  userOrderId: string;
  market: string;
  side: 'buy' | 'sell';
  filledQty: string;
  notionalUsd: string | null;
  /** VWAP of internal fills (quote/base); used for slippage-bounded hedge limits. */
  internalAvgPrice: string | null;
}): Promise<void> {
  const dup = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM hedge_jobs
     WHERE user_order_id = $1::uuid AND status IN ('pending', 'processing')`,
    [params.userOrderId]
  );
  if (parseInt(dup.rows[0]?.n ?? '0', 10) > 0) {
    return;
  }

  const risk = await assertHedgeEnqueueAllowed({
    market: params.market,
    notionalUsd: params.notionalUsd,
  });
  if (!risk.ok) {
    logger.info('hedge_enqueue_blocked', {
      code: risk.code,
      userOrderId: params.userOrderId,
      message: risk.message,
    });
    return;
  }

  const prov = await db.query<{ id: string }>(
    `SELECT id::text FROM external_liquidity_providers
     WHERE enabled = TRUE AND base_url <> '' AND api_key_ciphertext <> '' AND api_secret_ciphertext <> ''
     ORDER BY priority DESC, created_at ASC LIMIT 1`
  );
  const providerId = prov.rows[0]?.id ?? null;

  try {
    await db.query(
      `INSERT INTO hedge_jobs (market, side, qty, status, retry_count, user_order_id, notional_usd, provider_id, internal_avg_price)
       VALUES ($1, $2, $3::numeric, 'pending', 0, $4::uuid, $5::numeric, $6::uuid, $7::numeric)`,
      [
        params.market,
        params.side,
        params.filledQty,
        params.userOrderId,
        params.notionalUsd,
        providerId,
        params.internalAvgPrice,
      ]
    );
    await refreshHedgeExposureGauge().catch(() => {});
  } catch (e) {
    logger.warn('hedge_job_enqueue_failed', {
      userOrderId: params.userOrderId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
