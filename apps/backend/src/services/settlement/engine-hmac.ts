/**
 * HMAC-SHA256 v2 for Node → Rust matching-engine.
 * Canonical line (UTF-8), then HMAC-SHA256(active_secret):
 *   v2\n{userId}\n{engineId}\n{GET|POST}\n{pathWithQuery}\n{body}\n{nonce}\n
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const ENGINE_HMAC_PAYLOAD_VERSION = 'v2';

export function buildEngineHmacCanonicalMessage(
  userId: string,
  engineId: string,
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body: string,
  nonce: string
): string {
  const uid = userId.trim();
  const eid = engineId.trim();
  if (!uid || !eid) {
    throw new Error('engine_hmac: userId and engineId required');
  }
  return `${ENGINE_HMAC_PAYLOAD_VERSION}\n${uid}\n${eid}\n${method}\n${pathWithQuery}\n${body}\n${nonce}\n`;
}

export function generateEngineNonce(): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}`;
}

export function signEngineHmacV2(
  secret: string,
  userId: string,
  engineId: string,
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body: string,
  nonce: string
): string {
  const msg = buildEngineHmacCanonicalMessage(userId, engineId, method, pathWithQuery, body, nonce);
  return createHmac('sha256', secret).update(msg, 'utf8').digest('hex');
}

export function engineHmacRequestHeaders(params: {
  activeSecret: string | undefined;
  method: 'GET' | 'POST';
  pathWithQuery: string;
  body: string;
  userId: string;
  engineId: string;
}): Record<string, string> {
  const secret = params.activeSecret?.trim();
  if (!secret) return {};
  const nonce = generateEngineNonce();
  const signature = signEngineHmacV2(secret, params.userId, params.engineId, params.method, params.pathWithQuery, params.body, nonce);
  return {
    'x-signature': signature,
    'x-nonce': nonce,
    'x-user-id': params.userId.trim(),
    'x-engine-id': params.engineId.trim(),
  };
}

/** Verify engine HMAC v2 (e.g. matching engine → internal API). Timing-safe compare. */
export function verifyEngineHmacV2(
  secret: string,
  userId: string,
  engineId: string,
  method: 'GET' | 'POST',
  pathWithQuery: string,
  body: string,
  nonce: string,
  signatureHex: string
): boolean {
  try {
    const expectedHex = signEngineHmacV2(secret, userId, engineId, method, pathWithQuery, body, nonce);
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(signatureHex.trim(), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
