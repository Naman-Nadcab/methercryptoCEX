/**
 * Fresh env parse: break-glass IP allowlist (ADMIN_BREAK_GLASS_ALLOWED_IPS).
 * Invoked by phase1-final-security-verify.
 */
/** development: avoid Tier-0 production gate; allowlist branch still exercises real IP matching. */
process.env.NODE_ENV = 'development';
process.env.ADMIN_BREAK_GLASS_ALLOWED_IPS = '203.0.113.10/32';

async function main() {
  const { isBreakGlassClientIpAllowed } = await import('../src/lib/break-glass-access.js');
  if (!isBreakGlassClientIpAllowed('203.0.113.10')) process.exit(1);
  if (isBreakGlassClientIpAllowed('192.0.2.1')) process.exit(2);
  process.stdout.write('1');
}

main().catch(() => process.exit(3));
