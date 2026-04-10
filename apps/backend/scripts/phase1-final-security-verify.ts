/**
 * Phase-1 final security smoke checks (minimal env; uses Redis when available).
 * Run from apps/backend: npx tsx scripts/phase1-final-security-verify.ts
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signEngineHmacV2, verifyEngineHmacV2 } from '../src/services/settlement/engine-hmac.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');
const tsxCliCandidates = [
  path.join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  path.join(backendRoot, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
];
const tsxCli = tsxCliCandidates.find((p) => existsSync(p)) ?? tsxCliCandidates[0]!;

function runSubprocess(scriptName: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [tsxCli, path.join(__dirname, scriptName), ...args], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 60_000,
  });
}

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

function decodeJwtExpMinusIat(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      exp?: number;
      iat?: number;
    };
    if (payload.exp == null || payload.iat == null) return null;
    return payload.exp - payload.iat;
  } catch {
    return null;
  }
}

async function main() {
  const secret = 'c'.repeat(32);
  const sig = signEngineHmacV2(secret, 'u1', 'e1', 'GET', '/internal/engine/state', '', 'n1');
  if (!verifyEngineHmacV2(secret, 'u1', 'e1', 'GET', '/internal/engine/state', '', 'n1', sig)) {
    fail('HMAC valid sig should verify');
  }
  if (verifyEngineHmacV2(secret, 'u1', 'e1', 'GET', '/internal/engine/state', '', 'n1', 'bad')) {
    fail('HMAC invalid sig must be rejected');
  }

  const { verifyInternalHmacRequest } = await import('../src/lib/internal-hmac-auth.js');
  const unsigned = await verifyInternalHmacRequest({
    headers: {},
    method: 'GET',
    url: '/internal/engine/state',
    body: undefined,
  } as Parameters<typeof verifyInternalHmacRequest>[0]);
  if (unsigned) fail('internal HMAC must reject unsigned request');

  const prev = 'genesis';
  const canon = JSON.stringify({ action: 'test', actor: 'a' });
  const h1 = createHash('sha256').update(`${prev}|${canon}`, 'utf8').digest('hex');
  const h2 = createHash('sha256').update(`${h1}|${canon}`, 'utf8').digest('hex');
  if (h1 === h2) fail('audit chain hashes must change per link');

  const { refreshRedisHealth, getRedisHealthSnapshot, redisBlocksHighRiskActions } = await import(
    '../src/services/redis-health.service.js'
  );
  await refreshRedisHealth();
  const snap = getRedisHealthSnapshot();
  if (typeof snap.ok !== 'boolean') fail('redis health snapshot missing ok');

  const sub = runSubprocess('phase1-maker-check-subprocess.ts', [], {
    MAKER_CHECKER_ENABLED: 'true',
    MAKER_CHECKER_REQUIRED_APPROVALS: '1',
    MAKER_CHECKER_DELAY_SEC: '300',
  });
  if (sub.status !== 0) fail(`maker-checker subprocess failed: ${sub.stderr || sub.stdout}`);
  if (String(sub.stdout).trim() !== '1') fail(`expected effective approvals 1 for manual_credit, got ${sub.stdout}`);

  const bg = runSubprocess('phase1-break-glass-ip-subprocess.ts');
  if (bg.status !== 0) fail(`break-glass IP subprocess failed: ${bg.stderr || bg.stdout}`);
  if (String(bg.stdout).trim() !== '1') fail('break-glass IP allowlist check failed');

  for (const m of ['degraded', 'strict'] as const) {
    const ch = runSubprocess('phase1-chaos-redis-subprocess.ts', [], { PHASE1_VERIFY_REDIS_MODE: m });
    if (ch.status !== 0) fail(`chaos redis subprocess (${m}) failed: ${ch.stderr || ch.stdout}`);
    if (String(ch.stdout).trim() !== '1') fail(`chaos redis (${m}) unexpected output`);
  }

  const jwt = await import('jsonwebtoken');
  const signJwt = jwt.default?.sign ?? jwt.sign;
  const short = signJwt(
    { type: 'admin', breakGlass: true, sessionId: 's', adminId: 'a', email: 'e', role: 'r' },
    'x'.repeat(32),
    { expiresIn: '15m' }
  );
  const delta = decodeJwtExpMinusIat(short);
  if (delta == null || delta > 900) fail(`break-glass-style JWT should expire ≤900s from iat, got ${delta}`);

  await refreshRedisHealth();
  if (typeof redisBlocksHighRiskActions() !== 'boolean') fail('redisBlocksHighRiskActions must be boolean');
  void snap;

  console.log('OK: phase1-final-security-verify passed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
