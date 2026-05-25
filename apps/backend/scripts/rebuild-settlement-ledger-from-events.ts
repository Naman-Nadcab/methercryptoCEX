/**
 * Rebuild settlement_ledger_entries from processed settlement_events replay.
 *
 * Use only in controlled maintenance windows when legacy ledger drift blocks
 * settlement circuit recovery and aggregate audits.
 *
 * Run: cd apps/backend && npx tsx scripts/rebuild-settlement-ledger-from-events.ts
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { db } from '../src/lib/database.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/lib/logger.js';
import { redis } from '../src/lib/redis.js';
import { toNumeric } from '../src/services/settlement/decimal-utils.js';
import { LEDGER_ENTRY_DOMAIN } from '../src/services/settlement/settlement-hash-constants.js';
import { normalizeSettlementPayload, resolveMarketAssets } from '../src/services/settlement/settlement-worker.js';
import { computeSettlementLedgerDeltasFromPayload } from '../src/services/settlement/settlement-ledger-deltas.js';

const ADVISORY_LOCK_KEY = 88442212;

async function main(): Promise<void> {
  const client = await db.getSettlementClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query('LOCK TABLE settlement_ledger_entries IN ACCESS EXCLUSIVE MODE');

    const events = await client.query<{ id: number; payload: unknown }>(
      `SELECT id, payload
       FROM settlement_events
       WHERE status = 'processed'
       ORDER BY id ASC`
    );
    const totalEvents = events.rows.length;

    await client.query('TRUNCATE TABLE settlement_ledger_entries RESTART IDENTITY');

    const makerRebatesEnabled = config.features.makerRebatesEnabled;
    let prevHash: string | null = null;
    let insertedRows = 0;

    for (const row of events.rows) {
      const payload = normalizeSettlementPayload(row.payload);
      const market = await resolveMarketAssets(client, payload.symbol);
      const deltas = computeSettlementLedgerDeltasFromPayload(
        payload,
        {
          base: market.base,
          quote: market.quote,
          price_precision: market.price_precision,
          qty_precision: market.qty_precision,
          quote_precision: market.quote_precision,
        },
        makerRebatesEnabled
      );

      for (const d of deltas) {
        const deltaStr = toNumeric(d.delta);
        const hashPayload = `${LEDGER_ENTRY_DOMAIN}|${prevHash ?? ''}|${row.id}|${d.user_id}|${d.asset}|${deltaStr}`;
        const entryHash = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');

        await client.query(
          `INSERT INTO settlement_ledger_entries (settlement_event_id, user_id, asset, delta, prev_hash, entry_hash)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.id, d.user_id, d.asset, deltaStr, prevHash, entryHash]
        );

        prevHash = entryHash;
        insertedRows++;
      }
    }

    await client.query('COMMIT');
    logger.info('rebuild_settlement_ledger_from_events: completed', {
      events: totalEvents,
      insertedRows,
      makerRebatesEnabled,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('rebuild_settlement_ledger_from_events failed', {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    throw e;
  } finally {
    client.release();
    await db.close();
    await redis.close().catch(() => {});
  }
}

main().catch(() => process.exit(1));
