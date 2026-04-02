/**
 * Tier-1: evaluate Prometheus-style alert conditions on /metrics scrape and log ALERT_TRIGGERED
 * when thresholds are met (throttled). Does not replace Alertmanager — ensures the API process
 * never fails silently when conditions fire.
 */
import { logger } from '../lib/logger.js';
import { indexerStateLagSeconds, spotWsDisconnectsTotal } from '../lib/prometheus-metrics.js';
import { config } from '../config/index.js';

const THROTTLE_MS = 5 * 60 * 1000;
let lastIndexerLogAt = 0;
let lastWsSpikeLogAt = 0;

let prevWsDisconnectTotal = 0;
let prevWsDisconnectAt = 0;
/** Last computed disconnect rate (/s) between scrapes — for /health warnings */
let lastWsDisconnectRatePerSec = 0;

/** Align with apps/backend/prometheus/alerts/spot-tier1.rules.yml IndexerStateHeartbeatStale */
const INDEXER_LAG_ALERT_SEC = 300;

/** Align with SpotWsDisconnectSpike: rate(...[5m]) > 10 — we approximate using delta between scrapes */
const WS_DISCONNECT_RATE_ALERT_PER_SEC = 10;

export function getLastWsDisconnectRatePerSec(): number {
  return lastWsDisconnectRatePerSec;
}

export async function evaluateTier1AlertsOnMetricsScrape(): Promise<void> {
  if (!config.tier1.alertEvalOnMetricsScrape) return;

  const now = Date.now();
  try {
    const lagSnap = await indexerStateLagSeconds.get();
    const lagVal = lagSnap.values[0]?.value;
    if (typeof lagVal === 'number' && lagVal >= 0 && lagVal > INDEXER_LAG_ALERT_SEC) {
      if (now - lastIndexerLogAt >= THROTTLE_MS) {
        lastIndexerLogAt = now;
        logger.warn('ALERT_TRIGGERED', {
          condition: 'indexer_state_lag',
          indexer_lag_seconds: lagVal,
          threshold_seconds: INDEXER_LAG_ALERT_SEC,
          note: 'Matches Prometheus rule IndexerStateHeartbeatStale; verify indexer + Alertmanager',
        });
      }
    }

    const discSnap = await spotWsDisconnectsTotal.get();
    let total = 0;
    for (const v of discSnap.values) {
      total += v.value;
    }
    if (prevWsDisconnectAt > 0) {
      const elapsedSec = (now - prevWsDisconnectAt) / 1000;
      const delta = total - prevWsDisconnectTotal;
      if (elapsedSec > 0.5) {
        lastWsDisconnectRatePerSec = delta / elapsedSec;
        if (lastWsDisconnectRatePerSec >= WS_DISCONNECT_RATE_ALERT_PER_SEC) {
          if (now - lastWsSpikeLogAt >= THROTTLE_MS) {
            lastWsSpikeLogAt = now;
            logger.warn('ALERT_TRIGGERED', {
              condition: 'spot_ws_disconnect_spike',
              disconnects_per_sec_approx: Math.round(lastWsDisconnectRatePerSec * 1000) / 1000,
              threshold_per_sec: WS_DISCONNECT_RATE_ALERT_PER_SEC,
              note: 'Approximate from /metrics scrape interval; compare to rate(spot_ws_disconnects_total[5m])',
            });
          }
        }
      }
    }
    prevWsDisconnectTotal = total;
    prevWsDisconnectAt = now;
  } catch (e) {
    logger.debug('tier1_alert_eval_skipped', { error: e instanceof Error ? e.message : String(e) });
  }
}
