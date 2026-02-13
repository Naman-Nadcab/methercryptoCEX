/**
 * PHASE-11: Dedicated P2P escrow accounting.
 * Funds move available → escrow_balance (not locked_balance). Release/refund debit escrow only.
 * Decimal.js only, ROUND_DOWN only. Idempotent release and refund via escrow status guard.
 */

import crypto from 'node:crypto';
import { Decimal } from '../lib/decimal.js';
import type { PoolClient } from 'pg';
import { db } from '../lib/database.js';
import { getCurrencyIdForToken } from '../lib/currency-resolver.js';
import {
  ensureUserBalanceRow,
  assertUserBalanceUpdated,
  assertBalanceInvariant,
  CHAIN_ID_GLOBAL,
} from '../lib/user-balance-helper.js';
import { assertValidDecimal, assertNonNegative } from '../lib/monetary-invariants.js';
import { ROUND_DOWN, AMOUNT_PRECISION } from '../config/monetary-precision.js';
import { recordEscrowEvent } from './exchange-monitoring.service.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
Decimal.set({ rounding: Decimal.ROUND_DOWN });

function toAmount(amount: string): string {
  return new Decimal(amount).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString();
}

export interface MoveToEscrowResult {
  escrowId: string;
}

export interface ReleaseOrRefundResult {
  alreadyReleased?: boolean;
  alreadyRefunded?: boolean;
}

/**
 * Move amount from seller's available_balance into escrow_balance. Creates escrow row status=locked.
 * Call inside transaction. Throws if insufficient available.
 */
