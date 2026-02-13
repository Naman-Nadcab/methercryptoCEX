/**
 * Phase-9 Step-1: Snapshot & recovery anchors.
 * Read-only capture of engine_event_id, open orders, balances, ledger chain head.
 * Snapshots are append-only; never mutate ledger or balances.
 */
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';

const SNAPSHOT_VERSION = 1;

export interface SystemSnapshotRow {
  id: number;
  snapshot_type: string;
  engine_event_id: number;
  payload: SnapshotPayload;
  ledger_chain_head: string | null;
  created_at: Date;
}

export interface SnapshotPayload {
  snapshot_version: number;
  last_engine_event_id: number;
  open_orders: OpenOrderState[];
  balances: BalanceState[];
}

export interface OpenOrderState {
  id: string;
  user_id: string;
  pair_id: string;
  side: string;
  type: string;
  status: string;
  price: string | null;
  quantity: string;
  filled_quantity: string;
  remaining_quantity: string;
}

export interface BalanceState {
  user_id: string;
  asset: string;
  available: string;
  locked: string;
}

/**
 * Create a system snapshot. Reads state only; never mutates ledger or balances.
 * Payload ordering: orders by id, balances by (user_id, asset). Deterministic.
 */
export async function createSystemSnapshot(snapshot_type: string): Promise<SystemSnapshotRow | null> {
  const client = await db.getSettlementClient();
  try {
    const cursorRow = await client.query<{ last_engine_event_id: string }>(
      `SELECT last_engine_event_id::text AS last_engine_event_id FROM settlement_poller_cursor WHERE id = 1`
    );
    const last_engine_event_id = parseInt(cursorRow.rows[0]?.last_engine_event_id ?? '0', 10) || 0;

    const openOrdersRows = await client.query<{
      id: string;
      user_id: string;
      pair_id: string;
      side: string;
      type: string;
      status: string;
      price: string | null;
      quantity: string;
      filled_quantity: string;
      remaining_quantity: string;
    }>(
      `SELECT id::text, user_id::text, pair_id::text, side, type, status, price::text, quantity::text, filled_quantity::text, remaining_quantity::text
       FROM orders WHERE remaining_quantity > 0 ORDER BY id ASC`
    );
    const open_orders: OpenOrderState[] = openOrdersRows.rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      pair_id: r.pair_id,
      side: r.side,
      type: r.type,
      status: r.status,
      price: r.price,
      quantity: r.quantity,
      filled_quantity: r.filled_quantity,
      remaining_quantity: r.remaining_quantity,
    }));

    const balanceRows = await client.query<{ user_id: string; asset: string; available: string; locked: string }>(
      `SELECT ub.user_id, COALESCE(c.symbol, ub.currency_id::text) AS asset,
              ub.available_balance::text AS available, ub.locked_balance::text AS locked
       FROM user_balances ub
       LEFT JOIN currencies c ON c.id = ub.currency_id
       WHERE COALESCE(ub.chain_id, '') = '' AND ub.account_type = 'trading'
       ORDER BY ub.user_id, asset`
    );
    const balances: BalanceState[] = balanceRows.rows.map((r) => ({
      user_id: r.user_id,
      asset: r.asset ?? '',
      available: r.available ?? '0',
      locked: r.locked ?? '0',
    }));

    const chainHeadRow = await client.query<{ entry_hash: string | null }>(
      `SELECT entry_hash FROM settlement_ledger_entries ORDER BY id DESC LIMIT 1`
    );
    const ledger_chain_head = chainHeadRow.rows[0]?.entry_hash ?? null;

    const payload: SnapshotPayload = {
      snapshot_version: SNAPSHOT_VERSION,
      last_engine_event_id,
      open_orders,
      balances,
    };

    const cursorCheck = await client.query<{ last_engine_event_id: string }>(
      `SELECT last_engine_event_id::text AS last_engine_event_id FROM settlement_poller_cursor WHERE id = 1`
    );
    const currentCursor = parseInt(cursorCheck.rows[0]?.last_engine_event_id ?? '0', 10) || 0;
    if (last_engine_event_id !== currentCursor) {
      throw new Error('SNAPSHOT_CURSOR_MISMATCH');
    }

    const insertResult = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO system_snapshots (snapshot_type, engine_event_id, payload, ledger_chain_head)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING id, created_at`,
      [snapshot_type, last_engine_event_id, JSON.stringify(payload), ledger_chain_head]
    );
    const row = insertResult.rows[0];
    if (!row) return null;
    logger.debug('System snapshot created', {
      snapshot_type,
      engine_event_id: last_engine_event_id,
      snapshot_id: row.id,
    });
    return {
      id: parseInt(row.id, 10),
      snapshot_type,
      engine_event_id: last_engine_event_id,
      payload,
      ledger_chain_head,
      created_at: new Date(row.created_at),
    };
  } finally {
    client.release();
  }
}

/**
 * Initialize recovery state: return engine_event_id anchor from latest snapshot, or 0 if none.
 * Used by poller to resume after anchor; never replay pre-snapshot events.
 * Throws RECOVERY_INVARIANT_VIOLATION if poller cursor is ahead of snapshot (invalid state).
 */
export async function initializeRecoveryState(): Promise<number> {
  const client = await db.getSettlementClient();
  let cursor = 0;
  try {
    const cursorRow = await client.query<{ last_engine_event_id: string }>(
      `SELECT last_engine_event_id::text AS last_engine_event_id FROM settlement_poller_cursor WHERE id = 1`
    );
    cursor = parseInt(cursorRow.rows[0]?.last_engine_event_id ?? '0', 10) || 0;
  } finally {
    client.release();
  }
  const snapshot = await loadLatestSnapshot();
  if (snapshot && snapshot.engine_event_id > cursor) {
    throw new Error('RECOVERY_INVARIANT_VIOLATION');
  }
  return snapshot ? snapshot.engine_event_id : 0;
}

/**
 * Load latest snapshot by engine_event_id DESC. Provides anchor for recovery.
 */
export async function loadLatestSnapshot(): Promise<SystemSnapshotRow | null> {
  const client = await db.getSettlementClient();
  try {
    const r = await client.query<{
      id: string;
      snapshot_type: string;
      engine_event_id: string;
      payload: SnapshotPayload;
      ledger_chain_head: string | null;
      created_at: string;
    }>(
      `SELECT id, snapshot_type, engine_event_id, payload, ledger_chain_head, created_at
       FROM system_snapshots ORDER BY engine_event_id DESC LIMIT 1`
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0]!;
    return {
      id: parseInt(row.id, 10),
      snapshot_type: row.snapshot_type,
      engine_event_id: parseInt(row.engine_event_id, 10),
      payload: row.payload,
      ledger_chain_head: row.ledger_chain_head,
      created_at: new Date(row.created_at),
    };
  } finally {
    client.release();
  }
}
