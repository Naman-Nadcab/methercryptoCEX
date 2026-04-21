/**
 * Deposit recording + confirmation + credit flow for non-EVM chains (Bitcoin, Tron).
 *
 * The EVM `ChainIndexer.recordDeposit()` and `ConfirmationTracker.confirmDeposit()`
 * use ethers providers + EVM-specific tx receipts. BTC/Tron polling indexers call
 * these helpers instead — they own transaction verification themselves (the poll
 * response already proves the tx is on-chain with N confirmations).
 *
 * Guarantees:
 *  - `recordOrUpdateDeposit()` is idempotent: uses the same ON CONFLICT on
 *    (chain_id, tx_hash, to_address) the EVM pipeline uses. Confirmations get
 *    bumped on every tick; row is inserted once.
 *  - `creditConfirmedDeposit()` is transactional: `UPDATE deposits WHERE balance_applied_at IS NULL`
 *    is the mutex. Exactly one commit will ever credit user_balances + write ledger.
 */
import { query, getClient } from '../config/database';
import { logger } from '../utils/logger';
import { emailService } from './EmailService';

export interface NonEvmDepositInput {
  chainId: string;           // 'bitcoin' | 'tron'
  chainName: string;         // 'Bitcoin' | 'Tron'
  txHash: string;
  fromAddress: string | null;
  toAddress: string;         // case-sensitive for BTC (bech32) and Tron (base58)
  currencyId: string;        // UUID from `currencies` table
  symbol: string;            // 'BTC' | 'TRX' | 'USDT'
  /** Human-readable decimal string (e.g. "0.00120000" for BTC, "10.500000" for USDT). */
  amount: string;
  /** Current chain confirmations for this tx (0 if in mempool). */
  confirmations: number;
  /** Policy: how many confirmations before crediting balance. */
  requiredConfirmations: number;
  blockNumber: number;
  blockTimestampSec: number;
  explorerUrl?: string;
}

/**
 * Insert a fresh deposit if new, or bump confirmations on an existing pending row.
 * Returns the deposit row id + whether we just inserted or updated.
 * Rows already marked 'completed' (balance_applied_at set) are returned unchanged.
 */
