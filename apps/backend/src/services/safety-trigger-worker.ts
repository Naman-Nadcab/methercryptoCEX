/**
 * Safety Trigger Automation Worker
 *
 * Runs every 10 seconds: fetches enabled triggers, reads current metrics from Redis,
 * evaluates conditions (metric > threshold), and executes actions with a 60s cooldown.
 * Fails silently and never throws to avoid crashing exchange services.
 */

import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const WORKER_INTERVAL_MS = 10_000;
const COOLDOWN_SECONDS = 60;
const METRICS_PREFIX = 'safety_metrics:';
const COOLDOWN_PREFIX = 'safety_trigger_cooldown:';
const ACTOR_ID = 'safety_trigger_worker';

interface SafetyTriggerRow {
  id: string;
  trigger_type: string;
  metric: string | null;
  threshold_value: string;
  action: string;
  enabled: number;
}

/** Read current value for a metric from Redis. Returns 0 if missing or invalid. */
async function getMetricValue(metricKey: string): Promise<number> {
  try {
    const key = METRICS_PREFIX + metricKey;
    let raw = await redis.get(key);
    if (raw == null || raw === '') {
      const fromDb = await getMetricFromDb(metricKey);
      if (fromDb != null) {
        await redis.set(key, String(fromDb), 30);
        return fromDb;
      }
      return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Optional: derive metric from DB when not in Redis (e.g. order_queue_length, withdrawal_queue_size).
 * Returns null if unknown metric or query fails (worker continues with 0).
 */
async function getMetricFromDb(metricKey: string): Promise<number | null> {
  try {
    if (metricKey === 'order_queue_length') {
      const r = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM spot_orders WHERE status IN ('new', 'partially_filled')`);
      return parseInt(r.rows[0]?.n ?? '0', 10) || 0;
    }
    if (metricKey === 'withdrawal_queue_size') {
      const r = await db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM withdrawals
         WHERE status IN ('pending_approval','pending_email_verify','pending_2fa','processing','pending_blockchain')`
      );
      return parseInt(r.rows[0]?.n ?? '0', 10) || 0;
    }
    if (metricKey === 'rpc_failure_percentage') {
      const rpcVal = await redis.get('safety_metrics:rpc_failure_percentage');
      return rpcVal != null ? (Number(rpcVal) || 0) : 0;
    }
    if (metricKey === 'matching_engine_latency') {
      return 0;
    }
    return null;
  } catch {
    return null;
  }
}

/** Check if trigger is in cooldown. */
async function isInCooldown(triggerType: string): Promise<boolean> {
  try {
    const key = COOLDOWN_PREFIX + triggerType;
    const v = await redis.get(key);
    return v === '1' || v === 'true';
  } catch {
    return true; // fail closed: treat as in cooldown on error
  }
}

/** Set cooldown for trigger (60 seconds). */
async function setCooldown(triggerType: string): Promise<void> {
  try {
    const key = COOLDOWN_PREFIX + triggerType;
    await redis.set(key, '1', COOLDOWN_SECONDS);
  } catch (e) {
    logger.warn('Safety trigger worker: failed to set cooldown', {
      trigger_type: triggerType,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Ensure control_events table exists and insert a row. */
async function logControlEvent(event: string, service: string, severity: string): Promise<void> {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS control_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        event TEXT NOT NULL,
        service TEXT,
        severity TEXT DEFAULT 'info',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(
      'INSERT INTO control_events (event, service, severity) VALUES ($1, $2, $3)',
      [event, service, severity]
    );
  } catch (e) {
    logger.warn('Safety trigger worker: failed to log control_events', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function broadcastTimelineEvent(triggerType: string, action: string): Promise<void> {
  try {
    const { broadcastAdminControlEvent } = await import('./admin-events-ws.service.js');
    broadcastAdminControlEvent('timeline_event', {
      event: `Trigger executed: ${triggerType} - ${action}`,
      timestamp: new Date().toISOString(),
      triggered_by: ACTOR_ID,
      service: 'safety_trigger_worker',
      severity: 'warning',
    });
  } catch {
    // ignore
  }
}

/** Execute the configured action (internal; no HTTP). */
async function executeAction(action: string, triggerType: string): Promise<void> {
  try {
    if (action === 'pause_trading') {
      const { setTradingHalt } = await import('../lib/trading-halt.js');
      await setTradingHalt(true);
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_pause_trading', '1', NOW(), $1)
         ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1`,
        [ACTOR_ID]
      );
    } else if (action === 'disable_withdrawals') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by TEXT)
      `);
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ('emergency_disable_withdrawals', '1', NOW(), $1)
         ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW(), updated_by = $1`,
        [ACTOR_ID]
      );
    } else if (action === 'switch_rpc_provider') {
      await logControlEvent(
        `trigger_executed ${triggerType} ${action} (logged; RPC switch not implemented)`,
        'safety_trigger_worker',
        'warning'
      );
      await broadcastTimelineEvent(triggerType, action);
      return;
    } else if (action === 'send_admin_alert' || action === 'enable_risk_alerts') {
      await logControlEvent(`trigger_executed ${triggerType} ${action}`, 'safety_trigger_worker', 'warning');
      await broadcastTimelineEvent(triggerType, action);
      return;
    }

    await logControlEvent(`trigger_executed ${triggerType} ${action}`, 'safety_trigger_worker', 'warning');
    await broadcastTimelineEvent(triggerType, action);
  } catch (e) {
    logger.warn('Safety trigger worker: action execution failed', {
      action,
      trigger_type: triggerType,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** One evaluation cycle: fetch triggers, fetch metrics, evaluate, execute with cooldown. */
export async function runSafetyTriggerCycle(): Promise<void> {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS control_safety_triggers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        trigger_type TEXT NOT NULL UNIQUE,
        threshold_value NUMERIC NOT NULL DEFAULT 0,
        action TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      DO $$ BEGIN ALTER TABLE control_safety_triggers ADD COLUMN metric TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    `);

    const rows = await db.query<SafetyTriggerRow>(
      `SELECT id::text AS id, trigger_type, threshold_value::text AS threshold_value, action, enabled, metric
       FROM control_safety_triggers WHERE enabled = 1`
    );

    const triggers = rows.rows;
    if (triggers.length === 0) return;

    for (const t of triggers) {
      try {
        const metricKey = (t.metric && t.metric.trim()) || t.trigger_type;
        const currentValue = await getMetricValue(metricKey);
        const threshold = Number(t.threshold_value);
        if (!Number.isFinite(threshold) || currentValue <= threshold) continue;

        if (await isInCooldown(t.trigger_type)) continue;

        await setCooldown(t.trigger_type);
        await executeAction(t.action, t.trigger_type);
      } catch (e) {
        logger.warn('Safety trigger worker: trigger evaluation failed', {
          trigger_type: t.trigger_type,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    logger.warn('Safety trigger worker: cycle failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSafetyTriggerWorker(): void {
  if (intervalId != null) return;
  intervalId = setInterval(() => {
    runSafetyTriggerCycle().catch(() => {
      // Swallow: runSafetyTriggerCycle already logs and never throws critical errors
    });
  }, WORKER_INTERVAL_MS);
  logger.info('Safety trigger worker started (interval 10s, cooldown 60s)');
}

export function stopSafetyTriggerWorker(): void {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Safety trigger worker stopped');
  }
}
