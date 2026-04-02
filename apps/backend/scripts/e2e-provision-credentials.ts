/**
 * E2E credentials: upsert QA traders (same as ../../scripts/dev-provision-qa-traders.ts),
 * create Redis-backed sessions, mint access JWTs for user A and B.
 *
 * Run from repo root:
 *   cd apps/backend && npx tsx scripts/e2e-provision-credentials.ts
 *
 * Requires: DATABASE_URL, JWT_SECRET, REDIS_URL (same as API), migrated DB, BTC+USDT in currencies.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const A_EMAIL = 'qa_trader_a@local.exchange';
const B_EMAIL = 'qa_trader_b@local.exchange';
const PASSWORD = 'TestPass123';
export const API_KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const API_KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function main() {
  const pg = (await import('pg')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const crypto = await import('crypto');
  const jwt = (await import('jsonwebtoken')).default;
  const { createSession } = await import('../src/services/session.service.js');

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing');
    process.exit(1);
  }
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    console.error('JWT_SECRET missing or too short (min 32 chars)');
    process.exit(1);
  }
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const reg = await client.query<{ uak: string | null; ub: string | null }>(
    `SELECT to_regclass('public.user_api_keys')::text as uak, to_regclass('public.user_balances')::text as ub`
  );
  if (!reg.rows[0]?.uak || !reg.rows[0]?.ub) {
    console.error('Run migrations first (user_api_keys / user_balances).');
    process.exit(1);
  }

  const cur = await client.query<{ id: string; symbol: string }>(
    `SELECT id, symbol FROM currencies WHERE UPPER(TRIM(symbol)) IN ('BTC','USDT')`
  );
  const btc = cur.rows.find((r) => r.symbol?.toUpperCase().trim() === 'BTC')?.id;
  const usdt = cur.rows.find((r) => r.symbol?.toUpperCase().trim() === 'USDT')?.id;
  if (!btc || !usdt) {
    console.error('Need BTC and USDT rows in currencies.');
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
  await fundTrading(idA, usdt, '500000');
  await fundTrading(idB, btc, '5');
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

  const rowA = await client.query<{ email: string | null; phone: string | null }>(
    `SELECT email, phone FROM users WHERE id = $1`,
    [idA]
  );
  const rowB = await client.query<{ email: string | null; phone: string | null }>(
    `SELECT email, phone FROM users WHERE id = $1`,
    [idB]
  );

  await client.end();

  const sessA = await createSession({
    userId: idA,
    deviceType: 'web',
    ipAddress: '127.0.0.1',
    userAgent: 'e2e-provision-credentials',
    ttlSeconds: 7 * 24 * 60 * 60,
  });
  const sessB = await createSession({
    userId: idB,
    deviceType: 'web',
    ipAddress: '127.0.0.1',
    userAgent: 'e2e-provision-credentials',
    ttlSeconds: 7 * 24 * 60 * 60,
  });

  const payloadA = {
    userId: idA,
    email: rowA.rows[0]?.email ?? undefined,
    phone: rowA.rows[0]?.phone ?? undefined,
    role: 'user',
    sessionId: sessA.sessionId,
  };
  const payloadB = {
    userId: idB,
    email: rowB.rows[0]?.email ?? undefined,
    phone: rowB.rows[0]?.phone ?? undefined,
    role: 'user',
    sessionId: sessB.sessionId,
  };

  const tokenA = jwt.sign(payloadA, secret, { expiresIn });
  const tokenB = jwt.sign(payloadB, secret, { expiresIn });

  console.log('');
  console.log('=== E2E credentials (add to .env.e2e or export before npm run test:e2e) ===');
  console.log('');
  console.log(`E2E_JWT=${tokenA}`);
  console.log(`E2E_COUNTERPARTY_JWT=${tokenB}`);
  console.log(`E2E_API_KEY=${API_KEY_A}`);
  console.log(`E2E_COUNTERPARTY_API_KEY=${API_KEY_B}`);
  console.log('');
  console.log('=== Reference ===');
  console.log(JSON.stringify({ trader_a: A_EMAIL, trader_b: B_EMAIL, password: PASSWORD, user_ids: [idA, idB] }, null, 2));
  console.log('');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
