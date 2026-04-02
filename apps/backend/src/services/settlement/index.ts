/**
 * Phase-8 Step-5: Settlement pipeline exports.
 */
export { startMatchPoller, stopMatchPoller } from './match-poller.js';
export {
  startSettlementWorker,
  stopSettlementWorker,
  runSettlementWorkerOnce,
} from './settlement-worker.js';
export { startWalletReconciliationScheduler, stopWalletReconciliationScheduler } from './wallet-reconciliation-scheduler.js';
export { fetchMatches } from './engine-client.js';
export type { EngineMatchEvent, EngineMatchesResponse } from './engine-client.js';
export { tradeValue, takerFee, makerFee, toNumeric, TAKER_FEE_RATE, MAKER_FEE_RATE } from './decimal-utils.js';
export { runGlobalBalanceAudit } from './global-balance-auditor.js';
export { replaySettlementIntegrityCheck } from './settlement-replay-validator.js';
export {
  createSystemSnapshot,
  loadLatestSnapshot,
  initializeRecoveryState,
  type SystemSnapshotRow,
  type SnapshotPayload,
  type OpenOrderState,
  type BalanceState,
} from './snapshot-service.js';
export {
  runWalletReconciliation,
  defaultOnchainBalanceProvider,
  defaultWalletOutflowDebitProvider,
  type WalletBalanceProvider,
  type WalletOutflowDebitProvider,
  type WalletReconciliationOptions,
} from './wallet-reconciliation.service.js';
export { runLedgerCompaction } from './ledger-compaction.service.js';
