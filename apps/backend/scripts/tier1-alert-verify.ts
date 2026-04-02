/**
 * Simulates Tier-1 alert inputs by setting Prometheus counters/gauges and invoking the same
 * evaluation path used on /metrics scrape. Proves ALERT_TRIGGERED logs fire (throttle-aware).
 *
 * Run from repo: npm run test:tier1-alerts --workspace=@exchange/backend
 * Requires: TIER1_ALERT_EVAL_ON_METRICS not false.
 */
import { logger } from '../src/lib/logger.js';
import { indexerStateLagSeconds, spotWsDisconnectsTotal } from '../src/lib/prometheus-metrics.js';
import { evaluateTier1AlertsOnMetricsScrape } from '../src/services/tier1-alert-evaluation.service.js';
import { config } from '../src/config/index.js';

type AlertMeta = Record<string, unknown> | undefined;

async function main(): Promise<void> {
  if (!config.tier1.alertEvalOnMetricsScrape) {
    console.error('FAIL: TIER1_ALERT_EVAL_ON_METRICS is disabled; enable to verify alert logging.');
    process.exit(1);
  }

  const fired: { condition?: string }[] = [];
  const origWarn = logger.warn.bind(logger);
  (logger as { warn: typeof logger.warn }).warn = (msg: string, meta?: AlertMeta) => {
    if (msg === 'ALERT_TRIGGERED' && meta && typeof meta === 'object' && 'condition' in meta) {
      fired.push({ condition: String((meta as { condition?: unknown }).condition) });
    }
    return origWarn(msg, meta as never);
  };

  try {
    const lagSnap = await indexerStateLagSeconds.get();
    const snap = lagSnap.values[0]?.value;
    const prevLag = typeof snap === 'number' ? snap : -1;
    indexerStateLagSeconds.set(301);
    await evaluateTier1AlertsOnMetricsScrape();
    indexerStateLagSeconds.set(prevLag);

    const hasIndexer = fired.some((x) => x.condition === 'indexer_state_lag');
    if (!hasIndexer) {
      console.error('FAIL: expected ALERT_TRIGGERED condition indexer_state_lag');
      process.exit(1);
    }
    console.log('PASS: indexer_state_lag -> ALERT_TRIGGERED');

    await evaluateTier1AlertsOnMetricsScrape();
    spotWsDisconnectsTotal.inc(100);
    const t0 = Date.now();
    while (Date.now() - t0 < 650) {
      /* need >0.5s between scrapes for rate estimate */
    }
    await evaluateTier1AlertsOnMetricsScrape();

    const hasWs = fired.some((x) => x.condition === 'spot_ws_disconnect_spike');
    if (!hasWs) {
      console.error('FAIL: expected ALERT_TRIGGERED condition spot_ws_disconnect_spike');
      process.exit(1);
    }
    console.log('PASS: spot_ws_disconnect_spike -> ALERT_TRIGGERED');

    console.log(
      JSON.stringify({
        alert_status: 'pass',
        fired_conditions: [...new Set(fired.map((f) => f.condition).filter(Boolean))],
      })
    );
  } finally {
    (logger as { warn: typeof logger.warn }).warn = origWarn;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
