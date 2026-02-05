/**
 * ONE-TIME REPAIR: Migrate balances → user_balances for users who have
 * balances rows but NO user_balances rows.
 *
 * Run manually: cd apps/backend && npx tsx scripts/repair-balances-to-user-balances.ts
 *
 * DO NOT run on every startup. Manual / explicit only.
 * Uses db.getPool() for reads from deprecated balances table (guarded db.query would throw).
 */

import { db } from '../src/lib/database.js';
import { logger } from '../src/lib/logger.js';

async function repair(): Promise<void> {
  logger.info('Starting one-time repair: balances → user_balances (only where user_balances is empty)');

  const pool = db.getPool();
  const usersWithBalancesOnly = await pool.query<{ user_id: string }>(`
    SELECT DISTINCT b.user_id
    FROM balances b
    WHERE NOT EXISTS (SELECT 1 FROM user_balances ub WHERE ub.user_id = b.user_id)
  `);

  let repairedCount = 0;

  for (const { user_id } of usersWithBalancesOnly.rows) {
    const inserted = await pool.query(`
      INSERT INTO user_balances (
        id, user_id, currency_id, chain_id, account_type,
        available_balance, locked_balance, pending_balance, total_deposited, updated_at
      )
      SELECT
        gen_random_uuid(),
        b.user_id,
        c.id,
        '',
        'funding',
        COALESCE(b.available, 0) + COALESCE(b.locked, 0),
        0,
        0,
        0,
        NOW()
      FROM balances b
      JOIN tokens t ON b.token_id = t.id
      JOIN currencies c ON UPPER(TRIM(c.symbol)) = UPPER(TRIM(t.symbol))
      WHERE b.user_id = $1
      ON CONFLICT (user_id, currency_id, chain_id, account_type) DO NOTHING
    `, [user_id]);

    repairedCount += inserted.rowCount ?? 0;
    if ((inserted.rowCount ?? 0) > 0) {
      logger.info('Repaired user_balances for user', { user_id, rows: inserted.rowCount });
    }
  }

  logger.info('One-time repair finished', {
    users_processed: usersWithBalancesOnly.rows.length,
    total_rows_repaired: repairedCount,
  });
}

repair()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Repair failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
