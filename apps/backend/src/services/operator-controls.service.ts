/**
 * PHASE-14: Operator safety & recovery controls.
 * Read-only inspection and controlled recovery actions. No trading or accounting rule changes.
 */

import { randomUUID } from 'crypto';
import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { assertBalanceInvariant } from '../lib/user-balance-helper.js';
import { insertBalanceLedger } from '../lib/balance-ledger.js';
import { logAudit } from './audit-log.service.js';
import { getTradingHalted } from '../lib/trading-halt.js';
import { CHAIN_ID_GLOBAL } from '../lib/user-balance-helper.js';

export interface SettlementEventRow {
  id: number;
  engine_event_id: number;
  status: string;
  retry_count: number;
  last_error: string | null;
  processed_at: string | null;
  hash: string | null;
  created_at: string;
  payload?: unknown;
}

export interface LedgerDiscrepancyRow {
  user_id: string;
  asset: string;
  balance_available: string;
  balance_locked: string;
  balance_total: string;
  ledger_sum: string;
  diff: string;
}

export interface EscrowRow {
  id: string;
  user_id: string;
  currency_id: string;
  amount: string;
  status: string;
  admin_frozen_at: string | null;
  admin_frozen_reason: string | null;
  p2p_order_id: string | null;
  created_at: string;
  released_at: string | null;
  refunded_at: string | null;
}

/** List settlement events with optional filters. Read-only. */
export async function listSettlementEvents(params: {
  status?: string;
  limit?: number;
  offset?: number;
  since_id?: number;
}): Promise<{ rows: SettlementEventRow[]; total: number }> {
  const { status, limit = 50, offset = 0, since_id } = params;
  const conditions: string[] = ['1=1'];
  const args: (string | number)[] = [];
  let i = 1;
  if (status) {
    conditions.push(`status = $${i++}`);
    args.push(status);
  }
  if (since_id != null) {
    conditions.push(`id > $${i++}`);
    args.push(since_id);
  }
  const where = conditions.join(' AND ');
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM settlement_events WHERE ${where}`,
    args
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
  args.push(limit, offset);
  const limitParam = args.length - 1;
  const offsetParam = args.length;
  const result = await db.query<SettlementEventRow>(
    `SELECT id, engine_event_id, status, retry_count, last_error, processed_at, hash, created_at
     FROM settlement_events WHERE ${where}
     ORDER BY id DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
    args
  );
  return { rows: result.rows, total };
}

/** Get one settlement event with payload and ledger entries. Read-only. */
export async function getSettlementEventById(id: number): Promise<{
  event: SettlementEventRow & { payload: unknown };
  ledger_entries: { id: number; user_id: string; asset: string; delta: string; entry_hash: string | null }[];
} | null> {
  const eventResult = await db.query<(SettlementEventRow & { payload: unknown })>(
    `SELECT id, engine_event_id, status, retry_count, last_error, processed_at, hash, created_at, payload
     FROM settlement_events WHERE id = $1`,
    [id]
  );
  if (eventResult.rows.length === 0) return null;
  const ledgerResult = await db.query<{ id: number; user_id: string; asset: string; delta: string; entry_hash: string | null }>(
    `SELECT id, user_id, asset, delta::text AS delta, entry_hash
     FROM settlement_ledger_entries WHERE settlement_event_id = $1 ORDER BY id`,
    [id]
  );
  return {
    event: eventResult.rows[0]!,
    ledger_entries: ledgerResult.rows,
  };
}

