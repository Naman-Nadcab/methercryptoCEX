/**
 * DEV / QA ONLY: Upsert two spot traders with trading balances and fixed API keys.
 *
 * Requires repo root .env with DATABASE_URL pointing at a fully migrated database.
 *
 * Usage (from repo root):
 *   cd apps/backend && npx tsx ../../scripts/dev-provision-qa-traders.ts
 *
 * API keys (32 hex chars each):
 *   Trader A: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
 *   Trader B: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const A_EMAIL = 'qa_trader_a@local.exchange';
const B_EMAIL = 'qa_trader_b@local.exchange';
const PASSWORD = 'TestPass123';
/** 32-char keys (same shape as auth route: randomBytes(16).toString('hex')) */
export const API_KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const API_KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in .env');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const reg = await client.query<{ uak: string | null; ub: string | null }>(
    `SELECT to_regclass('public.user_api_keys')::text as uak, to_regclass('public.user_balances')::text as ub`
  );
  if (!reg.rows[0]?.uak) {
    console.error('Table user_api_keys not found. Run: npm run db:migrate (same DATABASE_URL as this script).');
    process.exit(1);
  }
  if (!reg.rows[0]?.ub) {
    console.error('Table user_balances not found. Run migrations.');
    process.exit(1);
  }

  const cur = await client.query<{ id: string; symbol: string }>(
    `SELECT id, symbol FROM currencies WHERE UPPER(TRIM(symbol)) IN ('BTC','USDT')`
  );
  const btc = cur.rows.find((r) => r.symbol?.toUpperCase().trim() === 'BTC')?.id;
  const usdt = cur.rows.find((r) => r.symbol?.toUpperCase().trim() === 'USDT')?.id;
  if (!btc || !usdt) {
    console.error('Need BTC and USDT rows in currencies table.');
    process.exit(1);
  }

  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(PASSWORD, salt);
  const salt64 = salt.substring(0, 64);

  function randomRef(prefix: string): string {
    const s = `${prefix}${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
    return s.slice(0, 10);
  }

  const userCols = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'`
  );
  const hasRole = userCols.rows.some((r) => r.column_name === 'role');

  async function ensureUser(email: string): Promise<string> {
    const ex = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL`,
      [email]
    );
    if (ex.rows.length > 0) return ex.rows[0]!.id;

    for (let i = 0; i < 5; i++) {
      const ref = randomRef('Q');
      try {
        const ins = hasRole
          ? await client.query<{ id: string }>(
              `INSERT INTO users (email, email_verified, password_hash, salt, status, referral_code, role)
               VALUES ($1, TRUE, $2, $3, 'active', $4, 'user')
               RETURNING id`,
              [email.toLowerCase(), hash, salt64, ref]
            )
          : await client.query<{ id: string }>(
              `INSERT INTO users (email, email_verified, password_hash, salt, status, referral_code)
               VALUES ($1, TRUE, $2, $3, 'active', $4)
               RETURNING id`,
              [email.toLowerCase(), hash, salt64, ref]
            );
        return ins.rows[0]!.id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/referral|unique|duplicate/i.test(msg)) continue;
        throw e;
      }
    }
    throw new Error('Could not allocate unique referral_code');
  }

  const idA = await ensureUser(A_EMAIL);
  const idB = await ensureUser(B_EMAIL);

  const chainCol = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_balances' AND column_name='chain_id'`
  );
  const hasChainId = chainCol.rows.length > 0;

  async function fundTrading(userId: string, currencyId: string, amount: string) {
    if (hasChainId) {
      await client.query(
        `INSERT INTO user_balances (user_id, currency_id, chain_id, account_type, available_balance, locked_balance)
         VALUES ($1, $2, '', 'trading', $3::numeric, 0)
         ON CONFLICT (user_id, currency_id, chain_id, account_type)
         DO UPDATE SET available_balance = EXCLUDED.available_balance`,
        [userId, currencyId, amount]
      );
    } else {
      await client.query(
        `INSERT INTO user_balances (user_id, currency_id, account_type, available_balance, locked_balance)
         VALUES ($1, $2, 'trading', $3::numeric, 0)
         ON CONFLICT (user_id, currency_id, account_type)
         DO UPDATE SET available_balance = EXCLUDED.available_balance`,
        [userId, currencyId, amount]
      );
    }
  }

  await fundTrading(idA, btc, '5');
  await fundTrading(idB, usdt, '500000');

  await client.query(`DELETE FROM user_api_keys WHERE api_key IN ($1, $2)`, [API_KEY_A, API_KEY_B]);

  const ipCol = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='user_api_keys' AND column_name='ip_addresses'`
  );
  const ipType = ipCol.rows[0]?.data_type ?? 'jsonb';
  const ipEmpty =
    ipType === 'ARRAY' || ipType?.includes('[]')
      ? "'{}'::text[]"
      : ipType === 'json' || ipType === 'jsonb'
        ? "'[]'::jsonb"
        : "'[]'";

  await client.query(
    `INSERT INTO user_api_keys (
       user_id, name, key_type, api_key_usage, api_key, api_secret, public_key,
       permission, ip_restriction, ip_addresses, permissions, expires_at
     ) VALUES ($1, $2, 'self', 'third_party', $3, NULL, NULL, 'read_write', 'no_restriction', ${ipEmpty}, '{}'::jsonb, NULL)`,
    [idA, 'QA Trader A', API_KEY_A]
  );
  await client.query(
    `INSERT INTO user_api_keys (
       user_id, name, key_type, api_key_usage, api_key, api_secret, public_key,
       permission, ip_restriction, ip_addresses, permissions, expires_at
     ) VALUES ($1, $2, 'self', 'third_party', $3, NULL, NULL, 'read_write', 'no_restriction', ${ipEmpty}, '{}'::jsonb, NULL)`,
    [idB, 'QA Trader B', API_KEY_B]
  );

  console.log(
    JSON.stringify(
      {
        trader_a_user_id: idA,
        trader_b_user_id: idB,
        emails: [A_EMAIL, B_EMAIL],
        password: PASSWORD,
        api_key_a: API_KEY_A,
        api_key_b: API_KEY_B,
        export_for_smoke:
          `export QA_API_KEY_A=${API_KEY_A} QA_API_KEY_B=${API_KEY_B}`,
      },
      null,
      2
    )
  );

  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
