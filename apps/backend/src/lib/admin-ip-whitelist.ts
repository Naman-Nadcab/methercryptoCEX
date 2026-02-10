/**
 * FIX #3: Admin IP whitelist enforcement for production.
 * Used after admin JWT auth succeeds to restrict admin API access to configured IPs/CIDRs.
 * Deterministic and testable: no I/O, pure functions.
 */

/**
 * Check if an IPv4 address is inside a CIDR range.
 * Supports only IPv4 (e.g. 10.0.0.0/8). No dependency; minimal implementation.
 */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const [netStr, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipParts = ip.split('.').map((p) => parseInt(p, 10));
  if (ipParts.length !== 4 || ipParts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const netParts = netStr.split('.').map((p) => parseInt(p, 10));
  if (netParts.length !== 4 || netParts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const ipNum = (ipParts[0]! << 24) | (ipParts[1]! << 16) | (ipParts[2]! << 8) | ipParts[3]!;
  const netNum = (netParts[0]! << 24) | (netParts[1]! << 16) | (netParts[2]! << 8) | netParts[3]!;
  const mask = prefix === 0 ? 0 : ~((1 << (32 - prefix)) - 1) >>> 0;
  return (ipNum >>> 0 & mask) === (netNum >>> 0 & mask);
}

/**
 * Returns true if the client IP is allowed by the whitelist.
 * Each entry is either an exact IP (IPv4 or IPv6) or an IPv4 CIDR (e.g. 10.0.0.0/8).
 */
export function isIpInWhitelist(clientIp: string, entries: readonly string[]): boolean {
  if (!clientIp || !entries.length) return false;
  const trimmed = clientIp.trim();
  for (const entry of entries) {
    const e = entry.trim();
    if (!e) continue;
    if (e.includes('/')) {
      if (trimmed.includes(':')) continue; // IPv6; we only support IPv4 CIDR
      if (ipv4InCidr(trimmed, e)) return true;
    } else {
      if (e === trimmed) return true;
    }
  }
  return false;
}
