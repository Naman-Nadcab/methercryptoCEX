/**
 * Hybrid hedge risk gates: exposure, daily loss, killswitch, DB master flag.
 * Spot user flow is never blocked — only hedge enqueue / execution.
 */

import { db } from '../lib/database.js';
import { Decimal } from '../lib/decimal.js';
import { logger } from '../lib/logger.js';
import { externalLiquidityConfigService, type HybridExecutionConfigRow } from './external-liquidity-config.service.js';
import { getTodayAdverseUsd } from './pnl.service.js';
import { hedgeExposureUsdGauge, hedgeJobsSkippedTotal, hedgeKillSwitchGauge } from '../lib/prometheus-metrics.js';
import { sendHedgeAlert } from './hedge-alert.service.js';

const HEDGE_PROVIDER_TRIP_FAILURES = 3;

function parseJsonBoolean(v: unknown, defaultFalse: boolean): boolean {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  return defaultFalse;
}

export async function readHedgeSystemBool(key: 'hedge_global_enabled' | 'hedge_emergency_stop'): Promise<boolean> {
  const r = await db.query<{ raw: unknown }>(
    `SELECT value AS raw FROM system_settings WHERE key = $1 LIMIT 1`,
    [key]
  );
  const v = r.rows[0]?.raw;
  if (v === undefined || v === null) {
    return false;
  }
  return parseJsonBoolean(v, false);
}

export async function setHedgeEmergencyStop(active: boolean): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('hedge_emergency_stop', to_jsonb($1::boolean), NOW())
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb($1::boolean), updated_at = NOW()`,
    [active]
  );
  hedgeKillSwitchGauge.set(active ? 1 : 0);
  if (active) {
    logger.error('hedge_emergency_stop_activated', {});
    void sendHedgeAlert('hedge_emergency_activated', { source: 'manual_or_auto' });
  }
  await externalLiquidityConfigService.invalidateCache();
}

export async function setHedgeGlobalEnabled(enabled: boolean): Promise<void> {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('hedge_global_enabled', to_jsonb($1::boolean), NOW())
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb($1::boolean), updated_at = NOW()`,
    [enabled]
  );
  logger.info('hedge_global_enabled_set', { enabled });
  await externalLiquidityConfigService.invalidateCache();
}

async function evaluateDailyLossKill(globalCfg: HybridExecutionConfigRow | null): Promise<void> {
  if (!globalCfg) return;
  const maxLoss = new Decimal(globalCfg.hedge_max_daily_loss_usd ?? '25000');
  if (!maxLoss.isFinite() || maxLoss.lte(0)) return;
  const adverse = await getTodayAdverseUsd();
  if (!adverse.isFinite()) return;
  if (adverse.gte(maxLoss)) {
    const stop = await readHedgeSystemBool('hedge_emergency_stop');
    if (!stop) {
      logger.error('hedge_daily_loss_kill', { adverse: adverse.toString(), maxDailyLoss: maxLoss.toString() });
      await setHedgeEmergencyStop(true);
      await sendHedgeAlert('hedge_daily_loss_limit_hit', {
        adverseUsd: adverse.toString(),
        limitUsd: maxLoss.toString(),
      });
    }
  }
}

export async function refreshHedgeExposureGauge(): Promise<void> {
  const r = await db.query<{ s: string | null }>(
    `SELECT COALESCE(SUM(notional_usd), 0)::text AS s
     FROM hedge_jobs WHERE status IN ('pending', 'processing') AND notional_usd IS NOT NULL`
  );
  const d = parseFloat(r.rows[0]?.s ?? '0');
  if (Number.isFinite(d)) hedgeExposureUsdGauge.set(d);
}

export async function refreshHedgePositionExposureSnapshot(): Promise<void> {
  await db.query(`
    WITH sums AS (
      SELECT market,
             COALESCE(SUM(notional_usd) FILTER (WHERE status IN ('pending','processing')), 0)::numeric AS exp_usd
      FROM hedge_jobs
      GROUP BY market
    )
    INSERT INTO hedge_positions (market, unrealized_pnl, realized_pnl, exposure_usd, updated_at)
    SELECT s.market, COALESCE(hp.unrealized_pnl, 0), COALESCE(hp.realized_pnl, 0), s.exp_usd, NOW()
    FROM sums s
    LEFT JOIN hedge_positions hp ON hp.market = s.market
    ON CONFLICT (market) DO UPDATE SET
      exposure_usd = EXCLUDED.exposure_usd,
      updated_at = NOW()
  `);
}

export type HedgeRiskGateResult = { ok: true } | { ok: false; code: string; message: string };

