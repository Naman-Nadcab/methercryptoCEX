/**
 * Phase 15 — WS vs REST parity (public ticker, orderbook, trades).
 * Env: E2E_SPOT_SYMBOL (default BTC_USDT)
 */
import { runWsRestParitySuite } from '../utils/ws-rest-parity.js';

export async function runPhase15(): Promise<{ passed: number; failed: number; results: string[] }> {
  const symbol = (process.env.E2E_SPOT_SYMBOL || 'BTC_USDT').trim();
  try {
    const { summary, results: parityResults } = await runWsRestParitySuite(symbol);
    const passed = parityResults.filter((r) => r.pass).length;
    const failed = parityResults.filter((r) => !r.pass).length;
    return { passed, failed, results: summary };
  } catch (e) {
    return {
      passed: 0,
      failed: 1,
      results: [`FAIL: Phase 15 ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}
