/**
 * Check for duplicate admin users (same email)
 * Run: cd apps/backend && npx tsx scripts/check-duplicate-admins.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const dupes = await client.query(`
    SELECT email, COUNT(*) as cnt, array_agg(id) as ids
    FROM admin_users
    GROUP BY email
    HAVING COUNT(*) > 1
  `);

  console.log('Duplicate admins (same email > 1):');
  if (dupes.rows.length === 0) {
    console.log('  None found');
  } else {
    console.table(dupes.rows);
  }

  const all = await client.query(
    'SELECT id, email, name, role, is_active, created_at FROM admin_users ORDER BY email'
  );
  console.log('\nAll admin users:');
  console.table(all.rows);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