export async function moveToEscrow(
  sellerId: string,
  tokenId: string,
  amount: string,
  p2pOrderId: string | null,
  client: PoolClient
): Promise<MoveToEscrowResult> {
  assertValidDecimal('moveToEscrow.amount', amount);
  assertNonNegative('moveToEscrow.amount', amount);
  const amountStr = toAmount(amount);
  const amountDec = new Decimal(amountStr);
  if (amountDec.lte(0)) {
    throw new Error('moveToEscrow: amount must be positive');
  }

  const currencyId = await getCurrencyIdForToken(tokenId);
  if (!currencyId) {
    throw new Error(`moveToEscrow: no currency_id for token ${tokenId}`);
  }

  const chainResult = await client.query<{ chain_id: string }>(
    'SELECT COALESCE(chain_id, \'\') AS chain_id FROM tokens WHERE id = $1',
    [tokenId]
  );
  const chainId = chainResult.rows[0]?.chain_id ?? CHAIN_ID_GLOBAL;

  await ensureUserBalanceRow(sellerId, currencyId, chainId, 'funding', client);

  const sel = await client.query<{ available_balance: string; escrow_balance: string | null }>(
    `SELECT available_balance::text AS available_balance, escrow_balance::text AS escrow_balance FROM user_balances
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
    [sellerId, currencyId, chainId]
  );
  if (sel.rows.length === 0) throw new Error('moveToEscrow: balance row not found');
  const avBefore = new Decimal(sel.rows[0]!.available_balance);
  const escBefore = new Decimal(sel.rows[0]!.escrow_balance ?? 0);

  const upd = await client.query(
    `UPDATE user_balances
     SET available_balance = available_balance - $4, escrow_balance = COALESCE(escrow_balance, 0) + $4, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND available_balance >= $4
     RETURNING *`,
    [sellerId, currencyId, chainId, amountStr]
  );

  if (upd.rowCount === 0 && chainId !== CHAIN_ID_GLOBAL) {
    await ensureUserBalanceRow(sellerId, currencyId, CHAIN_ID_GLOBAL, 'funding', client);
    const selGlobal = await client.query<{ available_balance: string; escrow_balance: string | null }>(
      `SELECT available_balance::text AS available_balance, escrow_balance::text AS escrow_balance FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
      [sellerId, currencyId, CHAIN_ID_GLOBAL]
    );
    if (selGlobal.rows.length === 0) throw new Error('moveToEscrow: balance row not found');
    const av = new Decimal(selGlobal.rows[0]!.available_balance);
    const esc = new Decimal(selGlobal.rows[0]!.escrow_balance ?? 0);
    const fallback = await client.query(
      `UPDATE user_balances
       SET available_balance = available_balance - $4, escrow_balance = COALESCE(escrow_balance, 0) + $4, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND available_balance >= $4
       RETURNING *`,
      [sellerId, currencyId, CHAIN_ID_GLOBAL, amountStr]
    );
    assertUserBalanceUpdated('moveToEscrow', fallback, sellerId, currencyId, 'funding', CHAIN_ID_GLOBAL);
    assertBalanceInvariant(fallback.rows[0]);
    const refId = p2pOrderId ?? crypto.randomUUID();
    await insertBalanceLedger({
      client,
      userId: sellerId,
      currencyId,
      accountType: 'funding',
      debit: amountStr,
      credit: '0',
      balanceBefore: av.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      balanceAfter: av.minus(amountDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      referenceType: 'p2p_escrow_lock',
      referenceId: refId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client,
      userId: sellerId,
      currencyId,
      accountType: 'funding',
      debit: '0',
      credit: amountStr,
      balanceBefore: esc.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      balanceAfter: esc.plus(amountDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      referenceType: 'p2p_escrow_lock',
      referenceId: refId,
      balanceType: 'pending',
    });
  } else {
    assertUserBalanceUpdated('moveToEscrow', upd, sellerId, currencyId, 'funding', chainId);
    assertBalanceInvariant(upd.rows[0]);
    const refId = p2pOrderId ?? crypto.randomUUID();
    await insertBalanceLedger({
      client,
      userId: sellerId,
      currencyId,
      accountType: 'funding',
      debit: amountStr,
      credit: '0',
      balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      balanceAfter: avBefore.minus(amountDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      referenceType: 'p2p_escrow_lock',
      referenceId: refId,
      balanceType: 'available',
    });
    await insertBalanceLedger({
      client,
      userId: sellerId,
      currencyId,
      accountType: 'funding',
      debit: '0',
      credit: amountStr,
      balanceBefore: escBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      balanceAfter: escBefore.plus(amountDec).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
      referenceType: 'p2p_escrow_lock',
      referenceId: refId,
      balanceType: 'pending',
    });
  }

  const escrowIns = await client.query<{ id: string }>(
    `INSERT INTO escrows (user_id, currency_id, token_id, amount, status, p2p_order_id)
     VALUES ($1, $2, $3, $4, 'locked', $5)
     RETURNING id`,
    [sellerId, currencyId, tokenId, amountStr, p2pOrderId]
  );
  const escrowId = escrowIns.rows[0]!.id;
  recordEscrowEvent({
    type: 'move_to_escrow',
    sellerId,
    escrowId,
    amount: amountStr,
  });
  return { escrowId };
}

/**
 * Release escrow to buyer: debit seller escrow_balance, credit buyer available.
 * Idempotent: if escrow status is already 'released', returns alreadyReleased and does no balance move.
 * PHASE-14: If admin_frozen_at IS NOT NULL, throws ESCROW_ADMIN_FROZEN; no mutation.
 */
export async function releaseFromEscrow(
  escrowId: string,
  buyerId: string,
  client: PoolClient
): Promise<ReleaseOrRefundResult> {
  const check = await client.query<{ status: string; admin_frozen_at: string | null }>(
    `SELECT status, admin_frozen_at FROM escrows WHERE id = $1`,
    [escrowId]
  );
  if (check.rows.length === 0) throw new Error('Escrow not found');
  if (check.rows[0]!.status !== 'locked') {
    recordEscrowEvent({ type: 'release_idempotent', escrowId });
    return { alreadyReleased: true };
  }
  if (check.rows[0]!.admin_frozen_at != null) throw new Error('ESCROW_ADMIN_FROZEN');

  const statusUpd = await client.query<{ id: string; user_id: string; currency_id: string; amount: string }>(
    `UPDATE escrows SET status = 'released', released_at = NOW() WHERE id = $1 AND status = 'locked' AND (admin_frozen_at IS NULL) RETURNING id, user_id, currency_id, amount::text AS amount`,
    [escrowId]
  );
  if (statusUpd.rowCount === 0) {
    const recheck = await client.query<{ admin_frozen_at: string | null }>(`SELECT admin_frozen_at FROM escrows WHERE id = $1`, [escrowId]);
    if (recheck.rows[0]?.admin_frozen_at != null) throw new Error('ESCROW_ADMIN_FROZEN');
    recordEscrowEvent({ type: 'release_idempotent', escrowId });
    return { alreadyReleased: true };
  }
  const row = statusUpd.rows[0]!;
  const sellerId = row.user_id;
  recordEscrowEvent({
    type: 'release',
    escrowId,
    sellerId,
    userId: buyerId,
    amount: row.amount,
  });
  const currencyId = row.currency_id;
  const amountStr = toAmount(row.amount);

  const chainId = CHAIN_ID_GLOBAL;
  await ensureUserBalanceRow(sellerId, currencyId, chainId, 'funding', client);
  await ensureUserBalanceRow(buyerId, currencyId, chainId, 'funding', client);

  const sellerSel = await client.query<{ escrow_balance: string | null }>(
    `SELECT escrow_balance::text AS escrow_balance FROM user_balances
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
    [sellerId, currencyId, chainId]
  );
  if (sellerSel.rows.length === 0) throw new Error('releaseFromEscrow: seller balance row not found');
  const sellerEscBefore = new Decimal(sellerSel.rows[0]!.escrow_balance ?? 0);

  const sellerUpd = await client.query(
    `UPDATE user_balances
     SET escrow_balance = COALESCE(escrow_balance, 0) - $4, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND COALESCE(escrow_balance, 0) >= $4
     RETURNING *`,
    [sellerId, currencyId, chainId, amountStr]
  );
  assertUserBalanceUpdated('releaseFromEscrow.seller', sellerUpd, sellerId, currencyId, 'funding', chainId);
  assertBalanceInvariant(sellerUpd.rows[0]);
  await insertBalanceLedger({
    client,
    userId: sellerId,
    currencyId,
    accountType: 'funding',
    debit: amountStr,
    credit: '0',
    balanceBefore: sellerEscBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    balanceAfter: sellerEscBefore.minus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    referenceType: 'p2p_escrow_release',
    referenceId: escrowId,
    balanceType: 'pending',
  });

  const buyerSel = await client.query<{ available_balance: string }>(
    `SELECT available_balance::text AS available_balance FROM user_balances
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
    [buyerId, currencyId, chainId]
  );
  if (buyerSel.rows.length === 0) throw new Error('releaseFromEscrow: buyer balance row not found');
  const buyerAvBefore = new Decimal(buyerSel.rows[0]!.available_balance);

  const buyerUpd = await client.query(
    `UPDATE user_balances
     SET available_balance = available_balance + $4, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
     RETURNING *`,
    [buyerId, currencyId, chainId, amountStr]
  );
  assertUserBalanceUpdated('releaseFromEscrow.buyer', buyerUpd, buyerId, currencyId, 'funding', chainId);
  assertBalanceInvariant(buyerUpd.rows[0]);
  await insertBalanceLedger({
    client,
    userId: buyerId,
    currencyId,
    accountType: 'funding',
    debit: '0',
    credit: amountStr,
    balanceBefore: buyerAvBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    balanceAfter: buyerAvBefore.plus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    referenceType: 'p2p_escrow_release',
    referenceId: escrowId,
    balanceType: 'available',
  });

  return {};
}

/**
 * Refund escrow to seller: debit seller escrow_balance, credit seller available.
 * Idempotent: if escrow status is already 'refunded', returns alreadyRefunded and does no balance move.
 * PHASE-14: If admin_frozen_at IS NOT NULL, throws ESCROW_ADMIN_FROZEN; no mutation.
 */
export async function refundFromEscrow(
  escrowId: string,
  client: PoolClient
): Promise<ReleaseOrRefundResult> {
  const check = await client.query<{ status: string; admin_frozen_at: string | null }>(
    `SELECT status, admin_frozen_at FROM escrows WHERE id = $1`,
    [escrowId]
  );
  if (check.rows.length === 0) throw new Error('Escrow not found');
  if (check.rows[0]!.status !== 'locked') {
    recordEscrowEvent({ type: 'refund_idempotent', escrowId });
    return { alreadyRefunded: true };
  }
  if (check.rows[0]!.admin_frozen_at != null) throw new Error('ESCROW_ADMIN_FROZEN');

  const statusUpd = await client.query<{ id: string; user_id: string; currency_id: string; amount: string }>(
    `UPDATE escrows SET status = 'refunded', refunded_at = NOW() WHERE id = $1 AND status = 'locked' AND (admin_frozen_at IS NULL) RETURNING id, user_id, currency_id, amount::text AS amount`,
    [escrowId]
  );
  if (statusUpd.rowCount === 0) {
    const recheck = await client.query<{ admin_frozen_at: string | null }>(`SELECT admin_frozen_at FROM escrows WHERE id = $1`, [escrowId]);
    if (recheck.rows[0]?.admin_frozen_at != null) throw new Error('ESCROW_ADMIN_FROZEN');
    recordEscrowEvent({ type: 'refund_idempotent', escrowId });
    return { alreadyRefunded: true };
  }
  const row = statusUpd.rows[0]!;
  const sellerId = row.user_id;
  recordEscrowEvent({
    type: 'refund',
    escrowId,
    sellerId,
    amount: row.amount,
  });
  const currencyId = row.currency_id;
  const amountStr = toAmount(row.amount);

  const chainId = CHAIN_ID_GLOBAL;
  await ensureUserBalanceRow(sellerId, currencyId, chainId, 'funding', client);

  const sellerSel = await client.query<{ escrow_balance: string | null; available_balance: string }>(
    `SELECT escrow_balance::text AS escrow_balance, available_balance::text AS available_balance FROM user_balances
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' FOR UPDATE`,
    [sellerId, currencyId, chainId]
  );
  if (sellerSel.rows.length === 0) throw new Error('refundFromEscrow: seller balance row not found');
  const escBefore = new Decimal(sellerSel.rows[0]!.escrow_balance ?? 0);
  const avBefore = new Decimal(sellerSel.rows[0]!.available_balance);

  const sellerDebit = await client.query(
    `UPDATE user_balances
     SET escrow_balance = COALESCE(escrow_balance, 0) - $4, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding' AND COALESCE(escrow_balance, 0) >= $4
     RETURNING *`,
    [sellerId, currencyId, chainId, amountStr]
  );
  assertUserBalanceUpdated('refundFromEscrow.sellerDebit', sellerDebit, sellerId, currencyId, 'funding', chainId);
  assertBalanceInvariant(sellerDebit.rows[0]);
  await insertBalanceLedger({
    client,
    userId: sellerId,
    currencyId,
    accountType: 'funding',
    debit: amountStr,
    credit: '0',
    balanceBefore: escBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    balanceAfter: escBefore.minus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    referenceType: 'p2p_escrow_release',
    referenceId: escrowId,
    balanceType: 'pending',
  });

  const sellerCredit = await client.query(
    `UPDATE user_balances
     SET available_balance = available_balance + $4, updated_at = NOW()
     WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'funding'
     RETURNING *`,
    [sellerId, currencyId, chainId, amountStr]
  );
  assertUserBalanceUpdated('refundFromEscrow.sellerCredit', sellerCredit, sellerId, currencyId, 'funding', chainId);
  assertBalanceInvariant(sellerCredit.rows[0]);
  await insertBalanceLedger({
    client,
    userId: sellerId,
    currencyId,
    accountType: 'funding',
    debit: '0',
    credit: amountStr,
    balanceBefore: avBefore.toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    balanceAfter: avBefore.plus(amountStr).toDecimalPlaces(AMOUNT_PRECISION, ROUND_DOWN).toString(),
    referenceType: 'p2p_escrow_release',
    referenceId: escrowId,
    balanceType: 'available',
  });

  return {};
}
