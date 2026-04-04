/**
 * Clears BOTH Redis settlement_circuit:open AND trading_halt:global after DB invariants are verified.
 * Long-lived API processes also clear stale in-process halt on the next worker tick (settlement-worker).
 * Prefer POST /admin/settlement/circuit-reset in production so audit + local halt reset stay aligned.
 * Run: cd apps/backend && npx tsx scripts/clear-settlement-circuit.ts
 */
import 'dotenv/config';
import { redis } from '../src/lib/redis.js';
import { setSettlementCircuitOpen, setTradingHalt } from '../src/lib/trading-halt.js';

async function main(): Promise<void> {
  await setSettlementCircuitOpen(false);
  console.log('settlement_circuit:open cleared (DEL)');
  await setTradingHalt(false);
  console.log('trading_halt:global cleared (DEL)');
  await redis.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
