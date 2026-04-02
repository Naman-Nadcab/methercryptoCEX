/**
 * E2E test runner. Runs all phases and exits with 0 if all passed, 1 otherwise.
 * Usage: npm run test:e2e [-- --phase=1,2,3]
 * Env: E2E_BASE_URL, E2E_ENGINE_URL, E2E_JWT, E2E_API_KEY, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *
 * `--phase=N` selects the Nth suite in order (1-based). There is no Phase 10 slot;
 * Phase 11 is N=10 (legacy). Phase 14 private WS = N=13, Phase 15 parity = N=14.
 */
import { runPhase1 } from './api/phase1-health.test.js';
import { runPhase2 } from './api/phase2-auth.test.js';
import { runPhase3 } from './api/phase3-spot.test.js';
import { runPhase4 } from './api/phase4-rust-engine.test.js';
import { runPhase5 } from './api/phase5-wallet.test.js';
import { runPhase6 } from './api/phase6-internal-transfer.test.js';
import { runPhase7 } from './api/phase7-p2p.test.js';
import { runPhase8 } from './api/phase8-liquidity-bot.test.js';
import { runPhase9 } from './api/phase9-websocket.test.js';
import { runPhase11 } from './api/phase11-security.test.js';
import { runPhase12 } from './api/phase12-failure.test.js';
import { runPhase13 } from './api/phase13-tier1-ops.test.js';
import { runPhase14 } from './api/phase14-private-ws.test.js';
import { runPhase15 } from './api/phase15-ws-rest-parity.test.js';

const phases: Array<{ name: string; run: () => Promise<{ passed: number; failed: number; results: string[] }> }> = [
  { name: 'Phase 1 — System health', run: runPhase1 },
  { name: 'Phase 2 — Authentication', run: runPhase2 },
  { name: 'Phase 3 — Spot trading', run: runPhase3 },
  { name: 'Phase 4 — Rust engine', run: runPhase4 },
  { name: 'Phase 5 — Wallet', run: runPhase5 },
  { name: 'Phase 6 — Internal transfer', run: runPhase6 },
  { name: 'Phase 7 — P2P', run: runPhase7 },
  { name: 'Phase 8 — Liquidity bot / oracle', run: runPhase8 },
  { name: 'Phase 9 — WebSocket', run: runPhase9 },
  { name: 'Phase 11 — Security', run: runPhase11 },
  { name: 'Phase 12 — Failure scenarios', run: runPhase12 },
  { name: 'Phase 13 — Tier-1 operations metrics', run: runPhase13 },
  {
    name: 'Phase 14 — Private WebSocket lifecycle',
    run: async () => {
      const r = await runPhase14();
      return { passed: r.passed, failed: r.failed, results: r.results };
    },
  },
  { name: 'Phase 15 — WS/REST parity', run: runPhase15 },
];

function getPhaseFilter(): number[] | null {
  const arg = process.argv.find((a) => a.startsWith('--phase='));
  if (!arg) return null;
  const list = arg.split('=')[1];
  if (!list) return null;
  return list.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
}

async function main() {
  const filter = getPhaseFilter();
  const toRun = filter?.length ? phases.filter((_, i) => filter.includes(i + 1)) : phases;
  console.log('E2E Test Runner');
  console.log('BASE_URL:', process.env.E2E_BASE_URL || 'http://localhost:4000');
  console.log('Phases:', toRun.map((p) => p.name).join(', '));
  console.log('---');

  let totalPassed = 0;
  let totalFailed = 0;
  for (const { name, run } of toRun) {
    try {
      const { passed, failed, results } = await run();
      totalPassed += passed;
      totalFailed += failed;
      console.log(`\n${name}`);
      results.forEach((r) => console.log('  ', r));
    } catch (e) {
      console.error(`\n${name} ERROR:`, e);
      totalFailed++;
    }
  }

  console.log('\n---');
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
