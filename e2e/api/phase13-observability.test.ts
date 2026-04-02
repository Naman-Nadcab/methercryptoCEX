/**
 * Phase 13b — Observability: /health depth, Prometheus scrape signals, optional degraded assertion.
 * Does not mutate production; read-only HTTP.
 *
 * Env:
 *   E2E_EXPECT_INDEXER_METRIC=true — require indexer_state_lag_seconds (or similar) line in /metrics
 *   E2E_EXPECT_WS_METRIC=true — require spot_ws_disconnects_total in /metrics
 *   E2E_ALLOW_DEGRADED_HEALTH=true — allow 503 on /health (still parse JSON)
 */
import { config } from '../config.js';

const BASE = config.baseUrl;
const TIMEOUT = config.timeoutMs;

function metricsHasLine(text: string, needle: string): boolean {
  return text.split('\n').some((line) => line.includes(needle));
}

export async function runPhase13Observability(): Promise<{ passed: number; failed: number; results: string[] }> {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(TIMEOUT) });
    const body = await res.json().catch(() => ({})) as {
      status?: string;
      services?: Record<string, string>;
      indexer_lag_sec?: number | null;
    };
    const allowDegraded = process.env.E2E_ALLOW_DEGRADED_HEALTH === 'true';
    const ok = res.ok || (allowDegraded && (body.services != null || body.status != null));
    if (!ok) {
      results.push(`FAIL: /health status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`);
      failed++;
    } else {
      results.push(
        `PASS: /health reachable status=${res.status} reported=${body.status ?? 'n/a'} indexer_lag_sec=${body.indexer_lag_sec ?? 'n/a'}`
      );
      passed++;
    }
  } catch (e) {
    results.push(`FAIL: /health ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  try {
    const res = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(TIMEOUT) });
    const text = await res.text();
    if (!res.ok) {
      results.push(`FAIL: /metrics status=${res.status}`);
      failed++;
    } else {
      results.push(`PASS: /metrics scrape body_len=${text.length}`);
      passed++;

      if (process.env.E2E_EXPECT_INDEXER_METRIC === 'true') {
        const has =
          metricsHasLine(text, 'indexer_state_lag_seconds') ||
          metricsHasLine(text, 'indexer_state');
        if (has) {
          results.push('PASS: indexer lag metric family present');
          passed++;
        } else {
          results.push('FAIL: expected indexer_state_lag_seconds (set E2E_EXPECT_INDEXER_METRIC=false to waive)');
          failed++;
        }
      }

      if (process.env.E2E_EXPECT_WS_METRIC === 'true') {
        if (metricsHasLine(text, 'spot_ws_disconnects_total')) {
          results.push('PASS: spot_ws_disconnects_total present');
          passed++;
        } else {
          results.push('FAIL: spot_ws_disconnects_total missing');
          failed++;
        }
      }

      /* Alert rule files are not evaluated here — document in chaos / runbook */
      if (process.env.E2E_ALERT_RULES_DOC_CHECK === 'true') {
        results.push(
          'INFO: Prometheus alert firing requires Alertmanager + live scrape; verify apps/backend/prometheus/alerts/*.yml in deploy'
        );
      }
    }
  } catch (e) {
    results.push(`FAIL: /metrics ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }

  return { passed, failed, results };
}
