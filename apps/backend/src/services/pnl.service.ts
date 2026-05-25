/**
 * Hedge PnL ledger (treasury / risk view only — not user balances).
 */

import { db } from '../lib/database.js';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { hedgePnlDailyGauge, hedgeRealizedPnlTotalGauge } from '../lib/prometheus-metrics.js';

/** Roll signed realized delta into daily table and aggregate position PnL per market. */
export async function recordHedgeRealizedPnlUsd(params: { market: string; signedPnlUsd: string }): Promise<void> {
  const sym = params.market.toUpperCase().replace(/-/g, '_');
  const delta = new Decimal(params.signedPnlUsd);
  if (!delta.isFinite()) return;

  await db.query(
    `INSERT INTO hedge_pnl_daily (day, realized_pnl_usd, updated_at)
     VALUES ((timezone('UTC', now()))::date, $1::numeric, NOW())
     ON CONFLICT (day) DO UPDATE SET
       realized_pnl_usd = hedge_pnl_daily.realized_pnl_usd + EXCLUDED.realized_pnl_usd,
       updated_at = NOW()`,
    [delta.toString()]
  );

  await db.query(
    `INSERT INTO hedge_positions (market, unrealized_pnl, realized_pnl, exposure_usd, updated_at)
     VALUES ($1, 0, $2::numeric, 0, NOW())
     ON CONFLICT (market) DO UPDATE SET
       realized_pnl = hedge_positions.realized_pnl + EXCLUDED.realized_pnl,
       updated_at = NOW()`,
    [sym, delta.toString()]
  );

  const total = await db.query<{ s: string | null }>(
    `SELECT COALESCE(SUM(realized_pnl), 0)::text AS s FROM hedge_positions`
  );
  const g = new Decimal(total.rows[0]?.s ?? '0');
  if (g.isFinite()) hedgeRealizedPnlTotalGauge.set(parseFloat(g.toString()));
}

export async function getTodayRealizedPnlUsd(): Promise<DecimalInstance> {
  const r = await db.query<{ s: string | null }>(
    `SELECT COALESCE(realized_pnl_usd, 0)::text AS s FROM hedge_pnl_daily WHERE day = (timezone('UTC', now()))::date`
  );
  return new Decimal(r.rows[0]?.s ?? '0');
}

/** Adverse move (loss magnitude) against today's running sum: max(0, -todayNet). */
export async function getTodayAdverseUsd(): Promise<DecimalInstance> {
  const net = await getTodayRealizedPnlUsd();
  if (net.lt(0)) return net.neg();
  return new Decimal(0);
}

export async function refreshPnlGaugesFromDb(): Promise<void> {
  const r = await db.query<{ s: string | null }>(
    `SELECT COALESCE(realized_pnl_usd, 0)::text AS s FROM hedge_pnl_daily WHERE day = (timezone('UTC', now()))::date`
  );
  const d = new Decimal(r.rows[0]?.s ?? '0');
  if (d.isFinite()) hedgePnlDailyGauge.set(parseFloat(d.toString()));
}
