/**
 * Hedge risk alerts — structured logs + optional ALERT_WEBHOOK_URL POST.
 */

import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';

export type HedgeAlertType =
  | 'hedge_exposure_limit_hit'
  | 'hedge_daily_loss_limit_hit'
  | 'hedge_emergency_activated'
  | 'hedge_failure_streak_provider_disabled'
  | 'hedge_skipped_kill_switch'
  | 'order_size_limit_hit';

export async function sendHedgeAlert(
  type: HedgeAlertType,
  payload: Record<string, string | number | boolean | undefined>
): Promise<void> {
  logger.warn('[HEDGE_ALERT]', { type, ...payload });
  const url = config.monitoring.alertWebhookUrl;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'exchange-hedge-risk',
        severity: type.includes('failure') || type.includes('emergency') ? 'critical' : 'warning',
        type,
        ts: new Date().toISOString(),
        payload,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* webhook is best-effort */
  }
}
