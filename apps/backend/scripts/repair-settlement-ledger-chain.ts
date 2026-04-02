/**
 * Re-links settlement_ledger_entries prev_hash → prior entry_hash and recomputes entry_hash
 * using the same algorithm as settlement-worker (LEDGER_ENTRY_DOMAIN + settlement_event_id).
 *
 * Requires DB role that can ALTER TABLE ... DISABLE TRIGGER on settlement_ledger_entries.
 * Stop settlement workers during run (brief maintenance window).
 *
 * Run: cd apps/backend && npx tsx scripts/repair-settlement-ledger-chain.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { db } from '../src/lib/database.js';
import { Decimal } from '../src/lib/decimal.js';
import { logger } from '../src/lib/logger.js';
import { toNumeric } from '../src/services/settlement/decimal-utils.js';
import { LEDGER_ENTRY_DOMAIN } from '../src/services/settlement/settlement-hash-constants.js';

const ADVISORY_KEY = 88442211;

async function main(): Promise<void> {
  const client = await db.getSettlementClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_KEY]);

    await client.query(
      'ALTER TABLE settlement_ledger_entries DISABLE TRIGGER trg_settlement_ledger_immutable_no_update'
    );
    await client.query(
      'ALTER TABLE settlement_ledger_entries DISABLE TRIGGER trg_settlement_ledger_immutable_no_delete'
    );

    const { rows: rawRows } = await client.query<{
      id: string;
      settlement_event_id: string;
      user_id: string;
      asset: string;
      delta: string;
    }>(
      `SELECT id::text AS id, settlement_event_id::text, user_id, asset, delta::text AS delta
       FROM settlement_ledger_entries ORDER BY id ASC`
    );
    const rows = [...rawRows].sort((a, b) => {
      const na = BigInt(a.id);
      const nb = BigInt(b.id);
      return na < nb ? -1 : na > nb ? 1 : 0;
    });

    let prevHash: string | null = null;
    for (const r of rows) {
      const deltaStr = toNumeric(new Decimal(r.delta));
      const payload = `${LEDGER_ENTRY_DOMAIN}|${prevHash ?? ''}|${r.settlement_event_id}|${r.user_id}|${r.asset}|${deltaStr}`;
      const entryHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

      await client.query(
        `UPDATE settlement_ledger_entries SET prev_hash = $1, entry_hash = $2 WHERE id = $3::bigint`,
        [prevHash, entryHash, r.id]
      );
      prevHash = entryHash;
    }

    await client.query(
      'ALTER TABLE settlement_ledger_entries ENABLE TRIGGER trg_settlement_ledger_immutable_no_update'
    );
    await client.query(
      'ALTER TABLE settlement_ledger_entries ENABLE TRIGGER trg_settlement_ledger_immutable_no_delete'
    );

    await client.query('COMMIT');
    logger.info('repair_settlement_ledger_chain: done', { rows: rows.length });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('repair_settlement_ledger_chain failed', {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    throw e;
  } finally {
    client.release();
    await db.close();
  }
}

main().catch(() => process.exit(1));
