/**
 * Backend startup: refuse to start if required tables are missing or are views.
 * FAIL CLOSED — do not allow the server to run with an invalid or partial database.
 *
 * Required: users, user_balances, tokens, withdrawals, chains, hot_wallets must be TABLES (relkind = 'r'), not views.
 * Legacy "balances" table is NOT validated; startup must never fail due to legacy tables.
 */

import { db } from './database.js';
import { logger } from './logger.js';

const REQUIRED_TABLES = ['users', 'user_balances', 'tokens', 'withdrawals', 'chains', 'hot_wallets', 'otp_verifications'] as const;
const RELKIND_TABLE = 'r';
const RELKIND_VIEW = 'v';

function formatRelkind(k: string): string {
  if (k === RELKIND_TABLE) return 'table';
  if (k === RELKIND_VIEW) return 'view';
  return k || 'unknown';
}

export async function validateRequiredTables(): Promise<void> {
  try {
    const result = await db.query<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind::text as relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [REQUIRED_TABLES as unknown as string[]]
    );
    const byName = new Map(result.rows.map((r) => [r.relname, r.relkind]));
    const missing: string[] = [];
    const viewsInsteadOfTables: string[] = [];
    for (const name of REQUIRED_TABLES) {
      const kind = byName.get(name);
      if (!kind) {
        missing.push(name);
      } else if (kind !== RELKIND_TABLE) {
        viewsInsteadOfTables.push(`${name} (currently a ${formatRelkind(kind)})`);
      }
    }
    if (missing.length > 0 || viewsInsteadOfTables.length > 0) {
      logger.error('Invalid database schema. Required tables missing or are views.', {
        missing,
        viewsInsteadOfTables,
      });
      console.error('');
      console.error('❌ Invalid database schema. Backend cannot start.');
      console.error('');
      if (viewsInsteadOfTables.length > 0) {
        console.error('   The following must be TABLES but are not:');
        viewsInsteadOfTables.forEach((s) => console.error('   - ' + s));
        console.error('');
        console.error('   Migrations will replace these views with tables when you run:');
      }
      if (missing.length > 0) {
        console.error('   Missing required tables: ' + missing.join(', ') + '.');
        console.error('');
        console.error('   Run migrations to create them:');
      }
      console.error('');
      console.error('   cd apps/backend');
      console.error('   npm run migrate');
      console.error('   npm run dev');
      console.error('');
      console.error('   If chains/tokens were views, migrations drop them and create tables.');
      console.error('');
      process.exit(1);
    }
    logger.info('Required tables validated (users, user_balances, tokens, withdrawals, chains, hot_wallets, otp_verifications).');

    // Fail fast if token withdrawal columns are missing (admin + withdrawal validation depend on them)
    await db.query<{ min_withdrawal: string; max_withdrawal: string | null }>(
      'SELECT t.min_withdrawal::text, t.max_withdrawal::text FROM tokens t LIMIT 1'
    );
    logger.info('✓ tokens.min_withdrawal and tokens.max_withdrawal verified');

    // spot_orders and spot_trades: require either "market" or "trading_pair_id" (legacy)
    const spotTables = ['spot_orders', 'spot_trades'];
    const colResult = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       AND column_name IN ('market', 'trading_pair_id')`,
      [spotTables]
    );
    const byTable = new Map<string, Set<string>>();
    for (const r of colResult.rows) {
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
      byTable.get(r.table_name)!.add(r.column_name);
    }
    const missingColumns: string[] = [];
    for (const t of spotTables) {
      const cols = byTable.get(t);
      if (!cols || (!cols.has('market') && !cols.has('trading_pair_id'))) {
        missingColumns.push(`${t}.market or ${t}.trading_pair_id`);
      }
    }
    if (missingColumns.length > 0) {
      logger.error('Schema drift: spot_orders/spot_trades need market or trading_pair_id. Refusing to start.', { missing: missingColumns });
      throw new Error(`SCHEMA_DRIFT: ${missingColumns.join('; ')}. Run migrations.`);
    }
    logger.info('✓ spot_orders and spot_trades (market or trading_pair_id) verified');
  } catch (err) {
    logger.error('Failed to validate required tables', {
      error: err instanceof Error ? err.message : 'Unknown',
    });
    console.error('');
    console.error('❌ Database validation failed. Cannot start backend.');
    console.error('');
    console.error('   Cause: ' + (err instanceof Error ? err.message : 'Unknown'));
    console.error('');
    console.error('   Ensure PostgreSQL is running and DATABASE_URL is correct.');
    console.error('   Then run: npm run migrate (in apps/backend)');
    console.error('');
    process.exit(1);
  }
}
