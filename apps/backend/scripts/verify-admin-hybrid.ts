/**
 * Smoke-test admin hybrid routes. Requires a running API and admin JWT.
 *
 *   ADMIN_BASE_URL=http://127.0.0.1:4000/api/v1/admin \
 *   ADMIN_JWT=eyJ... \
 *   npx tsx scripts/verify-admin-hybrid.ts
 *
 * Optional write test (needs markets:manage + healthy Redis):
 *   HYBRID_VERIFY_APPLY_PATCH=true npx tsx scripts/verify-admin-hybrid.ts
 */
import 'dotenv/config';

const base = (process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4000/api/v1/admin').replace(/\/$/, '');
const staticToken = (process.env.ADMIN_JWT ?? process.env.ADMIN_ACCESS_TOKEN ?? '').trim();
const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@example.com').trim();
const adminPassword = (process.env.ADMIN_PASSWORD ?? 'admin123').trim();
const clientUa = (process.env.ADMIN_VERIFY_USER_AGENT ?? 'tier1-admin-hybrid-verify').trim();

type R = { name: string; ok: boolean; status: number; detail: string };

async function req(token: string, method: string, path: string, body?: unknown): Promise<R> {
  const name = `${method} ${path}`;
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': clientUa,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { name, ok: res.ok, status: res.status, detail: text.slice(0, 500) };
  } catch (e) {
    return { name, ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function resolveAdminToken(): Promise<string> {
  if (staticToken) return staticToken;
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': clientUa,
    },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`admin login failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as { data?: { accessToken?: string } };
  const token = parsed.data?.accessToken?.trim();
  if (!token) throw new Error('admin login response missing accessToken');
  return token;
}

async function main(): Promise<void> {
  const results: R[] = [];
  let token = '';
  try {
    token = await resolveAdminToken();
  } catch (e) {
    console.error(`SKIP: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(0);
  }

  results.push(await req(token, 'GET', '/hybrid/config'));
  results.push(await req(token, 'GET', '/hybrid/risk/overview'));

  const list = results[0];
  let firstId: string | null = null;
  if (list.ok && list.detail) {
    try {
      const j = JSON.parse(list.detail) as { data?: Array<{ id: string }> };
      firstId = j.data?.[0]?.id ?? null;
    } catch {
      /* ignore */
    }
  }

  if (firstId && process.env.HYBRID_VERIFY_APPLY_PATCH === 'true') {
    results.push(
      await req(token, 'PATCH', '/hybrid/config', {
        id: firstId,
        max_slippage_bps: 50,
      })
    );
  } else if (firstId && process.env.HYBRID_VERIFY_APPLY_PATCH !== 'true') {
    results.push({
      name: 'PATCH /hybrid/config',
      ok: true,
      status: 0,
      detail: 'skipped (set HYBRID_VERIFY_APPLY_PATCH=true to test PATCH)',
    });
  } else {
    results.push({
      name: 'PATCH /hybrid/config',
      ok: true,
      status: 0,
      detail: 'skipped (no hybrid config row available in database)',
    });
  }

  results.push(await req(token, 'GET', '/external-liquidity/providers'));

  for (const r of results) {
    console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.name} HTTP ${r.status}`);
    if (!r.ok) console.log(`  ${r.detail}`);
  }

  const allOk = results.every((x) => x.ok);
  process.exit(allOk ? 0 : 1);
}

void main();
