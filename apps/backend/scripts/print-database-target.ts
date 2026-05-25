/**
 * Prints the DATABASE_URL the backend would use (from loaded config), redacted.
 * Compare with your Docker Postgres URL so migrate/seed/API hit the same DB.
 *
 *   cd apps/backend && npx tsx scripts/print-database-target.ts
 */
import 'dotenv/config';
import { config } from '../src/config/index.js';

function redactDatabaseUrl(raw: string): { redacted: string; host: string | null; database: string | null } {
  try {
    const u = new URL(raw);
    const host = u.hostname || null;
    const database = (u.pathname ?? '').replace(/^\//, '') || null;
    if (u.password) u.password = '***';
    if (u.username) u.username = u.username.length > 0 ? `${u.username[0]}***` : '***';
    return { redacted: u.toString(), host, database };
  } catch {
    return { redacted: '(could not parse DATABASE_URL)', host: null, database: null };
  }
}

const r = redactDatabaseUrl(config.database.url);
console.log(
  JSON.stringify(
    {
      databaseUrlRedacted: r.redacted,
      host: r.host,
      databaseName: r.database,
      compareWithDockerCompose:
        'Typical local compose: postgresql://exchange:***@127.0.0.1:5432/exchange — host and database name must match what the API uses.',
    },
    null,
    2
  )
);
