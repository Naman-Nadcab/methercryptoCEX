/**
 * Fix wallets.chain_id from UUID to VARCHAR (fixes "invalid input syntax for type uuid: 'bsc'").
 * Run from repo root: npx tsx apps/backend/fix-wallets-chain-id.ts
 * Or from apps/backend: npx tsx fix-wallets-chain-id.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const quote = (name: string) => '"' + String(name).replace(/"/g, '""') + '"';

const runFix = async (client: pg.Client) => {
  let baseSchema = 'public';
  let baseName = 'wallets';
  let viewDef: string | null = null;

  const relKind = await client.query(`
    SELECT c.oid, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'wallets'
  `);
  if (relKind.rows[0]?.relkind === 'v') {
    const viewOid = relKind.rows[0].oid;
    const def = await client.query(`SELECT pg_get_viewdef($1::regclass, true) as def`, [viewOid]);
    viewDef = def.rows[0]?.def ?? null;
    const dep = await client.query(`
      SELECT n.nspname, c.relname FROM pg_depend d
      JOIN pg_class c ON c.oid = d.refobjid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.objid = $1 AND d.refobjid != d.objid AND c.relkind = 'r'
      LIMIT 1
    `, [viewOid]);
    if (dep.rows[0]) {
      baseSchema = dep.rows[0].nspname;
      baseName = dep.rows[0].relname;
    }
    await client.query(`DROP VIEW IF EXISTS public.wallets CASCADE`);
  } else if (relKind.rows.length === 0) {
    // View was already dropped: find table with chain_id (uuid) to alter
    const t = await client.query(`
      SELECT table_schema, table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'chain_id' AND data_type = 'uuid'
      LIMIT 1
    `);
    if (t.rows[0]) {
      baseSchema = t.rows[0].table_schema;
      baseName = t.rows[0].table_name;
    }
  }
  const tbl = `"${baseSchema}"."${baseName}"`;

  // 2) Drop constraints and indexes on the base table
  const dropConstraints = await client.query(`
    SELECT c.conname FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1 AND t.relname = $2
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND a.attname = 'chain_id' AND NOT a.attisdropped
    )
  `, [baseSchema, baseName]);
  for (const row of dropConstraints.rows) {
    await client.query(`ALTER TABLE ${tbl} DROP CONSTRAINT IF EXISTS ${quote(row.conname)}`);
  }
  const dropIndexes = await client.query(`
    SELECT i.indexname FROM pg_indexes i
    WHERE i.schemaname = $1 AND i.tablename = $2 AND i.indexdef LIKE '%chain_id%'
  `, [baseSchema, baseName]);
  for (const row of dropIndexes.rows) {
    await client.query(`DROP INDEX IF EXISTS ${quote(baseSchema)}.${quote(row.indexname)}`);
  }

  await client.query(`ALTER TABLE ${tbl} ALTER COLUMN chain_id DROP DEFAULT`);
  await client.query(`ALTER TABLE ${tbl} ALTER COLUMN chain_id TYPE VARCHAR(20) USING chain_id::text`);

  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_user_chain ON ${tbl}(user_id, chain_id)`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallets_chain_address ON ${tbl}(chain_id, address)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wallets_address ON ${tbl}(chain_id, address)`);

  const chainsCol = await client.query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chains' AND column_name = 'id'
  `);
  if (chainsCol.rows[0]?.data_type === 'character varying') {
    await client.query(`ALTER TABLE ${tbl} ADD CONSTRAINT wallets_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES chains(id)`);
  }
  if (viewDef) {
    await client.query(`CREATE VIEW public.wallets AS ${viewDef}`);
  }
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Set it in .env at repo root.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const uuidCol = await client.query(`
      SELECT table_schema, table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'chain_id' AND data_type = 'uuid'
    `);
    const anyChainId = await client.query(`
      SELECT table_schema, table_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'chain_id'
    `);
    if (anyChainId.rows.length === 0) {
      console.log('No table with chain_id column in public.');
      return;
    }
    if (uuidCol.rows.length === 0) {
      console.log('chain_id is already VARCHAR everywhere. No change needed.');
      return;
    }
    await runFix(client);
    console.log('Done. wallets.chain_id is now VARCHAR(20). Try the deposit page again.');
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
