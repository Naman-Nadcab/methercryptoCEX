/**
 * Shared manual credit application (DB transaction) for admin routes and maker-checker execution.
 */
import { v4 as uuidv4 } from 'uuid';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import {
  ensureUserBalanceRow,
  assertUserBalanceUpdated,
  assertBalanceInvariant,
  CHAIN_ID_GLOBAL,
} from '../lib/user-balance-helper.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { logAudit } from './audit-log.service.js';

const ROUND_DOWN = 1;
const PREC = 8;

export interface ManualCreditApplyParams {
  userId: string;
  currencyId: string;
  symbol: string;
  amountDec: DecimalInstance;
  reasonTrimmed: string;
  executingAdminId: string;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function applyAdminManualCreditCore(p: ManualCreditApplyParams): Promise<void> {
  await db.transaction(async (client) => {
    await ensureUserBalanceRow(p.userId, p.currencyId, CHAIN_ID_GLOBAL, 'funding', client);
    const sel = await client.query<{ available_balance: string }>(
      `SELECT available_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND COALESCE(account_type::text, 'funding') = 'funding'
       FOR UPDATE`,
      [p.userId, p.currencyId, CHAIN_ID_GLOBAL]
    );
    if (sel.rows.length === 0) {
      throw new Error('ADMIN_CREDIT_BALANCE_ROW_NOT_FOUND');
    }
    const avBefore = new Decimal(sel.rows[0]!.available_balance);
    const upd = await client.query(
      `UPDATE user_balances SET available_balance = available_balance + $1::numeric, updated_at = NOW()
       WHERE user_id = $2 AND currency_id = $3 AND COALESCE(chain_id, '') = $4 AND COALESCE(account_type::text, 'funding') = 'funding'
       RETURNING *`,
      [p.amountDec.toString(), p.userId, p.currencyId, CHAIN_ID_GLOBAL]
    );
    assertUserBalanceUpdated('admin_manual_credit', upd, p.userId, p.currencyId, 'funding', CHAIN_ID_GLOBAL);
    assertBalanceInvariant(upd.rows[0]);
    const avAfter = new Decimal(upd.rows[0]!.available_balance ?? 0);
    const refId = uuidv4();
    await insertBalanceLedger({
      client,
      userId: p.userId,
      currencyId: p.currencyId,
      accountType: 'funding',
      debit: '0',
      credit: p.amountDec.toString(),
      balanceBefore: avBefore.toFixed(),
      balanceAfter: avAfter.toFixed(),
      referenceType: 'adjustment',
      referenceId: refId,
      balanceType: 'available',
    });
  });

  await logAudit({
    requestId: p.requestId ?? null,
    actorType: 'admin',
    actorId: p.executingAdminId,
    action: 'admin_manual_credit_executed',
    resourceType: 'user',
    resourceId: p.userId,
    newValue: { currency: p.symbol, amount: p.amountDec.toString(), reason: p.reasonTrimmed },
    ipAddress: p.ipAddress ?? null,
    userAgent: p.userAgent ?? null,
  });
}
