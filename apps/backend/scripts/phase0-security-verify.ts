/**
 * Phase-0 security smoke checks (no HTTP server required).
 * Run: npx tsx scripts/phase0-security-verify.ts
 */
import { getTier0ProductionViolations } from '../src/lib/security-production-gate.js';
import { signEngineHmacV2, verifyEngineHmacV2 } from '../src/services/settlement/engine-hmac.js';

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

async function main() {
  const saved = {
    TIER0_STRICT: process.env.TIER0_STRICT,
    JWT_SECRET: process.env.JWT_SECRET,
    ENGINE_INTERNAL_SECRET: process.env.ENGINE_INTERNAL_SECRET,
    ENGINE_HMAC_SECRET_ACTIVE: process.env.ENGINE_HMAC_SECRET_ACTIVE,
    ENGINE_HMAC_SECRET: process.env.ENGINE_HMAC_SECRET,
    INTERNAL_API_ALLOW_CIDRS: process.env.INTERNAL_API_ALLOW_CIDRS,
    INTERNAL_HMAC_SERVICE_SECRETS: process.env.INTERNAL_HMAC_SERVICE_SECRETS,
  };

  try {
    process.env.TIER0_STRICT = '1';
    process.env.JWT_SECRET = 'a'.repeat(32);
    delete process.env.ENGINE_INTERNAL_SECRET;
    delete process.env.ENGINE_HMAC_SECRET_ACTIVE;
    delete process.env.ENGINE_HMAC_SECRET;
    delete process.env.INTERNAL_API_ALLOW_CIDRS;
    delete process.env.INTERNAL_HMAC_SERVICE_SECRETS;

    const v = getTier0ProductionViolations();
    if (!v.some((x) => x.includes('ENGINE_INTERNAL_SECRET'))) {
      fail('expected ENGINE_INTERNAL_SECRET in Tier-0 violations');
    }
    if (!v.some((x) => x.includes('HMAC'))) {
      fail('expected HMAC in Tier-0 violations');
    }
    if (!v.some((x) => x.includes('INTERNAL_API_ALLOW_CIDRS'))) {
      fail('expected INTERNAL_API_ALLOW_CIDRS in Tier-0 violations');
    }
    if (!v.some((x) => x.includes('INTERNAL_HMAC_SERVICE_SECRETS'))) {
      fail('expected INTERNAL_HMAC_SERVICE_SECRETS in Tier-0 violations');
    }

    const secret = 'b'.repeat(32);
    const sig = signEngineHmacV2(secret, 'u1', 'e1', 'GET', '/internal/engine/state', '', 'n1');
    if (!verifyEngineHmacV2(secret, 'u1', 'e1', 'GET', '/internal/engine/state', '', 'n1', sig)) {
      fail('HMAC verify should accept valid signature');
    }
    if (verifyEngineHmacV2(secret, 'u1', 'e1', 'GET', '/internal/engine/state', '', 'n1', 'deadbeef')) {
      fail('HMAC verify should reject garbage signature');
    }

    if (saved.TIER0_STRICT === undefined) delete process.env.TIER0_STRICT;
    else process.env.TIER0_STRICT = saved.TIER0_STRICT;
    if (saved.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = saved.JWT_SECRET;
    if (saved.ENGINE_INTERNAL_SECRET === undefined) delete process.env.ENGINE_INTERNAL_SECRET;
    else process.env.ENGINE_INTERNAL_SECRET = saved.ENGINE_INTERNAL_SECRET;
    if (saved.ENGINE_HMAC_SECRET_ACTIVE === undefined) delete process.env.ENGINE_HMAC_SECRET_ACTIVE;
    else process.env.ENGINE_HMAC_SECRET_ACTIVE = saved.ENGINE_HMAC_SECRET_ACTIVE;
    if (saved.ENGINE_HMAC_SECRET === undefined) delete process.env.ENGINE_HMAC_SECRET;
    else process.env.ENGINE_HMAC_SECRET = saved.ENGINE_HMAC_SECRET;
    if (saved.INTERNAL_API_ALLOW_CIDRS === undefined) delete process.env.INTERNAL_API_ALLOW_CIDRS;
    else process.env.INTERNAL_API_ALLOW_CIDRS = saved.INTERNAL_API_ALLOW_CIDRS;
    if (saved.INTERNAL_HMAC_SERVICE_SECRETS === undefined) delete process.env.INTERNAL_HMAC_SERVICE_SECRETS;
    else process.env.INTERNAL_HMAC_SERVICE_SECRETS = saved.INTERNAL_HMAC_SERVICE_SECRETS;

    const { redis } = await import('../src/lib/redis.js');
    const { issueSpotWsTicket, consumeWsTicket } = await import('../src/services/ws-ticket.service.js');
    try {
      await redis.connect();
      const t = await issueSpotWsTicket('user-a', 'sess-b', '203.0.113.9');
      const ok1 = await consumeWsTicket(t, '203.0.113.9', 'spot');
      if (!ok1.ok) fail('first ticket consume should succeed');
      const ok2 = await consumeWsTicket(t, '203.0.113.9', 'spot');
      if (ok2.ok) fail('reused WS ticket must be rejected');
      const ok3 = await consumeWsTicket('nope', '203.0.113.9', 'spot');
      if (ok3.ok) fail('invalid ticket must be rejected');
    } catch (e) {
      console.warn('SKIP Redis WS ticket replay test:', e instanceof Error ? e.message : e);
    }

    console.log('OK: phase0-security-verify passed');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