export async function assertHedgeEnqueueAllowed(params: {
  market: string;
  notionalUsd: string | null;
}): Promise<HedgeRiskGateResult> {
  const globalEnabled = await readHedgeSystemBool('hedge_global_enabled');
  if (!globalEnabled) {
    hedgeJobsSkippedTotal.inc({ reason: 'hedge_global_disabled' });
    logger.info('hedge_skipped', { reason: 'hedge_global_disabled', market: params.market });
    return { ok: false, code: 'HEDGE_GLOBAL_DISABLED', message: 'Hedge processing disabled in system settings' };
  }
  const emergency = await readHedgeSystemBool('hedge_emergency_stop');
  hedgeKillSwitchGauge.set(emergency ? 1 : 0);
  if (emergency) {
    hedgeJobsSkippedTotal.inc({ reason: 'emergency_stop' });
    logger.warn('hedge_skipped', { reason: 'hedge_emergency_stop', market: params.market });
    void sendHedgeAlert('hedge_skipped_kill_switch', { market: params.market, phase: 'enqueue' });
    return { ok: false, code: 'HEDGE_EMERGENCY_STOP', message: 'Hedge emergency stop active' };
  }

  const globalCfg = await externalLiquidityConfigService.getGlobalHybridConfig();
  if (globalCfg) {
    await evaluateDailyLossKill(globalCfg);
    const stillEmergency = await readHedgeSystemBool('hedge_emergency_stop');
    if (stillEmergency) {
      hedgeJobsSkippedTotal.inc({ reason: 'emergency_after_loss_check' });
      return { ok: false, code: 'HEDGE_EMERGENCY_STOP', message: 'Hedge halted (loss or manual)' };
    }
  }

  if (params.notionalUsd != null) {
    const n = new Decimal(params.notionalUsd);
    const cfg = (await externalLiquidityConfigService.getHybridConfig(params.market)) ?? globalCfg;
    const maxOrder = cfg ? new Decimal(cfg.max_hedge_notional_usd_per_order) : new Decimal(0);
    if (maxOrder.isFinite() && maxOrder.gt(0) && n.gt(maxOrder)) {
      hedgeJobsSkippedTotal.inc({ reason: 'order_size' });
      logger.warn('hedge_skipped_max_order', { market: params.market, notional: n.toString(), max: maxOrder.toString() });
      void sendHedgeAlert('order_size_limit_hit', { market: params.market, notionalUsd: n.toString(), maxUsd: maxOrder.toString() });
      return { ok: false, code: 'HEDGE_ORDER_SIZE_LIMIT', message: 'Hedge notional exceeds configured per-order cap' };
    }
    const maxNet = globalCfg ? new Decimal(globalCfg.max_net_hedge_exposure_usd) : new Decimal(0);
    if (maxNet.isFinite() && maxNet.gt(0)) {
      const open = await db.query<{ s: string | null }>(
        `SELECT COALESCE(SUM(notional_usd), 0)::text AS s
         FROM hedge_jobs WHERE status IN ('pending', 'processing') AND notional_usd IS NOT NULL`
      );
      const openDec = new Decimal(open.rows[0]?.s ?? '0');
      if (openDec.plus(n).gt(maxNet)) {
        hedgeJobsSkippedTotal.inc({ reason: 'net_exposure' });
        logger.warn('hedge_skipped_net_exposure', {
          market: params.market,
          open: openDec.toString(),
          add: n.toString(),
          maxNet: maxNet.toString(),
        });
        void sendHedgeAlert('hedge_exposure_limit_hit', {
          market: params.market,
          openUsd: openDec.toString(),
          addUsd: n.toString(),
          maxNetUsd: maxNet.toString(),
        });
        return { ok: false, code: 'HEDGE_NET_EXPOSURE_LIMIT', message: 'Net hedge exposure would exceed limit' };
      }
    }
  }

  return { ok: true };
}

export async function assertHedgeWorkerTickAllowed(): Promise<HedgeRiskGateResult> {
  const globalEnabled = await readHedgeSystemBool('hedge_global_enabled');
  if (!globalEnabled) return { ok: false, code: 'HEDGE_GLOBAL_DISABLED', message: 'Hedge global off' };
  const emergency = await readHedgeSystemBool('hedge_emergency_stop');
  if (emergency) return { ok: false, code: 'HEDGE_EMERGENCY_STOP', message: 'Emergency stop' };
  const globalCfg = await externalLiquidityConfigService.getGlobalHybridConfig();
  if (globalCfg) await evaluateDailyLossKill(globalCfg);
  if (await readHedgeSystemBool('hedge_emergency_stop')) {
    return { ok: false, code: 'HEDGE_EMERGENCY_STOP', message: 'Emergency after loss evaluation' };
  }
  return { ok: true };
}

export { HEDGE_PROVIDER_TRIP_FAILURES };
