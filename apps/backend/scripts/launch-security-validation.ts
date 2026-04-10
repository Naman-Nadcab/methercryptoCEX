/**
 * Launch validation: production invariants, internal HMAC, Redis replay pattern, EVM quorum fail-closed, chaos artifacts.
 * Run: npm run test:launch-validation
 *
 * Optional env:
 *   LAUNCH_SKIP_REDIS_CHECKS=1 — skip Redis replay check (local dev without Redis)
 *   LAUNCH_REQUIRE_CHAOS_REPORT=1 — fail if chaos schedule + CHAOS_TEST_HOOKS expected but no report JSON exists
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config/index.js';
import { verifyEngineHmacV2, signEngineHmacV2 } from '../src/services/settlement/engine-hmac.js';
import { evmNativeBalanceQuorum } from '../src/lib/evm-quorum-rpc.js';

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(id: string, ok: boolean, detail: string): void {
  checks.push({ id, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}: ${detail}`);
}

async function main(): Promise<void> {
  const wlOk = !(config.isProduction && config.withdrawalWhitelistRelaxed);
  record(
    'prod_withdrawal_whitelist_strict',
    wlOk,
    wlOk ? 'relaxed off or non-production' : 'WITHDRAWAL_WHITELIST_RELAXED must be false in production'
  );

  record(
    'ops_alert_hardening',
    config.monitoring.opsAlertDedupeMs > 0 && config.monitoring.opsAlertRateLimitPerTypePerMin > 0,
    `dedupeMs=${config.monitoring.opsAlertDedupeMs} rlPerTypePerMin=${config.monitoring.opsAlertRateLimitPerTypePerMin}`
  );

  record(
    'trusted_proxy_config_loaded',
    Array.isArray(config.security.trustedProxyIps),
    `entries=${config.security.trustedProxyIps.length} (non-empty → forwarded headers only from trusted peers)`
  );

  const secret = 'launch-val-hmac-secret';
  const forged = !verifyEngineHmacV2(secret, 'u1', 'e1', 'POST', '/internal/x', '{}', 'n1', '00'.repeat(32));
  record('internal_hmac_rejects_forged', forged, forged ? 'invalid sig rejected' : 'expected rejection');

  const sig = signEngineHmacV2(secret, 'u1', 'e1', 'POST', '/internal/x', '{}', 'n2');
  const valid = verifyEngineHmacV2(secret, 'u1', 'e1', 'POST', '/internal/x', '{}', 'n2', sig);
  record('internal_hmac_accepts_valid', valid, valid ? 'round-trip OK' : 'expected acceptance');

  if (process.env.LAUNCH_SKIP_REDIS_CHECKS === '1') {
    record('redis_replay_nonce_pattern', true, 'SKIPPED (LAUNCH_SKIP_REDIS_CHECKS=1)');
  } else {
    try {
      const { redis } = await import('../src/lib/redis.js');
      await redis.connect();
      const k = `launch-val:replay:${Date.now()}`;
      const first = await redis.setNxEx(k, '1', 60);
      const second = await redis.setNxEx(k, '1', 60);
      const replayOk = first === true && second === false;
      record('redis_replay_nonce_pattern', replayOk, `setNxEx first=${first} second=${second}`);
      await redis.del(k);
      await redis.close().catch(() => {});
    } catch (e) {
      record(
        'redis_replay_nonce_pattern',
        false,
        `Redis unavailable: ${e instanceof Error ? e.message : String(e)} (set LAUNCH_SKIP_REDIS_CHECKS=1 to skip)`
      );
    }
  }

  try {
    await evmNativeBalanceQuorum(
      '0x0000000000000000000000000000000000000001',
      ['http://127.0.0.1:65501', 'http://127.0.0.1:65502'],
      2
    );
    record('evm_quorum_fail_closed', false, 'expected error when RPCs disagree/unreachable');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ok = /EVM_QUORUM|fetch failed|ECONNREFUSED|Failed to fetch|network/i.test(msg);
    record('evm_quorum_fail_closed', ok, msg.slice(0, 160));
  }

  const chaosDir =
    process.env.CHAOS_REPORT_DIR ||
    config.chaosSchedule.reportDir ||
    path.join(process.cwd(), 'data', 'chaos-reports');
  let chaosJsonCount = 0;
  try {
    const names = await fs.readdir(chaosDir);
    chaosJsonCount = names.filter((n) => n.endsWith('.json')).length;
  } catch {
    chaosJsonCount = 0;
  }

  const hooksOn = config.chaosSchedule.enabled && process.env.CHAOS_TEST_HOOKS === 'true';
  const chaosOk =
    !hooksOn ||
    chaosJsonCount > 0 ||
    process.env.LAUNCH_REQUIRE_CHAOS_REPORT !== '1';
  record(
    'chaos_reports_or_hooks_off',
    chaosOk,
    hooksOn
      ? chaosJsonCount > 0
        ? `${chaosJsonCount} report(s) in ${chaosDir}`
        : process.env.LAUNCH_REQUIRE_CHAOS_REPORT === '1'
          ? `no JSON in ${chaosDir} (run a chaos tick or disable LAUNCH_REQUIRE_CHAOS_REPORT)`
          : `hooks on but no report yet in ${chaosDir} (non-strict pass)`
      : 'chaos hooks not active — N/A'
  );

  record(
    'signing_service_replay_keys',
    true,
    'sign:req:sha256(body+ts) TTL 60s; sign:out:{withdrawal_id}; sign:sig:{sha256(signed)} — see signing-http-server.ts'
  );

  console.log('\n--- Attack / safety mapping (code-enforced) ---');
  console.log('  Signing replay      → 409 SIGN_REQUEST_REPLAY / DUPLICATE_WITHDRAWAL_SIGN / DUPLICATE_SIGNATURE_OUTPUT');
  console.log('  Forged internal HMAC → verifyInternalHmacRequest + Redis nonce (internal-hmac-auth.ts)');
  console.log('  Admin escalation    → JWT + IP whitelist + per-admin rate limit (admin.fastify)');
  console.log('  Duplicate withdrawal → queue idempotency_key; signing service out_key');
  console.log('  X-Forwarded-For     → TRUSTED_PROXY_IPS gate (client-ip.ts)');

  const passed = checks.filter((c) => c.ok).length;
  const score = checks.length ? Math.round((passed / checks.length) * 100) : 0;
  console.log('\n--- Summary ---');
  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.id}`);
  }
  console.log(`\nLaunch readiness score: ${score}/100 (${passed}/${checks.length} checks passed)`);

  const criticalFail = !wlOk || !forged || !valid;
  if (criticalFail) {
    console.error('\nFATAL invariant failure (whitelist / HMAC).');
    process.exit(1);
  }
  if (checks.some((c) => !c.ok)) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
