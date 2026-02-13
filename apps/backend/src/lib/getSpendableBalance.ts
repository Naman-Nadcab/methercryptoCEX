/**
 * Spendable balance = total balance - SUM(active balance_locks).
 * Single transaction, READ COMMITTED, SELECT FOR UPDATE.
 * Use for order/withdrawal/escrow checks. Decimal.js only, ROUND_DOWN only.
 */

import { Decimal } from './decimal.js';
import { db } from './database.js';
import { CHAIN_ID_GLOBAL } from './user-balance-helper.js';
import { ROUND_DOWN, AMOUNT_PRECISION as PRECISION } from '../config/monetary-precision.js';

export class InsufficientBalanceError extends Error {
  constructor(
    message: string,
    public readonly spendable: string,
    public readonly required: string
  ) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Get spendable balance for (userId, currencyId, accountType).
 * Runs in a single DB transaction with FOR UPDATE.
 * Optionally throws if spendable < requiredAmount.
 * All arithmetic Decimal.js, ROUND_DOWN only. No float.
 */
export async function getSpendableBalance(
  userId: string,
  currencyId: string,
  accountType: string,
  requiredAmount?: string
): Promise<{ spendable: string }> {
  return db.transaction(async (client) => {
    const row = await client.query<{ available_balance: string; locked_balance: string }>(
      `SELECT COALESCE(available_balance, 0)::text AS available_balance, COALESCE(locked_balance, 0)::text AS locked_balance
       FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND chain_id = $3 AND account_type::text = LOWER(TRIM($4))
       FOR UPDATE`,
      [userId, currencyId, CHAIN_ID_GLOBAL, accountType]
    );
    if (row.rows.length === 0) {
      if (requiredAmount != null && requiredAmount !== '') {
        const req = new Decimal(requiredAmount).toDecimalPlaces(PRECISION, ROUND_DOWN);
        if (req.gt(0)) {
          throw new InsufficientBalanceError('No balance row', '0', requiredAmount);
        }
      }
      return { spendable: '0' };
    }
    const r = row.rows[0]!;
    const available = new Decimal(r.available_balance || '0').toDecimalPlaces(PRECISION, ROUND_DOWN);
    const locked = new Decimal(r.locked_balance || '0').toDecimalPlaces(PRECISION, ROUND_DOWN);
    const total = available.plus(locked).toDecimalPlaces(PRECISION, ROUND_DOWN);

    const sumLock = await client.query<{ sum: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM balance_locks
       WHERE user_id = $1 AND currency_id = $2 AND account_type::text = LOWER(TRIM($3)) AND expires_at > NOW()`,
      [userId, currencyId, accountType]
    );
    const lockedSum = new Decimal(sumLock.rows[0]?.sum || '0').toDecimalPlaces(PRECISION, ROUND_DOWN);
    const spendable = total.minus(lockedSum).toDecimalPlaces(PRECISION, ROUND_DOWN);
    const spendableClamped = spendable.lt(0) ? new Decimal(0) : spendable;
    const spendableStr = spendableClamped.toDecimalPlaces(PRECISION, ROUND_DOWN).toString();

    if (requiredAmount != null && requiredAmount !== '') {
      const required = new Decimal(requiredAmount).toDecimalPlaces(PRECISION, ROUND_DOWN);
      if (required.gt(0) && spendableClamped.lt(required)) {
        throw new InsufficientBalanceError('Insufficient spendable balance', spendableStr, requiredAmount);
      }
    }
    return { spendable: spendableStr };
  });
}
