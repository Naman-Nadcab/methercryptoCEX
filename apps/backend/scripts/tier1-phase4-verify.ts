/**
 * Tier 1 Phase 4 gate (hybrid/binance execution readiness):
 * - GET /health must be healthy
 * - verify-admin-hybrid smoke must pass
 * - if hedge_global_enabled=true then at least one active external provider must exist
 * - optional Binance testnet credential validation (strict when TIER1_REQUIRE_BINANCE_TESTNET=true)
 *
 * Env:
 *   E2E_BASE_URL (default: http://127.0.0.1:4000)
 *   ADMIN_EMAIL / ADMIN_PASSWORD (default: admin@example.com / admin123)
 *   TIER1_REQUIRE_BINANCE_TESTNET=true|false
 *   BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_SECRET
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.E2E_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const adminBase = `${base}/api/v1/admin`;
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin123';
const requireBinance = process.env.TIER1_REQUIRE_BINANCE_TESTNET === 'true';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<void> {
  const healthRes = await fetch(`${base}/health`);
  const healthJson = (await healthRes.json().catch(() => null)) as { status?: string } | null;
  if (!healthRes.ok || healthJson?.status !== 'healthy') {
    console.error('TIER1_PHASE4_FAIL: /health is not healthy', healthRes.status, healthJson?.status);
    process.exit(1);
  }
  console.log('[phase4] /health OK healthy');

  const loginRes = await fetch(`${adminBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'tier1-phase4-verify' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginJson = (await loginRes.json().catch(() => null)) as { data?: { accessToken?: string } } | null;
  const token = loginJson?.data?.accessToken?.trim();
  if (!token) {
    console.error('TIER1_PHASE4_FAIL: admin login failed for phase4 checks');
    process.exit(1);
  }

  const riskRes = await fetch(`${adminBase}/hybrid/risk/overview`, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'tier1-phase4-verify' },
  });
  const riskJson = (await riskRes.json().catch(() => null)) as
    | { success?: boolean; data?: { flags?: { hedge_global_enabled?: boolean } } }
    | null;
  if (!riskRes.ok || !riskJson?.success) {
    console.error('TIER1_PHASE4_FAIL: /hybrid/risk/overview failed', riskRes.status);
    process.exit(1);
  }
  const hedgeGlobalEnabled = riskJson?.data?.flags?.hedge_global_enabled === true;

  const providersRes = await fetch(`${adminBase}/external-liquidity/providers`, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'tier1-phase4-verify' },
  });
  const providersJson = (await providersRes.json().catch(() => null)) as
    | {
        success?: boolean;
        data?: Array<{ id: string; enabled: boolean; api_key_configured: boolean; api_secret_configured: boolean }>;
      }
    | null;
  if (!providersRes.ok || !providersJson?.success || !Array.isArray(providersJson.data)) {
    console.error('TIER1_PHASE4_FAIL: provider list failed', providersRes.status);
    process.exit(1);
  }
  const activeConfiguredProviders = providersJson.data.filter(
    (p) => p.enabled && p.api_key_configured && p.api_secret_configured
  );
  if (hedgeGlobalEnabled && activeConfiguredProviders.length === 0) {
    console.error('TIER1_PHASE4_FAIL: hedge_global_enabled but no active configured external provider');
    process.exit(1);
  }
  console.log('[phase4] active configured providers', activeConfiguredProviders.length);

  console.log('[phase4] running verify:admin-hybrid ...');
  execSync('HYBRID_VERIFY_APPLY_PATCH=true npm run verify:admin-hybrid', {
    cwd: path.resolve(repoRoot, 'apps/backend'),
    stdio: 'inherit',
    env: { ...process.env, ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword, ADMIN_BASE_URL: adminBase },
  });

  const hasBinanceCreds =
    Boolean(process.env.BINANCE_TESTNET_API_KEY?.trim()) && Boolean(process.env.BINANCE_TESTNET_SECRET?.trim());
  if (!hasBinanceCreds) {
    if (requireBinance) {
      console.error(
        'TIER1_PHASE4_FAIL: BINANCE_TESTNET_API_KEY/BINANCE_TESTNET_SECRET required (TIER1_REQUIRE_BINANCE_TESTNET=true)'
      );
      process.exit(1);
    }
    console.warn(
      '[phase4] WARN: Binance testnet credential validation skipped (set creds or TIER1_REQUIRE_BINANCE_TESTNET=true)'
    );
    console.log('TIER1_PHASE4_VERIFY_OK');
    return;
  }

  console.log('[phase4] running qa-binance-testnet-validate ...');
  execSync('npx tsx scripts/qa-binance-testnet-validate.ts', {
    cwd: path.resolve(repoRoot, 'apps/backend'),
    stdio: 'inherit',
    env: { ...process.env, ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: adminPassword, API_BASE_URL: base },
  });

  console.log('TIER1_PHASE4_VERIFY_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