export async function recordOrUpdateDeposit(
  input: NonEvmDepositInput
): Promise<{ id: string; status: 'pending' | 'completed' | 'failed'; confirmationsBefore: number; existed: boolean } | null> {
  const amountNum = Number(input.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return null;

  try {
    const existing = await query(
      `SELECT id, status, confirmations, balance_applied_at
         FROM deposits
        WHERE chain_id = $1 AND tx_hash = $2 AND to_address = $3
        LIMIT 1`,
      [input.chainId, input.txHash, input.toAddress]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      // Bump confirmations only if it grew (never go backwards).
      if (input.confirmations > (row.confirmations ?? 0) && row.status === 'pending') {
        await query(
          `UPDATE deposits SET confirmations = GREATEST(confirmations, $1), updated_at = NOW()
            WHERE id = $2`,
          [input.confirmations, row.id]
        );
      }
      return {
        id: row.id,
        status: row.status,
        confirmationsBefore: row.confirmations ?? 0,
        existed: true,
      };
    }

    // Look up user + wallet by exact-match address (case-sensitive for BTC/Tron).
    const walletRes = await query(
      `SELECT user_id, id AS wallet_id
         FROM wallets
        WHERE address = $1 AND chain_id = $2
        LIMIT 1`,
      [input.toAddress, input.chainId]
    );
    if (walletRes.rows.length === 0) {
      logger.debug(`non-evm deposit: no wallet match (${input.chainId} / ${input.toAddress})`);
      return null;
    }
    const { user_id: userId, wallet_id: walletId } = walletRes.rows[0];

    const inserted = await query(
      `INSERT INTO deposits (
         id, user_id, currency_id, chain_id, wallet_id, tx_hash,
         from_address, to_address, amount, fee, confirmations,
         required_confirmations, block_number, block_timestamp,
         status, created_at, updated_at
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11,
         to_timestamp($12), 'pending', NOW(), NOW()
       )
       ON CONFLICT (chain_id, tx_hash, to_address) DO NOTHING
       RETURNING id`,
      [
        userId,
        input.currencyId,
        input.chainId,
        walletId,
        input.txHash,
        input.fromAddress,
        input.toAddress,
        input.amount,
        input.confirmations,
        input.requiredConfirmations,
        input.blockNumber,
        input.blockTimestampSec,
      ]
    );

    if (inserted.rows.length === 0) {
      // Race with a parallel tick — row was inserted between our SELECT and INSERT.
      return null;
    }

    logger.info(`Recorded non-EVM deposit`, {
      chain: input.chainName,
      txHash: input.txHash,
      symbol: input.symbol,
      amount: input.amount,
      userId,
      confirmations: input.confirmations,
    });

    // Fire deposit-detected email (best-effort).
    emailService.sendDepositDetectedEmail(userId, {
      symbol: input.symbol,
      amount: input.amount,
      chainName: input.chainName,
      txHash: input.txHash,
      requiredConfirmations: input.requiredConfirmations,
      explorerUrl: input.explorerUrl,
    });

    return {
      id: inserted.rows[0].id,
      status: 'pending',
      confirmationsBefore: 0,
      existed: false,
    };
  } catch (error) {
    logger.error('recordOrUpdateDeposit failed', {
      txHash: input.txHash,
      chain: input.chainId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Transactionally credit a pending deposit once confirmations >= required.
 * The `UPDATE ... WHERE balance_applied_at IS NULL RETURNING id` is the mutex.
 * Mirrors `ConfirmationTracker.confirmDeposit` for EVM, minus the receipt check
 * (non-EVM poll response is already authoritative).
 */
export async function creditConfirmedDeposit(params: {
  depositId: string;
  userId: string;
  currencyId: string;
  amount: string;
  symbol: string;
  chainId: string;
  chainName: string;
  txHash: string;
  explorerUrl?: string;
}): Promise<boolean> {
  const client = await getClient();
  let committed = false;
  try {
    await client.query('BEGIN');

    const markDone = await client.query(
      `UPDATE deposits
          SET status = 'completed', credited_at = NOW(), balance_applied_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND balance_applied_at IS NULL
        RETURNING id`,
      [params.depositId]
    );
    if ((markDone.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return false; // already credited in a prior tick
    }

    const curCheck = await client.query(
      `SELECT 1 FROM currencies WHERE id = $1`,
      [params.currencyId]
    );
    if (curCheck.rows.length === 0) {
      // Very odd: currency disappeared between record + credit. Roll back credit-set
      // so next tick can retry once currencies is fixed.
      await client.query('ROLLBACK');
      logger.warn('creditConfirmedDeposit: currency_id not found, rolled back', params);
      return false;
    }

    const CHAIN_ID_GLOBAL = '';
    await client.query(
      `INSERT INTO user_balances (
         id, user_id, currency_id, chain_id,
         available_balance, locked_balance, pending_balance, total_deposited,
         account_type, updated_at
       ) VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 0, 0, 'funding', NOW())
       ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING`,
      [params.userId, params.currencyId, CHAIN_ID_GLOBAL]
    );

    const lockSel = await client.query(
      `SELECT available_balance::text AS av
         FROM user_balances
        WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
        FOR UPDATE`,
      [params.userId, params.currencyId, CHAIN_ID_GLOBAL]
    );
    if (lockSel.rows.length === 0) {
      throw new Error('creditConfirmedDeposit: balance row not found after ensure');
    }
    const avBefore = lockSel.rows[0].av ?? '0';

    const balUpd = await client.query(
      `UPDATE user_balances
          SET available_balance = available_balance + $1,
              pending_balance = GREATEST(COALESCE(pending_balance, 0) - $1, 0),
              total_deposited = COALESCE(total_deposited, 0) + $1,
              updated_at = NOW()
        WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = 'funding'
        RETURNING available_balance::text AS av`,
      [params.amount, params.userId, params.currencyId, CHAIN_ID_GLOBAL]
    );
    const avAfter = balUpd.rows[0]?.av ?? '0';
    if (Number(avAfter) < 0 || !Number.isFinite(Number(avAfter))) {
      throw new Error('creditConfirmedDeposit: balance invariant violated after credit');
    }

    await client.query(
      `INSERT INTO balance_ledger (
         user_id, currency_id, reference_type, reference_id,
         debit, credit, balance_before, balance_after,
         balance_type, description, created_at
       ) VALUES ($1, $2, 'deposit', $3, 0, $4, $5, $6, 'available', 'account_type=funding', NOW())`,
      [params.userId, params.currencyId, params.depositId, params.amount, avBefore, avAfter]
    );

    await client.query(
      `INSERT INTO user_activity_logs (
         id, user_id, activity_type, description, metadata,
         ip_address, user_agent, created_at
       ) VALUES (gen_random_uuid(), $1, 'deposit_confirmed', $2, $3, '0.0.0.0', 'indexer', NOW())`,
      [
        params.userId,
        `Deposit of ${params.amount} ${params.symbol} confirmed`,
        JSON.stringify({
          chain: params.chainId,
          txHash: params.txHash,
          amount: params.amount,
          symbol: params.symbol,
        }),
      ]
    );

    await client.query('COMMIT');
    committed = true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('creditConfirmedDeposit failed (will retry on next tick)', {
      depositId: params.depositId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    client.release();
  }

  if (committed) {
    logger.info('Non-EVM deposit credited', {
      chain: params.chainName,
      depositId: params.depositId,
      userId: params.userId,
      amount: params.amount,
      symbol: params.symbol,
    });
    try {
      emailService.sendDepositConfirmedEmail(params.userId, {
        symbol: params.symbol,
        amount: params.amount,
        chainName: params.chainName,
        txHash: params.txHash,
        explorerUrl: params.explorerUrl,
      });
    } catch (e) {
      logger.warn('sendDepositConfirmedEmail threw (non-fatal)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return committed;
}

/**
 * Sweep pending non-EVM deposits that were previously recorded but never credited
 * (e.g. indexer restart, transient DB error). Runs on every indexer tick with the
 * current on-chain confirmations. Returns how many got credited.
 */
export async function creditReadyDepositsForChain(
  chainId: string,
  chainName: string,
  explorerTxPrefix: string | undefined,
  fetchCurrentConfirmations: (txHash: string, toAddress: string) => Promise<number | null>
): Promise<number> {
  let credited = 0;
  try {
    const res = await query(
      `SELECT d.id, d.user_id, d.currency_id, d.tx_hash, d.to_address,
              d.amount::text AS amount, d.confirmations, d.required_confirmations,
              c.symbol
         FROM deposits d
         JOIN currencies c ON c.id = d.currency_id
        WHERE d.chain_id = $1
          AND d.status = 'pending'
          AND d.balance_applied_at IS NULL
        ORDER BY d.created_at ASC
        LIMIT 100`,
      [chainId]
    );

    for (const row of res.rows as Array<{
      id: string; user_id: string; currency_id: string; tx_hash: string; to_address: string;
      amount: string; confirmations: number; required_confirmations: number; symbol: string;
    }>) {
      const conf = await fetchCurrentConfirmations(row.tx_hash, row.to_address).catch(() => null);
      if (conf == null) continue;

      if (conf !== row.confirmations) {
        await query(
          `UPDATE deposits SET confirmations = $1, updated_at = NOW() WHERE id = $2`,
          [conf, row.id]
        );
      }

      if (conf >= row.required_confirmations) {
        const ok = await creditConfirmedDeposit({
          depositId: row.id,
          userId: row.user_id,
          currencyId: row.currency_id,
          amount: row.amount,
          symbol: row.symbol,
          chainId,
          chainName,
          txHash: row.tx_hash,
          explorerUrl: explorerTxPrefix ? `${explorerTxPrefix}${row.tx_hash}` : undefined,
        });
        if (ok) credited++;
      }
    }
  } catch (err) {
    logger.error('creditReadyDepositsForChain failed', {
      chainId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return credited;
}
