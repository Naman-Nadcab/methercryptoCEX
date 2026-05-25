/**
 * Re-hash known dev admin passwords and clear lock counters.
 * Use when login returns INVALID_CREDENTIALS but you expect seed/migration defaults.
 *
 * Run: cd apps/backend && npm run admin:reset-dev-login
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PAIRS: { email: string; password: string }[] = [
  { email: 'admin@example.com', password: 'admin123' },
  { email: 'test@gmail.com', password: 'admin123' },
  { email: 'approver@example.com', password: 'admin123' },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set (apps/backend/.env).');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const { email, password } of PAIRS) {
      const hash = await bcrypt.hash(password, 12);
      const r = await client.query(
        `UPDATE admin_users
         SET password_hash = $2,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE LOWER(email) = LOWER($1)
         RETURNING email`,
        [email, hash]
      );
      if (r.rowCount === 0) {
        console.warn('No row for', email, '(run migrations + seed-admin if missing)');
      } else {
        console.log('Reset:', email, '→ password:', password);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
