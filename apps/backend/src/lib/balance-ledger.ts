/**
 * Mandatory balance_ledger inserts for all user_balances mutations.
 * Uses existing schema: user_id, currency_id, reference_type, reference_id,
 * debit, credit, balance_before, balance_after, balance_type, description, created_at.
 */

import type { PoolClient } from 'pg';
import type { Queryable } from './database.js';

export type LedgerReferenceType =
  | 'deposit'
  | 'withdrawal'
  | 'trade_buy'
  | 'trade_sell'
  | 'trade_fee'
  | 'p2p_escrow_lock'
  | 'p2p_escrow_release'
  | 'internal_transfer'
  | 'adjustment';

export interface InsertBalanceLedgerParams {
  client: Queryable | PoolClient;
  userId: string;
  currencyId: string;
  accountType: string;
  debit: string;
  credit: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  balanceType: 'available' | 'locked' | 'pending';
}

export async function insertBalanceLedger(params: InsertBalanceLedgerParams): Promise<void> {
  const {
    client,
    userId,
    currencyId,
    accountType,
    debit,
    credit,
    balanceBefore,
    balanceAfter,
    referenceType,
    referenceId,
    balanceType,
  } = params;
  const q = client as Queryable;
  await q.query(
    `INSERT INTO balance_ledger (user_id, currency_id, reference_type, reference_id, debit, credit, balance_before, balance_after, balance_type, description, created_at)
     VALUES ($1, $2, $3::ledger_reference_type, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::balance_type, $10, NOW())`,
    [userId, currencyId, referenceType, referenceId, debit, credit, balanceBefore, balanceAfter, balanceType, `account_type=${accountType}`]
  );
}
