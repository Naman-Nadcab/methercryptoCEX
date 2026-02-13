/**
 * Phase-9 Step-4: Ledger compaction & archival.
 * Checkpoint balances up to cutoff, copy rows to archive, then delete only archived rows.
 * Uses user_balances (trading) as single source of truth.
 */
import { Decimal } from '../../lib/decimal.js';
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { triggerCircuitIfViolation } from './settlement-circuit.js';
import { CHAIN_ID_GLOBAL } from '../../lib/user-balance-helper.js';

const SETTLEMENT_ACCOUNT_TYPE = 'trading';

/**
 * Run ledger compaction at cutoff_ledger_id.
 * 1) Compute balances from ledger authority up to cutoff; validate against user_balances.
 * 2) Insert checkpoints (user_id, asset, checkpoint_ledger_id, available, locked, chain_head).
 * 3) Copy rows with id <= cutoff to archive (preserve entry_hash & prev_hash).
 * 4) Delete from main ledger only those rows now in archive.
 */
export async function runLedgerCompaction(cutoff_ledger_id: number): Promise<{
  ok: boolean;
  checkpointsInserted: number;
  rowsArchived: number;
}> {
  const client = await db.getSettlementClient();
  try {
    await client.query('BEGIN');

    const ledgerSums = await client.query<{ user_id: string; asset: string; sum: string }>(
      `SELECT user_id, asset, COALESCE(SUM(delta), 0)::text AS sum
       FROM settlement_ledger_entries WHERE id <= $1
       GROUP BY user_id, asset`,
      [cutoff_ledger_id]
    );

    const chainHeadRow = await client.query<{ entry_hash: string | null }>(
      `SELECT entry_hash FROM settlement_ledger_entries WHERE id = $1`,
      [cutoff_ledger_id]
    );
    const chain_head = chainHeadRow.rows[0]?.entry_hash ?? '';
    if (!chain_head) {
      await client.query('ROLLBACK');
      throw new Error('LEDGER_COMPACTION_INVARIANT_VIOLATION');
    }

    const assetToCurrency = new Map<string, string>();
    for (const row of ledgerSums.rows) {
      if (!assetToCurrency.has(row.asset)) {
        const curr = await client.query<{ id: string }>(
          `SELECT id FROM currencies WHERE UPPER(TRIM(symbol)) = UPPER(TRIM($1)) LIMIT 1`,
          [row.asset]
        );
        assetToCurrency.set(row.asset, curr.rows[0]?.id ?? '');
      }
    }

    for (const row of ledgerSums.rows) {
      const currencyId = assetToCurrency.get(row.asset);
      if (!currencyId) {
        await client.query('ROLLBACK');
        triggerCircuitIfViolation('LEDGER_COMPACTION_INVARIANT_VIOLATION');
        throw new Error('LEDGER_COMPACTION_INVARIANT_VIOLATION');
      }
      const sumDelta = new Decimal(row.sum ?? '0');
      const balRow = await client.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4`,
        [row.user_id, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
      );
      if (balRow.rows.length === 0) {
        await client.query('ROLLBACK');
        triggerCircuitIfViolation('LEDGER_COMPACTION_INVARIANT_VIOLATION');
        throw new Error('LEDGER_COMPACTION_INVARIANT_VIOLATION');
      }
      const available = new Decimal(balRow.rows[0]!.available_balance ?? '0');
      const locked = new Decimal(balRow.rows[0]!.locked_balance ?? '0');
      const balanceTotal = available.plus(locked);
      if (!sumDelta.eq(balanceTotal)) {
        await client.query('ROLLBACK');
        triggerCircuitIfViolation('LEDGER_COMPACTION_INVARIANT_VIOLATION');
        throw new Error('LEDGER_COMPACTION_INVARIANT_VIOLATION');
      }
    }

    for (const row of ledgerSums.rows) {
      const currencyId = assetToCurrency.get(row.asset)!;
      const balRow = await client.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4`,
        [row.user_id, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
      );
      const available = balRow.rows[0]?.available_balance ?? '0';
      const locked = balRow.rows[0]?.locked_balance ?? '0';
      await client.query(
        `INSERT INTO ledger_checkpoints (user_id, asset, checkpoint_ledger_id, available, locked, chain_head)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.user_id, row.asset, cutoff_ledger_id, available, locked, chain_head]
      );
    }

    const copyResult = await client.query(
      `INSERT INTO settlement_ledger_entries_archive (id, settlement_event_id, user_id, asset, delta, prev_hash, entry_hash, created_at)
       SELECT id, settlement_event_id, user_id, asset, delta, prev_hash, entry_hash, created_at
       FROM settlement_ledger_entries WHERE id <= $1`,
      [cutoff_ledger_id]
    );
    const rowsArchived = copyResult.rowCount ?? 0;

    const ledgerCountRow = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM settlement_ledger_entries WHERE id <= $1`,
      [cutoff_ledger_id]
    );
    const archiveCountRow = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM settlement_ledger_entries_archive WHERE id <= $1`,
      [cutoff_ledger_id]
    );
    const ledgerCount = parseInt(ledgerCountRow.rows[0]?.count ?? '0', 10);
    const archiveCount = parseInt(archiveCountRow.rows[0]?.count ?? '0', 10);
    if (archiveCount !== ledgerCount) {
      await client.query('ROLLBACK');
      triggerCircuitIfViolation('LEDGER_COMPACTION_INVARIANT_VIOLATION');
      throw new Error('LEDGER_COMPACTION_INVARIANT_VIOLATION');
    }

    await client.query(`DELETE FROM settlement_ledger_entries WHERE id <= $1`, [cutoff_ledger_id]);

    const remainingSums = await client.query<{ user_id: string; asset: string; sum: string }>(
      `SELECT user_id, asset, COALESCE(SUM(delta), 0)::text AS sum
       FROM settlement_ledger_entries GROUP BY user_id, asset`
    );
    for (const row of ledgerSums.rows) {
      const currencyId = assetToCurrency.get(row.asset);
      if (!currencyId) continue;
      const checkpointRow = await client.query<{ available: string; locked: string }>(
        `SELECT available::text AS available, locked::text AS locked FROM ledger_checkpoints
         WHERE user_id = $1 AND asset = $2 AND checkpoint_ledger_id = $3 ORDER BY id DESC LIMIT 1`,
        [row.user_id, row.asset, cutoff_ledger_id]
      );
      if (checkpointRow.rows.length === 0) continue;
      const cp = checkpointRow.rows[0]!;
      const checkpointTotal = new Decimal(cp.available ?? '0').plus(new Decimal(cp.locked ?? '0'));
      const remainingSum = remainingSums.rows.find((r) => r.user_id === row.user_id && r.asset === row.asset);
      const remainingDelta = new Decimal(remainingSum?.sum ?? '0');
      const replayTotal = checkpointTotal.plus(remainingDelta);
      const balRow = await client.query<{ available_balance: string; locked_balance: string }>(
        `SELECT available_balance::text, locked_balance::text FROM user_balances
         WHERE user_id = $1 AND currency_id = $2 AND COALESCE(chain_id, '') = $3 AND account_type = $4`,
        [row.user_id, currencyId, CHAIN_ID_GLOBAL, SETTLEMENT_ACCOUNT_TYPE]
      );
      if (balRow.rows.length === 0) continue;
      const currentTotal = new Decimal(balRow.rows[0]!.available_balance ?? '0').plus(
        new Decimal(balRow.rows[0]!.locked_balance ?? '0')
      );
      if (!replayTotal.eq(currentTotal)) {
        await client.query('ROLLBACK');
        triggerCircuitIfViolation('LEDGER_COMPACTION_INVARIANT_VIOLATION');
        throw new Error('LEDGER_COMPACTION_INVARIANT_VIOLATION');
      }
    }

    await client.query('COMMIT');
    logger.info('Ledger compaction completed', {
      cutoff_ledger_id,
      checkpointsInserted: ledgerSums.rows.length,
      rowsArchived,
    });
    return {
      ok: true,
      checkpointsInserted: ledgerSums.rows.length,
      rowsArchived,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (err instanceof Error && err.message === 'LEDGER_COMPACTION_INVARIANT_VIOLATION') {
      triggerCircuitIfViolation('LEDGER_COMPACTION_INVARIANT_VIOLATION');
      logger.error('LEDGER_COMPACTION_INVARIANT_VIOLATION', {
        message: 'Checkpoint math or replay-from-checkpoint validation failed.',
        level: 'CRITICAL',
        cutoff_ledger_id,
      });
    }
    throw err;
  } finally {
    client.release();
  }
}
