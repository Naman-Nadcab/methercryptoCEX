/**
 * Match client socket IP against TRUSTED_PROXY_IPS (exact IPv4/IPv6 or IPv4 CIDR a.b.c.d/nn).
 */
function normalizePeerIp(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('::ffff:') && t.includes('.')) return t.slice(7);
  return t;
}

function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    const v = parseInt(x, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function matchesRule(peer: string, rule: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  const peerN = normalizePeerIp(peer);
  if (!r.includes('/')) {
    return peerN === normalizePeerIp(r);
  }
  const [netPart, bitsStr] = r.split('/', 2);
  if (!netPart) return false;
  const bits = parseInt(bitsStr ?? '', 10);
  const netInt = ipv4ToInt(normalizePeerIp(netPart));
  const peerInt = ipv4ToInt(peerN);
  if (netInt == null || peerInt == null || !Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : bits >= 32 ? 0xffffffff : ((0xffffffff << (32 - bits)) >>> 0);
  return (netInt & mask) === (peerInt & mask);
}

/** True if immediate TCP peer is a trusted proxy (empty rules = no strict proxy trust). */
export function isTrustedProxyPeer(socketRemoteAddress: string | undefined, rules: readonly string[]): boolean {
  if (rules.length === 0) return false;
  const peer = socketRemoteAddress ?? '';
  if (!peer) return false;
  return rules.some((rule) => matchesRule(peer, rule));
}
