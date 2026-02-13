/**
 * Phase-9 Step-3: Wallet & balance reconciliation layer.
 * Read-only relative to balances & ledger. Only INSERT snapshots + logs.
 * No balance or ledger mutations. Detection logic only.
 * Operates per wallet domain; internal = wallet_inflows - wallet_outflows (including sweeps/transfers).
 * Withdrawal accounting uses blockchain debit only (no business-level amount/net_amount).
 */
import { Decimal, type DecimalInstance } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { toNumeric } from './decimal-utils.js';
import { triggerCircuitIfViolation } from './settlement-circuit.js';
import { recordSettlementEvent } from '../exchange-monitoring.service.js';

export type WalletBalanceProvider = (asset: string, wallet_type: string) => Promise<DecimalInstance>;

/** Provider for actual on-chain debit total (withdrawals/sweeps out). Prevents drift misinterpretation. */
export type WalletOutflowDebitProvider = (asset: string, wallet_type: string) => Promise<DecimalInstance>;

const DEFAULT_TOLERANCE = new Decimal('0');

/**
 * Default mock provider for onchain balance (e.g. for tests or when no wallet provider is wired).
 */
export async function defaultOnchainBalanceProvider(_asset: string, _wallet_type: string): Promise<DecimalInstance> {
  return new Decimal('0');
}

/**
 * Default: no business-level withdrawal amounts used. Caller must supply getWalletOutflowDebit for accurate outflows.
 */
export async function defaultWalletOutflowDebitProvider(_asset: string, _wallet_type: string): Promise<DecimalInstance> {
  return new Decimal('0');
}

export interface WalletReconciliationOptions {
  asset: string;
  wallet_type: string;
  /** When 'hot', pass chainIdForSweeps to scope inflows to deposit_sweeps (to hot address) for that chain. */
  chainIdForSweeps?: string;
  getOnchainBalance?: WalletBalanceProvider;
  /** Actual on-chain sent/debit total for this wallet domain. Do NOT use business amount/net_amount. */
  getWalletOutflowDebit?: WalletOutflowDebitProvider;
  tolerance?: DecimalInstance | string;
}

/**
 * Run wallet reconciliation for one (asset, wallet_type) — per wallet domain, not global.
 * Internal ledger balance = wallet_inflows - wallet_outflows (deposits/sweeps in, blockchain debits out).
 * Withdrawal accounting MUST use getWalletOutflowDebit (actual on-chain sent); never business amount/net_amount.
 * Inserts snapshot. If |balance_delta| > tolerance: logs CRITICAL and triggers circuit breaker.
 */
export async function runWalletReconciliation(options: WalletReconciliationOptions): Promise<{
  ok: boolean;
  driftExceeded: boolean;
  snapshotId: number | null;
}> {
  const {
    asset,
    wallet_type,
    chainIdForSweeps,
    getOnchainBalance = defaultOnchainBalanceProvider,
    getWalletOutflowDebit = defaultWalletOutflowDebitProvider,
    tolerance = DEFAULT_TOLERANCE,
  } = options;
  const tol = typeof tolerance === 'string' ? new Decimal(tolerance) : tolerance;

  const client = await db.getSettlementClient();
  try {
    const onchain = await getOnchainBalance(asset, wallet_type);

    let wallet_inflows: DecimalInstance;
    if (wallet_type === 'hot' && chainIdForSweeps) {
      const sweepRow = await client.query<{ sum: string }>(
        `SELECT COALESCE(SUM(ds.amount), 0)::text AS sum
         FROM deposit_sweeps ds
         WHERE ds.chain_id = $1 AND ds.status = 'completed'
           AND ds.to_address IN (SELECT hw.address FROM hot_wallets hw WHERE hw.chain_id = $1 AND hw.is_active = TRUE)`,
        [chainIdForSweeps]
      );
      wallet_inflows = new Decimal(sweepRow.rows[0]?.sum ?? '0');
    } else {
      const depositRow = await client.query<{ sum: string }>(
        `SELECT COALESCE(SUM(d.amount), 0)::text AS sum FROM deposits d
         INNER JOIN currencies c ON c.id = d.currency_id
         WHERE UPPER(TRIM(c.symbol)) = UPPER(TRIM($1)) AND d.status IN ('completed', 'credited')`,
        [asset]
      );
      wallet_inflows = new Decimal(depositRow.rows[0]?.sum ?? '0');
    }

    const wallet_outflows = await getWalletOutflowDebit(asset, wallet_type);
    const internalLedgerBalance = wallet_inflows.minus(wallet_outflows);
    const balanceDelta = onchain.minus(internalLedgerBalance);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO wallet_state_snapshots (asset, wallet_type, onchain_balance, internal_ledger_balance, balance_delta)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        asset,
        wallet_type,
        toNumeric(onchain),
        toNumeric(internalLedgerBalance),
        toNumeric(balanceDelta),
      ]
    );
    const snapshotId = insertResult.rows[0] ? parseInt(insertResult.rows[0].id, 10) : null;

    const absDelta = balanceDelta.abs();
    const driftExceeded = absDelta.gt(tol);
    if (driftExceeded) {
      triggerCircuitIfViolation('WALLET_RECONCILIATION_DRIFT');
      recordSettlementEvent({
        type: 'balance_ledger_divergence',
        asset,
        balancesTotal: toNumeric(onchain),
        ledgerSum: toNumeric(internalLedgerBalance),
        error: `wallet_type=${wallet_type} delta=${toNumeric(balanceDelta)}`,
      });
      logger.error('WALLET_RECONCILIATION_DRIFT', {
        message: 'Wallet reconciliation drift exceeds tolerance. Do NOT auto-repair.',
        level: 'CRITICAL',
        asset,
        wallet_type,
        onchain_balance: toNumeric(onchain),
        internal_ledger_balance: toNumeric(internalLedgerBalance),
        balance_delta: toNumeric(balanceDelta),
        tolerance: toNumeric(tol),
      });
    }

    return { ok: !driftExceeded, driftExceeded, snapshotId };
  } finally {
    client.release();
  }
}
