/**
 * Backend startup: refuse to start if required wallet tables are missing or are views.
 * FAIL CLOSED — do not allow the server to run with an invalid or partial database.
 *
 * Required: chains, tokens, hot_wallets must be TABLES (relkind = 'r'), not views.
 */

import { db } from './database.js';
import { logger } from './logger.js';

const REQUIRED_TABLES = ['chains', 'hot_wallets', 'tokens'] as const;
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
    logger.info('Required tables validated (chains, hot_wallets, tokens).');
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
