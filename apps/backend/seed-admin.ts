/**
 * Ensure default admin users exist for admin panel login.
 * Run: cd apps/backend && npx tsx seed-admin.ts
 *
 * Creates (if missing):
 * - Super Admin: admin@example.com / admin123
 * - Withdrawal Approver: approver@example.com / approver123
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ADMINS = [
  { email: 'admin@example.com', password: 'admin123', name: 'Super Admin', role: 'super_admin', permissions: ['all'] },
  { email: 'approver@example.com', password: 'approver123', name: 'Withdrawal Approver', role: 'withdrawal_approver', permissions: ['withdrawals:approve'] },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();

    const tableExists = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'admin_users'
    `);
    if (tableExists.rows.length === 0) {
      console.error('Table admin_users does not exist. Run migrations first: npm run db:migrate');
      process.exit(1);
    }

    const permsType = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'admin_users' AND column_name = 'permissions'
    `);
    const isJsonb = permsType.rows[0]?.data_type === 'jsonb';

    for (const admin of ADMINS) {
      const existing = await client.query(
        'SELECT id, email FROM admin_users WHERE email = $1',
        [admin.email.toLowerCase()]
      );
      if (existing.rows.length > 0) {
        console.log('Admin already exists:', existing.rows[0]!.email);
        continue;
      }

      const passwordHash = await bcrypt.hash(admin.password, 12);
      if (isJsonb) {
        await client.query(
          `INSERT INTO admin_users (id, email, password_hash, name, role, permissions, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, TRUE)`,
          [admin.email.toLowerCase(), passwordHash, admin.name, admin.role, JSON.stringify(admin.permissions)]
        );
      } else {
        await client.query(
          `INSERT INTO admin_users (id, email, password_hash, name, role, permissions, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::text[], TRUE)`,
          [admin.email.toLowerCase(), passwordHash, admin.name, admin.role, admin.permissions]
        );
      }
      console.log('Created:', admin.email, `(${admin.role})`);
    }

    console.log('\nLogin at: /admin/login');
    console.log('  Super Admin: admin@example.com / admin123');
    console.log('  Withdrawal Approver: approver@example.com / approver123');
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
