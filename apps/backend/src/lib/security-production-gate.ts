/**
 * Tier-0 production gates: required secrets and internal API posture.
 * Fail-closed in NODE_ENV=production only (local dev unchanged unless TIER0_STRICT=1).
 */

function isStrictProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.TIER0_STRICT === '1' ||
    process.env.TIER0_STRICT === 'true'
  );
}

export function getTier0ProductionViolations(): string[] {
  if (!isStrictProduction()) return [];
  const v: string[] = [];
  const jwt = process.env.JWT_SECRET?.trim() ?? '';
  if (jwt.length < 32) v.push('JWT_SECRET (min 32 chars)');

  const internal = process.env.ENGINE_INTERNAL_SECRET?.trim();
  if (!internal) v.push('ENGINE_INTERNAL_SECRET');

  const hmac =
    process.env.ENGINE_HMAC_SECRET_ACTIVE?.trim() || process.env.ENGINE_HMAC_SECRET?.trim();
  if (!hmac) v.push('ENGINE_HMAC_SECRET_ACTIVE (or ENGINE_HMAC_SECRET)');

  const cidrs = process.env.INTERNAL_API_ALLOW_CIDRS?.trim();
  if (!cidrs) v.push('INTERNAL_API_ALLOW_CIDRS');

  const hmacMap = process.env.INTERNAL_HMAC_SERVICE_SECRETS?.trim();
  if (!hmacMap) v.push('INTERNAL_HMAC_SERVICE_SECRETS (e.g. matching-engine=hexsecret)');

  const bgOn =
    process.env.ADMIN_BREAK_GLASS_ENABLED === 'true' || process.env.ADMIN_BREAK_GLASS_ENABLED === '1';
  if (bgOn) {
    const s = process.env.ADMIN_BREAK_GLASS_SECRET?.trim() ?? '';
    if (s.length < 32) v.push('ADMIN_BREAK_GLASS_SECRET (min 32 chars when break-glass enabled)');
    const bgIp = process.env.ADMIN_BREAK_GLASS_ALLOWED_IPS?.trim();
    if (!bgIp) v.push('ADMIN_BREAK_GLASS_ALLOWED_IPS (comma-separated CIDRs for break-glass)');
  }

  return v;
}

export function assertTier0ProductionSecurityOrExit(): void {
  const violations = getTier0ProductionViolations();
  if (violations.length === 0) return;
  // eslint-disable-next-line no-console
  console.error('❌ Tier-0 security: refuse to start — fix:', violations.join('; '));
  process.exit(1);
}
