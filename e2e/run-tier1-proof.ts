/**
 * Tier-1 proof orchestration: health, spot, engine, long WS soak, metrics, private WS, parity.
 * Optional: k6 (TIER1_K6=true), chaos (TIER1_CHAOS=true — destructive).
 *
 * Usage (repo root): npm run test:tier1
 * Env: E2E_JWT, E2E_COUNTERPARTY_JWT, E2E_COUNTERPARTY_API_KEY as for phase 3/14.
 *      TIER1_WS_SOAK_MS — default 300000 (5m) if E2E_WS_SOAK_MS unset.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPhase1 } from './api/phase1-health.test.js';
import { runPhase3 } from './api/phase3-spot.test.js';
import { runPhase4 } from './api/phase4-rust-engine.test.js';
import { runPhase9 } from './api/phase9-websocket.test.js';
import { runPhase13 } from './api/phase13-tier1-ops.test.js';
import { runPhase14, type Phase14Metrics } from './api/phase14-private-ws.test.js';
import { runPhase15 } from './api/phase15-ws-rest-parity.test.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

type Report = {
  tier_score: number;
  reliability_score: number;
  ws_consistency: 'pass' | 'fail' | 'skipped';
  stress_result: 'pass' | 'fail' | 'skipped';
  recovery_result: 'pass' | 'fail' | 'skipped';
  observability_result: 'pass' | 'fail' | 'skipped';
  /** Phase 14 private WS samples; null if phase skipped or did not collect. */
  latency_p95: number | null;
  latency_avg: number | null;
  latency_max: number | null;
  /** Proven via `npm run verify:tier1-alerts` (not executed in this orchestrator). */
  alert_status: 'pass' | 'fail' | 'skipped';
  data_integrity: 'pass' | 'fail';
  phases: { name: string; passed: number; failed: number }[];
};

async function run() {
  if (!process.env.E2E_WS_SOAK_MS) {
    process.env.E2E_WS_SOAK_MS = process.env.TIER1_WS_SOAK_MS || '300000';
  }
  /* Parity runs in phase 15; avoid double work in phase 9 soak */
  const savedParity = process.env.E2E_WS_PARITY;
  process.env.E2E_WS_PARITY = 'false';

  const phases: Array<{ name: string; run: () => Promise<{ passed: number; failed: number; results: string[] }> }> = [
    { name: 'Phase 1 — health', run: runPhase1 },
    { name: 'Phase 3 — spot REST', run: runPhase3 },
    { name: 'Phase 4 — Rust engine', run: runPhase4 },
    { name: 'Phase 9 — public WS soak', run: runPhase9 },
    { name: 'Phase 13 — metrics + observability', run: runPhase13 },
    { name: 'Phase 14 — private WS lifecycle', run: runPhase14 },
    { name: 'Phase 15 — WS/REST parity', run: runPhase15 },
  ];

  const phaseLog: { name: string; passed: number; failed: number }[] = [];
  let failedPhases = 0;
  let phase14Metrics: Phase14Metrics | null = null;

  console.log('=== Tier-1 proof suite ===');
  console.log('E2E_BASE_URL:', process.env.E2E_BASE_URL || 'http://localhost:4000');
  console.log('E2E_WS_SOAK_MS:', process.env.E2E_WS_SOAK_MS);
  console.log('');

  for (const { name, run: fn } of phases) {
    try {
      const out = await fn();
      const { passed, failed, results } = out;
      if (name.includes('Phase 14') && out && typeof out === 'object' && 'metrics' in out) {
        phase14Metrics = (out as { metrics: Phase14Metrics }).metrics;
      }
      phaseLog.push({ name, passed, failed });
      console.log(`\n${name}`);
      results.forEach((r) => console.log(' ', r));
      if (failed > 0) failedPhases++;
    } catch (e) {
      failedPhases++;
      phaseLog.push({ name, passed: 0, failed: 1 });
      console.error(`\n${name} ERROR:`, e);
    }
  }

  if (savedParity !== undefined) process.env.E2E_WS_PARITY = savedParity;
  else delete process.env.E2E_WS_PARITY;

  let stress: 'pass' | 'fail' | 'skipped' = 'skipped';
  if (process.env.TIER1_K6 === 'true') {
    const k6 = spawnSync('k6', ['run', path.join(REPO_ROOT, 'load/k6-spot-order.js')], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    stress = k6.status === 0 ? 'pass' : 'fail';
    console.log(`\n[k6] exit=${k6.status ?? 'unknown'} -> ${stress}`);
  }

  let recovery: 'pass' | 'fail' | 'skipped' = 'skipped';
  if (process.env.TIER1_CHAOS === 'true') {
    const chaos = spawnSync('bash', [path.join(REPO_ROOT, 'scripts/chaos-test.sh')], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    recovery = chaos.status === 0 ? 'pass' : 'fail';
    console.log(`\n[chaos] exit=${chaos.status ?? 'unknown'} -> ${recovery}`);
  }

  const p9 = phaseLog.find((p) => p.name.includes('Phase 9'));
  const p14 = phaseLog.find((p) => p.name.includes('Phase 14'));
  const p15 = phaseLog.find((p) => p.name.includes('Phase 15'));
  const p13 = phaseLog.find((p) => p.name.includes('Phase 13'));

  const wsConsistency =
    (p9?.failed ?? 0) === 0 && (p14?.failed ?? 0) === 0 && (p15?.failed ?? 0) === 0 ? 'pass' : 'fail';
  const observability = (p13?.failed ?? 0) === 0 ? 'pass' : 'fail';

  const criticalFail =
    failedPhases > 0 || stress === 'fail' || recovery === 'fail';
  const reliability_score = criticalFail
    ? Math.max(0, 10 - failedPhases * 2 - (stress === 'fail' ? 2 : 0) - (recovery === 'fail' ? 2 : 0))
    : 10;

  const data_integrity =
    wsConsistency === 'pass' && observability === 'pass' ? 'pass' : 'fail';

  const report: Report = {
    tier_score: reliability_score,
    reliability_score,
    ws_consistency: wsConsistency,
    stress_result: stress,
    recovery_result: recovery,
    observability_result: observability,
    latency_p95: phase14Metrics?.ws_latency_p95_ms ?? null,
    latency_avg: phase14Metrics?.ws_latency_avg_ms ?? null,
    latency_max: phase14Metrics?.ws_latency_max_ms ?? null,
    alert_status: 'skipped',
    data_integrity,
    phases: phaseLog,
  };

  console.log('\n=== Tier-1 proof summary (JSON) ===');
  console.log(JSON.stringify(report, null, 2));

  const exitCode = criticalFail ? 1 : 0;
  process.exit(exitCode);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
