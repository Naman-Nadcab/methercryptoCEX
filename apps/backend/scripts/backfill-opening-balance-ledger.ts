/**
 * Genesis gap backfill for balance_ledger (trading account only).
 *
 * Closes the difference between user_balances and SUM(balance_ledger postings) per bucket
 * (available / locked), matching spot-integrity.service.ts — without mutating user_balances.
 *
 * Idempotency: deterministic reference_id per (backfill_version, user_id, currency_id, balance_type).
 * Re-runs skip rows that already exist for reference_type = opening_balance.
 *
 * Requires DB migration adding enum value ledger_reference_type.opening_balance.
 *
 * Usage (from apps/backend):
 *   npx tsx scripts/backfill-opening-balance-ledger.ts           # dry-run
 *   npx tsx scripts/backfill-opening-balance-ledger.ts --apply  # insert
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { v5 as uuidv5 } from 'uuid';
import { Decimal } from '../src/lib/decimal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const BACKFILL_VERSION = 'genesis_backfill_v1';
/** Fixed namespace — do not change after first production use (reference_ids must stay stable). */
const GENESIS_BACKFILL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const ACCOUNT_TYPE = 'trading';
const CHAIN_GLOBAL = '';
const EPS = new Decimal('1e-12');

const APPLY = process.argv.includes('--apply');

function stableReferenceId(userId: string, currencyId: string, balanceType: 'available' | 'locked'): string {
  return uuidv5(`${BACKFILL_VERSION}|${userId}|${currencyId}|${balanceType}`, GENESIS_BACKFILL_NAMESPACE);
}

function dec8(d: Decimal): string {
  return d.toDecimalPlaces(8, Decimal.ROUND_DOWN).toString();
}

