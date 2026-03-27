#!/usr/bin/env npx tsx
/**
 * Security penetration test runner.
 * Usage: npm run test:security [-- --phase=1,2,3]
 */
import { runPhase1Auth } from './phase1-auth.test.js';
import { runPhase2Api } from './phase2-api.test.js';
import { runPhase3Wallet } from './phase3-wallet.test.js';
import { runPhase4Trade } from './phase4-trade.test.js';
import { runPhase9Dos } from './phase9-dos.test.js';

const phases: Array<{
  name: string;
  run: () => Promise<{ passed: number; failed: number; results: string[] }>;
}> = [
  { name: 'Phase 1 — Auth attacks', run: runPhase1Auth },
  { name: 'Phase 2 — API security', run: runPhase2Api },
  { name: 'Phase 3 — Wallet', run: runPhase3Wallet },
  { name: 'Phase 4 — Trading', run: runPhase4Trade },
  { name: 'Phase 9 — DoS / rate limit', run: runPhase9Dos },
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
  console.log('Security Penetration Test Runner');
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
