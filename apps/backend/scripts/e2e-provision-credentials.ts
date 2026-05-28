/**
 * E2E credentials: upsert QA traders (same as ../../scripts/dev-provision-qa-traders.ts),
 * create Redis-backed sessions, mint access JWTs for user A and B.
 *
 * Run from repo root:
 *   cd apps/backend && npx tsx scripts/e2e-provision-credentials.ts --emit-json ../../e2e/.e2e-credentials.json
 *
 * Requires: DATABASE_URL, JWT_SECRET, REDIS_URL (same as API), migrated DB, BTC+USDT in currencies.
 */
import dotenv from 'dotenv';
import path from 'path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import Decimal from 'decimal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
  const { config } = await import('../src/config/index.js');

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
  // Keep generated E2E tokens aligned with backend runtime defaults (12h in dev),
  // otherwise stale credentials quickly fail /auth/me and private WS auth.
  const expiresIn = process.env.E2E_JWT_EXPIRES_IN || config.jwt.expiresIn || process.env.JWT_EXPIRES_IN || '12h';

  /** Local Postgres (Docker/host) typically has no TLS; `ssl = { rejectUnauthorized: false }` still enables STARTTLS and fails. Remote DBs usually need permissive TLS. */
  function pgSslForUrl(connectionString: string): undefined | { rejectUnauthorized: boolean } {
    try {
      const normalized = connectionString.replace(/^postgresql:/i, 'http:').replace(/^postgres:/i, 'http:');
      const u = new URL(normalized);
      const host = (u.hostname || '').toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost' || host === 'postgres' || host.endsWith('.internal')) {
        return undefined;
      }
    } catch {
      /* ignore */
    }
    if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false') {
      return { rejectUnauthorized: false };
    }
    return undefined;
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: pgSslForUrl(url),
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
  const hasSpotTradingSuspendedAt = userCols.rows.some((r) => r.column_name === 'spot_trading_suspended_at');
  const hasLockedUntil = userCols.rows.some((r) => r.column_name === 'locked_until');
  const hasFailedLoginAttempts = userCols.rows.some((r) => r.column_name === 'failed_login_attempts');

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
  const targetUsers = [idA, idB];

  const userSetClauses = ["status = 'active'"];
  if (hasSpotTradingSuspendedAt) userSetClauses.push('spot_trading_suspended_at = NULL');
  if (hasLockedUntil) userSetClauses.push('locked_until = NULL');
  if (hasFailedLoginAttempts) userSetClauses.push('failed_login_attempts = 0');
  await client.query(`UPDATE users SET ${userSetClauses.join(', ')} WHERE id = ANY($1::uuid[])`, [targetUsers]);

  // Prevent balance-integrity auto-suspension from stale OPEN orders left by older failed E2E runs.
  // We cancel orders first, then re-align balances to deterministic seed values below.
  const spotOrdersHasMarket = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='spot_orders' AND column_name='market'
     ) AS exists`
  );
  if (spotOrdersHasMarket.rows[0]?.exists) {
    await client.query(
      `UPDATE spot_orders
          SET status = 'CANCELLED', updated_at = NOW()
        WHERE user_id = ANY($1::uuid[])
          AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER', 'TRIGGERED')`,
      [targetUsers]
    );
  } else {
    await client.query(
      `UPDATE spot_orders
          SET status = 'cancelled'::order_status, updated_at = NOW()
        WHERE user_id = ANY($1::uuid[])
          AND status IN ('new'::order_status, 'partially_filled'::order_status)`,
      [targetUsers]
    );
  }

  const chainCol = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_balances' AND column_name='chain_id'`
  );
  const hasChainId = chainCol.rows.length > 0;

  async function fundTrading(userId: string, currencyId: string, amount: string) {
    const targetAvailable = new Decimal(amount);
    if (!targetAvailable.isFinite() || targetAvailable.isNegative()) {
      throw new Error(`Invalid funding amount: ${amount}`);
    }
    const balRow = hasChainId
      ? await client.query<{ available_balance: string; locked_balance: string }>(
          `SELECT COALESCE(available_balance, 0)::text AS available_balance,
                  COALESCE(locked_balance, 0)::text AS locked_balance
             FROM user_balances
            WHERE user_id = $1 AND currency_id = $2 AND chain_id = '' AND account_type = 'trading'
            LIMIT 1`,
          [userId, currencyId]
        )
      : await client.query<{ available_balance: string; locked_balance: string }>(
          `SELECT COALESCE(available_balance, 0)::text AS available_balance,
                  COALESCE(locked_balance, 0)::text AS locked_balance
             FROM user_balances
            WHERE user_id = $1 AND currency_id = $2 AND account_type = 'trading'
            LIMIT 1`,
          [userId, currencyId]
        );
    const beforeAvailable = new Decimal(balRow.rows[0]?.available_balance ?? '0');
    const beforeLocked = new Decimal(balRow.rows[0]?.locked_balance ?? '0');

    if (hasChainId) {
      await client.query(
        `INSERT INTO user_balances (user_id, currency_id, chain_id, account_type, available_balance, locked_balance)
         VALUES ($1, $2, '', 'trading', $3::numeric, 0)
         ON CONFLICT (user_id, currency_id, chain_id, account_type)
         DO UPDATE SET available_balance = EXCLUDED.available_balance, locked_balance = EXCLUDED.locked_balance`,
        [userId, currencyId, amount]
      );
    } else {
      await client.query(
        `INSERT INTO user_balances (user_id, currency_id, account_type, available_balance, locked_balance)
         VALUES ($1, $2, 'trading', $3::numeric, 0)
         ON CONFLICT (user_id, currency_id, account_type)
         DO UPDATE SET available_balance = EXCLUDED.available_balance, locked_balance = EXCLUDED.locked_balance`,
        [userId, currencyId, amount]
      );
    }

    const ledgerRow = await client.query<{ avail_sum: string; lock_sum: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN balance_type = 'available' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS avail_sum,
         COALESCE(SUM(CASE WHEN balance_type = 'locked' THEN credit::numeric - debit::numeric ELSE 0 END), 0)::text AS lock_sum
       FROM balance_ledger
       WHERE user_id = $1::uuid
         AND currency_id = $2::uuid
         AND description LIKE '%account_type=trading%'`,
      [userId, currencyId]
    );
    const ledgerAvailable = new Decimal(ledgerRow.rows[0]?.avail_sum ?? '0');
    const ledgerLocked = new Decimal(ledgerRow.rows[0]?.lock_sum ?? '0');
    const deltaAvailable = targetAvailable.minus(ledgerAvailable);
    const targetLocked = new Decimal(0);
    const deltaLocked = targetLocked.minus(ledgerLocked);

    if (!deltaAvailable.isZero()) {
      const refId = randomUUID();
      await client.query(
        `INSERT INTO balance_ledger (
           user_id, currency_id, reference_type, reference_id, debit, credit,
           balance_before, balance_after, balance_type, description, created_at
         ) VALUES (
           $1::uuid, $2::uuid, 'adjustment'::ledger_reference_type, $3::uuid, $4::numeric, $5::numeric,
           $6::numeric, $7::numeric, 'available'::balance_type, $8, NOW()
         )`,
        [
          userId,
          currencyId,
          refId,
          deltaAvailable.isNegative() ? deltaAvailable.abs().toString() : '0',
          deltaAvailable.isPositive() ? deltaAvailable.toString() : '0',
          ledgerAvailable.toString(),
          targetAvailable.toString(),
          'account_type=trading;e2e_seed_balance=1',
        ]
      );
    }
    if (!deltaLocked.isZero()) {
      const refId = randomUUID();
      await client.query(
        `INSERT INTO balance_ledger (
           user_id, currency_id, reference_type, reference_id, debit, credit,
           balance_before, balance_after, balance_type, description, created_at
         ) VALUES (
           $1::uuid, $2::uuid, 'adjustment'::ledger_reference_type, $3::uuid, $4::numeric, $5::numeric,
           $6::numeric, $7::numeric, 'locked'::balance_type, $8, NOW()
         )`,
        [
          userId,
          currencyId,
          refId,
          deltaLocked.isNegative() ? deltaLocked.abs().toString() : '0',
          deltaLocked.isPositive() ? deltaLocked.toString() : '0',
          ledgerLocked.toString(),
          targetLocked.toString(),
          'account_type=trading;e2e_seed_balance=1',
        ]
      );
    }
    if (!beforeLocked.isZero() || !beforeAvailable.eq(targetAvailable)) {
      console.log(
        `Aligned trading balance for ${userId}/${currencyId}: available ${beforeAvailable.toString()} -> ${targetAvailable.toString()}, locked ${beforeLocked.toString()} -> 0`
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

  const emitIdx = process.argv.indexOf('--emit-json');
  if (emitIdx >= 0) {
    const rawPath = process.argv[emitIdx + 1];
    if (!rawPath?.trim()) {
      console.error('Usage: --emit-json <path-to.json>');
      process.exit(1);
    }
    const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      JSON.stringify(
        {
          E2E_JWT: tokenA,
          E2E_COUNTERPARTY_JWT: tokenB,
          E2E_API_KEY: API_KEY_A,
          E2E_COUNTERPARTY_API_KEY: API_KEY_B,
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`Wrote credentials JSON: ${abs}`);
  }

  const shouldPrintSecrets = process.env.E2E_PRINT_SECRETS === '1';
  console.log('');
  if (shouldPrintSecrets) {
    console.log('=== E2E credentials (add to .env.e2e or export before npm run test:e2e) ===');
    console.log('');
    console.log(`E2E_JWT=${tokenA}`);
    console.log(`E2E_COUNTERPARTY_JWT=${tokenB}`);
    console.log(`E2E_API_KEY=${API_KEY_A}`);
    console.log(`E2E_COUNTERPARTY_API_KEY=${API_KEY_B}`);
    console.log('');
  } else {
    console.log('E2E credentials generated and saved (secrets hidden by default).');
    console.log('Set E2E_PRINT_SECRETS=1 only for local debugging.');
    console.log('');
  }
  console.log('=== Reference ===');
  console.log(JSON.stringify({ trader_a: A_EMAIL, trader_b: B_EMAIL, password: PASSWORD, user_ids: [idA, idB] }, null, 2));
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
