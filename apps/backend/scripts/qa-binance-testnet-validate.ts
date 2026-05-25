/**
 * PATCH Binance Spot testnet credentials on external_liquidity_providers, then POST /test.
 *
 * Prerequisites (from https://testnet.binance.vision ):
 *   export BINANCE_TESTNET_API_KEY="..."
 *   export BINANCE_TESTNET_SECRET="..."
 *
 * Optional:
 *   ADMIN_EMAIL, ADMIN_PASSWORD (default: seed-admin creds)
 *   EXTERNAL_LIQUIDITY_PROVIDER_ID (default: first row in DB)
 *
 * Run from repo root:
 *   cd apps/backend && npx tsx scripts/qa-binance-testnet-validate.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

function pgSsl(connectionString: string): undefined | { rejectUnauthorized: boolean } {
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
  return process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false'
    ? { rejectUnauthorized: false }
    : undefined;
}

async function main(): Promise<void> {
  const key = process.env.BINANCE_TESTNET_API_KEY?.trim();
  const secret = process.env.BINANCE_TESTNET_SECRET?.trim();
  if (!key || !secret) {
    console.error('Missing BINANCE_TESTNET_API_KEY and/or BINANCE_TESTNET_SECRET. Export both, then rerun.');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not set.');
    process.exit(1);
  }

  let providerId = process.env.EXTERNAL_LIQUIDITY_PROVIDER_ID?.trim();
  if (!providerId) {
    const c = new pg.Client({ connectionString: dbUrl, ssl: pgSsl(dbUrl) });
    await c.connect();
    try {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM external_liquidity_providers ORDER BY priority, created_at NULLS LAST LIMIT 1`
      );
      providerId = r.rows[0]?.id;
    } finally {
      await c.end();
    }
    if (!providerId) {
      console.error('No external_liquidity_providers row found.');
      process.exit(1);
    }
  }

  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'admin123';

  const loginRes = await fetch(`${BASE}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = (await loginRes.json()) as { success?: boolean; data?: { accessToken?: string } };
  const token = loginJson.data?.accessToken;
  if (!token) {
    console.error('Admin login failed', loginRes.status, JSON.stringify(loginJson).slice(0, 800));
    process.exit(1);
  }

  const patchRes = await fetch(`${BASE}/api/v1/admin/external-liquidity/providers/${providerId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      base_url: 'https://testnet.binance.vision',
      is_testnet: true,
      enabled: true,
      api_key: key,
      api_secret: secret,
    }),
  });
  const patchJson = await patchRes.json().catch(() => null);
  if (!patchRes.ok || !patchJson || (patchJson as { success?: boolean }).success !== true) {
    console.error('PATCH provider failed', patchRes.status, JSON.stringify(patchJson).slice(0, 1200));
    process.exit(1);
  }

  const testRes = await fetch(`${BASE}/api/v1/admin/external-liquidity/providers/${providerId}/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const testJson = (await testRes.json()) as { success?: boolean; data?: unknown };
  console.log(JSON.stringify(testJson, null, 2));
  if (!testRes.ok || testJson.success !== true) {
    process.exit(1);
  }
  console.error('\nOK: Binance testnet connection test returned success: true');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
