/**
 * Fix: user_balances.currency_id FK violation.
 * Backfills "currencies" with any currency_id that appears in "deposits" but is missing from "currencies".
 * Run: cd apps/backend && npx tsx fix-user-balances-currency-fk.ts
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

    // 1. Check required tables exist
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('user_balances', 'currencies', 'deposits')
    `);
    const names = new Set(tables.rows.map((r: { table_name: string }) => r.table_name));
    if (!names.has('user_balances') || !names.has('currencies') || !names.has('deposits')) {
      console.log('Missing tables. Need: user_balances, currencies, deposits.');
      console.log('Present:', [...names].join(', ') || 'none');
      console.log('Why fix fails: user_balances FK references currencies(id). Ensure full-schema (currencies, deposits, user_balances) is applied.');
      process.exit(1);
    }

    // 2. Find currency_ids in deposits that are not in currencies
    const missing = await client.query<{ currency_id: string }>(`
      SELECT DISTINCT d.currency_id AS currency_id
      FROM deposits d
      LEFT JOIN currencies c ON c.id = d.currency_id
      WHERE d.currency_id IS NOT NULL AND c.id IS NULL
    `);
    if (missing.rows.length === 0) {
      console.log('OK: Every deposits.currency_id exists in currencies. No fix needed.');
      return;
    }
    const missingIds = missing.rows.map((r) => r.currency_id);
    console.log('Missing currency_id in currencies (from deposits):', missingIds.length, missingIds.slice(0, 5).join(', ') + (missingIds.length > 5 ? '...' : ''));

    // 3. Check if tokens table exists (migrate.ts schema)
    const hasTokens = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tokens'
    `);
    const tokensExists = hasTokens.rows.length > 0;

    // 4. Check currencies columns (currency_type enum vs varchar)
    const cols = await client.query<{ data_type: string; udt_name: string }>(`
      SELECT data_type, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'currencies' AND column_name = 'currency_type'
    `);
    const currencyTypeCol = cols.rows[0];
    const currencyTypeCast = currencyTypeCol?.udt_name === 'currency_type' ? "::currency_type" : "";

    let inserted = 0;

    if (tokensExists) {
      // Backfill from tokens: insert into currencies for each missing id that exists in tokens
      for (const id of missingIds) {
        const fromToken = await client.query<{ id: string; symbol: string; name: string; decimals: number; contract_address: string | null }>(`
          SELECT id, symbol, name, decimals, contract_address FROM tokens WHERE id = $1
        `, [id]);
        if (fromToken.rows.length === 0) continue;
        const t = fromToken.rows[0]!;
        try {
          await client.query(`
            INSERT INTO currencies (id, symbol, name, currency_type, blockchain_id, contract_address, decimals)
            VALUES ($1, $2, $3, 'crypto'${currencyTypeCast}, NULL, $4, $5)
            ON CONFLICT (id) DO NOTHING
          `, [t.id, t.symbol, t.name, t.contract_address ?? null, t.decimals]);
          if ((await client.query('SELECT 1 FROM currencies WHERE id = $1', [id])).rows.length > 0) {
            inserted++;
            console.log('Inserted currency from tokens:', t.symbol, t.id);
          }
        } catch (e) {
          console.warn('Insert from tokens failed for', id, (e as Error).message);
        }
      }
    }

    // 5. Any remaining missing: insert minimal row so FK is satisfied (symbol/name placeholder)
    for (const id of missingIds) {
      const exists = await client.query('SELECT 1 FROM currencies WHERE id = $1', [id]);
      if (exists.rows.length > 0) continue;
      try {
        await client.query(`
          INSERT INTO currencies (id, symbol, name, currency_type)
          VALUES ($1, 'UNKNOWN', 'Unknown (backfill)', 'crypto'${currencyTypeCast})
          ON CONFLICT (id) DO NOTHING
        `, [id]);
        inserted++;
        console.log('Inserted placeholder currency for id:', id);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('currency_type')) {
          console.error('currency_type enum missing. Create it: CREATE TYPE currency_type AS ENUM (\'crypto\', \'fiat\', \'stablecoin\');');
        }
        console.error('Insert placeholder failed for', id, msg);
      }
    }

    console.log('Done. Inserted', inserted, 'rows into currencies.');
    if (inserted > 0) {
      console.log('Restart backend and retry deposit / deposit-history.');
    }
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
