/**
 * Withdrawal signing queue: async, rate-limited, idempotent.
 * - Enqueue withdrawals for chains that have an active hot wallet.
 * - Processor signs and broadcasts one at a time; audits every step.
 * - No plaintext keys; signer obtained and zeroized in hot-wallet.service.
 * - Monetary amounts: Decimal.js only, ROUND_DOWN, no float.
 */

import { Decimal } from '../lib/decimal.js';
import { JsonRpcProvider } from 'ethers';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { logHotWalletAudit } from '../lib/hot-wallet-audit.js';
import { logWithdrawalLifecycle } from '../lib/withdrawal-audit.js';
import { getCurrencyIdForToken } from '../lib/currency-resolver.js';
import { ensureUserBalanceRow, assertUserBalanceUpdated, assertBalanceInvariant, CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { ROUND_DOWN, AMOUNT_PRECISION } from '../config/monetary-precision.js';
import { getSignerForChain, getHotWalletByChainId, checkHotWalletCaps, resolveHotWalletChainId } from './hot-wallet.service.js';

const ACTOR_SYSTEM = 'withdrawal-signing-processor';
const RATE_LIMIT_MS_PER_CHAIN = 2000;
const MAX_ATTEMPTS = 3;

export interface EnqueueResult {
  enqueued: boolean;
  reason?: string;
  /** Set when enqueued: false due to hot wallet caps */
  code?: string;
}

/** Only withdrawals with this status may be enqueued or signed. */
const ENQUEUEABLE_STATUS = 'pending';

/**
 * Idempotent enqueue: one queue row per withdrawal (idempotency_key = withdrawal_id).
 * HARD GUARD: Only withdrawals with status = 'pending' can be enqueued; otherwise throws.
 * Uses SELECT ... FOR UPDATE so status cannot change between check and insert.
 */
export async function enqueueWithdrawal(withdrawalId: string): Promise<EnqueueResult> {
  try {
    return await db.transaction(async (client) => {
      const row = await client.query<{ status: string; chain_id: string; net_amount: string }>(
        `SELECT status, chain_id, net_amount FROM withdrawals WHERE id = $1 FOR UPDATE`,
        [withdrawalId]
      );
      if (row.rows.length === 0) {
        return { enqueued: false, reason: 'Withdrawal not found' };
      }
      const { status, chain_id: chainId, net_amount: netAmount } = row.rows[0]!;
      if (status !== ENQUEUEABLE_STATUS) {
        throw new Error(
          `Only pending withdrawals can be enqueued; withdrawal ${withdrawalId} has status '${status}'`
        );
      }
      const hot = await getHotWalletByChainId(chainId);
      if (!hot) {
        return { enqueued: false, reason: 'No hot wallet for chain' };
      }
      const capCheck = await checkHotWalletCaps(chainId, netAmount);
      if (!capCheck.allowed) {
        return {
          enqueued: false,
          reason: capCheck.message ?? capCheck.code,
          code: capCheck.code,
        };
      }
      await client.query(
        `INSERT INTO withdrawal_signing_queue (withdrawal_id, chain_id, status, idempotency_key)
         VALUES ($1, $2, 'pending', $3)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [withdrawalId, chainId, withdrawalId]
      );
      const check = await client.query<{ n: number }>(
        `SELECT 1 AS n FROM withdrawal_signing_queue WHERE withdrawal_id = $1 AND status = 'pending'`,
        [withdrawalId]
      );
      return { enqueued: check.rows.length > 0 };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    logger.error('Enqueue withdrawal failed', { withdrawalId, error: msg });
    if (err instanceof Error && msg.includes('Only pending withdrawals can be enqueued')) {
      throw err;
    }
    return { enqueued: false, reason: msg };
  }
}

interface WithdrawalRow {
  id: string;
  status: string;
  user_id: string;
  token_id: string;
  chain_id: string;
  amount: string;
  fee: string;
  net_amount: string;
  to_address: string;
  account_type: string;
}

interface TokenRow {
  is_native: boolean;
  decimals: number;
}

interface ChainRow {
  rpc_url: string;
}

/**
 * Process one item from the queue: sign (if needed) and broadcast. Rate-limited by chain.
 * PHASE-15: Claim with FOR UPDATE SKIP LOCKED. CRITICAL: Broadcast is idempotent — we never set status
 * back to 'pending' after persisting signed_tx_hex; retries re-use the same signed tx (no double-send).
 */
export async function processSigningQueue(): Promise<void> {
  const claimed = await db.transaction(async (client) => {
    const sel = await client.query<{
      id: string;
      withdrawal_id: string;
      chain_id: string;
      attempts: number;
      status: string;
      signed_tx_hex: string | null;
    }>(
      `SELECT id, withdrawal_id, chain_id, attempts, status, signed_tx_hex
       FROM withdrawal_signing_queue
       WHERE (status = 'pending' OR (status = 'broadcast' AND signed_tx_hex IS NOT NULL))
         AND attempts < $1
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS]
    );
    if (sel.rows.length === 0) return null;
    const row = sel.rows[0]!;
    await client.query(
      `UPDATE withdrawal_signing_queue SET status = 'signing', attempts = attempts + 1 WHERE id = $1`,
      [row.id]
    );
    return row;
  });
  if (!claimed) return;

  const queueId = claimed.id;
  const withdrawalId = claimed.withdrawal_id;
  const isRetryBroadcast = claimed.status === 'broadcast' && claimed.signed_tx_hex != null;
  if (!isRetryBroadcast) {
    logger.info('[E2E_WITHDRAWAL] stage=signing_started', {
      withdrawal_id: withdrawalId,
      chain_id: claimed.chain_id,
      queue_id: queueId,
    });
  }

  const withdrawalResult = await db.query<WithdrawalRow>(
    `SELECT id, status, user_id, token_id, chain_id, amount, fee, net_amount, to_address, account_type
     FROM withdrawals WHERE id = $1`,
    [withdrawalId]
  );
  if (withdrawalResult.rows.length === 0) {
    await markQueueFailed(queueId, 'Withdrawal not found');
    return;
  }
  const w = withdrawalResult.rows[0]!;
  const chainId = w.chain_id ?? CHAIN_ID_GLOBAL;

  if (w.status !== ENQUEUEABLE_STATUS) {
    await markQueueFailed(queueId, `Withdrawal status is '${w.status}'; only pending withdrawals can be signed`);
    return;
  }

  const capCheck = await checkHotWalletCaps(chainId, w.net_amount);
  if (!capCheck.allowed) {
    await markQueueFailed(queueId, capCheck.message ?? capCheck.code);
    return;
  }

  const tokenResult = await db.query<TokenRow>(
    `SELECT is_native, decimals FROM tokens WHERE id = $1`,
    [w.token_id]
  );
  if (tokenResult.rows.length === 0) {
    await markQueueFailed(queueId, 'Token not found');
    return;
  }
  const token = tokenResult.rows[0]!;

  if (!token.is_native) {
    await markQueueFailed(queueId, 'Only native token withdrawals are supported by the hot wallet');
    return;
  }

  const chainResult = await db.query<ChainRow>(`SELECT rpc_url FROM chains WHERE id = $1`, [chainId]);
  if (chainResult.rows.length === 0) {
    await markQueueFailed(queueId, 'Chain not found');
    return;
  }
  const rpcUrl = chainResult.rows[0]!.rpc_url;

  await logHotWalletAudit({
    actorId: ACTOR_SYSTEM,
    actorType: 'system',
    action: 'withdrawal_signing_started',
    resourceType: 'withdrawal',
    resourceId: withdrawalId,
    details: { withdrawal_id: withdrawalId, chain_id: chainId },
  });

  let signer: Awaited<ReturnType<typeof getSignerForChain>>;
  try {
    signer = await getSignerForChain(chainId, ACTOR_SYSTEM, 'withdrawal');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    logger.error('Get signer failed', { withdrawalId, chainId, error: msg });
    await markQueueFailed(queueId, `Signer failed: ${msg}`);
    await logHotWalletAudit({
      actorId: ACTOR_SYSTEM,
      actorType: 'system',
      action: 'withdrawal_signing_failed',
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      details: { withdrawal_id: withdrawalId, error: msg },
    });
    return;
  }
  if (!signer) {
    await markQueueFailed(queueId, 'No hot wallet signer for chain');
    await logHotWalletAudit({
      actorId: ACTOR_SYSTEM,
      actorType: 'system',
      action: 'withdrawal_signing_failed',
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      details: { withdrawal_id: withdrawalId, error: 'No signer' },
    });
    return;
  }

  const valueWei = BigInt(
    new Decimal(w.net_amount).times(new Decimal(10).pow(token.decimals)).floor().toString()
  );
  if (valueWei <= 0n) {
    await markQueueFailed(queueId, 'Invalid net amount for wei');
    return;
  }

  let signedTx: string;
  if (isRetryBroadcast && claimed.signed_tx_hex) {
    signedTx = claimed.signed_tx_hex;
  } else {
    try {
      signedTx = await signer.signTransaction({
        to: w.to_address,
        value: valueWei,
        data: '0x',
        gasLimit: 21000n,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      await markQueueFailed(queueId, `Sign failed: ${msg}`);
      await logHotWalletAudit({
        actorId: ACTOR_SYSTEM,
        actorType: 'system',
        action: 'withdrawal_signing_failed',
        resourceType: 'withdrawal',
        resourceId: withdrawalId,
        details: { withdrawal_id: withdrawalId, error: msg },
      });
      return;
    }
    await db.query(
      `UPDATE withdrawal_signing_queue SET status = 'broadcast', signed_tx_hex = $1 WHERE id = $2`,
      [signedTx, queueId]
    );
  }

  const provider = new JsonRpcProvider(rpcUrl);
  let txHash: string;
  try {
    const tx = await provider.broadcastTransaction(signedTx);
    txHash = tx.hash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    const r = await db.query<{ attempts: number; max_attempts: number }>(
      `SELECT attempts, max_attempts FROM withdrawal_signing_queue WHERE id = $1`,
      [queueId]
    );
    const rrow = r.rows[0];
    const atLimit = rrow && rrow.attempts >= rrow.max_attempts;
    if (atLimit) {
      await markQueueFailed(queueId, `Broadcast failed after max retries: ${msg}`);
    } else {
      await db.query(
        `UPDATE withdrawal_signing_queue SET status = 'broadcast' WHERE id = $1`,
        [queueId]
      );
    }
    await logHotWalletAudit({
      actorId: ACTOR_SYSTEM,
      actorType: 'system',
      action: 'withdrawal_signing_failed',
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      details: { withdrawal_id: withdrawalId, error: msg },
    });
    return;
  }

  const totalRequired = new Decimal(w.amount).plus(w.fee).toString();
  const currencyId = await getCurrencyIdForToken(w.token_id);
  const rawAccountType = w.account_type || 'funding';
  const accountType = ['funding', 'spot', 'trading'].includes(rawAccountType) ? rawAccountType : 'funding';

  // Re-check withdrawal status inside tx: if user cancelled after we broadcast, do not debit balance (avoid double-spend).
  const completionApplied = await db.transaction(async (client) => {
    const statusRow = await client.query<{ status: string }>(
      `SELECT status FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );
    if (statusRow.rows.length === 0) {
      await client.query(
        `UPDATE withdrawal_signing_queue SET status = 'failed', error_message = 'Withdrawal not found' WHERE id = $1`,
        [queueId]
      );
      return false;
    }
    const currentStatus = statusRow.rows[0]!.status;
    if (currentStatus === 'cancelled') {
      await client.query(
        `UPDATE withdrawal_signing_queue
         SET status = 'cancelled', error_message = 'Withdrawal was cancelled by user after broadcast', processed_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [queueId]
      );
      logger.warn('Withdrawal was cancelled after broadcast; balance not debited', { withdrawalId, queueId });
      return false;
    }

    await client.query(
      `UPDATE withdrawal_signing_queue
       SET status = 'completed', tx_hash = $1, processed_at = CURRENT_TIMESTAMP, error_message = NULL
       WHERE id = $2`,
      [txHash, queueId]
    );
    await client.query(
      `UPDATE withdrawals
       SET status = 'completed', tx_hash = $1, completed_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [txHash, withdrawalId]
    );
    if (currencyId) {
      await ensureUserBalanceRow(w.user_id, currencyId, chainId, accountType, client);
      const sel = await client.query<{ locked_balance: string }>(
        `SELECT locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
        [w.user_id, currencyId, chainId, accountType]
      );
      if (sel.rows.length === 0) throw new Error('withdrawal_complete: balance row not found');
      const lockedBefore = new Decimal(sel.rows[0]!.locked_balance);
      const completeUpd = await client.query(
        `UPDATE user_balances
         SET locked_balance = locked_balance - $1, updated_at = NOW()
         WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5 AND locked_balance >= $1
         RETURNING *`,
        [totalRequired, w.user_id, currencyId, chainId, accountType]
      );
      assertUserBalanceUpdated('withdrawal_complete_deduct', completeUpd, w.user_id, currencyId, accountType, w.chain_id ?? undefined);
      assertBalanceInvariant(completeUpd.rows[0]);
      await insertBalanceLedger({
        client,
        userId: w.user_id,
        currencyId,
        accountType,
        debit: totalRequired,
        credit: '0',
        balanceBefore: lockedBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
        balanceAfter: lockedBefore.minus(totalRequired).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
        referenceType: 'withdrawal',
        referenceId: withdrawalId,
        balanceType: 'locked',
      });
    }
    return true;
  });

  if (!completionApplied) {
    return;
  }

  const resolvedChainId = await resolveHotWalletChainId(chainId);
  if (resolvedChainId) {
    await db.query(
      `UPDATE hot_wallets SET balance_cache = balance_cache - $1::numeric, updated_at = CURRENT_TIMESTAMP WHERE chain_id = $2 AND is_active = TRUE`,
      [valueWei.toString(), resolvedChainId]
    );
  }

  await logHotWalletAudit({
    actorId: ACTOR_SYSTEM,
    actorType: 'system',
    action: 'withdrawal_signing_completed',
    resourceType: 'withdrawal',
    resourceId: withdrawalId,
    details: { withdrawal_id: withdrawalId, tx_hash: txHash },
  });

  await logWithdrawalLifecycle('withdrawal_signed', {
    withdrawal_id: withdrawalId,
    user_id: w.user_id,
    admin_id: null,
    token_id: w.token_id,
    chain_id: w.chain_id,
    amount: totalRequired,
    ip: null,
    user_agent: null,
  });

  logger.info('Withdrawal signed and broadcast', { withdrawalId, chainId, txHash });
  // E2E withdrawal lifecycle: stage 4 — completed (tx_hash saved, locked balance deducted)
  logger.info('[E2E_WITHDRAWAL] stage=completed', {
    withdrawal_id: withdrawalId,
    status: 'completed',
    chain_id: w.chain_id,
    tx_hash: txHash,
  });
}

async function markQueueFailed(queueId: string, errorMessage: string): Promise<void> {
  const r = await db.query<{ attempts: number; max_attempts: number; withdrawal_id: string }>(
    `SELECT attempts, max_attempts, withdrawal_id FROM withdrawal_signing_queue WHERE id = $1`,
    [queueId]
  );
  const row = r.rows[0];
  if (!row) return;
  const isFinal = row.attempts >= row.max_attempts;
  await db.query(
    `UPDATE withdrawal_signing_queue
     SET status = $1, error_message = $2, processed_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END
     WHERE id = $4`,
    [isFinal ? 'failed' : 'pending', errorMessage, isFinal, queueId]
  );
  if (isFinal) {
    const totalResult = await db.query<{ amount: string; fee: string; user_id: string; token_id: string; account_type: string; chain_id: string }>(
      `SELECT amount, fee, user_id, token_id, account_type, chain_id FROM withdrawals WHERE id = $1`,
      [row.withdrawal_id]
    );
    const w = totalResult.rows[0];
    if (w) {
      const total = new Decimal(w.amount).plus(w.fee).toString();
      await db.query(
        `UPDATE withdrawals SET status = 'failed', failed_reason = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [errorMessage, row.withdrawal_id]
      );
      const currencyId = await getCurrencyIdForToken(w.token_id);
      const rawAccountType = w.account_type || 'funding';
      const accountType = ['funding', 'spot', 'trading'].includes(rawAccountType) ? rawAccountType : 'funding';
      const chainId = w.chain_id ?? CHAIN_ID_GLOBAL;
      if (currencyId) {
        await db.transaction(async (client) => {
          await ensureUserBalanceRow(w.user_id, currencyId, chainId, accountType, client);
          const sel = await client.query<{ available_balance: string; locked_balance: string }>(
            `SELECT available_balance::text, locked_balance::text FROM user_balances
             WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4 FOR UPDATE`,
            [w.user_id, currencyId, chainId, accountType]
          );
          if (sel.rows.length === 0) throw new Error('withdrawal_fail_refund: balance row not found');
          const avBefore = new Decimal(sel.rows[0]!.available_balance);
          const lockedBefore = new Decimal(sel.rows[0]!.locked_balance);
          const totalDec = new Decimal(total);
          if (lockedBefore.lt(totalDec)) {
            throw new Error(
              `withdrawal_fail_refund: locked_balance (${lockedBefore.toString()}) < refundAmount (${total}); invariant violation`
            );
          }
          const refundUpd = await client.query(
            `UPDATE user_balances
             SET available_balance = available_balance + $1, locked_balance = locked_balance - $1, updated_at = NOW()
             WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND account_type = $5
             RETURNING *`,
            [total, w.user_id, currencyId, chainId, accountType]
          );
          assertUserBalanceUpdated('withdrawal_fail_refund', refundUpd, w.user_id, currencyId, accountType, w.chain_id ?? undefined);
          assertBalanceInvariant(refundUpd.rows[0]);
          await insertBalanceLedger({
            client,
            userId: w.user_id,
            currencyId,
            accountType,
            debit: '0',
            credit: total,
            balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
            balanceAfter: avBefore.plus(total).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
            referenceType: 'withdrawal',
            referenceId: row.withdrawal_id,
            balanceType: 'available',
          });
          await insertBalanceLedger({
            client,
            userId: w.user_id,
            currencyId,
            accountType,
            debit: total,
            credit: '0',
            balanceBefore: lockedBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
            balanceAfter: lockedBefore.minus(total).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
            referenceType: 'withdrawal',
            referenceId: row.withdrawal_id,
            balanceType: 'locked',
          });
        });
      }
    }
  }
}
