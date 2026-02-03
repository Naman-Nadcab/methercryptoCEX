/**
 * Ensures table "wallets" exists (fixes "relation wallets does not exist" after view was dropped).
 * Creates the wallets table per migration schema if missing.
 * Run: cd apps/backend && npx tsx ensure-wallets-relation.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();

    const exists = await client.query(`
      SELECT c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'wallets'
    `);
    if (exists.rows.length > 0) {
      console.log('Relation public.wallets already exists.');
      return;
    }

    await client.query(`
      CREATE TABLE public.wallets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chain_id VARCHAR(20) NOT NULL REFERENCES chains(id),
        address VARCHAR(100) NOT NULL,
        encrypted_private_key TEXT NOT NULL,
        hd_path VARCHAR(50) NOT NULL,
        hd_index INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, chain_id),
        UNIQUE(chain_id, address)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wallets_address ON public.wallets(chain_id, address)`);
    console.log('Created table public.wallets. Try the deposit page again.');
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
