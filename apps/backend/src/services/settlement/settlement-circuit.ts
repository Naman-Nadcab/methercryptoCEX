/**
 * Circuit breaker: on accounting violations, halt further settlements.
 * State persisted in Redis so restart does not lose circuit-open (fail-open risk).
 */
import { logger } from '../../lib/logger.js';
import { setSettlementCircuitOpen } from '../../lib/trading-halt.js';
import { recordOperationalEvent } from '../exchange-monitoring.service.js';

let tradingHalted = false;

export function isTradingHalted(): boolean {
  return tradingHalted;
}

export function setTradingHalted(halt: boolean): void {
  tradingHalted = halt;
}

const CIRCUIT_OPEN_ERRORS = [
  'GLOBAL_LEDGER_INVARIANT_VIOLATION',
  'GLOBAL_BALANCE_INVARIANT_VIOLATION',
  'SETTLEMENT_HASH_MISMATCH',
  'LEDGER_CHAIN_VIOLATION',
  'LEDGER_IMMUTABLE_VIOLATION',
  'ORDER_INVARIANT_VIOLATION',
  'FEE_INVARIANT_VIOLATION',
  'WALLET_RECONCILIATION_DRIFT',
  'LEDGER_COMPACTION_INVARIANT_VIOLATION',
];

export function triggerCircuitIfViolation(errMsg: string): void {
  if (CIRCUIT_OPEN_ERRORS.includes(errMsg)) {
    setTradingHalted(true);
    setSettlementCircuitOpen(true).catch((e) => {
      logger.error('Failed to persist circuit open to Redis', { error: e instanceof Error ? e.message : String(e) });
    });
    recordOperationalEvent({ type: 'circuit_open', violation: errMsg });
    logger.error('SETTLEMENT_CIRCUIT_BREAKER_OPEN', {
      message: 'Accounting violation triggered global trading halt. No further settlements until investigation.',
      violation: errMsg,
    });
  }
}
