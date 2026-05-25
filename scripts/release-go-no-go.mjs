#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const reportDir = path.join(root, 'docs', 'reports');
const reportPath = path.join(reportDir, 'release-go-no-go.latest.json');
const startedAt = new Date().toISOString();
const strictProfile = process.env.RELEASE_STRICT_PROFILE === '1';

const steps = [
  {
    id: 'tier1_phase1',
    command: './node_modules/.bin/tsx',
    args: ['apps/backend/scripts/tier1-phase1-verify.ts'],
  },
  {
    id: 'tier1_phase2',
    command: './node_modules/.bin/tsx',
    args: ['apps/backend/scripts/tier1-phase2-verify.ts'],
  },
  {
    id: 'tier1_phase3',
    command: './node_modules/.bin/tsx',
    args: ['apps/backend/scripts/tier1-phase3-verify.ts'],
  },
  {
    id: 'load_gate',
    command: 'node',
    args: ['scripts/load-gate.mjs'],
    env: {
      LOAD_GATE_DURATION_SEC: process.env.LOAD_GATE_DURATION_SEC || '45',
      LOAD_GATE_CONCURRENCY: process.env.LOAD_GATE_CONCURRENCY || '8',
      LOAD_GATE_P95_MS: process.env.LOAD_GATE_P95_MS || '500',
      LOAD_GATE_ERROR_PCT: process.env.LOAD_GATE_ERROR_PCT || '1',
      LOAD_GATE_429_PCT: process.env.LOAD_GATE_429_PCT || '3',
      LOAD_GATE_TIMEOUT_MS: process.env.LOAD_GATE_TIMEOUT_MS || '4000',
    },
  },
  {
    id: 'incident_drill',
    command: 'bash',
    args: ['scripts/incident-drill.sh'],
  },
  {
    id: 'monitoring_slo',
    command: 'node',
    args: ['scripts/monitoring-slo-check.mjs'],
    env: {
      MONITORING_REQUIRE_ALERT_ROUTE: strictProfile ? '1' : process.env.MONITORING_REQUIRE_ALERT_ROUTE || '0',
    },
  },
  {
    id: 'compliance_signoff',
    command: 'node',
    args: ['scripts/compliance-signoff.mjs'],
    env: { COMPLIANCE_STRICT: strictProfile ? '1' : process.env.COMPLIANCE_STRICT || '0' },
  },
];

const results = [];
let hardFail = false;

function runStep(step) {
  const env = { ...process.env, ...(step.env || {}) };
  const started = Date.now();
  const run = spawnSync(step.command, step.args, {
    cwd: root,
    env,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const elapsedMs = Date.now() - started;
  const out = `${run.stdout || ''}\n${run.stderr || ''}`.trim();
  return {
    ok: run.status === 0,
    exit_code: run.status,
    elapsed_ms: elapsedMs,
    output_tail: out.slice(-4000),
  };
}

for (const step of steps) {
  const maxAttempts = Number(process.env.RELEASE_GATE_RETRY || 2);
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = runStep(step);
    last = { ...r, attempt };
    if (r.ok) {
      results.push({ id: step.id, ...r, attempts: attempt });
      console.log(`[PASS] ${step.id} (${r.elapsed_ms}ms, attempt ${attempt}/${maxAttempts})`);
      break;
    }
    console.log(`[FAIL] ${step.id} (${r.elapsed_ms}ms, attempt ${attempt}/${maxAttempts})`);
    if (attempt < maxAttempts) {
      const sleepMs = 1500 * attempt;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
    }
  }
  const latest = results[results.length - 1];
  if (!latest || latest.id !== step.id || !latest.ok) {
    results.push({
      id: step.id,
      ok: false,
      exit_code: last?.exit_code ?? 1,
      elapsed_ms: last?.elapsed_ms ?? 0,
      output_tail: last?.output_tail ?? '',
      attempts: maxAttempts,
    });
    hardFail = true;
    break;
  }
}

const rollbackTriggers = [
  'Any release gate step fails',
  'p95 latency exceeds configured budget',
  'error rate exceeds configured budget',
  'settlement circuit opens (exchange_settlement_circuit_open=1)',
  'incident drill fails dependency recovery',
];

const report = {
  generated_at: new Date().toISOString(),
  started_at: startedAt,
  strict_profile: strictProfile,
  pass: !hardFail,
  results,
  rollback_triggers: rollbackTriggers,
  next_action: hardFail ? 'BLOCK_RELEASE' : 'GO_RELEASE',
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Report written: ${reportPath}`);

if (hardFail) {
  console.error('RELEASE_GO_NO_GO_FAIL');
  process.exit(1);
}
console.log('RELEASE_GO_NO_GO_OK');