/** Run ledger vs user_balances comparison. Read-only; does NOT trigger circuit. For operator inspection. */
export async function runLedgerDiscrepancyReport(): Promise<{ ok: boolean; mismatches: LedgerDiscrepancyRow[] }> {
  const client = await db.getSettlementClient();
  const mismatches: LedgerDiscrepancyRow[] = [];
  try {
    const ledgerRows = await client.query<{ user_id: string; asset: string; sum: string }>(
      `SELECT user_id, asset, COALESCE(SUM(delta), 0)::text AS sum
       FROM settlement_ledger_entries GROUP BY user_id, asset`
    );
    const assetToCurrency = new Map<string, string>();
    for (const row of ledgerRows.rows) {
      if (!assetToCurrency.has(row.asset)) {
        const curr = await client.query<{ id: string }>(
          `SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM($1)) LIMIT 1`,
          [row.asset]
        );
        assetToCurrency.set(row.asset, curr.rows[0]?.id ?? '');
      }
    }
    for (const row of ledgerRows.rows) {
      const currencyId = assetToCurrency.get(row.asset);
      if (!currencyId) continue;
      const ledgerSum = new Decimal(row.sum ?? '0');
      const balResult = await client.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = '' AND account_type = 'trading'`,
        [row.user_id, currencyId]
      );
      const available = new Decimal(balResult.rows[0]?.available_balance ?? '0');
      const locked = new Decimal(balResult.rows[0]?.locked_balance ?? '0');
      const balanceTotal = available.plus(locked);
      if (!ledgerSum.eq(balanceTotal)) {
        mismatches.push({
          user_id: row.user_id,
          asset: row.asset,
          balance_available: available.toString(),
          balance_locked: locked.toString(),
          balance_total: balanceTotal.toString(),
          ledger_sum: ledgerSum.toString(),
          diff: balanceTotal.minus(ledgerSum).toString(),
        });
      }
    }
  } finally {
    client.release();
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** List escrows with filters. Read-only. */
export async function listEscrows(params: {
  user_id?: string;
  status?: string;
  order_id?: string;
  frozen?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rows: EscrowRow[]; total: number }> {
  const { user_id, status, order_id, frozen, limit = 50, offset = 0 } = params;
  const conditions: string[] = ['1=1'];
  const args: (string | number | boolean)[] = [];
  let i = 1;
  if (user_id) {
    conditions.push(`e.user_id = $${i++}`);
    args.push(user_id);
  }
  if (status) {
    conditions.push(`e.status = $${i++}`);
    args.push(status);
  }
  if (order_id) {
    conditions.push(`(e.p2p_order_id = $${i++} OR e.id IN (SELECT escrow_id FROM p2p_orders WHERE id = $${i++}::uuid))`);
    args.push(order_id, order_id);
  }
  if (frozen === true) {
    conditions.push('e.admin_frozen_at IS NOT NULL');
  } else if (frozen === false) {
    conditions.push('e.admin_frozen_at IS NULL');
  }
  const where = conditions.join(' AND ');
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM escrows e WHERE ${where}`,
    args
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
  args.push(limit, offset);
  const limitParam = args.length - 1;
  const offsetParam = args.length;
  const result = await db.query<EscrowRow>(
    `SELECT e.id, e.user_id, e.currency_id, e.amount::text AS amount, e.status,
            e.admin_frozen_at, e.admin_frozen_reason, e.p2p_order_id, e.created_at, e.released_at, e.refunded_at
     FROM escrows e WHERE ${where} ORDER BY e.created_at DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
    args
  );
  return { rows: result.rows, total };
}

/** Get one escrow by id. Read-only. */
export async function getEscrowById(id: string): Promise<EscrowRow & { order?: unknown; ad_id?: string } | null> {
  const r = await db.query<EscrowRow & { order_id?: string; ad_id?: string }>(
    `SELECT e.id, e.user_id, e.currency_id, e.amount::text AS amount, e.status,
            e.admin_frozen_at, e.admin_frozen_reason, e.p2p_order_id, e.created_at, e.released_at, e.refunded_at,
            o.id AS order_id, o.ad_id
     FROM escrows e
     LEFT JOIN p2p_orders o ON o.escrow_id = e.id
     WHERE e.id = $1`,
    [id]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0]!;
  return {
    ...row,
    p2p_order_id: row.p2p_order_id ?? null,
    order: row.order_id ? { id: row.order_id, ad_id: row.ad_id } : undefined,
    ad_id: row.ad_id,
  } as EscrowRow & { order?: unknown; ad_id?: string };
}

/** Freeze escrow: set admin_frozen_at and reason. Blocks release/refund until unfreeze. */
export async function freezeEscrow(
  escrowId: string,
  reason: string | null,
  adminId: string,
  ipAddress?: string | null
): Promise<{ ok: boolean; message: string }> {
  const upd = await db.query<{ id: string; status: string }>(
    `UPDATE escrows SET admin_frozen_at = NOW(), admin_frozen_reason = $2
     WHERE id = $1 AND status = 'locked' RETURNING id, status`,
    [escrowId, reason ?? null]
  );
  if (upd.rows.length === 0) {
    const exists = await db.query('SELECT id, status FROM escrows WHERE id = $1', [escrowId]);
    if (exists.rows.length === 0) return { ok: false, message: 'Escrow not found' };
    return { ok: false, message: 'Escrow is not locked (already released or refunded)' };
  }
  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'operator_escrow_freeze',
    resourceType: 'escrow',
    resourceId: escrowId,
    newValue: { reason: reason ?? null },
    ipAddress: ipAddress ?? null,
  });
  return { ok: true, message: 'Escrow frozen' };
}

/** Unfreeze escrow: clear admin_frozen_at and reason. */
export async function unfreezeEscrow(
  escrowId: string,
  adminId: string,
  ipAddress?: string | null
): Promise<{ ok: boolean; message: string }> {
  const upd = await db.query(
    `UPDATE escrows SET admin_frozen_at = NULL, admin_frozen_reason = NULL WHERE id = $1 RETURNING id`,
    [escrowId]
  );
  if (upd.rows.length === 0) return { ok: false, message: 'Escrow not found' };
  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'operator_escrow_unfreeze',
    resourceType: 'escrow',
    resourceId: escrowId,
    ipAddress: ipAddress ?? null,
  });
  return { ok: true, message: 'Escrow unfrozen' };
}

/**
 * Ledger-authoritative balance reconciliation.
 * Sets user_balances (trading) so available_balance + locked_balance = ledger_sum. Requires reason and audit.
 */
export async function reconcileBalanceToLedger(params: {
  user_id: string;
  asset: string;
  reason: string;
  adminId: string;
  ipAddress?: string | null;
  target_available?: string;
  target_locked?: string;
}): Promise<{ ok: boolean; message: string; ledger_sum?: string }> {
  const { user_id, asset, reason, adminId, ipAddress, target_available, target_locked } = params;
  const halted = await getTradingHalted();
  if (!halted) {
    return { ok: false, message: 'Reconcile requires trading to be halted. Set trading_halted=true first.' };
  }

  return await db.transaction(async (client) => {
    const sumResult = await client.query<{ sum: string }>(
      `SELECT COALESCE(SUM(delta), 0)::text AS sum FROM settlement_ledger_entries WHERE user_id = $1 AND asset = $2`,
      [user_id, asset]
    );
    const ledgerSum = sumResult.rows[0]?.sum ?? '0';
    const ledgerDec = new Decimal(ledgerSum);
    if (ledgerDec.lt(0)) {
      return { ok: false, message: 'Ledger sum is negative; cannot reconcile', ledger_sum: ledgerSum };
    }

    const currRow = await client.query<{ id: string }>(
      `SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM($1)) LIMIT 1`,
      [asset]
    );
    const currencyId = currRow.rows[0]?.id;
    if (!currencyId) {
      return { ok: false, message: 'Asset not found in currencies', ledger_sum: ledgerSum };
    }

    const lockSel = await client.query<{ available_balance: string; locked_balance: string }>(
      `SELECT available_balance::text, locked_balance::text FROM user_balances
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = 'trading'
       FOR UPDATE`,
      [user_id, currencyId, CHAIN_ID_GLOBAL]
    );
    if (lockSel.rows.length === 0) {
      return { ok: false, message: 'No user_balances row for this user_id and asset', ledger_sum: ledgerSum };
    }
    const oldAvailable = lockSel.rows[0]!.available_balance;
    const oldLocked = lockSel.rows[0]!.locked_balance;

    let newAvailable: string;
    let newLocked: string;
    if (target_available != null && target_locked != null) {
      const a = new Decimal(target_available);
      const l = new Decimal(target_locked);
      if (!a.plus(l).eq(ledgerDec)) {
        return { ok: false, message: 'target_available + target_locked must equal ledger_sum', ledger_sum: ledgerSum };
      }
      if (a.lt(0) || l.lt(0)) {
        return { ok: false, message: 'target_available and target_locked must be non-negative', ledger_sum: ledgerSum };
      }
      newAvailable = a.toFixed();
      newLocked = l.toFixed();
    } else {
      newAvailable = ledgerDec.toFixed();
      newLocked = '0';
    }
    if (new Decimal(newAvailable).lt(0) || new Decimal(newLocked).lt(0)) {
      return { ok: false, message: 'Reconcile would set negative balance', ledger_sum: ledgerSum };
    }

    const updResult = await client.query(
      `UPDATE user_balances SET available_balance = $3, locked_balance = $4, updated_at = NOW()
       WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $5 AND account_type = 'trading'
       RETURNING *`,
      [user_id, currencyId, newAvailable, newLocked, CHAIN_ID_GLOBAL]
    );
    if (updResult.rows[0]) assertBalanceInvariant(updResult.rows[0]);

    const refId = randomUUID();
    const avDelta = new Decimal(newAvailable).minus(oldAvailable);
    const lockDelta = new Decimal(newLocked).minus(oldLocked);
    if (!avDelta.isZero()) {
      await insertBalanceLedger({
        client,
        userId: user_id,
        currencyId,
        accountType: 'trading',
        debit: avDelta.lt(0) ? avDelta.abs().toFixed() : '0',
        credit: avDelta.gte(0) ? avDelta.toFixed() : '0',
        balanceBefore: oldAvailable,
        balanceAfter: newAvailable,
        referenceType: 'adjustment',
        referenceId: refId,
        balanceType: 'available',
      });
    }
    if (!lockDelta.isZero()) {
      await insertBalanceLedger({
        client,
        userId: user_id,
        currencyId,
        accountType: 'trading',
        debit: lockDelta.lt(0) ? lockDelta.abs().toFixed() : '0',
        credit: lockDelta.gte(0) ? lockDelta.toFixed() : '0',
        balanceBefore: oldLocked,
        balanceAfter: newLocked,
        referenceType: 'adjustment',
        referenceId: refId,
        balanceType: 'locked',
      });
    }

    await logAudit({
      actorType: 'admin',
      actorId: adminId,
      action: 'operator_balance_reconcile',
      resourceType: 'balance',
      resourceId: `${user_id}:${asset}`,
      oldValue: { available: oldAvailable, locked: oldLocked },
      newValue: { available: newAvailable, locked: newLocked, reason },
      ipAddress: ipAddress ?? null,
    });
    return { ok: true, message: 'Balance reconciled to ledger', ledger_sum: ledgerSum };
  });
}