async function countMismatches(client: pg.PoolClient): Promise<number> {
  const r = await client.query<{ n: string }>(
    `WITH ledger_sums AS (
       SELECT user_id, currency_id,
         COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS avail_sum,
         COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS lock_sum
       FROM balance_ledger
       WHERE description LIKE '%account_type=trading%'
       GROUP BY user_id, currency_id
     )
     SELECT COUNT(*)::text AS n
     FROM user_balances ub
     LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
     WHERE ub.account_type = $1 AND COALESCE(ub.chain_id, '') = $2
       AND (
         COALESCE(ub.available_balance, 0)::numeric <> COALESCE(ls.avail_sum::numeric, 0)
         OR COALESCE(ub.locked_balance, 0)::numeric <> COALESCE(ls.lock_sum::numeric, 0)
       )`,
    [ACCOUNT_TYPE, CHAIN_GLOBAL]
  );
  return parseInt(r.rows[0]?.n ?? '0', 10) || 0;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const ssl =
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false as const } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl });
  const client = await pool.connect();

  const inserted: Array<{ user_id: string; currency_id: string; balance_type: string; credit: string; reference_id: string }> = [];
  const skippedExisting: string[] = [];
  const errors: string[] = [];

  try {
    const rows = await client.query<{
      user_id: string;
      currency_id: string;
      available_balance: string;
      locked_balance: string;
      avail_sum: string | null;
      lock_sum: string | null;
    }>(
      `WITH ledger_sums AS (
         SELECT user_id, currency_id,
           COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS avail_sum,
           COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS lock_sum
         FROM balance_ledger
         WHERE description LIKE '%account_type=trading%'
         GROUP BY user_id, currency_id
       )
       SELECT ub.user_id::text, ub.currency_id::text,
         COALESCE(ub.available_balance, 0)::text AS available_balance,
         COALESCE(ub.locked_balance, 0)::text AS locked_balance,
         ls.avail_sum,
         ls.lock_sum
       FROM user_balances ub
       LEFT JOIN ledger_sums ls ON ub.user_id = ls.user_id AND ub.currency_id = ls.currency_id
       WHERE ub.account_type = $1 AND COALESCE(ub.chain_id, '') = $2`,
      [ACCOUNT_TYPE, CHAIN_GLOBAL]
    );

    const mismatchBefore = await countMismatches(client);

    if (APPLY) await client.query('BEGIN');
    try {
      for (const row of rows.rows) {
        const availBal = new Decimal(row.available_balance ?? '0');
        const lockBal = new Decimal(row.locked_balance ?? '0');
        const ledgerAvail = new Decimal(row.avail_sum ?? '0');
        const ledgerLock = new Decimal(row.lock_sum ?? '0');

        const missingAvail = availBal.minus(ledgerAvail);
        const missingLock = lockBal.minus(ledgerLock);

        const bucketDefs = [
          { balanceType: 'available' as const, missing: missingAvail, bal: availBal, ledger: ledgerAvail },
          { balanceType: 'locked' as const, missing: missingLock, bal: lockBal, ledger: ledgerLock },
        ];

        for (const { balanceType, missing, bal, ledger } of bucketDefs) {
          if (missing.abs().lte(EPS)) continue;
          if (missing.isNegative()) {
            errors.push(
              `NEGATIVE_GAP ${row.user_id} ${row.currency_id} ${balanceType}: balance=${dec8(bal)} ledger_net=${dec8(ledger)} (ledger exceeds balance — manual investigation required)`
            );
            continue;
          }

          const creditStr = dec8(missing);
          if (creditStr === '0') continue;

          const refId = stableReferenceId(row.user_id, row.currency_id, balanceType);
          const exists = await client.query(
            `SELECT 1 FROM balance_ledger WHERE reference_type = 'opening_balance' AND reference_id = $1::uuid LIMIT 1`,
            [refId]
          );
          if (exists.rows.length > 0) {
            skippedExisting.push(`${row.user_id}|${row.currency_id}|${balanceType}|${refId}`);
            continue;
          }

          const beforeStr = dec8(bal.minus(missing));
          const afterStr = dec8(bal);

          if (!APPLY) {
            inserted.push({
              user_id: row.user_id,
              currency_id: row.currency_id,
              balance_type: balanceType,
              credit: creditStr,
              reference_id: refId,
            });
            continue;
          }

          await client.query(
            `INSERT INTO balance_ledger (
               user_id, currency_id, reference_type, reference_id, debit, credit,
               balance_before, balance_after, balance_type, description, created_at
             ) VALUES (
               $1::uuid, $2::uuid, 'opening_balance'::ledger_reference_type, $3::uuid,
               0::numeric, $4::numeric, $5::numeric, $6::numeric, $7::balance_type,
               $8, NOW()
             )`,
            [
              row.user_id,
              row.currency_id,
              refId,
              creditStr,
              beforeStr,
              afterStr,
              balanceType,
              `account_type=${ACCOUNT_TYPE} | Initial balance backfill (${BACKFILL_VERSION})`,
            ]
          );
          inserted.push({
            user_id: row.user_id,
            currency_id: row.currency_id,
            balance_type: balanceType,
            credit: creditStr,
            reference_id: refId,
          });
        }
      }

      if (APPLY) await client.query('COMMIT');
    } catch (e) {
      if (APPLY) await client.query('ROLLBACK');
      throw e;
    }

    const mismatchAfter = await countMismatches(client);

    const usersAffected = [...new Set(inserted.map((x) => x.user_id))];

    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry_run',
      backfill_version: BACKFILL_VERSION,
      spot_integrity_mismatches_before: mismatchBefore,
      spot_integrity_mismatches_after: mismatchAfter,
      spot_integrity_ok: mismatchAfter === 0,
      entries_planned_or_inserted: inserted.length,
      users_affected_count: usersAffected.length,
      users_affected: usersAffected,
      entries: inserted,
      skipped_idempotent_hits: skippedExisting.length,
      skipped_idempotent_sample: skippedExisting.slice(0, 20),
      negative_gap_errors: errors,
    }, null, 2));

    if (errors.length > 0) {
      console.error('Completed with ledger>balance gaps (no credit inserted for those).');
      process.exitCode = 2;
    }

    if (!APPLY) {
      console.error('\nDry-run only. Re-run with --apply to insert.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
