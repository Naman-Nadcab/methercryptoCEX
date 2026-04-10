/**
 * INTERNAL_HMAC_SERVICE_SECRETS: comma-separated serviceId=secret pairs.
 * When non-empty, verifyInternalHmacRequest uses the secret for X-Service-Id only (no spoofing with shared engine secret).
 */
export function parseInternalHmacServiceSecrets(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const s = (raw ?? '').trim();
  if (!s) return out;
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const id = p.slice(0, eq).trim();
    const secret = p.slice(eq + 1).trim();
    if (id && secret) out[id] = secret;
  }
  return out;
}

export function resolveInternalHmacSecretForService(
  serviceId: string | undefined,
  serviceSecrets: Record<string, string>
): string | null {
  if (!serviceId) return null;
  const s = serviceSecrets[serviceId]?.trim();
  return s || null;
}
